import { join } from 'node:path';
import { npm, readReport, releaseDirectory, writeJSON } from './release-helpers.ts';

const directory = releaseDirectory();
const report = readReport(directory);
process.env.FLOATING_UI_CONFIG_DIRECTORY = directory;
process.env.FLOATING_UI_RELEASE_DIRECTORY = directory;

if (report.plan.key === 'core') {
  npm(['test', '--', 'tests/core-package.test.ts', 'tests/behavior.test.ts']);
} else {
  npm(['test', '--', 'tests/packages.test.ts', 'tests/types.test.ts', 'tests/behavior.test.ts']);
  npm(['run', 'test:browser']);
}

// Publication requires this exact report, including archive integrity, to have passed validation.
writeJSON(join(directory, 'validated.json'), report);
