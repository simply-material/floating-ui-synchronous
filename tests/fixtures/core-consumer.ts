/* Standalone core assertions compiled against installed packages; never executed. */
import * as core from '@test/synchronous-core';

/**
 * Detects widened any returns and retained Promise unions through conditional-type equality.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Requires the inferred contract to be exactly true at compile time.
 */
declare function expectTrue<T extends true>(): void;

/**
 * Checks assignability without introducing unused fixture variables.
 */
declare function expectAssignable<T>(value: T): void;

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

declare const platform: core.Platform;
declare const state: core.MiddlewareState;
const result = core.computePosition({}, {}, { platform });
expectAssignable<number>(result.x);

// @ts-expect-error Direct results are not Promises.
result.then(() => {});

// @ts-expect-error Coordinates retain their numeric type.
expectAssignable<string>(result.x);

expectAssignable<core.SideObject>(core.detectOverflow(state));
expectAssignable<core.MiddlewareReturn>(core.offset(2).fn(state));
expectAssignable<core.Middleware>({ name: 'custom', fn: (value) => ({ x: value.x }) });

// @ts-expect-error Middleware cannot return a Promise.
expectAssignable<core.Middleware>({ name: 'async', fn: async () => ({ x: 1 }) });

const rect = { x: 0, y: 0, width: 1, height: 1 };

// @ts-expect-error Measurements must return rectangles directly.
expectAssignable<core.Platform['getElementRects']>(async () => ({
  reference: rect,
  floating: rect,
}));

// @ts-expect-error Dimensions must be synchronous.
expectAssignable<core.Platform['getDimensions']>(async () => ({ width: 1, height: 1 }));

// @ts-expect-error Clipping rectangles must be synchronous.
expectAssignable<core.Platform['getClippingRect']>(async () => rect);

// @ts-expect-error Direction must be synchronous.
expectAssignable<NonNullable<core.Platform['isRTL']>>(async () => false);

// @ts-expect-error Custom overflow results must be synchronous.
expectAssignable<NonNullable<core.Platform['detectOverflow']>>(async () => ({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}));

core.size({
  apply({ availableWidth }) {
    expectAssignable<number>(availableWidth);
  },
});
// Preserve TypeScript's ordinary void-callback convention and upstream's any element identities.
core.size({ apply: async () => {} });
expectAssignable<core.Platform['getOffsetParent']>(async () => ({}));
