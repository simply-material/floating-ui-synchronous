import { npm } from './release-helpers.ts';
import { selectNextRelease } from './select-release.ts';

const directory = await selectNextRelease();

if (directory) {
  npm(['run', 'release:build', '--', directory]);
  npm(['run', 'release:validate', '--', directory]);
  process.env.FLOATING_UI_DRY_RUN = 'true';
  npm(['run', 'release:publish', '--', directory]);

  console.log('Review artifacts:', directory);
  console.log('No publication or follow-up workflow was dispatched.');
}
