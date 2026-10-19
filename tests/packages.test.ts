import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { beforeAll, expect, it } from 'vitest';
import { config, inputs, packageKeys, root } from '../src/config.ts';
import { createConsumer, npm } from './helpers/consumer.ts';

let consumer: ReturnType<typeof createConsumer>;

beforeAll(() => {
  consumer = createConsumer();
});

it('installs two independent packages without upstream asynchronous core or DOM', () => {
  const core = consumer.manifest('core');
  const dom = consumer.manifest('dom');

  expect(core.dependencies).toEqual({ '@floating-ui/utils': '^0.2.12' });
  expect(dom.dependencies).toEqual({
    '@floating-ui/utils': '^0.2.12',
    [config.core.name]: config.core.version,
  });

  expect(() => consumer.require.resolve('@floating-ui/core')).toThrow();
  expect(() => consumer.require.resolve('@floating-ui/dom')).toThrow();

  expect(consumer.require('@floating-ui/utils/package.json').version).toBe(inputs.utils.version);
});

it.each(packageKeys)('preserves upstream distribution paths and exported names: %s', (key) => {
  const originalDirectory = join(root, 'node_modules', '@floating-ui', key);
  const upstream = JSON.parse(readFileSync(join(originalDirectory, 'package.json'), 'utf8'));
  const manifest = consumer.manifest(key);

  for (const field of ['main', 'module', 'types', 'unpkg', 'exports', 'sideEffects']) {
    expect(manifest[field]).toEqual(upstream[field]);
  }

  const actualFiles = readdirSync(join(consumer.packageDirectory(key), 'dist')).sort();
  expect(actualFiles).toEqual(readdirSync(join(originalDirectory, 'dist')).sort());

  expect(Object.keys(consumer.require(config[key].name)).sort()).toEqual(
    Object.keys(consumer.require(join(originalDirectory, upstream.main))).sort(),
  );

  for (const file of actualFiles) {
    const contents = readFileSync(join(consumer.packageDirectory(key), 'dist', file), 'utf8');

    expect(contents).not.toContain('@floating-ui/core');

    if (file.endsWith('.d.ts') || file.endsWith('.d.mts'))
      expect(contents).not.toMatch(/\b(?:Promise|Promisable)\s*</);

    if (file.includes('.browser') || file.includes('.umd'))
      expect(contents).not.toContain('@floating-ui/utils');
  }

  expect(readFileSync(join(consumer.packageDirectory(key), manifest.module), 'utf8')).toContain(
    '@floating-ui/utils',
  );

  expect(existsSync(join(consumer.packageDirectory(key), 'LICENSE'))).toBe(true);

  const provenance = JSON.parse(
    readFileSync(join(consumer.packageDirectory(key), 'provenance.json'), 'utf8'),
  );

  expect(provenance.upstream).toEqual(inputs[key]);
  expect(provenance.validationPair.core.version).toBe(config.core.version);
  expect(provenance.utils).toMatchObject({
    testVersion: inputs.utils.version,
    dependencyRange: '^0.2.12',
  });
  expect(provenance.releaseFingerprint).toMatch(/^[a-f0-9]{64}$/);
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
