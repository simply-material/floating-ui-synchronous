import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { runInNewContext } from 'node:vm';
import { npm, readReport, releaseDirectory } from './release-helpers.ts';

const directory = releaseDirectory();
const report = readReport(directory);
const { plan } = report;
const consumer = mkdtempSync(join(tmpdir(), 'floating-ui-public-'));
writeFileSync(
  join(consumer, 'package.json'),
  JSON.stringify({ name: 'public-consumer', private: true, type: 'module' }),
);

// Install only the target. In particular, DOM must resolve its core through the shipped caret dependency.
npm(
  [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    plan.name + '@' + plan.version,
  ],
  false,
  consumer,
);
const require = createRequire(join(consumer, 'package.json'));
const manifest = require(plan.name + '/package.json');
const packageDirectory = dirname(require.resolve(plan.name + '/package.json'));

if (
  manifest.version !== plan.version ||
  !isDeepStrictEqual(manifest.synchronousRelease, plan.identity)
) {
  throw new Error('Public package differs from the selected publication');
}

for (const name of ['@floating-ui/core', '@floating-ui/dom']) {
  let resolved = false;

  try {
    require.resolve(name);
    resolved = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }

  if (resolved) {
    throw new Error('Public consumer unexpectedly installed ' + name);
  }
}

const check = `
const result = engine.computePosition({}, {}, {platform: {
  isRTL() { return false; },
  getElementRects() { return {reference: {x: 10, y: 20, width: 30, height: 10}, floating: {x: 0, y: 0, width: 20, height: 5}}; }
}});

if (result.then || result.x !== 15 || result.y !== 30) throw new Error('Public positioning contract failed');
`;

for (const extension of ['mjs', 'cjs']) {
  const entry = join(consumer, 'check.' + extension);
  const load =
    extension === 'mjs'
      ? `import * as engine from '${plan.name}';`
      : `const engine = require('${plan.name}');`;
  writeFileSync(entry, load + check);
  execFileSync(process.execPath, [entry], { cwd: consumer, stdio: 'inherit' });
}

const configuration = JSON.parse(readFileSync(join(directory, 'transform.config.json'), 'utf8'));

for (const cdn of ['https://unpkg.com/', 'https://cdn.jsdelivr.net/npm/']) {
  const response = await fetch(cdn + plan.name + '@' + plan.version + '/' + manifest.unpkg, {
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error('CDN download failed: ' + response.status + ' ' + cdn);
  }

  const code = await response.text();

  if (code !== readFileSync(join(packageDirectory, manifest.unpkg), 'utf8')) {
    throw new Error('CDN distribution differs from the installed package');
  }

  const globals: Record<string, unknown> = {};

  if (plan.key === 'dom') {
    const fromDOM = createRequire(join(packageDirectory, 'package.json'));
    const coreRoot = dirname(fromDOM.resolve(configuration.core.name + '/package.json'));
    const coreManifest = fromDOM(configuration.core.name + '/package.json');
    runInNewContext(readFileSync(join(coreRoot, coreManifest.unpkg), 'utf8'), globals);
  }

  runInNewContext(
    code +
      '\nconst engine = globalThis[' +
      JSON.stringify(configuration[plan.key].global) +
      '];\n' +
      check,
    globals,
  );
}

console.log('Public npm installation, Node ESM/CommonJS, and both CDN UMD distributions passed.');
