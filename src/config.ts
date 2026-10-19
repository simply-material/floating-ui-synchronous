import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Repository root, resolved from this module so commands do not depend on their working directory.
 */
export const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * Packages transformed and emitted separately.
 */
export const packageKeys = ['core', 'dom'] as const;

/**
 * Key identifying one generated package in the input and output configuration.
 */
export type PackageKey = (typeof packageKeys)[number];

/**
 * Exact upstream npm artifact selected for transformation or validation.
 */
export interface SourcePackage {
  /**
   * Original scoped npm package name.
   */
  name: string;

  /**
   * Exact upstream version.
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
 * Identity of a separately installable synchronous package.
 */
export interface OutputPackage {
  /**
   * Replacement scoped package name, also used in rewritten imports.
   */
  name: string;

  /**
   * This package's upstream version followed by a positive `-synchronous.N` revision.
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
   * Generated core identity, used as DOM's exact dependency.
   */
  core: OutputPackage;

  /**
   * Generated DOM identity, versioned against its own upstream package.
   */
  dom: OutputPackage;
}

/**
 * Locked source artifacts. The Floating UI utils library is verified alongside the two transformed packages.
 */
export const inputs: Record<PackageKey | 'utils', SourcePackage> = JSON.parse(
  readFileSync(join(root, 'upstream.lock.json'), 'utf8'),
);

/**
 * Output settings loaded once and checked below before any build work starts.
 */
export const config: TransformConfig = JSON.parse(
  readFileSync(join(root, 'transform.config.json'), 'utf8'),
);

// Our naming convention requires @scope/name, using lowercase letters, digits, and hyphens.
const scopedPackageNamePattern = /^@[a-z0-9-]+\/[a-z0-9-]+$/;

// Allows ASCII letters, underscores, or dollar signs first; later characters may also be digits.
const browserGlobalNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Requires three numeric version components and -synchronous.N, with a positive N and no leading zeros.
const synchronousVersionPattern = /^\d+\.\d+\.\d+-synchronous\.[1-9]\d*$/;

// Keep generated identities separate from upstream and tie revisions to each locked source version.
for (const key of packageKeys) {
  if (
    !scopedPackageNamePattern.test(config[key].name) ||
    config[key].name.startsWith('@floating-ui/') ||
    !browserGlobalNamePattern.test(config[key].global) ||
    !config[key].version.startsWith(inputs[key].version + '-synchronous.') ||
    !synchronousVersionPattern.test(config[key].version)
  ) {
    throw new Error('Invalid output package configuration: ' + key);
  }
}

if (config.core.name === config.dom.name || config.core.global === config.dom.global) {
  throw new Error('Core and DOM must have distinct package and global names');
}
