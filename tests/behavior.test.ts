import type * as reference from '@floating-ui/core';
import { beforeAll, expect, it } from 'vitest';
import { config, inputs } from '../src/config.ts';
import { createConsumer } from './helpers/consumer.ts';
import { chains, fixture, placements, rectangles } from './helpers/platform.ts';

/*
 * Installed synchronous engine typed with the upstream vocabulary for shared fixtures.
 * Direct-return assertions check runtime timing; separate compiler fixtures check generated types.
 */
let synchronous: typeof reference;
let upstream: typeof reference;

beforeAll(() => {
  synchronous = createConsumer('archives', ['core']).require(config.core.name);
  upstream = createConsumer('upstream', ['core']).require(inputs.core.name);
});

it.each(chains)('matches upstream calculations and callback order: %s', async (chain) => {
  for (const rectangle of rectangles) {
    for (const placement of placements) {
      for (const rtl of [false, true]) {
        for (const strategy of ['absolute', 'fixed'] as const) {
          const original = fixture(upstream, rectangle, rtl, chain);
          const transformed = fixture(synchronous, rectangle, rtl, chain);

          const expected = await upstream.computePosition(original.reference, original.floating, {
            ...original,
            placement,
            strategy,
          });
          const actual = synchronous.computePosition(transformed.reference, transformed.floating, {
            ...transformed,
            placement,
            strategy,
          });

          expect(actual).not.toHaveProperty('then');
          expect(actual).toEqual(expected);
          expect(transformed.log).toEqual(original.log);
        }
      }
    }
  }
});

it('finishes middleware and size.apply before returning or running a queued microtask', async () => {
  const state = fixture(synchronous, rectangles[0], false, 'sizeReset');
  let microtask = false;

  queueMicrotask(() => {
    microtask = true;
  });
  const result = synchronous.computePosition(state.reference, state.floating, state);

  expect(result).toHaveProperty('x');
  expect(state.log).toContain('apply');
  expect(microtask).toBe(false);

  await Promise.resolve();
  expect(microtask).toBe(true);
});

it('throws measurement errors synchronously', () => {
  const state = fixture(synchronous, rectangles[0], false, 'bare');

  state.platform.getElementRects = () => {
    throw new Error('measurement failed');
  };

  expect(() => synchronous.computePosition(state.reference, state.floating, state)).toThrow(
    'measurement failed',
  );
});

it('exposes direct middleware and detectOverflow results', () => {
  const state = fixture(synchronous, rectangles[0], false, 'bare');
  let captured: reference.MiddlewareState | undefined;

  synchronous.computePosition(state.reference, state.floating, {
    ...state,
    middleware: [
      {
        name: 'capture',

        // Captures an actual middleware state for direct middleware/overflow invocation checks.
        fn(value) {
          captured = value;
          return {};
        },
      },
    ],
  });
  expect(captured).toBeDefined();
  const middlewareResult = synchronous.offset(3).fn(captured!);
  expect(middlewareResult).not.toHaveProperty('then');
  expect(middlewareResult).not.toHaveProperty('next');
  expect(synchronous.detectOverflow(captured!)).toEqual({
    top: -100,
    bottom: -40,
    left: -100,
    right: -100,
  });
});
