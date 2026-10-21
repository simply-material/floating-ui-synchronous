import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { beforeAll, expect, it } from 'vitest';
import { config, inputs, packageKeys, root } from '../src/config.ts';
import { createConsumer, npm } from './helpers/consumer.ts';
import { expectPackage } from './helpers/packages.ts';

let consumer: ReturnType<typeof createConsumer>;
let reference: ReturnType<typeof createConsumer>;

beforeAll(() => {
  consumer = createConsumer();
  reference = createConsumer('upstream');
});

it('installs independently without upstream asynchronous core or DOM', () => {
  expect(() => consumer.require.resolve('@floating-ui/core')).toThrow();
  expect(() => consumer.require.resolve('@floating-ui/dom')).toThrow();
});

it.each(packageKeys)('preserves installed package contracts: %s', (key) => {
  expectPackage(consumer, reference, key);
});

const measurement = readFileSync(new URL('./fixtures/measurement.js', import.meta.url), 'utf8');

it('resolves Node ESM and CommonJS entry points in an isolated installed consumer', () => {
  expect(
    consumer.run(
      'import * as core from "' +
        config.core.name +
        '";\nimport * as dom from "' +
        config.dom.name +
        '";\n' +
        measurement,
    ),
  ).toBe('ok\n');

  expect(
    consumer.run(
      'const core = require("' +
        config.core.name +
        '");\nconst dom = require("' +
        config.dom.name +
        '");\n' +
        measurement,
      'cjs',
    ),
  ).toBe('ok\n');
});

it.each(['.umd.js', '.umd.min.js'])(
  'supports AMD with an external transformed core: %s',
  (extension) => {
    let core: Record<string, unknown> = {};

    for (const key of packageKeys) {
      const exports: Record<string, unknown> = {};

      // Minimal AMD loader that verifies DOM requests the exact transformed core module name.
      const define = Object.assign(
        (dependencies: string[], factory: (...args: unknown[]) => void) => {
          expect(dependencies).toEqual(
            key === 'core' ? ['exports'] : ['exports', config.core.name],
          );

          factory(exports, core);
        },
        { amd: {} },
      );

      runInNewContext(
        readFileSync(
          join(consumer.packageDirectory(key), 'dist/floating-ui.' + key + extension),
          'utf8',
        ),
        { define },
      );

      expect(exports.computePosition).toBeTypeOf('function');

      if (key === 'core') core = exports;
      else expect(exports.offset).toBe(core.offset);
    }
  },
);

it('coexists with upstream packages without changing either engine', async () => {
  const separate = createConsumer();

  npm(
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      ...packageKeys.map((key) =>
        join(root, '.cache/upstream', key + '-' + inputs[key].version + '.tgz'),
      ),
    ],
    separate.directory,
  );

  const source = [
    'import * as core from "' + config.core.name + '";',
    'import * as dom from "' + config.dom.name + '";',
    'import * as upstream from "@floating-ui/dom";',

    measurement,

    'const promise = upstream.computePosition({}, {}, {platform});',
    'if (!(promise instanceof Promise)) throw new Error("Upstream changed");',
    'if (JSON.stringify(await promise) !== JSON.stringify(b)) throw new Error("Position differs");',
  ].join('\n');

  expect(separate.run(source)).toBe('ok\n');
});
