/*
 * DOM and core interoperability assertions used by ../types.test.ts. The test substitutes
 * package names and compiles this alongside core-consumer.ts in an isolated consumer;
 * neither file is executed.
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

declare const domState: dom.MiddlewareState;
declare const reference: HTMLElement;
declare const floating: HTMLElement;

// Keep this inferred so we can detect an incorrect return type.
const domResult = dom.computePosition(reference, floating);
expectAssignable<number>(domResult.x);

// @ts-expect-error The positioning result is not a Promise.
domResult.then(() => {});

const domOverflow: dom.SideObject = dom.detectOverflow(domState);

const domMiddleware: dom.Middleware = {
  name: 'custom',

  fn(state) {
    return { y: state.y + domOverflow.top };
  },
};

expectAssignable<dom.MiddlewareReturn>(dom.flip().fn(domState));

// @ts-expect-error Asynchronous middleware is outside the synchronous contract.
expectAssignable<dom.Middleware>({ name: 'async', fn: async () => ({ x: 1 }) });

// @ts-expect-error A Promise is not a dimension result.
expectAssignable<dom.Platform['getDimensions']>(async () => ({ width: 1, height: 1 }));

// @ts-expect-error isRTL returns a boolean synchronously.
expectAssignable<dom.Platform['isRTL']>(async () => false);

dom.size({
  apply({ elements }) {
    elements.floating.style.width = '20px';
  },
});

// TypeScript permits async functions in void positions. Keep that convention.
dom.size({ apply: async () => {} });

const update: () => void = () => {
  dom.computePosition(reference, floating);
};

expectAssignable<() => void>(dom.autoUpdate(reference, floating, update));
expectAssignable<core.Middleware>(dom.offset(2));
expectAssignable<dom.ComputePositionConfig['middleware']>([false, null, undefined, domMiddleware]);
