import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { satisfies } from 'semver';
import { config, inputs, root, type PackageKey } from '../../src/config.ts';
import { verifyIntegrity } from '../../src/upstream.ts';
import type { createConsumer } from './consumer.ts';

/**
 * Checks installed files, exports, dependencies, and provenance against isolated upstream references.
 */
export function expectPackage(
  consumer: ReturnType<typeof createConsumer>,
  reference: ReturnType<typeof createConsumer>,
  key: PackageKey,
): void {
  const upstream = reference.manifest(key);
  const manifest = consumer.manifest(key);
  const directory = consumer.packageDirectory(key);
  const provenance = JSON.parse(readFileSync(join(directory, 'provenance.json'), 'utf8'));

  expect(manifest).toMatchObject({ name: config[key].name, version: config[key].version });
  expect(manifest.dependencies).toEqual(
    key === 'core'
      ? upstream.dependencies
      : {
          '@floating-ui/utils': upstream.dependencies['@floating-ui/utils'],
          [config.core.name]: config.dom.coreRange,
        },
  );

  for (const field of ['main', 'module', 'types', 'unpkg', 'exports', 'sideEffects']) {
    expect(manifest[field]).toEqual(upstream[field]);
  }

  const files = readdirSync(join(directory, 'dist')).sort();
  expect(files).toEqual(readdirSync(join(reference.packageDirectory(key), 'dist')).sort());
  expect(Object.keys(consumer.require(config[key].name)).sort()).toEqual(
    Object.keys(reference.require(inputs[key].name)).sort(),
  );

  for (const file of files) {
    const content = readFileSync(join(directory, 'dist', file), 'utf8');
    expect(content).not.toContain('@floating-ui/core');

    if (file.endsWith('.d.ts') || file.endsWith('.d.mts')) {
      expect(content).not.toMatch(/\b(?:Promise|Promisable)\s*</);
    }

    if (file.includes('.browser') || file.includes('.umd')) {
      expect(content).not.toContain('@floating-ui/utils');
    }
  }

  expect(readFileSync(join(directory, manifest.module), 'utf8')).toContain('@floating-ui/utils');
  expect(readFileSync(join(directory, 'LICENSE'), 'utf8')).toBe(
    readFileSync(join(reference.packageDirectory(key), 'LICENSE'), 'utf8'),
  );
  expect(provenance.upstream).toEqual(inputs[key]);
  expect(manifest.synchronousRelease.upstream).toEqual(inputs[key]);
  expect(manifest.synchronousRelease.transformerRevision).toBe(
    provenance.transformer.sourceRevision,
  );
  expect(provenance.validationPair[key].version).toBe(config[key].version);
  expect(provenance.utils.dependencyRange).toBe(upstream.dependencies['@floating-ui/utils']);
  expect(satisfies(provenance.utils.testVersion, provenance.utils.dependencyRange)).toBe(true);

  const installedUtils = JSON.parse(
    readFileSync(
      join(consumer.dependencyDirectory(key, '@floating-ui/utils'), 'package.json'),
      'utf8',
    ),
  );
  expect(installedUtils.version).toBe(inputs.utils[key].version);

  if (key === 'dom') {
    expect(manifest.synchronousRelease.coreVersion).toBe(config.dom.coreRange);
    expect(satisfies(provenance.validationPair.core.version, config.dom.coreRange)).toBe(true);
  }

  let fresh = true;

  if (process.env.FLOATING_UI_RELEASE_DIRECTORY) {
    const releaseDirectory = process.env.FLOATING_UI_RELEASE_DIRECTORY;
    const report = JSON.parse(readFileSync(join(releaseDirectory, 'release.json'), 'utf8'));
    const target = report.plan.key === key;
    verifyIntegrity(
      readFileSync(join(releaseDirectory, key + '.tgz')),
      target ? report.integrity : report.coreIntegrity,
    );
    fresh = target && !report.plan.existing;

    if (target) {
      expect(manifest.synchronousRelease).toEqual(report.plan.identity);
    }
  }

  // Reused archives keep their original utils bundle and transformer output. Never rebuild them for comparison.
  if (fresh) {
    expect(provenance.utils.testVersion).toBe(inputs.utils[key].version);
    const generatedDirectory = process.env.FLOATING_UI_RELEASE_DIRECTORY
      ? join(process.env.FLOATING_UI_RELEASE_DIRECTORY, 'packages', key)
      : join(root, 'dist', key);

    for (const file of [
      'package.json',
      'README.md',
      'LICENSE',
      ...files.map((name) => 'dist/' + name),
    ]) {
      expect(readFileSync(join(directory, file))).toEqual(
        readFileSync(join(generatedDirectory, file)),
      );
    }
  }
}
