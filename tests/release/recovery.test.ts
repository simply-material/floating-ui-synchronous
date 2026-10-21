import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { config, inputs, root, type PackageKey, type SourcePackage } from '../../src/config.ts';
import { npm } from '../helpers/consumer.ts';
import { readReport, writeJSON, type ReleaseReport } from '../../scripts/release-helpers.ts';

it('resumes DOM with original archives and provenance without regenerating either package', () => {
  const directory = mkdtempSync(join(tmpdir(), 'release-recovery-'));
  const output = join(directory, 'review');

  mkdirSync(output);

  /**
   * Packs copies of baseline output; DOM metadata represents an earlier transformer checkout.
   */
  function archive(key: PackageKey): SourcePackage {
    const source = join(directory, key);
    cpSync(join(root, 'dist', key), source, { recursive: true });

    if (key === 'dom') {
      const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
      const provenance = JSON.parse(readFileSync(join(source, 'provenance.json'), 'utf8'));

      manifest.synchronousRelease.transformerRevision = 'original-source';
      provenance.transformer.sourceRevision = 'original-source';
      provenance.transformer.revision = 'original-checkout';

      writeJSON(join(source, 'package.json'), manifest);
      writeJSON(join(source, 'provenance.json'), provenance);
    }

    const [packed] = JSON.parse(
      npm(
        ['pack', source, '--json', '--ignore-scripts', '--pack-destination', directory],
        directory,
      ),
    );

    const bytes = readFileSync(join(directory, packed.filename));
    writeFileSync(join(directory, key + '.tgz'), bytes);

    return {
      name: config[key].name,
      version: config[key].version,
      integrity: packed.integrity,
      tarball: 'https://registry.npmjs.org/fixture-' + key + '.tgz',
    };
  }

  const core = archive('core');
  const dom = archive('dom');
  const manifest = JSON.parse(readFileSync(join(directory, 'dom/package.json'), 'utf8'));
  const coreManifest = JSON.parse(readFileSync(join(directory, 'core/package.json'), 'utf8'));
  const report: ReleaseReport = {
    plan: {
      key: 'dom',
      name: dom.name,
      version: dom.version,
      identity: manifest.synchronousRelease,
      reason: 'resume',
      existing: dom,
    },
    revision: 'current-validation-checkout',
    dirty: false,
  };

  writeJSON(join(output, 'release.json'), report);

  const registry = {
    versions: {
      [core.version]: {
        ...coreManifest,
        dist: { integrity: core.integrity, tarball: core.tarball },
      },
    },
    'dist-tags': { latest: core.version },
  };
  const runner = join(directory, 'run.mjs');

  writeFileSync(
    runner,
    `
      import { readFileSync } from 'node:fs';

      globalThis.fetch = async (url) => {
        if (url === ${JSON.stringify(dom.tarball)}) {
          return new Response(readFileSync(${JSON.stringify(join(directory, 'dom.tgz'))}));
        }

        if (url === ${JSON.stringify(core.tarball)}) {
          return new Response(readFileSync(${JSON.stringify(join(directory, 'core.tgz'))}));
        }

        if (url === ${JSON.stringify('https://registry.npmjs.org/' + encodeURIComponent(core.name))}) {
          return Response.json(${JSON.stringify(registry)});
        }

        throw new Error('Unexpected network request: ' + url);
      };

      await import(${JSON.stringify(new URL('../../scripts/build-release.ts', import.meta.url).href)});
    `,
  );

  const originalDOM = readFileSync(join(root, 'dist/dom/package.json'));

  execFileSync(process.execPath, [runner, output], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  expect(readFileSync(join(output, 'dom.tgz'))).toEqual(readFileSync(join(directory, 'dom.tgz')));
  expect(readFileSync(join(output, 'core.tgz'))).toEqual(readFileSync(join(directory, 'core.tgz')));
  expect(readFileSync(join(root, 'dist/dom/package.json'))).toEqual(originalDOM);

  expect(JSON.parse(readFileSync(join(output, 'upstream.lock.json'), 'utf8'))).toEqual(inputs);
  expect(JSON.parse(readFileSync(join(output, 'transform.config.json'), 'utf8'))).toEqual(config);
  expect(readReport(output)).toEqual({
    ...report,
    integrity: dom.integrity,
    coreIntegrity: core.integrity,
    artifactRevision: 'original-checkout',
  });
});
