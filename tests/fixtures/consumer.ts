/*
 * Type assertions used by ../types.test.ts. The test substitutes package names, copies this
 * file into an isolated consumer, and compiles it; this file is never executed.
 * ./tsconfig.json resolves imports for local editing only, not for the installed-package tests.
 */
import * as core from '@test/synchronous-core';
import * as dom from '@test/synchronous-dom';

/**
 * Compares conditional-type behavior instead of mutual assignability, which `any` can satisfy.
 * This lets the fixture detect widened return types as well as retained Promise unions.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Checks at compile time whether {@link value} is assignable to T.
 */
declare function expectAssignable<T>(value: T): void;

/**
 * Requires T to satisfy the true constraint at compile time.
 */
declare function expectTrue<T extends true>(): void;

// Exact core return and callback-argument contracts that transformation must preserve.
expectTrue<Equal<ReturnType<typeof core.computePosition>, core.ComputePositionReturn>>();
expectTrue<Equal<ReturnType<typeof core.detectOverflow>, core.SideObject>>();
expectTrue<Equal<ReturnType<core.Middleware['fn']>, core.MiddlewareReturn>>();
expectTrue<Equal<ReturnType<NonNullable<core.SizeOptions['apply']>>, void>>();
expectTrue<
  Equal<Parameters<NonNullable<core.SizeOptions['apply']>>[0]['availableWidth'], number>
>();
expectTrue<Equal<ReturnType<core.Platform['getElementRects']>, core.ElementRects>>();
expectTrue<Equal<ReturnType<core.Platform['getClippingRect']>, core.Rect>>();
expectTrue<Equal<ReturnType<core.Platform['getDimensions']>, core.Dimensions>>();
expectTrue<Equal<ReturnType<NonNullable<core.Platform['isRTL']>>, boolean>>();
expectTrue<Equal<ReturnType<NonNullable<core.Platform['getScale']>>, { x: number; y: number }>>();

// Exact DOM contracts, including concrete element types and the re-exported core API.
expectTrue<Equal<ReturnType<typeof dom.computePosition>, dom.ComputePositionReturn>>();
expectTrue<Equal<ReturnType<typeof dom.detectOverflow>, dom.SideObject>>();
expectTrue<Equal<ReturnType<dom.Middleware['fn']>, dom.MiddlewareReturn>>();
expectTrue<Equal<ReturnType<NonNullable<dom.SizeOptions['apply']>>, void>>();
expectTrue<
  Equal<Parameters<NonNullable<dom.SizeOptions['apply']>>[0]['availableHeight'], number>
>();
expectTrue<Equal<ReturnType<dom.Platform['getElementRects']>, dom.ElementRects>>();
expectTrue<Equal<ReturnType<dom.Platform['getDimensions']>, dom.Dimensions>>();
expectTrue<Equal<ReturnType<dom.Platform['getOffsetParent']>, Element | Window>>();
expectTrue<Equal<ReturnType<dom.Platform['getDocumentElement']>, HTMLElement>>();
expectTrue<Equal<ReturnType<dom.Platform['isRTL']>, boolean>>();

declare const platform: core.Platform;
declare const coreState: core.MiddlewareState;
declare const domState: dom.MiddlewareState;
declare const reference: HTMLElement;
declare const floating: HTMLElement;

// Keep these inferred so we can detect an incorrect return type
const result = core.computePosition({}, {}, { platform });
const domResult = dom.computePosition(reference, floating);
expectAssignable<number>(result.x + domResult.x);

// @ts-expect-error The positioning result is not a Promise.
result.then(() => {});

// @ts-expect-error DOM also returns a direct value.
domResult.then(() => {});

// @ts-expect-error Coordinate results retain their number types.
expectAssignable<string>(result.x);

const overflow: core.SideObject = core.detectOverflow(coreState);
const domOverflow: dom.SideObject = dom.detectOverflow(domState);

expectAssignable<core.Middleware>({
  name: 'custom',

  fn(state) {
    return { x: state.x + overflow.left };
  },
});

const domMiddleware: dom.Middleware = {
  name: 'custom',

  fn(state) {
    return { y: state.y + domOverflow.top };
  },
};

expectAssignable<core.MiddlewareReturn>(core.offset(2).fn(coreState));
expectAssignable<dom.MiddlewareReturn>(dom.flip().fn(domState));

// @ts-expect-error Asynchronous middleware is outside the synchronous contract.
expectAssignable<core.Middleware>({ name: 'async', fn: async () => ({ x: 1 }) });

// @ts-expect-error Asynchronous DOM middleware is also unsupported.
expectAssignable<dom.Middleware>({ name: 'async', fn: async () => ({ x: 1 }) });

const rect = { x: 0, y: 0, width: 1, height: 1 };

// @ts-expect-error A Promise is not an ElementRects result.
expectAssignable<core.Platform['getElementRects']>(async () => ({
  reference: rect,
  floating: rect,
}));

// @ts-expect-error A Promise is not a dimension result.
expectAssignable<dom.Platform['getDimensions']>(async () => ({ width: 1, height: 1 }));

// @ts-expect-error A Promise is not a clipping rectangle.
expectAssignable<core.Platform['getClippingRect']>(async () => rect);

// @ts-expect-error isRTL returns a boolean synchronously.
expectAssignable<dom.Platform['isRTL']>(async () => false);

const sides = { top: 0, right: 0, bottom: 0, left: 0 };

// @ts-expect-error detectOverflow returns an overflow object synchronously.
expectAssignable<NonNullable<core.Platform['detectOverflow']>>(async () => sides);

core.size({
  apply({ availableWidth }) {
    expectAssignable<number>(availableWidth);
  },
});

dom.size({
  apply({ elements }) {
    elements.floating.style.width = '20px';
  },
});

// TypeScript permits async functions in void positions. Keep that convention.
core.size({ apply: async () => {} });
dom.size({ apply: async () => {} });

// Upstream core uses "any" for platform element identities; retain portability.
expectAssignable<core.Platform['getOffsetParent']>(async () => ({}));

const update: () => void = () => {
  dom.computePosition(reference, floating);
};

expectAssignable<() => void>(dom.autoUpdate(reference, floating, update));
expectAssignable<core.Middleware>(dom.offset(2));
expectAssignable<dom.ComputePositionConfig['middleware']>([false, null, undefined, domMiddleware]);
