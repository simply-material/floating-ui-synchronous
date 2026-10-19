/*
 * Global types for measurement.js and semantics.input.js, included by ./tsconfig.json.
 * These declarations support editing only; the test harnesses below supply the actual values.
 */

// ../packages.test.ts prepends imports or require calls before measurement.js.
declare const core: typeof import('@test/synchronous-core');
declare const dom: typeof import('@test/synchronous-dom');

// ../transform.test.ts supplies a fresh VM context for each execution of semantics.input.js.
declare const events: string[];
declare function measure(value: number): number;
declare function fail(): never;
