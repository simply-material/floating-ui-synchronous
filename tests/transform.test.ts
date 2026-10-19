import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertInventory,
  inspectImplementation,
  transformImplementation,
} from '../src/transform.ts';

// A stable name used for tests.
const coreName = '@example/synchronous-core';

const transform = (source: string) => transformImplementation(source, coreName);

describe('implementation AST transformation', () => {
  it('preserves observable behavior across calls, branches, loops, and exceptions', async () => {
    const source = readFileSync(new URL('./fixtures/semantics.input.js', import.meta.url), 'utf8');

    // Gives each execution its own global helper functions and event log,
    // so the original and transformed code cannot affect each other's results.
    function context() {
      const events: string[] = [];

      return {
        events,

        measure(value: number) {
          events.push('measure:' + value);
          return value + 1;
        },

        fail() {
          throw new Error('failure');
        },
      };
    }

    const originalContext = context();
    const transformedContext = context();
    const expected = await runInNewContext(source, originalContext);
    const actual = runInNewContext(transform(source), transformedContext);

    expect(actual).not.toHaveProperty('then');
    expect(actual).toEqual({
      first: 10,
      nested: 3,
      total: 5,
      conditional: undefined,
      optional: 7,
      chainBoundary: 'threw',
    });
    expect(actual).toEqual(expected);
    expect(transformedContext.events).toEqual([
      'platform:3',
      'unbound',
      'measure:1',
      'measure:2',
      'measure:1',
      'measure:2',
      'failure',
      'finally',
    ]);
    expect(transformedContext.events).toEqual(originalContext.events);
  });

  it('records the call being awaited, excluding calls in its arguments', () => {
    const inventory = inspectImplementation(
      'async function f() { return await platform.measure(getOptions(), () => unrelated()); }',
    );

    expect(inventory.awaits).toEqual({ 'f: platform.measure': 1 });
  });

  it('does not treat JSON property ordering as an inventory change', () => {
    expect(() => assertInventory({ a: 1, b: 2 }, { b: 2, a: 1 })).not.toThrow();
  });

  it.each([
    'async function subject() { return await measure(); }',
    'const subject = async () => await measure();',
    'const subject = async function() { return await measure(); };',
    'const object = {async subject() { return await measure(); }}; const subject = object.subject;',
    'const object = {subject: async () => await measure()}; const subject = object.subject;',
    'const subject = [async () => await measure()][0];',
    'class Example { async method() { return await measure(); }} const subject = new Example().method;',
  ])('handles each async function form: %s', (declaration) => {
    const output = transform(declaration + '\nsubject();');

    expect(runInNewContext(output, { measure: () => 42 })).toBe(42);
    expect(transform(output)).toBe(output);
  });

  it('preserves receivers, precedence, evaluation order, and short circuits', () => {
    const calls: number[] = [];
    const code = `
      const object = {
        value: 6,
        async run() {
          const first = (await measure(this.value)) * 2;
          const second = await measure(await measure(3));
          const skipped = false && await fail();
          const missing = undefined;
          const optional = (await missing?.()) ?? 7;

          return [first, second, skipped, optional];
        },
      };

      object.run();
    `;

    expect(
      runInNewContext(transform(code), {
        measure(value: number) {
          calls.push(value);
          return value + 1;
        },

        fail() {
          throw new Error('Must short circuit');
        },
      }),
    ).toEqual([14, 5, false, 7]);
    expect(calls).toEqual([6, 3, 4]);
  });

  it('preserves synchronous error and finally behavior', () => {
    const calls: string[] = [];
    const code = `
      async function subject() {
        try {
          return await fail();
        } catch (error) {
          record(error.message);
          return 2;
        } finally {
          record("finally");
        }
      }

      subject();
    `;

    expect(
      runInNewContext(transform(code), {
        fail() {
          throw new Error('measurement');
        },

        record(value: string) {
          calls.push(value);
        },
      }),
    ).toBe(2);
    expect(calls).toEqual(['measurement', 'finally']);
  });

  it('rewrites imports and re-exports without editing ordinary strings or comments', () => {
    const output = transform(
      [
        'import {computePosition} from "@floating-ui/core";',
        'export {detectOverflow} from "@floating-ui/core";',
        '// @floating-ui/core is the original package.',
        'const label = "@floating-ui/core";',
      ].join('\n'),
    );

    expect(output.match(/from "@example\/synchronous-core"/g)).toHaveLength(2);
    expect(output).toContain('const label = "@floating-ui/core"');
    expect(output).toContain('// @floating-ui/core is the original package.');
  });

  it.each([
    'async function f() { for await (const x of items) {} }',
    'async function* f() { yield 1; }',
    'function f() { return Promise.resolve(1); }',
    'function f() { return task.then(callback); }',
    'async function f() { return await import("module"); }',
    'async function f() { return await result; }',
    'function f() { return task["then"](callback); }',
    'function f() { return globalThis["Promise"].resolve(1); }',
    'async function f() { return (await object[getKey()])(); }',
    'async function f() { return (await getObject()?.method)(); }',
    'async function f() { return await (() => measure()); }',
  ])('fails on unreviewed asynchronous mechanisms: %s', (source) => {
    expect(() => transform(source)).toThrow(/Unsupported|Unreviewed/);
  });

  it('requires review when awaited callees or function forms change', () => {
    const reviewed = inspectImplementation(
      'async function f() { return await platform.measure(); }',
    );

    expect(() =>
      assertInventory(
        inspectImplementation('async function f() { return await platform.other(); }'),
        reviewed,
      ),
    ).toThrow('inventory changed');

    expect(() =>
      assertInventory(
        inspectImplementation(
          'async function f() { return await platform.measure(); } const extra = async () => 1;',
        ),
        reviewed,
      ),
    ).toThrow('inventory changed');
  });
});
