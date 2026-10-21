# Releases

We publish `@simply-material/floating-ui-core-synchronous` and
`@simply-material/floating-ui-dom-synchronous` as public npm packages.

## How does a release work?

The release workflow runs when `main` changes, daily at 09:00 UTC, and through **Run workflow**.
Each run handles one package. After a successful publication, consumer checks, and GitHub release,
it dispatches another run. A run with nothing to release stops the chain.

We process stable, non-deprecated upstream versions at or above each package's version in
`upstream.lock.json`, including maintenance releases published later on older lines. Published
provenance identifies which upstream versions we have already transformed. Our own patch numbers
cannot be used for that comparison.

Each run first finishes any npm publication missing its completed GitHub release. It then chooses:

1. The earliest unprocessed core version.
2. The earliest unprocessed DOM version.
3. A transformer update for the newest eligible core version.
4. A transformer update for the newest eligible DOM version.

Transformer updates follow commits affecting `src`, build dependencies, output configuration, or
the reviewed inventory.

## How are versions allocated?

Major and minor versions follow each package's upstream version. Within that series, we use the higher
of upstream's patch and our highest published patch plus one. The first publication starts at upstream's
patch. Exact upstream versions are recorded in package metadata and release notes.
If an older upstream package is updated, we use the `maintenance` npm tag so it doesn't become `latest`.

Floating UI DOM's core dependency is a caret range starting at our lowest published core version whose recorded
upstream version satisfies upstream DOM's requirement.

For example, upstream DOM might require core `^1.8.1`, while transformer fixes make our first compatible
core release `1.8.3`. The transformed DOM would then depend on `^1.8.3`.
Publishing a later transformed core fix, such as `1.8.4`, does not raise that minimum.

## How do I preview and review a release?

Use Node.js 24, npm, and an authenticated GitHub CLI:

```sh
npm ci
npx playwright install chromium firefox webkit
npm run check
npm run release:dry-run
```

`npm run check` runs the full repository validation.

Uncommitted changes produce previews instead of actual releases.
You can review the `notes.md`, `release.json`, and the tarball in the printed `output/release-.../` directory.
New packages are generated in its `packages/` subdirectory for both previews and actual releases.

## What if a run fails?

A failed release run disables the workflow, preventing new scheduled and push runs.
This is meant to prevent the further scheduled attempts from running until someone manually reviews
and runs the workflow to re-enable it. When a workflow runs, it will attempt to retry a failed
workflow unless new changes appeared since then.
