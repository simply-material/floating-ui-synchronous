import { expect, it } from 'vitest';
import { releaseFingerprint } from '../src/build.ts';

// Fixture identity kept independent of output package names and version configuration.
const coreName = '@example/synchronous-core';

it('fingerprints artifacts independently of provenance and allocated package revision', () => {
  const files = {
    'package.json': JSON.stringify({
      name: coreName,
      version: '1.8.0-synchronous.1',
      dependencies: { utils: '^1' },
    }),
    'dist/index.js': 'export const value = 1;',
    'provenance.json': '{"revision":"one"}',
  };
  const fingerprint = releaseFingerprint(files);

  expect(
    releaseFingerprint({
      ...files,
      'provenance.json': '{"revision":"two"}',
      'package.json': files['package.json'].replace('synchronous.1', 'synchronous.2'),
    }),
  ).toBe(fingerprint);

  expect(releaseFingerprint({ ...files, 'dist/index.js': 'export const value = 2;' })).not.toBe(
    fingerprint,
  );

  expect(
    releaseFingerprint({ ...files, 'package.json': files['package.json'].replace('^1', '^2') }),
  ).not.toBe(fingerprint);
});
