import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { build, validateDependencies } from '../src/build.ts';
import { config, inputs, root } from '../src/config.ts';

/**
 * Reads every generated file, including provenance, for byte-for-byte rebuild comparisons.
 */
function artifacts(directory: string) {
  return Object.fromEntries(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [relative(directory, path), readFileSync(path, 'utf8')];
      }),
  );
}

it('rebuilds identical artifacts in a separate output directory', async () => {
  const before = artifacts(join(root, 'dist'));
  const outputDirectory = mkdtempSync(join(tmpdir(), 'floating-ui-synchronous-build-'));

  await build(outputDirectory);

  expect(artifacts(outputDirectory)).toEqual(before);
});

it('builds core alone without downloading DOM or claiming DOM validation', async () => {
  const output = mkdtempSync(join(tmpdir(), 'floating-ui-core-only-'));
  const original = inputs.dom.integrity;
  inputs.dom.integrity = 'sha512-invalid-unused-DOM-input';

  try {
    await build(output, ['core']);
    expect(readdirSync(output)).toEqual(['core']);
    const provenance = JSON.parse(readFileSync(join(output, 'core/provenance.json'), 'utf8'));
    expect(provenance.validationPair).not.toHaveProperty('dom');
  } finally {
    inputs.dom.integrity = original;
  }
});

it('accepts compatible upstream ranges but rejects unknown or incompatible dependencies', () => {
  expect(() => validateDependencies('core', { '@floating-ui/utils': '>=0.2.0 <1' })).not.toThrow();
  expect(() =>
    validateDependencies('dom', { '@floating-ui/core': '^1.8.0', '@floating-ui/utils': '^0.2.0' }),
  ).not.toThrow();
  expect(() => validateDependencies('core', { '@floating-ui/utils': '^99.0.0' })).toThrow(
    'Locked input',
  );
  expect(() =>
    validateDependencies('core', { '@floating-ui/utils': '^0.2.0', extra: '*' }),
  ).toThrow('Upstream dependencies');
  expect(() => validateDependencies('dom', { '@floating-ui/utils': '^0.2.0' })).toThrow(
    'Upstream dependencies',
  );

  const range = config.dom.coreRange;
  config.dom.coreRange = '^99.0.0';

  try {
    expect(() =>
      validateDependencies('dom', {
        '@floating-ui/core': '^1.8.0',
        '@floating-ui/utils': '^0.2.0',
      }),
    ).toThrow('validation core');
  } finally {
    config.dom.coreRange = range;
  }
});
