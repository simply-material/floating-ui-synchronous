import { build } from './build.ts';
import { prepareInputs } from './upstream.ts';
import { packageKeys, type PackageKey } from './config.ts';

const requested = process.argv.slice(3);

if (requested.some((key) => !packageKeys.includes(key as PackageKey))) {
  throw new Error('Build targets must be core or dom');
}

const packages = requested.length ? ([...new Set(requested)] as PackageKey[]) : packageKeys;

if (process.argv[2] === 'prepare') {
  const directories = await prepareInputs(packages);
  console.log('Verified inputs:', directories);
} else if (process.argv[2] === 'build') {
  await build(process.env.FLOATING_UI_OUTPUT_DIRECTORY, packages);
} else {
  console.error('Usage: npm run build | npm run prepare:inputs');
  process.exitCode = 1;
}
