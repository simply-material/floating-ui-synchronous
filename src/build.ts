import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { rollup } from 'rollup';
import { minify } from 'terser';
import { satisfies } from 'semver';
import {
  config,
  inputs,
  packageKeys,
  releaseIdentity,
  repository,
  root,
  type PackageKey,
} from './config.ts';
import { prepareInputs } from './upstream.ts';
import { assertInventory, inspectImplementation, transformImplementation } from './transform.ts';
import { transformDeclarations } from './declarations.ts';

/**
 * Serializes generated metadata with readable indentation and a final newline.
 */
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

/**
 * Provenance identifying the local transformer state that produced an artifact.
 */
interface TransformerIdentity {
  /**
   * Git HEAD identifying the checkout used for this build.
   */
  revision: string;

  /**
   * Whether the checkout has staged, unstaged, or untracked changes.
   */
  dirty: boolean;

  /**
   * Last mainline commit affecting transformer source or build configuration.
   */
  sourceRevision: string;
}

/**
 * Captures checkout provenance and the last mainline commit affecting publication inputs.
 *
 * @param directory - Checkout to inspect; tests use isolated fixture repositories.
 * @throws Error - If Git history or working-tree status cannot be read.
 */
export function transformerIdentity(directory = root): TransformerIdentity {
  /**
   * Runs Git relative to the inspected checkout, returning trimmed command output.
   */
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();

  return {
    revision: git('rev-parse', 'HEAD'),
    dirty: Boolean(git('status', '--porcelain')),
    // First-parent history includes source changes introduced by merge commits.
    sourceRevision: git(
      'log',
      '-1',
      '--first-parent',
      '--format=%H',
      '--',
      'src',
      'package.json',
      'package-lock.json',
      'transform.config.json',
      'reviewed-inventory.json',
      'README.md',
    ),
  };
}

/**
 * Emits npm ESM, browser ESM, and UMD distributions, with minified browser and UMD variants.
 * Utils stays external in npm ESM and is bundled from verified inputs for browser/UMD output.
 * DOM's transformed core dependency stays external in every format.
 *
 * @param key - Package whose distribution filenames and UMD global should be used.
 * @param code - Already transformed canonical ESM implementation.
 * @param utilsDirectory - Freshly extracted, integrity-checked upstream utils package directory.
 * @returns Package-relative distribution filenames mapped to generated JavaScript.
 */
async function generateJavaScript(
  key: PackageKey,
  code: string,
  utilsDirectory: string,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const stem = 'dist/floating-ui.' + key;

  for (const format of ['npm', 'browser', 'umd'] as const) {
    const virtual = '\0floating-ui-synchronous:' + key;
    const bundle = await rollup({
      input: virtual,

      onwarn(warning) {
        throw new Error(warning.message);
      },
      plugins: [
        {
          name: 'verified-inputs',

          resolveId(id) {
            if (id === virtual) {
              return virtual;
            }

            if (id === config.core.name && key === 'dom') {
              return { id, external: true };
            }

            if (id === '@floating-ui/utils' || id === '@floating-ui/utils/dom') {
              if (format === 'npm') {
                return { id, external: true };
              }

              return join(
                utilsDirectory,
                'dist',
                id.endsWith('/dom') ? 'floating-ui.utils.dom.mjs' : 'floating-ui.utils.mjs',
              );
            }

            throw new Error('Unexpected implementation import: ' + id);
          },

          load(id) {
            return id === virtual ? code : null;
          },
        },
      ],
    });

    try {
      const { output } = await bundle.generate({
        format: format === 'umd' ? 'umd' : 'es',
        name: config[key].global,
        globals: { [config.core.name]: config.core.global },

        // This controls Rollup's generated wrappers, not transpilation of upstream implementation code.
        generatedCode: 'es5',
        freeze: false,
        sourcemap: false,
      });
      if (output.length !== 1 || output[0].type !== 'chunk') {
        throw new Error('Unexpected bundle shape');
      }

      const source = output[0].code;

      if (source.includes('@floating-ui/core')) {
        throw new Error('Upstream core reference in generated code');
      }

      const inventory = inspectImplementation(source);

      if (inventory.functions.length || Object.keys(inventory.awaits).length) {
        throw new Error('Generated output is asynchronous');
      }

      if (format === 'npm') {
        files[stem + '.mjs'] = source;
        files[stem + '.esm.js'] = source;
      } else {
        const extension = format === 'umd' ? '.umd.js' : '.browser.mjs';
        files[stem + extension] = source;
        const compressed = await minify(source, {
          module: format === 'browser',
          ecma: 2015,
          format: { comments: /^!/ },
        });
        if (!compressed.code) {
          throw new Error('Minifier produced no output');
        }

        const minifiedInventory = inspectImplementation(compressed.code);

        if (minifiedInventory.functions.length || Object.keys(minifiedInventory.awaits).length) {
          throw new Error('Minification introduced asynchronous syntax');
        }

        files[stem + extension.replace(/\.(js|mjs)$/, '.min.$1')] = compressed.code + '\n';
      }
    } finally {
      await bundle.close();
    }
  }

  return files;
}

/**
 * Verifies inputs and writes selected packages; defaults to the baseline core/DOM pair.
 * DOM retains its configured caret dependency; utils keeps its upstream range.
 * All selected transformations finish before their output directories are replaced.
 *
 * @param outputDirectory - Parent of the generated core/ and dom/ directories; defaults to the repository's dist/.
 * @param packages - Packages to transform; a core-only build does not prepare DOM.
 * @throws Error - If inputs differ from reviewed expectations or any transformation/output check fails.
 */
export async function build(
  outputDirectory = join(root, 'dist'),
  packages: readonly PackageKey[] = packageKeys,
): Promise<void> {
  const outputRoot = resolve(outputDirectory);
  const directories = await prepareInputs(packages);
  const reviewed = JSON.parse(await readFile(join(root, 'reviewed-inventory.json'), 'utf8'));
  const identity = transformerIdentity();
  const outputs: Record<string, Record<string, string>> = {};

  for (const { key, packageDirectory, utilsDirectory } of directories) {
    const upstream = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));

    validateDependencies(key, upstream.dependencies);

    const input = await readFile(
      join(packageDirectory, 'dist', 'floating-ui.' + key + '.mjs'),
      'utf8',
    );
    assertInventory(inspectImplementation(input), reviewed[key]);
    const code = transformImplementation(input, config.core.name);
    const files = await generateJavaScript(key, code, utilsDirectory);

    for (const extension of ['d.ts', 'd.mts']) {
      const filename = 'dist/floating-ui.' + key + '.' + extension;
      files[filename] = transformDeclarations(
        await readFile(join(packageDirectory, filename), 'utf8'),
        config.core.name,
        filename,
      );
    }

    const dependencies = { ...upstream.dependencies };

    if (key === 'dom') {
      delete dependencies['@floating-ui/core'];
      dependencies[config.core.name] = config.dom.coreRange;
    }

    const manifest = {
      name: config[key].name,
      version: config[key].version,
      synchronousRelease: releaseIdentity(key, identity.sourceRevision),
      private: config.private,
      description: 'Generated synchronous variant of ' + inputs[key].name,
      repository: { type: 'git', url: 'https://github.com/' + repository + '.git' },
      homepage: 'https://github.com/' + repository + '#readme',
      bugs: { url: 'https://github.com/' + repository + '/issues' },
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org' },
      license: upstream.license,
      main: upstream.main,
      module: upstream.module,
      types: upstream.types,
      unpkg: upstream.unpkg,
      exports: upstream.exports,
      sideEffects: upstream.sideEffects,
      files: ['dist', 'provenance.json'],
      dependencies,
    };

    files['package.json'] = json(manifest);
    files['LICENSE'] = await readFile(join(packageDirectory, 'LICENSE'), 'utf8');
    files['README.md'] = await readFile(join(root, 'README.md'), 'utf8');
    files['provenance.json'] = json({
      // Version of this metadata structure, independent of either package's release version.
      schemaVersion: 2,

      upstream: inputs[key],
      transformer: identity,
      configuration: config,
      inputs,

      validationPair: {
        core: {
          upstream: inputs.core.version,
          name: config.core.name,
          version: config.core.version,
        },
        ...(packages.includes('dom')
          ? {
              dom: {
                upstream: inputs.dom.version,
                name: config.dom.name,
                version: config.dom.version,
              },
            }
          : {}),
      },

      // Separates the pinned validation input from the range consumers will resolve.
      utils: {
        testVersion: inputs.utils[key].version,
        integrity: inputs.utils[key].integrity,
        dependencyRange: dependencies['@floating-ui/utils'],
      },
    });
    outputs[key] = files;
  }

  // Only replace selected package directories after transformation succeeds.
  for (const key of packages) {
    const destination = resolve(outputRoot, key);
    if (relative(outputRoot, destination) !== key) {
      throw new Error('Unsafe output directory');
    }

    await rm(destination, { recursive: true, force: true });
    await mkdir(join(destination, 'dist'), { recursive: true });

    for (const [filename, contents] of Object.entries(outputs[key])) {
      await writeFile(join(destination, filename), contents);
    }

    console.log('Built ' + config[key].name + '@' + config[key].version);
  }
}

/**
 * Accepts upstream range changes while requiring reviewed dependency names and compatible inputs.
 *
 * @param key - Package whose dependency requirements to validate.
 * @param dependencies - Upstream manifest's declared dependency ranges.
 * @throws Error - For an unexpected dependency or an incompatible upstream/transformed version.
 */
export function validateDependencies(key: PackageKey, dependencies: Record<string, string>): void {
  const expected =
    key === 'core' ? ['@floating-ui/utils'] : ['@floating-ui/core', '@floating-ui/utils'];

  assertInventory(Object.keys(dependencies ?? {}).sort(), expected, 'Upstream dependencies');

  for (const name of expected) {
    const input = name === '@floating-ui/core' ? inputs.core : inputs.utils[key];

    if (typeof dependencies[name] !== 'string' || !satisfies(input.version, dependencies[name])) {
      throw new Error('Locked input does not satisfy upstream dependency: ' + name);
    }
  }

  if (key === 'dom' && !satisfies(config.core.version, config.dom.coreRange)) {
    throw new Error('DOM validation core must satisfy its transformed dependency range');
  }
}
