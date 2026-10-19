/*
 * Runtime positioning checks used by ../packages.test.ts. The test supplies core and dom
 * through ESM imports or CommonJS require, then executes this code in an isolated consumer.
 * Its upstream-coexistence check also reuses the platform and b variables defined here.
 */

// Minimal synchronous platform whose expected bottom placement is known independently.
const platform = {
  isRTL() {
    return false;
  },

  getElementRects() {
    return {
      reference: { x: 10, y: 20, width: 30, height: 10 },
      floating: { x: 0, y: 0, width: 20, height: 5 },
    };
  },
};

// @ts-expect-error Bare positioning uses only these two platform methods.
const a = core.computePosition({}, {}, { platform });
// @ts-expect-error The fixed platform deliberately bypasses real DOM elements.
const b = dom.computePosition({}, {}, { platform });

if ('then' in a || 'then' in b || a.x !== 15 || b.y !== 30) {
  throw new Error('Invalid synchronous result');
}

if (core.offset !== dom.offset) {
  throw new Error('DOM uses a different core');
}

console.log('ok');
