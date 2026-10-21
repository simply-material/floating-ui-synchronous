import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { parse } from 'semver';

/**
 * Repository root, resolved from this module so commands do not depend on their working directory.
 */
export const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * Candidate settings live outside the checked-in baseline during release builds.
 */
export const configDirectory = resolve(process.env.FLOATING_UI_CONFIG_DIRECTORY ?? root);

/**
 * Public repository used by package metadata and release commands.
 */
export const repository = 'simply-material/floating-ui-synchronous';

/**
 * Packages transformed and emitted separately.
 */
export const packageKeys = ['core', 'dom'] as const;

/**
 * Key identifying one generated package in the input and output configuration.
 */
export type PackageKey = (typeof packageKeys)[number];

/**
 * Exact npm artifact selected as an upstream input or reused publication.
 */
export interface SourcePackage {
  /**
   * Scoped npm package name identifying the archive.
   */
  name: string;

  /**
   * Exact version of this archive's package.
   */
  version: string;

  /**
   * Expected archive digest in sha512-base64 npm integrity notation.
   */
  integrity: string;

  /**
   * Download URL for the locked npm registry tarball.
   */
  tarball: string;
}

/**
 * Exact upstream artifacts for building and validating a package or the baseline pairing.
 */
export interface BuildInputs {
  /**
   * Core source used for transformation or as DOM's validation reference.
   */
  core: SourcePackage;

  /**
   * DOM source; unused when building core alone.
   */
  dom: SourcePackage;

  /**
   * Independent utils selections; consumers still receive upstream's dependency ranges.
   */
  utils: Record<PackageKey, SourcePackage>;
}

/**
 * Source and transformer identity recorded for a publication.
 */
export interface ReleaseIdentity {
  /**
   * Last mainline commit affecting transformer source or build settings.
   */
  transformerRevision: string;

  /**
   * Exact source artifact represented by this transformed publication.
   */
  upstream: SourcePackage;

  /**
   * DOM's dependency on our synchronous core package. The minimum is the
   * lowest published version whose upstream core satisfies upstream DOM's requirement.
   *
   * For example, if upstream DOM requires "^1.8.1", transformer fixes might
   * make our first compatible core release 1.8.3. We use "^1.8.3" and keep
   * that minimum, even when another transformer fix produces 1.8.4.
   */
  coreVersion?: string;
}

/**
 * Identity of a separately installable synchronous package.
 */
export interface OutputPackage {
  /**
   * Replacement scoped package name, also used in rewritten imports.
   */
  name: string;

  /**
   * Stable upstream-aligned major/minor with an independently allocated patch.
   */
  version: string;

  /**
   * JavaScript identifier used by the UMD browser global.
   */
  global: string;
}

/**
 * Output identities and the publication safeguard shared by both packages.
 */
export interface TransformConfig {
  /**
   * Copied into each manifest; true prevents npm publication.
   */
  private: boolean;

  /**
   * Generated core identity, also identifying the version used to validate DOM.
   */
  core: OutputPackage;

  /**
   * Generated DOM identity, versioned against its own upstream package.
   */
  dom: OutputPackage & {
    /**
     * Caret dependency (e.g., ^1.8.3) whose minimum follows upstream's requirement through publication provenance.
     */
    coreRange: string;
  };
}

/**
 * Locked source artifacts. The Floating UI utils library is verified alongside the two transformed packages.
 */
export const inputs: BuildInputs = JSON.parse(
  readFileSync(join(configDirectory, 'upstream.lock.json'), 'utf8'),
);

/**
 * Output settings loaded once and checked below before any build work starts.
 */
export const config: TransformConfig = JSON.parse(
  readFileSync(join(configDirectory, 'transform.config.json'), 'utf8'),
);

// Our naming convention requires @scope/name, using lowercase letters, digits, and hyphens.
const scopedPackageNamePattern = /^@[a-z0-9-]+\/[a-z0-9-]+$/;

// Allows ASCII letters, underscores, or dollar signs first; later characters may also be digits.
const browserGlobalNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Keep generated identities separate from upstream and never trail its patch in the same series.
for (const key of packageKeys) {
  const version = parse(config[key].version);
  const upstream = parse(inputs[key].version);

  if (
    !scopedPackageNamePattern.test(config[key].name) ||
    config[key].name.startsWith('@floating-ui/') ||
    !browserGlobalNamePattern.test(config[key].global)
  ) {
    throw new Error('Invalid output package configuration: ' + key);
  }

  if (
    !version ||
    !upstream ||
    version.version !== config[key].version ||
    version.prerelease.length ||
    version.build.length ||
    version.major !== upstream.major ||
    version.minor !== upstream.minor ||
    version.patch < upstream.patch
  ) {
    throw new Error(
      'Output must have stable upstream-aligned major/minor and patch at least upstream: ' + key,
    );
  }
}

const minimumCore = parse(config.dom.coreRange?.slice(1));

if (
  !minimumCore ||
  config.dom.coreRange !== '^' + minimumCore.version ||
  minimumCore.prerelease.length ||
  minimumCore.build.length
) {
  throw new Error('DOM requires a stable caret range');
}

if (config.core.name === config.dom.name || config.core.global === config.dom.global) {
  throw new Error('Core and DOM must have distinct package and global names');
}

/**
 * Records the source and transformer revision that determine whether this package needs publication.
 */
export function releaseIdentity(key: PackageKey, transformerRevision: string): ReleaseIdentity {
  return {
    transformerRevision,
    upstream: inputs[key],
    ...(key === 'dom' ? { coreVersion: config.dom.coreRange } : {}),
  };
}
