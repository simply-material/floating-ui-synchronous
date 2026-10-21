import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { x as extract } from 'tar';
import { inputs, packageKeys, root, type PackageKey, type SourcePackage } from './config.ts';

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
 * Extracts selected upstream packages and their own utils into fresh verified directories.
 * @param packages - Packages needed for transformation or reference testing; defaults to both.
 * @returns Package keys and absolute roots for their source and utils distributions.
 */
export async function prepareInputs(packages: readonly PackageKey[] = packageKeys) {
  const cache = join(root, '.cache', 'upstream');
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, 'verified-'));
  const prepared = [];

  for (const key of new Set(packages)) {
    prepared.push({
      /** Package owning these two verified input directories. */
      key,

      /** Extracted upstream core or DOM package root. */
      packageDirectory: await extractInput(inputs[key], join(directory, key)),

      /** Extracted utils selected for this package's dependency range. */
      utilsDirectory: await extractInput(inputs.utils[key], join(directory, key + '-utils')),
    });
  }

  return prepared;
}

/**
 * Extracts a locked input and verifies its manifest's name and version before use.
 */
async function extractInput(input: SourcePackage, directory: string): Promise<string> {
  const archive = await downloadInput(input);
  await mkdir(directory);
  await extractArchive(archive, directory);

  const packageDirectory = join(directory, 'package');
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));

  if (manifest.name !== input.name || manifest.version !== input.version) {
    throw new Error('Unexpected upstream package identity: ' + input.name);
  }

  return packageDirectory;
}

/**
 * Extracts an already integrity-verified npm archive into an existing empty directory.
 *
 * Rejects entries outside package/, links, and special files for both upstream and reused publications.
 */
export async function extractArchive(archive: string, directory: string): Promise<void> {
  await extract({
    file: archive,
    cwd: directory,
    strict: true,
    filter: (path, entry) => {
      const type = 'type' in entry ? entry.type : 'Unknown';

      if (!allowedArchiveEntry(path, type)) {
        throw new Error('Unsupported tarball entry: ' + path + ' (' + type + ')');
      }

      return true;
    },
  });
}
