import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { satisfies } from 'semver';
import {
  config,
  inputs,
  packageKeys,
  type BuildInputs,
  type SourcePackage,
  type TransformConfig,
} from '../src/config.ts';
import { extractArchive, verifyIntegrity } from '../src/upstream.ts';
import {
  npm,
  output,
  readReport,
  registryPackage,
  releaseDirectory,
  sourcePackage,
  stableVersions,
  writeJSON,
} from './release-helpers.ts';

const directory = releaseDirectory();
const report = readReport(directory);
const { plan } = report;
const archive = join(directory, plan.key + '.tgz');
const outputDirectory = join(directory, 'packages');
let configuration: TransformConfig = structuredClone(config);
let selected: BuildInputs = structuredClone(inputs);

/**
 * Downloads a published archive unchanged, rejecting unexpected hosts and incorrect integrity.
 */
async function download(input: SourcePackage, destination: string): Promise<void> {
  if (new URL(input.tarball).origin !== 'https://registry.npmjs.org') {
    throw new Error('Unexpected publication registry');
  }

  const response = await fetch(input.tarball, { signal: AbortSignal.timeout(60_000) });

  if (!response.ok) {
    throw new Error('Archive download failed: ' + response.status);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  verifyIntegrity(bytes, input.integrity);
  await writeFile(destination, bytes);
}

if (plan.existing) {
  await download(plan.existing, archive);
  const extracted = join(directory, 'original');
  await mkdir(extracted);
  await extractArchive(archive, extracted);

  const manifest = JSON.parse(await readFile(join(extracted, 'package/package.json'), 'utf8'));
  const provenance = JSON.parse(await readFile(join(extracted, 'package/provenance.json'), 'utf8'));

  if (
    manifest.name !== plan.name ||
    manifest.version !== plan.version ||
    !isDeepStrictEqual(manifest.synchronousRelease, plan.identity) ||
    provenance.schemaVersion !== 2
  ) {
    throw new Error('Published archive does not match the selected release');
  }

  // Recovery validates the original bytes and settings, even when today's transformer has changed.
  configuration = provenance.configuration;
  selected = provenance.inputs;
  report.artifactRevision = provenance.transformer.revision;
  report.integrity = plan.existing.integrity;
} else {
  configuration[plan.key].version = plan.version;
  selected[plan.key] = plan.identity.upstream;

  if (plan.key === 'dom') {
    if (!plan.core?.synchronousRelease || !plan.identity.coreVersion) {
      throw new Error('DOM selection requires an existing core and translated dependency');
    }

    configuration.core.version = plan.core.version;
    configuration.dom.coreRange = plan.identity.coreVersion;
    selected.core = plan.core.synchronousRelease.upstream;
  }

  const utils = await registryPackage('@floating-ui/utils');

  for (const key of plan.key === 'core' ? (['core'] as const) : packageKeys) {
    const source = (await registryPackage(selected[key].name)).versions[selected[key].version];
    const range = source.dependencies?.['@floating-ui/utils'];
    const compatible =
      range &&
      stableVersions(utils)
        .filter((item) => satisfies(item.version, range))
        .at(-1);

    if (!compatible) {
      throw new Error('No compatible utils for ' + selected[key].name);
    }

    selected.utils[key] = sourcePackage(compatible);
  }

  report.artifactRevision = report.revision;
}

writeJSON(join(directory, 'transform.config.json'), configuration);
writeJSON(join(directory, 'upstream.lock.json'), selected);
process.env.FLOATING_UI_CONFIG_DIRECTORY = directory;

const keys = plan.key === 'core' ? ['core'] : packageKeys;
npm(['run', 'prepare:inputs', '--', ...keys]);

if (!plan.existing) {
  process.env.FLOATING_UI_OUTPUT_DIRECTORY = outputDirectory;
  npm(['run', 'build', '--', plan.key]);
  const [packed] = JSON.parse(
    npm(
      [
        'pack',
        join(outputDirectory, plan.key),
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        directory,
      ],
      true,
    ),
  );

  await rename(join(directory, packed.filename), archive);
  report.integrity = packed.integrity;
  verifyIntegrity(await readFile(archive), packed.integrity);
}

if (plan.key === 'dom') {
  const core = (await registryPackage(configuration.core.name)).versions[
    configuration.core.version
  ];

  if (!core || !isDeepStrictEqual(core.synchronousRelease?.upstream, selected.core)) {
    throw new Error('DOM validation core is unavailable or has different upstream provenance');
  }

  await download(sourcePackage(core), join(directory, 'core.tgz'));
  report.coreIntegrity = core.dist.integrity;
}

const notes = [
  `# ${plan.name}@${plan.version}`,
  '',
  `[npm package](https://www.npmjs.com/package/${plan.name}/v/${plan.version})`,
  '',
  `[Upstream changelog](https://github.com/floating-ui/floating-ui/blob/master/packages/${plan.key}/CHANGELOG.md)`,
  ...(report.dirty ? ['', '**Uncommitted preview: provisional version; no publication.**'] : []),
  '',
].join('\n');

writeJSON(join(directory, 'release.json'), report);
await writeFile(join(directory, 'notes.md'), notes);
output('revision', report.artifactRevision!);
output('archive', archive);
console.log(notes);
