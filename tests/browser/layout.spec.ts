import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { config } from '../../src/config.ts';

// Transformed, scrollable clipping fixture shared by the geometry comparison matrix.
const layout = readFileSync(new URL('../fixtures/layout.html', import.meta.url), 'utf8');

/**
 * Observations retained between browser evaluations in the autoUpdate lifecycle test.
 */
interface UpdateState {
  /**
   * Number of update callbacks completed so far.
   */
  calls: number;

  /**
   * Stops all observers and event listeners installed by autoUpdate.
   */
  cleanup(): void;

  /**
   * Whether any callback returned a Promise or non-finite coordinate.
   */
  bad: boolean;
}

/**
 * Test-only window extension used to read and clean up the browser's autoUpdate state.
 */
type UpdateWindow = typeof window & {
  /**
   * Shared state created by this test's first browser evaluation.
   */
  updates: UpdateState;
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

for (const extension of ['mjs', 'esm.js', 'browser.mjs', 'browser.min.mjs']) {
  test('matches upstream DOM geometry: ' + extension, async ({ page }) => {
    const failures = await page.evaluate(
      async ({ extension, layout }) => {
        const synchronousPath = '/synchronous/dom.' + extension;
        const corePath = '/synchronous/core.' + extension;
        const upstreamPath = '/upstream/dom.mjs';

        const synchronous = await import(synchronousPath);
        const core = await import(corePath);
        const upstream = await import(upstreamPath);

        document.body.innerHTML = layout;

        const viewport = document.querySelector('.viewport') as HTMLElement;
        const anchor = document.querySelector('.anchor') as HTMLElement;
        const floating = document.querySelector('.floating') as HTMLElement;
        const arrow = document.querySelector('.arrow') as HTMLElement;

        viewport.scrollLeft = 40;
        viewport.scrollTop = 30;

        const failures: string[] = [];

        const directCore = core.computePosition(
          {},
          {},
          {
            platform: {
              // Supplies fixed geometry to check the core distribution independently of DOM.
              getElementRects() {
                return {
                  reference: { x: 10, y: 20, width: 30, height: 10 },
                  floating: { x: 0, y: 0, width: 20, height: 5 },
                };
              },
            },
            middleware: [core.offset(3)],
          },
        );

        if (directCore.then || directCore.x !== 15 || directCore.y !== 33) {
          failures.push('Core distribution returned an invalid result');
        }

        for (const direction of ['ltr', 'rtl']) {
          for (const strategy of ['absolute', 'fixed']) {
            viewport.style.direction = direction;
            floating.style.position = strategy;

            for (const placement of ['top-start', 'right-end', 'bottom-start', 'left-end']) {
              for (const chain of ['flip', 'autoPlacement', 'size', 'inline', 'hide', 'custom']) {
                const virtual = {
                  // Real clipping context for the virtual inline reference.
                  contextElement: anchor,

                  getBoundingClientRect: () => anchor.getBoundingClientRect(),

                  // Models two inline line fragments within the reference box.
                  getClientRects: () => {
                    const rect = anchor.getBoundingClientRect();

                    return [
                      new DOMRect(rect.x, rect.y, rect.width / 2, rect.height / 2),
                      new DOMRect(rect.x, rect.y + rect.height / 2, rect.width, rect.height / 2),
                    ];
                  },
                };

                const reference = chain === 'inline' ? virtual : anchor;

                // Resets mutable DOM dimensions before calculating with either engine.
                const run = (engine: typeof synchronous) => {
                  floating.style.width = '120px';
                  floating.style.height = '80px';

                  const log: string[] = [];

                  const middleware = {
                    flip: [
                      engine.offset(7),
                      engine.flip(),
                      engine.shift({ padding: 5, limiter: engine.limitShift() }),
                      engine.arrow({ element: arrow, padding: 2 }),
                    ],

                    autoPlacement: [engine.autoPlacement({ alignment: 'start' }), engine.shift()],

                    size: [
                      engine.size({
                        // Resizes the floating element to exercise size middleware resets.
                        apply({
                          availableWidth,
                          availableHeight,
                        }: {
                          /** Horizontal space reported by the engine under test. */
                          availableWidth: number;

                          /** Vertical space reported by the engine under test. */
                          availableHeight: number;
                        }) {
                          log.push('apply');

                          floating.style.width = Math.max(20, Math.min(93, availableWidth)) + 'px';
                          floating.style.height =
                            Math.max(20, Math.min(57, availableHeight)) + 'px';
                        },
                      }),
                      engine.shift(),
                    ],

                    inline: [engine.inline(), engine.offset(3), engine.flip()],

                    hide: [engine.hide(), engine.hide({ strategy: 'escaped' })],

                    custom: [
                      {
                        name: 'custom',

                        // Changes placement once, then adjusts x after the middleware restart.
                        fn(state: {
                          /** Current calculated horizontal coordinate. */
                          x: number;

                          /** Per-middleware state retained across resets. */
                          middlewareData: Record<
                            string,
                            {
                              /** Marks completion of the custom middleware's single reset. */
                              done?: boolean;
                            }
                          >;
                        }) {
                          return state.middlewareData.custom?.done
                            ? { x: state.x + 1 }
                            : {
                                data: { done: true },
                                reset: { placement: 'right-start', rects: true },
                              };
                        },
                      },
                    ],
                  }[chain];

                  const platform = {
                    ...engine.platform,

                    getDimensions(element: Element) {
                      log.push('dimensions');
                      return engine.platform.getDimensions(element);
                    },

                    getOffsetParent(element: Element) {
                      log.push('parent');
                      return engine.platform.getOffsetParent(element);
                    },
                  };

                  return {
                    // Direct transformed result or upstream Promise, compared after upstream settles.
                    result: engine.computePosition(reference, floating, {
                      strategy,
                      placement,
                      middleware,
                      platform,
                    }),

                    // Ordered measurements and size callbacks for the same positioning operation.
                    log,
                  };
                };

                const original = run(upstream);
                const expected = await original.result;

                const transformed = run(synchronous);
                const actual = transformed.result;

                const label = [direction, strategy, placement, chain].join('/');

                if (actual?.then || !Number.isFinite(actual?.x) || !Number.isFinite(actual?.y))
                  failures.push(label + ': not a direct result');

                if (JSON.stringify(actual) !== JSON.stringify(expected))
                  failures.push(label + ': geometry differs');

                if (JSON.stringify(original.log) !== JSON.stringify(transformed.log))
                  failures.push(label + ': callback order differs');
              }
            }
          }
        }

        return failures;
      },
      { extension, layout },
    );

    expect(failures).toEqual([]);
  });
}

test('DOM measurement, size.apply, and custom middleware complete in the calling stack', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const path = '/synchronous/dom.mjs';
    const engine = await import(path);

    // Remove indentation between tags so formatting does not add DOM text nodes.
    document.body.innerHTML = `
      <div id="reference" style="width:60px;height:20px"></div>
      <div id="floating" style="position:absolute;width:80px;height:40px"></div>
    `
      .trim()
      .replace(/>\s+</g, '><');

    const reference = document.getElementById('reference')!;
    const floating = document.getElementById('floating')!;

    let microtask = false;
    queueMicrotask(() => {
      microtask = true;
    });

    const rects = engine.platform.getElementRects({ reference, floating, strategy: 'absolute' });

    let applied = false;
    let middlewareRan = false;

    const result = engine.computePosition(reference, floating, {
      middleware: [
        engine.size({
          apply() {
            applied = true;
          },
        }),
        {
          name: 'custom',

          fn(state: unknown) {
            middlewareRan = true;

            const overflow = engine.detectOverflow(state);

            if (overflow.then || typeof overflow.top !== 'number')
              throw new Error('Asynchronous overflow');

            return {};
          },
        },
      ],
    });

    return {
      rectsDirect: !rects.then && rects.reference.width === 60,
      direct: !result.then && Number.isFinite(result.x),
      applied,
      middlewareRan,
      microtask,
    };
  });

  expect(result).toEqual({
    rectsDirect: true,
    direct: true,
    applied: true,
    middlewareRan: true,
    microtask: false,
  });
});

test('autoUpdate calculates synchronously on initial call and later resize/scroll events, then cleans up', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const path = '/synchronous/dom.mjs';
    const engine = await import(path);

    document.body.innerHTML = `
      <div id="scroll" style="position:relative;overflow:auto;width:300px;height:200px">
        <div style="width:600px;height:500px">
          <div id="reference" style="width:60px;height:20px"></div>
          <div id="floating" style="position:absolute;width:80px;height:40px"></div>
        </div>
      </div>
    `
      .trim()
      .replace(/>\s+</g, '><');

    const reference = document.getElementById('reference')!;
    const floating = document.getElementById('floating')!;

    const state: UpdateState = {
      calls: 0,

      cleanup() {},

      bad: false,
    };

    (window as UpdateWindow).updates = state;

    state.cleanup = engine.autoUpdate(reference, floating, () => {
      const result = engine.computePosition(reference, floating);

      state.bad ||= Boolean(result.then) || !Number.isFinite(result.x);
      state.calls++;
    });

    if (state.calls !== 1 || state.bad)
      throw new Error('Initial update did not finish synchronously');
  });

  const calls = () => page.evaluate(() => (window as UpdateWindow).updates.calls);

  // Let initial observer notifications settle before measuring a new event.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  const beforeResize = await calls();
  await page.evaluate(() => {
    document.getElementById('reference')!.style.width = '90px';
  });
  await expect.poll(calls).toBeGreaterThan(beforeResize);

  const beforeScroll = await calls();
  await page.evaluate(() => {
    document.getElementById('scroll')!.scrollTop = 25;
  });
  await expect.poll(calls).toBeGreaterThan(beforeScroll);

  const stopped = await page.evaluate(() => {
    const state = (window as UpdateWindow).updates;
    state.cleanup();

    document.getElementById('reference')!.style.width = '100px';
    document.getElementById('scroll')!.scrollTop = 50;

    return { calls: state.calls, bad: state.bad };
  });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  expect(await calls()).toBe(stopped.calls);
  expect(stopped.bad).toBe(false);
});

for (const extension of ['umd.js', 'umd.min.js']) {
  test('supports script-tag globals alongside upstream: ' + extension, async ({ page }) => {
    for (const variant of ['upstream', 'synchronous'])
      for (const key of ['core', 'dom']) {
        await page.addScriptTag({ url: '/' + variant + '/' + key + '.' + extension });
      }

    const result = await page.evaluate(
      async (globals) => {
        const modules = window as unknown as Record<string, any>;
        const core = modules[globals.core];
        const dom = modules[globals.dom];
        const upstream = modules.FloatingUIDOM;

        document.body.innerHTML = `
          <div id="reference" style="width:40px;height:20px"></div>
          <div id="floating" style="position:absolute;width:30px;height:10px"></div>
        `
          .trim()
          .replace(/>\s+</g, '><');

        const reference = document.getElementById('reference')!;
        const floating = document.getElementById('floating')!;

        const actual = dom.computePosition(reference, floating, { middleware: [dom.offset(4)] });
        const original = upstream.computePosition(reference, floating, {
          middleware: [upstream.offset(4)],
        });

        return {
          actual,
          expected: await original,
          upstreamAsync: Boolean(original.then),
          synchronous: !actual.then,
          sameCore: core.offset === dom.offset,
          sameExports:
            JSON.stringify(Object.keys(dom).sort()) ===
            JSON.stringify(Object.keys(upstream).sort()),
        };
      },
      { core: config.core.global, dom: config.dom.global },
    );

    expect(result.actual).toEqual(result.expected);
    expect(result).toMatchObject({
      upstreamAsync: true,
      synchronous: true,
      sameCore: true,
      sameExports: true,
    });
  });
}
