import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compare, prerelease, valid } from 'semver';
import { root, type PackageKey, type ReleaseIdentity, type SourcePackage } from '../src/config.ts';

/**
 * A transformed package version, whether newly selected or already published.
 */
export interface TransformedPackage {
  /**
   * Public npm name, distinct from the upstream package.
   */
  name: string;

  /**
   * Allocated stable version. The patch number may differ from upstream's patch number.
   */
  version: string;

  /**
   * Source and transformer inputs recorded in the published manifest.
   */
  identity: ReleaseIdentity;
}

/**
 * Registry fields needed for selection, dependency translation, and archive verification.
 */
export interface RegistryVersion {
  /**
   * The name of the package.
   */
  name: string;

  /**
   * The package's version, excluding pre-releases.
   */
  version: string;

  /**
   * The package's dependencies.
   *
   * For example, Floating UI's DOM package relies on Floating UI core and Floating UI utils.
   */
  dependencies?: Record<string, string>;

  /**
   * The deprecation message.
   *
   * If present in a Floating UI package, that package is not considered for transformation.
   */
  deprecated?: string;

  /**
   * Publication provenance if the package is a synchronous release.
   */
  synchronousRelease?: ReleaseIdentity;

  /**
   * Exact npm archive identity used for download and integrity verification.
   */
  dist: {
    /**
     * SHA-512 integrity digest of the archive.
     */
    integrity: string;

    /**
     * The tarball's registry URL.
     */
    tarball: string;
  };
}

/**
 * Snapshot of an npm package's version history and distribution tags.
 */
export interface RegistryPackage {
  /**
   * Published metadata indexed by version string.
   */
  versions: Record<string, RegistryVersion>;

  /**
   * Tag aliases, including the default installation version under latest.
   */
  'dist-tags': Record<string, string>;
}

/**
 * One publication selected for this run.
 */
export interface ReleasePlan extends TransformedPackage {
  /**
   * Package to build, validate, and publish.
   */
  key: PackageKey;

  /**
   * Why this version was selected, included in review output.
   */
  reason: 'upstream' | 'transformer' | 'resume';

  /**
   * Original archive when finishing a publication whose GitHub release is still missing.
   */
  existing?: SourcePackage;

  /**
   * Published core chosen for a new DOM build.
   */
  core?: RegistryVersion;
}

/**
 * Report passed between build, validation, and publication stages.
 */
export interface ReleaseReport {
  /**
   * The release plan associated with this run.
   */
  plan: ReleasePlan;

  /**
   * Checkout used to prepare and validate this run.
   */
  revision: string;

  /**
   * Whether the repository had uncommitted changes when the release was planned.
   *
   * If true, only dry-run publication is allowed.
   */
  dirty: boolean;

  /**
   * Integrity of the target archive, added by the build stage.
   */
  integrity?: string;

  /**
   * Integrity of DOM's reused core archive, when present.
   */
  coreIntegrity?: string;

  /**
   * Original build commit used as the GitHub release target, including resumed publications.
   */
  artifactRevision?: string;
}

/**
 * Reads public npm metadata.
 */
export async function registryPackage(name: string): Promise<RegistryPackage> {
  const response = await fetch('https://registry.npmjs.org/' + encodeURIComponent(name), {
    signal: AbortSignal.timeout(60_000),
  });

  // A 404 means the package has no publications yet.
  if (response.status === 404) {
    return { versions: {}, 'dist-tags': {} };
  }

  if (!response.ok) {
    throw new Error(`Registry lookup failed: ${name} (${response.status})`);
  }

  return response.json();
}

/**
 * Returns non-deprecated stable records in ascending version order.
 */
export function stableVersions(registry: RegistryPackage): RegistryVersion[] {
  return Object.values(registry.versions)
    .filter((item) => valid(item.version) && !prerelease(item.version) && !item.deprecated)
    .sort((a, b) => compare(a.version, b.version));
}

/**
 * Reduces registry metadata to the exact artifact identity stored in locks and provenance.
 */
export function sourcePackage(item: RegistryVersion): SourcePackage {
  return {
    name: item.name,
    version: item.version,
    integrity: item.dist.integrity,
    tarball: item.dist.tarball,
  };
}

/**
 * Returns `'latest'` if {@link version} is the newest version. Otherwise, returns `'maintenance'`.
 */
export function publicationTag(
  version: string,
  registry: RegistryPackage,
): 'latest' | 'maintenance' {
  const versions = [...Object.keys(registry.versions), registry['dist-tags'].latest].filter(
    (value) => valid(value) && !prerelease(value),
  );

  return versions.some((value) => compare(value, version) > 0) ? 'maintenance' : 'latest';
}

/**
 * Deterministic completion marker for one npm publication, independent of other packages.
 */
export function releaseTag(plan: Pick<ReleasePlan, 'key' | 'version'>): string {
  return plan.key + '-' + plan.version;
}

/**
 * Writes readable JSON for settings and reports shared by command stages.
 */
export function writeJSON(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

/**
 * Reads a named report from an explicit release directory supplied to a command.
 */
export function readReport(directory: string): ReleaseReport {
  return JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'));
}

/**
 * Requires a release directory argument via the command-line, preventing accidental use of unrelated output.
 */
export function releaseDirectory(): string {
  if (process.argv.length !== 3) {
    throw new Error('Supply the release directory printed by release:select');
  }

  return resolve(process.argv[2]);
}

/**
 * Adds a key-value pair to the `GITHUB_OUTPUT` environment variable for inspection
 * within a GitHub Action workflow.
 */
export function output(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

/**
 * Runs npm through the invoking Node executable without shell interpolation.
 * @param args - npm command and arguments.
 * @param capture - Return stdout instead of forwarding it, for npm's JSON responses.
 * @param cwd - Working directory; public smoke checks use an isolated consumer.
 */
export function npm(args: string[], capture = false, cwd = root): string {
  if (!process.env.npm_execpath) {
    throw new Error('Run release commands through npm scripts');
  }

  return (
    execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    }) ?? ''
  );
}
