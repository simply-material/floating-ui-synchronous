import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { createConsumer } from './helpers/consumer.ts';
import { checkConsumerTypes, consumerModes } from './helpers/types.ts';

// Isolated installation shared within this suite; mutation tests restore its declarations.
let consumer: ReturnType<typeof createConsumer>;

beforeAll(() => {
  consumer = createConsumer();
});

it.each(consumerModes)('checks installed declarations with $resolution ($extension)', (mode) => {
  checkConsumerTypes(consumer, 'dom', mode);
});

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

    expect(() => checkConsumerTypes(consumer, 'dom', consumerModes[0])).toThrow(
      "Type 'false' does not satisfy the constraint 'true'",
    );
  } finally {
    writeFileSync(path, original);
  }
});
