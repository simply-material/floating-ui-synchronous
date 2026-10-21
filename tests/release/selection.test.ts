import { afterEach, expect, it, vi } from 'vitest';
import { config, inputs, type PackageKey } from '../../src/config.ts';
import { allocateVersion, selectRelease } from '../../scripts/select-release.ts';
import {
  publicationTag,
  registryPackage,
  releaseTag,
  sourcePackage,
  type RegistryPackage,
  type RegistryVersion,
  type ReleasePlan,
} from '../../scripts/release-helpers.ts';

/**
 * Builds independent upstream records; fake archive identities are never downloaded by planner tests.
 */
function version(key: PackageKey, value: string, coreRange = '^1.8.0'): RegistryVersion {
  return {
    name: '@floating-ui/' + key,
    version: value,
    dependencies: {
      '@floating-ui/utils': '^0.2.0',
      ...(key === 'dom' ? { '@floating-ui/core': coreRange } : {}),
    },
    dist: {
      integrity: 'sha512-' + key + '-' + value,
      tarball: 'https://registry.npmjs.org/' + key + '-' + value + '.tgz',
    },
  };
}

/**
 * Creates a fresh mutable npm snapshot for arranging publication sequences.
 */
function registry(versions: RegistryVersion[] = []): RegistryPackage {
  return {
    versions: Object.fromEntries(versions.map((item) => [item.version, item])),
    'dist-tags': {},
  };
}

/**
 * Starts at the checked-in baseline with an empty transformed registry and one available source per package.
 */
function scenario() {
  const upstream = {
    core: registry([version('core', inputs.core.version)]),
    dom: registry([version('dom', inputs.dom.version)]),
  };
  const published = { core: registry(), dom: registry() };
  const completed = new Set<string>();

  return {
    upstream,
    published,
    completed,

    /**
     * Evaluates the planner without modifying its registry inputs.
     */
    next(revision = 'transformer', preview = false) {
      const before = structuredClone({ upstream, published });
      const result = selectRelease(
        config,
        inputs,
        upstream,
        published,
        completed,
        revision,
        preview,
      );

      expect({ upstream, published }).toEqual(before);

      return result;
    },

    /**
     * Records npm publication, optionally leaving its GitHub completion marker missing.
     */
    publish(plan: ReleasePlan, complete = true) {
      const target = published[plan.key];
      const tag = publicationTag(plan.version, target);
      target.versions[plan.version] = {
        ...version(plan.key, plan.version),
        name: plan.name,
        synchronousRelease: structuredClone(plan.identity),
      };
      target['dist-tags'][tag] = plan.version;

      if (complete) {
        completed.add(releaseTag(plan));
      }
    },
  };
}

it('starts at the locked baseline and drains core versions before DOM, one publication per run', () => {
  const state = scenario();
  state.upstream.core = registry([
    version('core', '1.7.9'),
    version('core', '1.8.0'),
    version('core', '1.8.1'),
    version('core', '2.0.0'),
  ]);
  state.upstream.dom.versions['1.7.9'] = version('dom', '1.7.9');

  for (const [key, selected] of [
    ['core', '1.8.0'],
    ['core', '1.8.1'],
    ['core', '2.0.0'],
    ['dom', '1.8.0'],
  ] as const) {
    const plan = state.next()!;
    expect(plan).toMatchObject({
      key,
      version: selected,
      reason: 'upstream',
      identity: { upstream: sourcePackage(state.upstream[key].versions[selected]) },
    });

    if (key === 'dom') {
      expect(plan.identity.coreVersion).toBe('^1.8.0');
      expect(plan.core?.version).toBe('1.8.1');
    } else {
      expect(plan.core).toBeUndefined();
    }

    state.publish(plan);
  }

  expect(state.next()).toBeUndefined();
});

it('finds late maintenance releases below the newest major without downgrading latest', () => {
  const state = scenario();
  state.publish(state.next()!);
  state.upstream.core.versions['2.0.0'] = version('core', '2.0.0');
  state.publish(state.next()!);
  state.publish(state.next()!);

  state.upstream.core.versions['1.8.1'] = version('core', '1.8.1');
  const maintenance = state.next()!;

  expect(maintenance).toMatchObject({ key: 'core', version: '1.8.1', reason: 'upstream' });
  expect(publicationTag(maintenance.version, state.published.core)).toBe('maintenance');

  state.publish(maintenance);

  expect(state.published.core['dist-tags'].latest).toBe('2.0.0');
  expect(state.next()).toBeUndefined();
});

it('uses provenance rather than transformed patch numbers to find unprocessed sources', () => {
  const state = scenario();
  state.publish({ ...state.next()!, version: '1.8.9' });
  state.upstream.core.versions['1.8.1'] = version('core', '1.8.1');

  expect(state.next()).toMatchObject({
    key: 'core',
    version: '1.8.10',
    identity: { upstream: { version: '1.8.1' } },
  });
});

it('finishes an npm publication before advancing, preserving its original identity after transformer changes', () => {
  const state = scenario();
  const plan = state.next()!;

  expect(state.next()).toEqual(plan);

  state.publish(plan, false);
  state.upstream.core.versions['1.8.1'] = version('core', '1.8.1');

  const resumed = state.next('new-transformer')!;

  expect(resumed).toEqual({
    key: plan.key,
    name: plan.name,
    version: plan.version,
    identity: plan.identity,
    reason: 'resume',
    existing: sourcePackage(state.published.core.versions[plan.version]),
  });

  state.completed.add(releaseTag(plan));

  expect(state.next('new-transformer')).toMatchObject({
    reason: 'upstream',
    identity: { transformerRevision: 'new-transformer', upstream: { version: '1.8.1' } },
  });
});

it('releases transformer fixes for current core and DOM in separate runs, then stops', () => {
  const state = scenario();
  state.publish(state.next()!);
  state.publish(state.next()!);
  const core = state.next('fixed')!;

  expect(core).toMatchObject({ key: 'core', version: '1.8.1', reason: 'transformer' });

  state.publish(core);
  const dom = state.next('fixed')!;

  expect(dom).toMatchObject({
    key: 'dom',
    version: '1.8.1',
    reason: 'transformer',
    identity: { coreVersion: '^1.8.0' },
    core: { version: '1.8.1' },
  });

  state.publish(dom);

  expect(state.next('fixed')).toBeUndefined();
});

it('does not add a redundant transformer revision after adopting a new upstream version', () => {
  const state = scenario();
  state.publish(state.next()!);
  state.publish(state.next()!);
  state.upstream.core.versions['1.8.1'] = version('core', '1.8.1');
  state.publish(state.next('fixed')!);

  expect(state.next('fixed')).toMatchObject({ key: 'dom', reason: 'transformer' });
});

it('does not revise existing DOM merely because an earlier compatible core becomes available', () => {
  const state = scenario();
  state.publish(state.next()!);
  state.upstream.core.versions['1.10.0'] = version('core', '1.10.0');
  state.publish(state.next()!);
  state.upstream.dom.versions['1.8.0'].dependencies!['@floating-ui/core'] = '^1.9.0';
  const dom = state.next()!;

  expect(dom.identity.coreVersion).toBe('^1.10.0');

  state.publish(dom);

  state.upstream.core.versions['1.9.0'] = version('core', '1.9.0');
  state.publish(state.next()!);

  expect(state.next()).toBeUndefined();
});

it('limits transformer fixes to newest sources instead of republishing maintenance history', () => {
  const state = scenario();
  state.publish(state.next()!);
  state.upstream.core.versions['2.0.0'] = version('core', '2.0.0');
  state.publish(state.next()!);
  state.publish(state.next()!);

  expect(state.next('fixed')).toMatchObject({ key: 'core', version: '2.0.1' });

  state.publish(state.next('fixed')!);

  expect(state.next('fixed')).toMatchObject({ key: 'dom', core: { version: '1.8.0' } });
});

it('translates a changed DOM minimum using upstream provenance without backfilling core', () => {
  const state = scenario();
  state.publish({ ...state.next()!, version: '1.8.5' });
  state.upstream.core.versions['1.8.1'] = version('core', '1.8.1');
  state.publish(state.next()!);
  state.upstream.dom.versions['1.8.0'].dependencies!['@floating-ui/core'] = '^1.8.1';

  expect(state.next()).toMatchObject({
    key: 'dom',
    identity: { coreVersion: '^1.8.6' },
    core: { version: '1.8.6' },
  });
});

it('fails on an unavailable DOM core requirement instead of creating another publication', () => {
  const state = scenario();
  state.publish(state.next()!);
  state.upstream.dom.versions['1.8.0'].dependencies!['@floating-ui/core'] = '^3.0.0';

  expect(() => state.next()).toThrow('No published transformed core satisfies');
});

it('rejects a missing core requirement', () => {
  const state = scenario();
  state.publish(state.next()!);
  delete state.upstream.dom.versions['1.8.0'].dependencies!['@floating-ui/core'];

  expect(() => state.next()).toThrow('must declare its core dependency');
});

it('skips prereleases and deprecated upstream releases while retaining later eligibility', () => {
  const state = scenario();
  state.upstream.core.versions['1.8.1'] = { ...version('core', '1.8.1'), deprecated: 'withdrawn' };
  state.upstream.core.versions['2.0.0-beta.1'] = version('core', '2.0.0-beta.1');
  state.publish(state.next()!);

  expect(state.next()).toMatchObject({ key: 'dom' });
});

it('allocates previews without interpreting uncommitted contents as a published identity', () => {
  const state = scenario();
  state.publish(state.next()!);
  state.publish(state.next()!);

  expect(state.next('transformer', true)).toMatchObject({
    key: 'core',
    version: '1.8.1',
    reason: 'transformer',
  });
});

it('allocates independently by major/minor, includes occupied versions, and never trails upstream', () => {
  const versions = registry([
    version('core', '1.8.8'),
    version('core', '1.9.2'),
    version('core', '2.0.3'),
  ]);

  expect(allocateVersion('1.8.1', versions)).toBe('1.8.9');
  expect(allocateVersion('1.8.12', versions)).toBe('1.8.12');
  expect(allocateVersion('1.9.0', versions)).toBe('1.9.3');
  expect(allocateVersion('3.0.0', versions)).toBe('3.0.0');

  versions.versions['1.8.9007199254740991'] = version('core', '1.8.9007199254740991');

  expect(() => allocateVersion('1.8.1', versions)).toThrow('too large');
});

it('does not disguise a backwards upstream patch as a newer compatible patch', () => {
  const state = scenario();
  state.publish(state.next()!);
  state.upstream.core.versions['1.8.2'] = version('core', '1.8.2');
  state.publish(state.next()!);
  state.upstream.core.versions['1.8.1'] = version('core', '1.8.1');

  expect(() => state.next()).toThrow('older upstream patch');
});

it('chooses a maintenance tag even if latest is stale or absent', () => {
  const versions = registry([version('core', '2.0.0')]);

  expect(publicationTag('1.8.1', versions)).toBe('maintenance');

  versions['dist-tags'].latest = '3.0.0';

  expect(publicationTag('2.1.0', versions)).toBe('maintenance');
  expect(publicationTag('3.1.0', versions)).toBe('latest');
});

afterEach(() => vi.unstubAllGlobals());

it('treats only registry 404 as an unpublished package', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  fetch.mockResolvedValueOnce(new Response('', { status: 404 }));

  expect(await registryPackage('@example/missing')).toEqual(registry());

  for (const status of [403, 429, 500]) {
    fetch.mockResolvedValueOnce(new Response('', { status }));

    await expect(registryPackage('@example/core')).rejects.toThrow('Registry lookup failed');
  }

  fetch.mockRejectedValueOnce(new Error('Offline'));

  await expect(registryPackage('@example/core')).rejects.toThrow('Offline');
});
