import type * as core from '@floating-ui/core';
import { rectToClientRect } from '@floating-ui/utils';

/**
 * Reference geometry covering ordinary, clipped, narrow, offscreen, and zero-sized elements.
 */
export const rectangles: core.Rect[] = [
  { x: 130, y: 80, width: 40, height: 20 },
  { x: -5, y: 5, width: 40, height: 20 },
  { x: 270, y: 175, width: 40, height: 20 },
  { x: 10, y: 80, width: 1, height: 12 },
  { x: 150, y: -30, width: 20, height: 15 },
  { x: 90, y: 60, width: 0, height: 0 },
];

/**
 * All four sides with centered, start, and end alignment for the parity matrix.
 */
export const placements = ['top', 'right', 'bottom', 'left'].flatMap((side) => [
  side,
  side + '-start',
  side + '-end',
]) as core.Placement[];

/**
 * Middleware scenarios spanning built-ins, measurement resets, and custom callbacks.
 */
export const chains = [
  'bare',
  'offset',
  'flipShiftArrow',
  'autoPlacement',
  'inline',
  'sizeReset',
  'customReset',
  'hide',
] as const;

/**
 * Name of one middleware scenario supplied by the deterministic platform fixture.
 */
type Chain = (typeof chains)[number];

/**
 * Creates independent platform state for comparing upstream and transformed core behavior.
 * Measurements are synchronous in both cases; the engine determines execution timing.
 *
 * @param engine - Upstream or installed transformed core, using the shared fixture vocabulary.
 * @param referenceRect - Anchor geometry within a fixed 300 by 200 clipping rectangle.
 * @param rtl - Whether the platform reports right-to-left layout.
 * @param chain - Middleware scenario, including callbacks that can trigger a remeasurement.
 * @returns Positioning inputs and a call log for comparing measurement and callback order.
 */
export function fixture(engine: typeof core, referenceRect: core.Rect, rtl: boolean, chain: Chain) {
  const log: unknown[] = [];
  const reference = { rect: referenceRect };
  const floating = { clientWidth: 100, clientHeight: 60 };
  const arrow = {};
  const parent = { clientWidth: 100, clientHeight: 60 };
  let dimensions = { width: 100, height: 60 };

  const platform: core.Platform = {
    getElementRects({ reference: ref }) {
      log.push('rects');
      const rect = 'getBoundingClientRect' in ref ? ref.getBoundingClientRect() : referenceRect;
      return { reference: { ...rect }, floating: { x: 0, y: 0, ...dimensions } };
    },

    getDimensions(element) {
      log.push('dimensions');
      return element === arrow ? { width: 8, height: 8 } : { ...dimensions };
    },

    getClippingRect() {
      log.push('clipping');
      return { x: 0, y: 0, width: 300, height: 200 };
    },

    getOffsetParent() {
      log.push('parent');
      return parent;
    },

    getDocumentElement() {
      return parent;
    },

    // Treats synthetic identities as elements so element-dependent calculations run.
    isElement() {
      return true;
    },

    getScale() {
      return { x: 1, y: 1 };
    },

    isRTL() {
      return rtl;
    },

    // Preserves coordinates because the fixture has no offset-parent translation or scale.
    convertOffsetParentRelativeRectToViewportRelativeRect({ rect }) {
      return rect;
    },

    // Splits the reference into two line fragments for inline middleware.
    getClientRects() {
      return [
        rectToClientRect({
          ...referenceRect,
          width: referenceRect.width / 2,
          height: referenceRect.height / 2,
        }),
        rectToClientRect({
          ...referenceRect,
          y: referenceRect.y + referenceRect.height / 2,
          height: referenceRect.height / 2,
        }),
      ];
    },

    detectOverflow(state, options) {
      log.push('overflow');
      return engine.detectOverflow(state, options);
    },
  };

  const middleware: Record<Chain, core.ComputePositionConfig['middleware']> = {
    bare: [],
    offset: [
      false,
      engine.offset((state) => ({
        mainAxis: 7,
        crossAxis: 3,
        alignmentAxis: state.rects.reference.width / 4,
      })),
    ],
    flipShiftArrow: [
      engine.offset(5),
      engine.flip({ fallbackAxisSideDirection: 'start' }),
      engine.shift({ limiter: engine.limitShift() }),
      engine.arrow({ element: arrow, padding: 3 }),
    ],
    autoPlacement: [
      engine.offset(4),
      engine.autoPlacement({ alignment: 'start', crossAxis: true }),
      engine.shift({ crossAxis: true }),
    ],
    inline: [engine.inline(), engine.offset(2), engine.flip()],
    sizeReset: [
      engine.size({
        // Changes floating dimensions so size middleware must request fresh measurements.
        apply() {
          log.push('apply');
          dimensions = { width: 70, height: 40 };
        },
      }),
      engine.shift(),
    ],
    customReset: [
      {
        name: 'custom',

        // Requests one placement/rect reset, then changes x on the restarted middleware pass.
        fn(state) {
          return state.middlewareData.custom?.done
            ? { x: state.x + 2 }
            : { data: { done: true }, reset: { placement: 'left-start', rects: true } };
        },
      },
    ],
    hide: [engine.hide(), engine.hide({ strategy: 'escaped' })],
  };
  return {
    /**
     * Synthetic reference identity passed to computePosition.
     */
    reference,

    /**
     * Synthetic floating element exposing the client dimensions needed by middleware.
     */
    floating,

    /**
     * Measurement and geometry operations bound to this fixture's mutable state.
     */
    platform,

    /**
     * Selected middleware chain, created from the engine being compared.
     */
    middleware: middleware[chain],

    /**
     * Ordered observations used to detect changed callback or measurement sequencing.
     */
    log,
  };
}
