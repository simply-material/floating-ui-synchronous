import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { build } from '../src/build.ts';
import { root } from '../src/config.ts';

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
