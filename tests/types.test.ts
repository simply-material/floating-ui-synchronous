import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { config, root } from '../src/config.ts';
import { createConsumer } from './helpers/consumer.ts';

// Isolated installation shared within this suite; mutation tests restore its declarations.
let consumer: ReturnType<typeof createConsumer>;

beforeAll(() => {
  consumer = createConsumer();
});

const source = readFileSync(new URL('./fixtures/consumer.ts', import.meta.url), 'utf8')
  .replaceAll('@test/synchronous-core', config.core.name)
  .replaceAll('@test/synchronous-dom', config.dom.name);

/**
 * Compiles the installed consumer with strict checking and library declaration checking enabled.
 * @param extension - File extension selecting the consumer's ESM or CommonJS interpretation.
 * @param module - TypeScript module mode paired with the selected resolution strategy.
 * @param resolution - Module resolution strategy used to exercise package export conditions.
 * @throws Error - With compiler output when either an assertion or the installed declarations fail.
 */
function checkConsumer(extension: string, module: string, resolution: string): void {
  const entry = join(consumer.directory, 'consumer.' + extension);
  writeFileSync(entry, source);

  try {
    execFileSync(
      process.execPath,
      [
        join(root, 'node_modules/typescript/lib/tsc.js'),
        '--noEmit',
        '--strict',
        '--noUnusedLocals',
        '--skipLibCheck',
        'false',
        '--target',
        'ES2020',
        '--module',
        module,
        '--moduleResolution',
        resolution,
        entry,
      ],
      {
        cwd: consumer.directory,
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    throw new Error(String((error as { stdout?: string }).stdout || error));
  }
}

it.each([
  { extension: 'mts', module: 'NodeNext', resolution: 'NodeNext' },
  { extension: 'cts', module: 'NodeNext', resolution: 'NodeNext' },
  { extension: 'ts', module: 'ESNext', resolution: 'Bundler' },
])(
  'checks installed declarations with $resolution ($extension)',
  ({ extension, module, resolution }) => {
    checkConsumer(extension, module, resolution);
  },
);

it.each([
  {
    name: 'computePosition widened to any',
    from: '=> ComputePositionReturn;',
    to: '=> any;',
  },
  {
    name: 'size.apply still permitting a Promise return in its declaration',
    from: '}) => void>',
    to: '}) => void | Promise<void>>',
  },
])('the consumer assertions reject an intentionally broken declaration: $name', ({ from, to }) => {
  // Mutate only this suite's isolated installed fixture, never dist or sources.
  const path = join(consumer.packageDirectory('core'), 'dist/floating-ui.core.d.mts');
  const original = readFileSync(path, 'utf8');
  expect(original).toContain(from);

  try {
    writeFileSync(path, original.replace(from, to));

    expect(() => checkConsumer('mts', 'NodeNext', 'NodeNext')).toThrow(
      "Type 'false' does not satisfy the constraint 'true'",
    );
  } finally {
    writeFileSync(path, original);
  }
});
