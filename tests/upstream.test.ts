import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { allowedArchiveEntry, verifyIntegrity } from '../src/upstream.ts';
import { inputs, root } from '../src/config.ts';

it('keeps the differential reference dependencies aligned with the locked inputs', () => {
  for (const input of Object.values(inputs)) {
    const manifest = JSON.parse(
      readFileSync(join(root, 'node_modules', input.name, 'package.json'), 'utf8'),
    );

    expect(manifest.version).toBe(input.version);
  }
});

it('verifies every input byte before extraction', () => {
  const bytes = Buffer.from('upstream archive');
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');

  expect(() => verifyIntegrity(bytes, integrity)).not.toThrow();
  expect(() => verifyIntegrity(Buffer.from('changed archive'), integrity)).toThrow();
  expect(() => verifyIntegrity(bytes, 'sha1-invalid')).toThrow();
});

it('limits archive extraction to regular package files and directories', () => {
  expect(allowedArchiveEntry('package/dist/index.mjs', 'File')).toBe(true);
  expect(allowedArchiveEntry('package/dist/', 'Directory')).toBe(true);

  for (const path of [
    '../outside',
    '/absolute',
    'package/../../outside',
    'package\\..\\outside',
    'outside/file',
  ]) {
    expect(allowedArchiveEntry(path, 'File')).toBe(false);
  }

  expect(allowedArchiveEntry('package/link', 'SymbolicLink')).toBe(false);
  expect(allowedArchiveEntry('package/link', 'Link')).toBe(false);
});
