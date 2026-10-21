# Maintainer Guide

_Note: "upstream" refers to the original Floating UI packages / repository._

This project generates separate synchronous core and DOM packages from verified Floating UI npm releases.
The TypeScript compiler's abstract syntax tree (AST) supports structural changes to JavaScript and declarations,
using Rollup and Terser to produce the distributions.

Versions start from `@floating-ui/core@1.8.0`, `@floating-ui/dom@1.8.0`, and `@floating-ui/utils@0.2.12`.
Public packages are emitted separately:

```text
@simply-material/floating-ui-dom-synchronous
├── @simply-material/floating-ui-core-synchronous
│   └── @floating-ui/utils (upstream range)
└── @floating-ui/utils (upstream range)
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
4. Redirect DOM's imports, re-exports, declarations, and dependency to the generated core, using the translated caret range in `transform.config.json`.
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

Each package follows upstream's major/minor, with independently allocated stable patches for source updates
and transformer fixes. DOM's minimum core version follows upstream's requirement through published provenance.

Each package's `provenance.json` records its original upstream inputs, transformer checkout, configuration,
and validation targets. This is used to record how the transformed version was created.
