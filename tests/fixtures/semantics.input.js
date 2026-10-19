/*
 * Implementation transformation input used by ../transform.test.ts. Original and transformed
 * code run in separate VM contexts; the test compares results and recorded events.
 * The harness supplies events, measure, and fail to exercise await removal across receiver
 * binding, precedence, branching, loops, and exceptions.
 */
'use strict';

// Fixture receiver whose method detects lost or newly introduced `this` bindings.
const platform = {
  // Receiver-specific value read by the method under test.
  value: 3,

  /**
   * Records its receiver and adds the argument; a detached strict-mode call must throw.
   * @param {number} increment
   */
  async measure(increment) {
    events.push('platform:' + this.value);
    return this.value + increment;
  },
};

async function subject() {
  const first = (await platform.measure(2)) * 2;
  const detached = platform.measure;

  try {
    await detached(0);
  } catch {
    events.push('unbound');
  }

  const nested = await measure(await measure(1));
  let total = 0;

  for (const value of [1, 2]) {
    total += await measure(value);
  }

  const conditional = await (false ? measure(100) : void 0);
  const missing = undefined;
  // @ts-expect-error Deliberately absent callable: optional chaining must skip fail().
  const optional = (await missing?.(fail())) ?? 7;
  let chainBoundary;

  try {
    // @ts-expect-error Deliberate dereference: removing parentheses would wrongly extend the optional chain.
    chainBoundary = (await missing?.()).value;
  } catch {
    chainBoundary = 'threw';
  }

  try {
    await fail();
  } catch (error) {
    // The harness's fail() throws an Error, but catch variables are typed as unknown.
    events.push(/** @type {Error} */ (error).message);
  } finally {
    events.push('finally');
  }

  return { first, nested, total, conditional, optional, chainBoundary };
}

subject();
