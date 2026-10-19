import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { x as extract } from 'tar';
import { inputs, root, type SourcePackage } from './config.ts';

/**
 * Requires archive bytes to match the lock file's single SHA-512 integrity digest.
 *
 * @param bytes - Complete downloaded or cached tarball contents.
 * @param expected - npm-style sha512-base64 digest; other algorithms are rejected.
 * @throws Error - If the digest is unsupported or any byte differs from the locked artifact.
 */
export function verifyIntegrity(bytes: Uint8Array, expected: string): void {
  if (
    !expected.startsWith('sha512-') ||
    'sha512-' + createHash('sha512').update(bytes).digest('base64') !== expected
  ) {
    throw new Error('Upstream tarball integrity mismatch');
  }
}

/**
 * Allows regular files and directories beneath the npm archive's package/ prefix.
 * Rejects traversal segments, backslash paths, links, and special entry types before extraction.
 *
 * @param path - Archive entry path reported by tar.
 * @param type - tar's entry classification, such as File or Directory.
 */
export function allowedArchiveEntry(path: string, type: string): boolean {
  return (
    path.startsWith('package/') &&
    !path.includes('\\') &&
    !path.split('/').includes('..') &&
    (type === 'File' || type === 'Directory')
  );
}

/**
 * Retrieves a locked npm tarball, reusing the local cache only after checking its integrity.
 * Newly downloaded bytes are verified before being written to the cache.
 *
 * @param input - Exact package identity, registry URL, and digest from the lock file.
 * @returns Absolute path to the verified cached tarball.
 * @throws Error - If downloading, registry validation, integrity checking, or cache access fails.
 */
export async function downloadInput(input: SourcePackage): Promise<string> {
  const cache = join(root, '.cache', 'upstream');
  await mkdir(cache, { recursive: true });

  const filename = input.name.replace('@floating-ui/', '') + '-' + input.version + '.tgz';
  const archive = join(cache, filename);
  let bytes: Uint8Array;

  try {
    bytes = await readFile(archive);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    const url = new URL(input.tarball);

    if (url.origin !== 'https://registry.npmjs.org') {
      throw new Error('Unexpected upstream registry');
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });

    if (!response.ok) {
      throw new Error('Download failed: ' + response.status + ' ' + url);
    }

    bytes = new Uint8Array(await response.arrayBuffer());
    verifyIntegrity(bytes, input.integrity);
    await writeFile(archive, bytes);
    return archive;
  }

  verifyIntegrity(bytes, input.integrity);
  return archive;
}

/**
 * Extracts locked core, DOM, and utils archives into a new directory for each build.
 * Validates archive entries and manifest identities; previously extracted files are never reused.
 * Extracted directories remain in the local cache for inspection.
 *
 * @returns Absolute package-root directories indexed by the locked input keys.
 */
export async function prepareInputs(): Promise<Record<keyof typeof inputs, string>> {
  const cache = join(root, '.cache', 'upstream');
  await mkdir(cache, { recursive: true });

  const directory = await mkdtemp(join(cache, 'verified-'));
  const prepared = {} as Record<keyof typeof inputs, string>;

  for (const key of ['core', 'dom', 'utils'] as const) {
    const archive = await downloadInput(inputs[key]);
    const target = join(directory, key);
    await mkdir(target);

    await extract({
      file: archive,
      cwd: target,
      strict: true,
      filter: (path, entry) => {
        const type = 'type' in entry ? entry.type : 'Unknown';

        if (!allowedArchiveEntry(path, type)) {
          throw new Error('Unsupported tarball entry: ' + path + ' (' + type + ')');
        }

        return true;
      },
    });

    prepared[key] = join(target, 'package');
    const manifest = JSON.parse(await readFile(join(prepared[key], 'package.json'), 'utf8'));

    if (manifest.name !== inputs[key].name || manifest.version !== inputs[key].version) {
      throw new Error('Unexpected upstream package identity: ' + key);
    }
  }

  return prepared;
}
