import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { rollup } from 'rollup';
import { minify } from 'terser';
import { config, inputs, packageKeys, root, type PackageKey } from './config.ts';
import { prepareInputs } from './upstream.ts';
import { assertInventory, inspectImplementation, transformImplementation } from './transform.ts';
import { transformDeclarations } from './declarations.ts';

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

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
   * Digest of source, dependency locks, configuration, and reviewed inventory contents.
   */
  inputSha256: string;
}

/**
 * Hashes release contents while excluding provenance and the package's own allocated version.
 * Dependency versions still contribute, so a changed core pairing changes DOM's fingerprint.
 *
 * @param files - Package-relative filenames mapped to their complete UTF-8 contents.
 * @returns A digest for deciding whether generated artifacts need a new package revision.
 */
export function releaseFingerprint(files: Record<string, string>): string {
  const contents = Object.entries(files)
    .filter(([path]) => path !== 'provenance.json')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, text]) => {
      if (path === 'package.json') {
        const { version: _version, ...manifest } = JSON.parse(text);
        text = JSON.stringify(manifest);
      }

      return [path, text];
    });

  return sha256(JSON.stringify(contents));
}

/**
 * Captures Git state and hashes local build inputs, including any uncommitted source changes.
 * @throws Error - If the Git revision or working-tree status cannot be read.
 */
async function transformerIdentity(): Promise<TransformerIdentity> {
  const paths = [
    'package.json',
    'package-lock.json',
    'transform.config.json',
    'upstream.lock.json',
    'reviewed-inventory.json',
    ...(await readdir(join(root, 'src'))).sort().map((p) => 'src/' + p),
  ];

  const contents = await Promise.all(
    paths.map(async (path) => [path, await readFile(join(root, path), 'utf8')]),
  );

  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

  const dirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  );

  return { revision, dirty, inputSha256: sha256(JSON.stringify(contents)) };
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
 * Verifies inputs, transforms core and DOM together, and writes the two packages.
 * DOM imports and depends on the exact configured core version; utils keeps its upstream range.
 * Both packages finish transformation before existing output directories are replaced.
 *
 * This generates artifacts and provenance, but does not run the test suite or publish packages.
 * @param outputDirectory - Parent of the generated core/ and dom/ directories; defaults to the repository's dist/.
 * @throws Error - If inputs differ from reviewed expectations or any transformation/output check fails.
 */
export async function build(outputDirectory = join(root, 'dist')): Promise<void> {
  const outputRoot = resolve(outputDirectory);
  const directories = await prepareInputs();
  const reviewed = JSON.parse(await readFile(join(root, 'reviewed-inventory.json'), 'utf8'));
  const identity = await transformerIdentity();
  const outputs: Record<string, Record<string, string>> = {};

  for (const key of packageKeys) {
    const upstream = JSON.parse(await readFile(join(directories[key], 'package.json'), 'utf8'));

    const expectedDependencies =
      key === 'core'
        ? { '@floating-ui/utils': '^0.2.12' }
        : { '@floating-ui/core': '^1.8.0', '@floating-ui/utils': '^0.2.12' };
    assertInventory(upstream.dependencies, expectedDependencies, 'Upstream dependencies');

    const input = await readFile(
      join(directories[key], 'dist', 'floating-ui.' + key + '.mjs'),
      'utf8',
    );
    assertInventory(inspectImplementation(input), reviewed[key]);
    const code = transformImplementation(input, config.core.name);
    const files = await generateJavaScript(key, code, directories.utils);

    for (const extension of ['d.ts', 'd.mts']) {
      const filename = 'dist/floating-ui.' + key + '.' + extension;
      files[filename] = transformDeclarations(
        await readFile(join(directories[key], filename), 'utf8'),
        config.core.name,
        filename,
      );
    }

    const dependencies = { ...upstream.dependencies };

    if (key === 'dom') {
      delete dependencies['@floating-ui/core'];
      dependencies[config.core.name] = config.core.version;
    }

    const manifest = {
      name: config[key].name,
      version: config[key].version,
      private: config.private,
      description: 'Generated synchronous variant of ' + inputs[key].name,
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
    files['LICENSE'] = await readFile(join(directories[key], 'LICENSE'), 'utf8');
    files['README.md'] = [
      `# ${config[key].name}`,
      `Generated from ${inputs[key].name}@${inputs[key].version}.`,
      'Positioning, platform methods and middleware execute synchronously. Custom callbacks, including size.apply, must be synchronous. Promise-returning callbacks are unsupported; no runtime guard is added.',
      'The synchronous prerelease label identifies the synchronous variant, not experimental quality. See provenance.json for exact inputs.',
      '',
    ].join('\n\n');
    files['provenance.json'] = json({
      // Version of this metadata structure, independent of either package's release version.
      schemaVersion: 1,

      upstream: inputs[key],
      transformer: identity,
      configuration: config,

      // Pair selected for validation; recording it here does not attest that tests have run.
      validationPair: {
        core: {
          upstream: inputs.core.version,
          name: config.core.name,
          version: config.core.version,
        },
        dom: { upstream: inputs.dom.version, name: config.dom.name, version: config.dom.version },
      },

      // Separates the pinned validation input from the range consumers will resolve.
      utils: {
        testVersion: inputs.utils.version,
        integrity: inputs.utils.integrity,
        dependencyRange: dependencies['@floating-ui/utils'],
      },

      releaseFingerprint: releaseFingerprint(files),
    });
    outputs[key] = files;
  }

  // Only replace the two generated package directories after transformation succeeds.
  for (const key of packageKeys) {
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
