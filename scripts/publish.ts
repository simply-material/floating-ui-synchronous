import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { repository } from '../src/config.ts';
import { verifyIntegrity } from '../src/upstream.ts';
import {
  npm,
  publicationTag,
  readReport,
  registryPackage,
  releaseDirectory,
} from './release-helpers.ts';

const directory = releaseDirectory();
const report = readReport(directory);
const { plan } = report;
const dryRun = process.env.FLOATING_UI_DRY_RUN === 'true';

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
    registry = await registryPackage(plan.name);
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
