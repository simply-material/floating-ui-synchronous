# Maintainer Guide

_Note: "upstream" refers to the original Floating UI packages / repository._

This project generates separate synchronous core and DOM packages from verified Floating UI npm releases.
The TypeScript compiler's abstract syntax tree (AST) supports structural changes to JavaScript and declarations,
using Rollup and Terser to produce the distributions.

The initial reviewed inputs are `@floating-ui/core@1.8.0`, `@floating-ui/dom@1.8.0`, and `@floating-ui/utils@0.2.12`.
Only this pairing is currently validated. Package identities are configurable placeholders, and generated packages
are private:

```text
@floating-ui-synchronous-local/dom@1.8.0-synchronous.1
├── @floating-ui-synchronous-local/core@1.8.0-synchronous.1 (exact dependency)
│   └── @floating-ui/utils@^0.2.12
└── @floating-ui/utils@^0.2.12
```

## Build and validate

Use Node.js 24 or newer and npm.

```sh
npm ci
npx playwright install chromium firefox webkit
npm run check
```

On Linux, use `npx playwright install --with-deps chromium firefox webkit` to install browser system dependencies too.

`npm run build` verifies the exact upstream inputs in `upstream.lock.json` and writes `dist/core` and `dist/dom`.
Downloads are cached in `.cache/upstream` and checked against their locked integrity on every build.

`npm run check` checks formatting, typechecks the transformer, builds both packages, and runs all tests. Use
`npm run format` to format repository sources and fixtures, or `npm run format:check` to check formatting without
editing files. Generated distributions are excluded from the source formatter.

Individual suites:

| Command                 | Tool                | Purpose                                                                                                      |
| ----------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm test`              | Vitest              | All unit, package, and compiler tests, including independent fixtures and behavior comparisons with upstream |
| `npm run test:packages` | Vitest + npm + Node | Verify installed distributions, dependencies, metadata, and coexistence with upstream                        |
| `npm run test:types`    | Vitest + TypeScript | Verify installed declarations and synchronous contracts under supported module resolution modes              |
| `npm run test:browser`  | Playwright Test     | Verify layout parity, synchronous execution, and browser distributions in Chromium, Firefox, and WebKit      |

Run `npm run build` before individual consumer suites. They install packed packages outside this repository to
expose packaging defects that development dependencies could conceal. Temporary consumers are retained for inspection;
browser reports and failure traces are in `output/playwright`.

## Transformation

1. Verify and extract the locked published inputs.
2. Compare upstream asynchronous syntax with the checkpoint in `reviewed-inventory.json`.
3. Transform both packages' implementations and declarations to synchronous contracts.
4. Redirect DOM's imports, re-exports, declarations, and dependency to the generated core, pinned to the exact version in `transform.config.json`.
5. Generate and inspect the distributions, preserve the upstream MIT license, and record provenance.

The output uses ordinary synchronous function calls. Only reviewed asynchronous return contracts are transformed;
unexpected asynchronous constructs stop the build for review.

The inventory is a review checkpoint, not a proof of synchrony for arbitrary JavaScript. Behavioral and browser tests
check the reviewed implementation. Do not automatically accept a new inventory just to make an upgrade pass.

## Synchronous contract

`computePosition`, `detectOverflow`, and built-in middleware return their results directly. Platform measurements,
custom middleware, option callbacks, and `size.apply` must execute synchronously. Errors are thrown synchronously.

Declarations use ordinary synchronous return types, including `void` for `size.apply`.

`autoUpdate` retains its observer/event lifecycle. Its initial update and each subsequent positioning calculation execute
synchronously when the supplied update callback calls `computePosition`.

## Distribution compatibility

Each package retains the upstream's entry-point layout and export map:

- `.mjs` and `.esm.js` for npm ESM consumers.
- `.browser.mjs` and `.browser.min.mjs` for browser ESM.
- `.umd.js` and `.umd.min.js` for CommonJS, AMD, and script tags.
- `.d.ts` and `.d.mts` declarations.

Normal ESM keeps utils external. Browser ESM and UMD bundle utils, matching upstream. DOM always uses the separately
generated core: through package imports, AMD dependencies, or the configured UMD global. Browser ESM requires an import
map or equivalent resolution for the synchronous core package.

When using browser script tags, load the core UMD script before the DOM UMD script. These expose
`window.FloatingUISynchronousCore` and `window.FloatingUISynchronousDOM`, respectively. Upstream's globals can
coexist alongside them.

## Versions and provenance

Edit `transform.config.json` to choose package names, UMD globals, and independent core/DOM output versions. Each
version follows its own upstream base, for example `1.8.0-synchronous.1` followed by `1.8.0-synchronous.2` for a transformation fix.

`synchronous` identifies the synchronous variant; it does not mean the package is experiment, even though the version format
is considered a prerelease by npm. Therefore, npm's range rules still apply: `^1.8.0-synchronous.1` can accept `1.8.0-synchronous.2`,
but does not accept `1.8.1-synchronous.1`. Consumers must update their dependency ranges when adopting another upstream base.

Each package's `provenance.json` records its upstream inputs, transformer identity, configuration, and core/DOM
validation pairing. It distinguishes the exact tested utils version from the dependency range consumers resolve.
The pairing identifies what the test suite must validate; a build alone does not attest that tests passed.

A release fingerprint excludes provenance-only changes and the package's allocated version, but includes generated
artifacts and dependency changes. A future release workflow can use this fingerprint to publish a new `-synchronous.N`
revision only when the generated package contents change. Published versions should never be overwritten, even if the
transformer logic is patched / updated.

## Reviewing an upstream update

1. Update versions, tarball URLs, and integrity values in `upstream.lock.json`, together with the matching upstream development dependencies and npm lockfile.
2. Review upstream implementation and declaration changes, the async inventory, and dependency assumptions in `src/build.ts`.
3. Adjust affected transformation rules and tests, update the reviewed inventory deliberately, and select each package's output version in `transform.config.json`.
4. Run `npm run check` to validate both generated packages together.

The GitHub Actions workflow validates changes using the same command. Release discovery, supported-version policy,
revision allocation, publication, and recovery from partial publication still need to be worked on. No publishing
workflow or scheduled task is currently configured.
