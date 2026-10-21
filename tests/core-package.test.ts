import { beforeAll, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.ts';
import { createConsumer } from './helpers/consumer.ts';
import { expectPackage } from './helpers/packages.ts';
import { checkConsumerTypes, consumerModes } from './helpers/types.ts';

let consumer: ReturnType<typeof createConsumer>;
let reference: ReturnType<typeof createConsumer>;

beforeAll(() => {
  consumer = createConsumer('archives', ['core']);
  reference = createConsumer('upstream', ['core']);
});

it('ships a complete standalone core without DOM or asynchronous core', () => {
  expectPackage(consumer, reference, 'core');
  expect(() => consumer.require.resolve(config.dom.name)).toThrow();
  expect(() => consumer.require.resolve('@floating-ui/core')).toThrow();
});

it.each(consumerModes)(
  'checks standalone core declarations with $resolution ($extension)',
  (mode) => {
    checkConsumerTypes(consumer, 'core', mode);
  },
);

it.each([
  { from: '=> ComputePositionReturn;', to: '=> any;' },
  { from: '}) => void>', to: '}) => void | Promise<void>>' },
])('rejects a broken standalone core declaration: $to', ({ from, to }) => {
  const path = join(consumer.packageDirectory('core'), 'dist/floating-ui.core.d.mts');
  const original = readFileSync(path, 'utf8');
  expect(original).toContain(from);

  try {
    writeFileSync(path, original.replace(from, to));
    expect(() => checkConsumerTypes(consumer, 'core', consumerModes[0])).toThrow(
      "Type 'false' does not satisfy the constraint 'true'",
    );
  } finally {
    writeFileSync(path, original);
  }
});

it.each(['mjs', 'cjs'])('loads standalone core through Node %s', (extension) => {
  const load =
    extension === 'mjs'
      ? `import * as core from '${config.core.name}';`
      : `const core = require('${config.core.name}');`;

  expect(
    consumer.run(
      load + '\nif (typeof core.computePosition !== "function") throw new Error("Missing export");',
      extension,
    ),
  ).toBe('');
});
