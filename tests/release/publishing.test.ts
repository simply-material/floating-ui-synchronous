import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { config, inputs, repository } from '../../src/config.ts';
import {
  writeJSON,
  type RegistryPackage,
  type RegistryVersion,
  type ReleaseReport,
} from '../../scripts/release-helpers.ts';

/**
 * Creates validated report/archive fixtures; fake npm records commands and never accesses a registry.
 */
function publication() {
  const directory = mkdtempSync(join(tmpdir(), 'release-publish-'));
  const bytes = Buffer.from('validated archive fixture');
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  const report: ReleaseReport = {
    plan: {
      key: 'core',
      name: config.core.name,
      version: '1.8.0',
      reason: 'upstream',
      identity: { transformerRevision: 'source', upstream: inputs.core },
    },
    revision: 'checkout',
    dirty: false,
    integrity,
  };
  const published: RegistryVersion = {
    name: report.plan.name,
    version: report.plan.version,
    synchronousRelease: report.plan.identity,
    dist: { integrity, tarball: 'https://registry.npmjs.org/fixture.tgz' },
  };

  writeFileSync(join(directory, 'core.tgz'), bytes);
  writeJSON(join(directory, 'validated.json'), report);

  return { directory, report, published };
}

/**
 * Executes the real publisher against deterministic registry responses and a recording npm stub.
 */
function run(
  fixture: ReturnType<typeof publication>,
  responses: RegistryPackage[],
  dryRun = false,
) {
  const { directory, report } = fixture;
  const log = join(directory, 'commands.jsonl');
  const stub = join(directory, 'npm.mjs');
  const runner = join(directory, 'run.mjs');

  writeFileSync(log, '');
  writeJSON(join(directory, 'release.json'), report);
  writeJSON(join(directory, 'responses.json'), responses);

  writeFileSync(
    stub,
    `
      import { appendFileSync } from 'node:fs';

      appendFileSync(
        ${JSON.stringify(log)},
        JSON.stringify(process.argv.slice(2)) + '\\n',
      );
    `,
  );

  writeFileSync(
    runner,
    `
      import { readFileSync } from 'node:fs';

      // Assign inside the child: Windows can inherit npm_execpath under a different casing.
      process.env.npm_execpath = ${JSON.stringify(stub)};

      const responses = JSON.parse(
        readFileSync(${JSON.stringify(join(directory, 'responses.json'))}, 'utf8'),
      );

      globalThis.fetch = async () => {
        if (!responses.length) {
          throw new Error('Unexpected registry call');
        }

        return new Response(JSON.stringify(responses.shift()));
      };

      await import(${JSON.stringify(new URL('../../scripts/publish.ts', import.meta.url).href)});
    `,
  );

  const result = spawnSync(process.execPath, [runner, directory], {
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_execpath: stub,
      GITHUB_ACTIONS: 'true',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: 'checkout',
      RELEASE_PUBLISH_ENABLED: 'true',
      FLOATING_UI_DRY_RUN: String(dryRun),
    },
  });

  expect(result.error).toBeUndefined();

  const commands: string[][] = readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return { ...result, commands };
}

it('publishes one verified archive with the latest tag', () => {
  const fixture = publication();
  const result = run(fixture, [
    { versions: {}, 'dist-tags': {} },
    { versions: { '1.8.0': fixture.published }, 'dist-tags': { latest: '1.8.0' } },
  ]);

  expect(result.status, result.stderr).toBe(0);
  expect(result.commands).toEqual([
    [
      'publish',
      join(fixture.directory, 'core.tgz'),
      '--ignore-scripts',
      '--access',
      'public',
      '--tag',
      'latest',
    ],
  ]);
});

it('publishes an older line with maintenance while preserving latest', () => {
  const fixture = publication();
  const newer = { ...fixture.published, version: '2.0.0' };
  const result = run(fixture, [
    { versions: { '2.0.0': newer }, 'dist-tags': { latest: '2.0.0' } },
    {
      versions: { '1.8.0': fixture.published, '2.0.0': newer },
      'dist-tags': { latest: '2.0.0', maintenance: '1.8.0' },
    },
  ]);

  expect(result.status, result.stderr).toBe(0);
  expect(result.commands).toHaveLength(1);
  expect(result.commands[0].slice(-2)).toEqual(['--tag', 'maintenance']);
});

it('reuses identical npm publications without republishing or changing tags', () => {
  const fixture = publication();
  const result = run(fixture, [{ versions: { '1.8.0': fixture.published }, 'dist-tags': {} }]);

  expect(result.status, result.stderr).toBe(0);
  expect(result.commands).toEqual([]);
});

it('simulates an uncommitted preview without requiring a publishable checkout', () => {
  const fixture = publication();
  fixture.report.dirty = true;
  writeJSON(join(fixture.directory, 'validated.json'), fixture.report);

  const result = run(fixture, [{ versions: {}, 'dist-tags': {} }], true);

  expect(result.status, result.stderr).toBe(0);
  expect(result.commands[0].at(-1)).toBe('--dry-run');
});

it.each(['dirty', 'report', 'archive', 'integrity', 'identity'])(
  'rejects %s mismatches before issuing any npm mutation',
  (change) => {
    const fixture = publication();

    if (change === 'dirty') {
      fixture.report.dirty = true;
      writeJSON(join(fixture.directory, 'validated.json'), fixture.report);
    } else if (change === 'report') {
      fixture.report.revision = 'different';
    } else if (change === 'archive') {
      writeFileSync(join(fixture.directory, 'core.tgz'), 'changed');
    } else if (change === 'integrity') {
      fixture.published.dist.integrity = 'sha512-wrong';
    } else {
      fixture.published.synchronousRelease = {
        ...fixture.report.plan.identity,
        transformerRevision: 'different',
      };
    }

    const result = run(fixture, [
      { versions: { '1.8.0': fixture.published }, 'dist-tags': { latest: '1.8.0' } },
    ]);

    expect(result.status).toBe(1);
    expect(result.commands).toEqual([]);
  },
);
