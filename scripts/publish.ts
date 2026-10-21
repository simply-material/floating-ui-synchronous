import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { repository } from '../src/config.ts';
import { verifyIntegrity } from '../src/upstream.ts';
import {
  npm,
  publicationTag,
  readReport,
  registryPackage,
  releaseDirectory,
  type RegistryPackage,
} from './release-helpers.ts';

const directory = releaseDirectory();
const report = readReport(directory);
const { plan } = report;
const dryRun = process.env.FLOATING_UI_DRY_RUN === 'true';

/**
 * Waits for npm to expose an accepted publication before its contents are verified.
 * Only missing versions are retried; registry errors still fail the run.
 */
async function waitForPublication(): Promise<RegistryPackage> {
  const deadline = Date.now() + 10 * 60_000;

  while (true) {
    const registry = await registryPackage(plan.name);

    if (registry.versions[plan.version]) {
      return registry;
    }

    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      throw new Error(
        `npm accepted ${plan.name}@${plan.version}, but the version is still unavailable after 10 minutes. Retry the workflow once it appears on npm.`,
      );
    }

    console.log(`Waiting for npm to make ${plan.name}@${plan.version} available...`);
    await setTimeout(Math.min(15_000, remaining));
  }
}

if (
  !isDeepStrictEqual(report, JSON.parse(readFileSync(join(directory, 'validated.json'), 'utf8')))
) {
  throw new Error('Release report changed after validation');
}

if (
  !dryRun &&
  (report.dirty ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_SHA !== report.revision ||
    process.env.RELEASE_PUBLISH_ENABLED !== 'true')
) {
  throw new Error(
    'Publishing requires the enabled main-branch workflow and a clean validated checkout',
  );
}

const archive = join(directory, plan.key + '.tgz');
verifyIntegrity(readFileSync(archive), report.integrity!);
let registry = await registryPackage(plan.name);
const tag = publicationTag(plan.version, registry);

if (!registry.versions[plan.version]) {
  if (plan.existing) {
    throw new Error('The resumed publication disappeared from npm');
  }

  npm([
    'publish',
    archive,
    '--ignore-scripts',
    '--access',
    'public',
    '--tag',
    tag,
    ...(dryRun ? ['--dry-run'] : []),
  ]);

  if (!dryRun) {
    registry = await waitForPublication();
  }
}

if (!dryRun || registry.versions[plan.version]) {
  const actual = registry.versions[plan.version];

  if (
    actual?.dist.integrity !== report.integrity ||
    !isDeepStrictEqual(actual.synchronousRelease, plan.identity)
  ) {
    throw new Error('npm publication differs from the validated archive or release inputs');
  }
}

console.log(dryRun ? 'Dry run passed; nothing was published.' : 'Verified npm publication.');
