import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { transformerIdentity } from '../../src/build.ts';

/**
 * Creates an isolated mainline repository so tests never change this project's Git state.
 */
function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'release-identity-'));

  /**
   * Executes fixture Git operations and returns trimmed output.
   */
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();

  /**
   * Writes a repository-relative fixture file, creating its parent directory if needed.
   */
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  };

  /**
   * Commits fixture edits and returns the new revision for identity assertions.
   */
  const commit = () => {
    git('add', '.');
    git('commit', '--quiet', '-m', 'Fixture change');
    return git('rev-parse', 'HEAD');
  };

  git('init', '--quiet', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  write('src/example.ts', 'export {};');
  commit();
  return { directory, git, write, commit };
}

it.each([
  'src/example.ts',
  'package.json',
  'package-lock.json',
  'transform.config.json',
  'reviewed-inventory.json',
  'README.md',
])('counts a relevant commit: %s', (path) => {
  const repo = repository();
  repo.write(path, 'changed');
  const revision = repo.commit();

  expect(transformerIdentity(repo.directory)).toEqual({
    revision,
    sourceRevision: revision,
    dirty: false,
  });
});

it.each(['MAINTAINER.md', 'tests/example.test.ts', 'scripts/example.ts', 'upstream.lock.json'])(
  'does not republish merely for %s changes',
  (path) => {
    const repo = repository();
    const before = transformerIdentity(repo.directory);
    repo.write(path, 'changed');
    const revision = repo.commit();

    expect(transformerIdentity(repo.directory)).toEqual({ ...before, revision });
  },
);

it.each(['unstaged', 'staged', 'untracked'])('marks %s edits as previews', (state) => {
  const repo = repository();
  repo.write(state === 'untracked' ? 'new.ts' : 'src/example.ts', 'changed');

  if (state === 'staged') {
    repo.git('add', '.');
  }

  expect(transformerIdentity(repo.directory).dirty).toBe(true);
});

it('uses the mainline merge commit for merged transformer changes', () => {
  const repo = repository();
  repo.git('checkout', '--quiet', '-b', 'feature');
  repo.write('src/example.ts', 'changed');

  const feature = repo.commit();
  repo.git('checkout', '--quiet', 'main');
  repo.git('merge', '--quiet', '--no-ff', 'feature', '-m', 'Merge');
  const identity = transformerIdentity(repo.directory);

  expect(identity.sourceRevision).toBe(identity.revision);
  expect(identity.sourceRevision).not.toBe(feature);
});
