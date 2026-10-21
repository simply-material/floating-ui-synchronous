import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, root, type PackageKey } from '../../src/config.ts';
import type { createConsumer } from './consumer.ts';

/** File extension, module mode, and resolution mode covering Node exports and bundler consumers. */
export const consumerModes = [
  { extension: 'mts', module: 'NodeNext', resolution: 'NodeNext' },
  { extension: 'cts', module: 'NodeNext', resolution: 'NodeNext' },
  { extension: 'ts', module: 'ESNext', resolution: 'Bundler' },
] as const;

/**
 * Compiles source assertions against installed declarations without editor-only path mappings.
 * @param consumer
 * @param key - Checks core alone, or both fixtures for DOM and core interoperability.
 * @param mode
 * @throws Error - With TypeScript diagnostics if a contract or library declaration fails.
 */
export function checkConsumerTypes(
  consumer: ReturnType<typeof createConsumer>,
  key: PackageKey,
  mode: (typeof consumerModes)[number],
): void {
  const fixtures = key === 'core' ? ['core-consumer'] : ['core-consumer', 'dom-consumer'];
  const entries = fixtures.map((fixture) => {
    const source = readFileSync(new URL('../fixtures/' + fixture + '.ts', import.meta.url), 'utf8')
      .replaceAll('@test/synchronous-core', config.core.name)
      .replaceAll('@test/synchronous-dom', config.dom.name);
    const entry = join(consumer.directory, fixture + '.' + mode.extension);
    writeFileSync(entry, source);

    return entry;
  });

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
        mode.module,
        '--moduleResolution',
        mode.resolution,
        ...entries,
      ],
      {
        cwd: consumer.directory,
        encoding: 'utf8',
        timeout: 30_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    throw new Error(
      String(
        (
          error as {
            /**
             * Captured compiler diagnostics from the failed process.
             */
            stdout?: string;
          }
        ).stdout || error,
      ),
    );
  }
}
