import { build } from './build.ts';
import { prepareInputs } from './upstream.ts';

if (process.argv[2] === 'prepare') {
  const directories = await prepareInputs();
  console.log('Verified inputs:', directories);
} else if (process.argv[2] === 'build') {
  await build();
} else {
  console.error('Usage: npm run build | npm run prepare:inputs');
  process.exitCode = 1;
}
