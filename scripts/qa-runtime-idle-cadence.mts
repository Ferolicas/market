// /runtime sustained idle-load evidence — before/after the mobile idle
// presentation-cadence fix (2026-09-27).
//
// The owner's report: a real 15-minute iPhone playtest of `/runtime` showed
// good per-frame timing (60fps, work avg 3.2ms, p95 5.1ms, p99 7.0ms) but the
// phone stayed warm for minutes after closing the app — sustained load a
// single frame's timing can't see. Root cause found by code audit:
// `ClientRuntime.tick()` called `present()`+`renderer.render()` on every
// single rAF callback unconditionally, so the mobile render profile's
// `targetFps: 30` idle budget (already shipped and used by `/`'s and
// `/play2`'s React canvas via `MarketScene`'s `CappedFrameScheduler`) never
// actually applied to `/runtime` — a mostly-idle 15-minute session was
// presenting a full GPU frame roughly twice as often as intended for the
// whole span. The fix (`ClientRuntime.shouldPresentNow()`) reimplements the
// same idle/motion cadence gate for this runtime's own manual rAF loop.
//
// This script proves the fix directly and quantitatively: it loads a real
// `/runtime` session on an iPhone-class viewport with a REAL GPU (ANGLE
// Vulkan, not the default SwiftShader software renderer — required for any
// GPU-side timing/heat question in this codebase, see
// `qa-runtime-first-visit-hitch.mts`), lets the player sit completely idle
// (no input) for a fixed window, and reads `renderer.info.render.frame`
// (exposed at `window.__MARKET_QA__.render.frame` in `?debug=1`) before and
// after that window to compute real presented-frames-per-second while idle.
// It runs the session twice: once with `?ablate=cadence` (reverts to the
// pre-fix "every rAF" behaviour) and once without (the shipped fix), so the
// idle render rate is a direct, real A/B measurement of the fix, not a guess
// from reading the code.
//
// Usage: `pnpm exec tsx scripts/qa-runtime-idle-cadence.mts`
import { chromium, type Page } from "playwright";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const idleWindowMs = Number(process.env.MARKET_QA_IDLE_MS ?? "12000");

/**
 * `/runtime` (`IntegralClient.tsx`) never mounts with a `debug` prop, so
 * `window.__MARKET_QA__` doesn't exist there — unlike
 * `qa-runtime-first-visit-hitch.mts`'s own harness page. Counting real
 * `gl.clear()` calls is a lower-level, debug-flag-independent signal of the
 * same thing: `WebGLRenderer.render()` always clears the color/depth buffer
 * exactly once at the start of a real submitted frame (`autoClear: true`,
 * this renderer's default — see `ClientRuntime`'s constructor, which never
 * sets it to false), and a skipped `shouldPresentNow()` tick calls neither
 * `present()` nor `renderer.render()` at all, so it calls `clear()` zero
 * times. A raw source STRING, not a function reference — a function
 * reference makes `tsx`'s bundler-injected `__name()` helper leak into the
 * page and silently no-op the whole init script (see the matching comment in
 * `qa-runtime-first-visit-hitch.mts`).
 */
const CLEAR_COUNTER_INIT_SCRIPT = `
  (function () {
    window.__CLEAR_QA__ = { count: 0 };
    function patch(proto) {
      if (!proto || typeof proto.clear !== "function") return;
      var original = proto.clear;
      proto.clear = function () {
        window.__CLEAR_QA__.count += 1;
        return original.apply(this, arguments);
      };
    }
    patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
    patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
    window.__RAF_QA__ = { count: 0 };
    var originalRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return originalRaf(function (t) { window.__RAF_QA__.count += 1; return cb(t); });
    };
    window.__VIS_QA__ = document.visibilityState;
    document.addEventListener("visibilitychange", function () { window.__VIS_QA__ = document.visibilityState; });
  })();
`;

async function measureIdleRenderRate(browser: Awaited<ReturnType<typeof chromium.launch>>, ablateCadence: boolean) {
  const page: Page = await browser.newPage({ viewport: { width: 430, height: 932 } }); // iPhone-class viewport (width <= 820 -> mobile profile)
  await page.addInitScript(CLEAR_COUNTER_INIT_SCRIPT);
  const url = `${appUrl}/runtime${ablateCadence ? "?ablate=cadence" : ""}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as unknown as { __CLEAR_QA__?: { count: number } }).__CLEAR_QA__?.count && (window as unknown as { __CLEAR_QA__: { count: number } }).__CLEAR_QA__.count > 0, { timeout: 30_000 });
  // Let the scene finish its deferred crowd/asset load and settle before
  // sampling, so warm-up work never counts as "idle" load.
  await page.waitForTimeout(6_000);
  const sample = () => ({
    clear: (window as unknown as { __CLEAR_QA__: { count: number } }).__CLEAR_QA__.count,
    raf: (window as unknown as { __RAF_QA__: { count: number } }).__RAF_QA__.count,
    vis: (window as unknown as { __VIS_QA__: string }).__VIS_QA__,
    t: performance.now(),
  });
  const before = await page.evaluate(sample);
  await page.waitForTimeout(idleWindowMs);
  const after = await page.evaluate(sample);
  await page.close();
  const elapsedS = (after.t - before.t) / 1_000;
  const renders = after.clear - before.clear;
  const rafs = after.raf - before.raf;
  return { renders, rafs, elapsedS, rendersPerSecond: renders / elapsedS, rafsPerSecond: rafs / elapsedS, visibility: after.vis };
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

try {
  console.log(`Idle window: ${idleWindowMs}ms, no player input, iPhone-class viewport, real GPU (ANGLE Vulkan).\n`);
  const before = await measureIdleRenderRate(browser, true);
  console.log(`BEFORE (?ablate=cadence, reverts to pre-fix "every rAF"): ${before.renders} renders / ${before.rafs} rAFs / ${before.elapsedS.toFixed(2)}s = ${before.rendersPerSecond.toFixed(1)} renders/s, ${before.rafsPerSecond.toFixed(1)} rAF/s, visibility=${before.visibility}`);
  const after = await measureIdleRenderRate(browser, false);
  console.log(`AFTER  (shipped fix, targetFps: 30 idle cadence):         ${after.renders} renders / ${after.rafs} rAFs / ${after.elapsedS.toFixed(2)}s = ${after.rendersPerSecond.toFixed(1)} renders/s, ${after.rafsPerSecond.toFixed(1)} rAF/s, visibility=${after.visibility}`);
  const reduction = 1 - after.rendersPerSecond / before.rendersPerSecond;
  console.log(`\nIdle GPU submit-and-present rate reduced by ${(reduction * 100).toFixed(0)}%.`);
} finally {
  await browser.close();
}
