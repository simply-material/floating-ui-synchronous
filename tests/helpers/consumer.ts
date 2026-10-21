import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, inputs, packageKeys, root, type PackageKey } from '../../src/config.ts';

/**
 * Runs the invoking npm CLI through Node, avoiding platform-specific shell wrappers.
 * Uses the repository's local npm cache and returns stdout; command failures throw.
 *
 * @param args - npm subcommand and arguments, passed directly without shell interpolation.
 * @param cwd - Directory in which npm should resolve packages and write files.
 */
export function npm(args: string[], cwd: string): string {
  const cli = process.env.npm_execpath;

  if (!cli || !existsSync(cli)) {
    throw new Error('Run tests through npm scripts so the npm CLI path is available.');
  }

  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...process.env, npm_config_cache: join(root, '.cache', 'npm') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Installs generated/reused archives or upstream references outside the repository.
 * Pins per-package utils offline without changing the dependency ranges shipped in those archives.
 * Lifecycle scripts are disabled and installations remain available for inspection.
 *
 * @param source - Generated/reused archives or locked upstream reference archives.
 * @param keys - Packages required by the test; core can be tested independently.
 * @returns Helpers bound to the isolated consumer's package resolution and working directory.
 */
export function createConsumer(
  source: 'archives' | 'upstream' = 'archives',
  keys: readonly PackageKey[] = packageKeys,
) {
  // Outside the repository: ancestor node_modules must not hide packaging defects.
  const directory = mkdtempSync(join(tmpdir(), 'floating-ui-synchronous-consumer-'));
  const archives = join(directory, 'archives');
  mkdirSync(archives);
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: 'consumer-fixture',
      private: true,
      type: 'module',
      overrides: Object.fromEntries(
        keys.flatMap((key) =>
          [config[key].name, inputs[key].name].map((name) => [
            name,
            {
              '@floating-ui/utils': pathToFileURL(
                join(root, '.cache/upstream', 'utils-' + inputs.utils[key].version + '.tgz'),
              ).href,
            },
          ]),
        ),
      ),
    }),
  );

  const names = source === 'upstream' ? inputs : config;
  const packages = keys.map((key) => {
    if (source === 'upstream') {
      return join(root, '.cache/upstream', key + '-' + inputs[key].version + '.tgz');
    }

    if (process.env.FLOATING_UI_RELEASE_DIRECTORY) {
      return join(process.env.FLOATING_UI_RELEASE_DIRECTORY, key + '.tgz');
    }

    const output = JSON.parse(
      npm(
        [
          'pack',
          join(root, 'dist', key),
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          archives,
        ],
        directory,
      ),
    );
    return join(archives, output[0].filename);
  });

  npm(
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      ...packages,
    ],
    directory,
  );

  const require = createRequire(join(directory, 'package.json'));

  /** Resolves an upstream or transformed package using this consumer's own installation. */
  const packageDirectory = (key: PackageKey) =>
    dirname(require.resolve(names[key].name + '/package.json'));

  return {
    /**
     * Absolute root of this consumer's temporary npm project.
     */
    directory,

    /**
     * Node require function resolving from this consumer, not the transformer repository.
     */
    require,

    /**
     * Resolves the installed upstream or transformed package for artifact inspection.
     */
    packageDirectory,

    /**
     * Reads the installed manifest, including dependency and export mappings.
     */
    manifest(key: PackageKey) {
      return JSON.parse(readFileSync(join(packageDirectory(key), 'package.json'), 'utf8'));
    },

    /**
     * Resolves a dependency from its importing package, including nested utils installations.
     */
    dependencyDirectory(key: PackageKey, name: string) {
      return dirname(
        createRequire(join(packageDirectory(key), 'package.json')).resolve(name + '/package.json'),
      );
    },

    /**
     * Writes and executes a consumer entry point, returning stdout or throwing on failure.
     * @param source - Complete JavaScript program to run in a separate Node process.
     * @param extension - Entry file extension; mjs and cjs exercise their respective module loaders.
     */
    run(source: string, extension = 'mjs') {
      const entry = join(directory, 'check.' + extension);
      writeFileSync(entry, source);

      return execFileSync(process.execPath, [entry], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 30_000,
      });
    },
  };
}
