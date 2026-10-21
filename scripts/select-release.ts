import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, gte, maxSatisfying, parse, satisfies } from 'semver';
import { transformerIdentity } from '../src/build.ts';
import {
  config,
  inputs,
  packageKeys,
  repository,
  root,
  type BuildInputs,
  type PackageKey,
  type TransformConfig,
} from '../src/config.ts';
import {
  output,
  registryPackage,
  releaseTag,
  sourcePackage,
  stableVersions,
  writeJSON,
  type RegistryPackage,
  type RegistryVersion,
  type ReleasePlan,
} from './release-helpers.ts';

/**
 * Allocates a stable patch in upstream's major/minor series, without reusing any occupied version.
 */
export function allocateVersion(source: string, registry: RegistryPackage): string {
  const { major, minor, patch } = parse(source)!;
  const series = `${major}.${minor}.x`;
  const previous = maxSatisfying(Object.keys(registry.versions), series);

  for (const item of Object.values(registry.versions)) {
    const original = item.synchronousRelease?.upstream.version;

    if (original && satisfies(original, series) && compare(original, source) > 0) {
      // We process versions in-order, so this shouldn't happen typically.
      // Requires manual review if it does happen.
      throw new Error('Cannot publish an older upstream patch in an already advanced series');
    }
  }

  const next = previous ? Math.max(patch, parse(previous)!.patch + 1) : patch;

  if (!Number.isSafeInteger(next)) {
    throw new Error('Patch version is too large');
  }

  return `${major}.${minor}.${next}`;
}

/**
 * Selects exactly one publication using registry provenance and completed GitHub release tags.
 * Priority: incomplete publication, unprocessed core, unprocessed DOM, core fix, DOM fix.
 *
 * @param settings
 * @param baseline - Inclusive upstream starting versions from the checked-in lock.
 * @param upstream
 * @param published
 * @param completed
 * @param transformerRevision
 * @param preview - Forces fresh transformer candidates for an uncommitted preview when upstream is caught up.
 * @returns The next target, or undefined when no publication is needed.
 */
export function selectRelease(
  settings: TransformConfig,
  baseline: BuildInputs,
  upstream: Record<PackageKey, RegistryPackage>,
  published: Record<PackageKey, RegistryPackage>,
  completed: ReadonlySet<string>,
  transformerRevision: string,
  preview = false,
): ReleasePlan | undefined {
  // Resume before allocating anything: npm may have succeeded before smoke checks or release creation failed.
  for (const key of packageKeys) {
    const unfinished = Object.values(published[key].versions)
      .filter(
        (item) =>
          item.synchronousRelease && !completed.has(releaseTag({ key, version: item.version })),
      )
      .sort((a, b) => compare(a.version, b.version))[0]; // <-- Get the first unfinished version

    if (unfinished) {
      return {
        key,
        name: settings[key].name,
        version: unfinished.version,
        identity: unfinished.synchronousRelease!,
        reason: 'resume',
        existing: sourcePackage(unfinished),
      };
    }
  }

  /**
   * Constructs a new target, translating DOM's requirement using existing core provenance only.
   */
  function candidate(
    key: PackageKey,
    source: RegistryVersion,
    reason: 'upstream' | 'transformer',
  ): ReleasePlan {
    const identity = { transformerRevision, upstream: sourcePackage(source) };
    let core: RegistryVersion | undefined;
    let coreRange: string | undefined;

    if (key === 'dom') {
      const requirement = source.dependencies?.['@floating-ui/core'];

      if (!requirement) {
        throw new Error('Upstream DOM must declare its core dependency');
      }

      const compatible = stableVersions(published.core).filter(
        (item) =>
          item.synchronousRelease?.upstream.name === baseline.core.name &&
          satisfies(item.synchronousRelease.upstream.version, requirement),
      );

      if (!compatible.length) {
        throw new Error(
          'No published transformed core satisfies upstream DOM requirement: ' + requirement,
        );
      }

      const minimum = '^' + compatible[0].version;
      coreRange = minimum;
      core = compatible.filter((item) => satisfies(item.version, minimum)).at(-1)!;
    }

    return {
      key,
      name: settings[key].name,
      version: allocateVersion(source.version, published[key]),
      identity: { ...identity, ...(coreRange ? { coreVersion: coreRange } : {}) },
      reason,
      ...(core ? { core } : {}),
    };
  }

  for (const key of packageKeys) {
    const processedVersions = new Set(
      Object.values(published[key].versions)
        .filter((item) => item.synchronousRelease?.upstream.name === baseline[key].name)
        .map((item) => item.synchronousRelease!.upstream.version),
    );
    const next = stableVersions(upstream[key]).find(
      (item) => gte(item.version, baseline[key].version) && !processedVersions.has(item.version),
    );

    if (next) {
      return candidate(key, next, 'upstream');
    }
  }

  // Transformer fixes apply to each package's newest eligible source, not every historical release.
  for (const key of packageKeys) {
    const latest = stableVersions(upstream[key])
      .filter((item) => gte(item.version, baseline[key].version))
      .at(-1);

    if (!latest) {
      throw new Error('No eligible upstream release at or above baseline: ' + key);
    }

    const previous = stableVersions(published[key])
      .filter((item) => item.synchronousRelease?.upstream.version === latest.version)
      .at(-1);

    if (preview || previous?.synchronousRelease?.transformerRevision !== transformerRevision) {
      return candidate(key, latest, 'transformer');
    }
  }

  // Nothing to release
  return undefined;
}

/**
 * Queries current upstream/npm/GitHub state and writes a single reviewable selection.
 */
export async function selectNextRelease(): Promise<string | undefined> {
  const upstream = {
    core: await registryPackage(inputs.core.name),
    dom: await registryPackage(inputs.dom.name),
  };
  const published = {
    core: await registryPackage(config.core.name),
    dom: await registryPackage(config.dom.name),
  };
  const tags = execFileSync(
    'gh',
    [
      'api',
      '--paginate',
      `repos/${repository}/releases`,
      '--jq',
      '.[] | select(.draft == false) | .tag_name',
    ],
    { encoding: 'utf8', cwd: root },
  );
  const identity = transformerIdentity();
  const plan = selectRelease(
    config,
    inputs,
    upstream,
    published,
    new Set(tags.split(/\r?\n/)),
    identity.sourceRevision,
    identity.dirty,
  );

  output('available', String(Boolean(plan)));

  if (!plan) {
    console.log('All eligible upstream releases and transformer updates are published.');
    return undefined;
  }

  mkdirSync(join(root, 'output'), { recursive: true });
  const directory = mkdtempSync(join(root, 'output', 'release-'));
  writeJSON(join(directory, 'release.json'), {
    plan,
    revision: identity.revision,
    dirty: identity.dirty,
  });
  output('directory', directory);
  output('key', plan.key);
  output('tag', releaseTag(plan));
  console.log(`Selected ${plan.name}@${plan.version} (${plan.reason})\n${directory}`);

  return directory;
}

// Planning tests import this module without querying registries or creating output.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await selectNextRelease();
}
