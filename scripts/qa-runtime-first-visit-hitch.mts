// /runtime first-visit GPU warm-up regression — before/after evidence.
//
// Diagnoses (and proves the fix for) the owner's report: "/runtime gets
// smoother the more you explore; stutters appear mainly the first time you
// enter/explore a given section." Drives the real level-30 `/runtime` build
// with a real Chromium page (Playwright), instrumented at the WebGL level
// (compileShader/linkProgram/texImage2D/texSubImage2D/bufferData counts +
// timestamps), plus an independent rAF gap tracker and a longtask observer —
// the exact checklist the owner asked for. Two runs per section:
//   - "?ablate=warmup": reverts to the exact pre-fix behaviour (see
//     `src/client/WorldKit/ablation.ts`) — first-render-triggered
//     shader/texture cost.
//   - default (fix ON): proactive `renderer.initTexture`/`compileAsync`
//     warm-up (`src/client/WorldKit/gpuWarmup.ts`).
// Movement is closed-loop (steers toward a real layout-space target using
// the same camera-relative-input math `PlayerController.cameraRelativeMovement`
// uses) toward three real destinations: the farm (cow station), the dairy
// retail department, and checkout lane 0.
//
// Usage: `pnpm exec tsx scripts/qa-runtime-first-visit-hitch.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-runtime-warmup-qa";
await fs.mkdir(outputRoot, { recursive: true });

// Layout-space targets (same space as `window.__MARKET_QA__.player.x/z`,
// i.e. `scaleStorePosition()`'s output, the same function `PLAYER_START`
// and `makeStoreElement()` both use — every raw layout constant below is
// multiplied by `STORE_LAYOUT_SCALE` (2), copied verbatim from the real
// layout modules so this script can never drift from the real game).
const STORE_LAYOUT_SCALE = 2;
const RAW = {
  farm: [5.9, 0, -16.65] as const, // FARM_ANIMAL_STATIONS.cow.position (farm-layout.ts)
  dairy: [-10.34, 0, 0.45 + 3 * (46 / (12 * 3 * 2))] as const, // RETAIL_DEPARTMENTS.dairy.display (retail-layout.ts)
  checkout: [7.55, 0, 3.95] as const, // CHECKOUT_LANES[0].counter (checkout-layout.ts)
};
const TARGETS = {
  farm: { x: RAW.farm[0] * STORE_LAYOUT_SCALE, z: RAW.farm[2] * STORE_LAYOUT_SCALE, label: "granja (vaca)" },
  dairy: { x: RAW.dairy[0] * STORE_LAYOUT_SCALE, z: RAW.dairy[2] * STORE_LAYOUT_SCALE, label: "lácteos" },
  checkout: { x: RAW.checkout[0] * STORE_LAYOUT_SCALE, z: RAW.checkout[2] * STORE_LAYOUT_SCALE, label: "caja 0" },
} as const;

// The farm sits behind a single narrow rear door — straight-line steering
// alone walks the player into the wall beside it. These are the real
// corridor/threshold waypoints (`STORE_REAR_DOOR.interiorCorridor` +
// `insideApproach`/`outsideApproach`, `storefront-layout.ts`) the game's own
// navmesh-less fallback path already uses, scaled the same way as `TARGETS`.
const FARM_ROUTE_RAW: readonly [number, number][] = [
  [3.1, 0.45], [3.1, -4.6], [6.8, -6.35], [7.5, -6.9], [7.5, -9.35],
];
const FARM_ROUTE = FARM_ROUTE_RAW.map(([x, z]) => ({ x: x * STORE_LAYOUT_SCALE, z: z * STORE_LAYOUT_SCALE }));

const FORWARD = { x: -16 / 30.316, y: -25.75 / 30.316 };
const RIGHT = { x: -FORWARD.y, y: FORWARD.x };

interface GlEvent { m: string; t: number }
interface FrameSample { t: number; gap: number }
interface LongTask { start: number; dur: number }

async function installInstrumentation(page: Page) {
  // A raw source STRING, not a function reference. `tsx`/esbuild's "keep
  // names" transform injects `__name(fn, "fn")` calls around named
  // functions/consts, referencing a module-scope helper that only exists in
  // the bundled Node output — invisible (and `ReferenceError: __name is not
  // defined`) once Playwright grabs only `fn.toString()` to serialize a
  // function value into the page. Confirmed by direct repro before writing
  // this comment: a function-reference `addInitScript` silently threw that
  // exact error on every navigation and NEVER installed the hooks (0 events
  // for the entire session) — a plain string sidesteps the round-trip
  // entirely, since Playwright evaluates it as-is with no transform.
  await page.addInitScript(`
    (function () {
      window.__GPU_QA__ = { events: [] };
      window.__FRAME_QA__ = [];
      window.__LT_QA__ = [];
      function patch(proto, name) {
        var original = proto[name];
        if (typeof original !== "function") return;
        proto[name] = function () {
          window.__GPU_QA__.events.push({ m: name, t: performance.now() });
          return original.apply(this, arguments);
        };
      }
      var methods = ["compileShader", "linkProgram", "texImage2D", "texImage3D", "texSubImage2D", "bufferData", "bufferSubData"];
      [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function (ctor) {
        if (!ctor) return;
        methods.forEach(function (m) { patch(ctor.prototype, m); });
      });
      try {
        new PerformanceObserver(function (list) {
          list.getEntries().forEach(function (entry) {
            window.__LT_QA__.push({ start: entry.startTime, dur: entry.duration });
          });
        }).observe({ entryTypes: ["longtask"] });
      } catch (e) { /* Safari-class browsers: unsupported, matches production's own null handling */ }
      var last = performance.now();
      function raf(now) {
        window.__FRAME_QA__.push({ t: now, gap: now - last });
        last = now;
        requestAnimationFrame(raf);
      }
      requestAnimationFrame(raf);
    })();
  `);
}

interface QaWindowState {
  ready: boolean;
  x: number | null;
  z: number | null;
  breakdownKeys: string[];
}

async function readState(page: Page): Promise<QaWindowState> {
  return page.evaluate(() => {
    const w = window as unknown as { __MARKET_QA__?: { player?: { x: number; z: number }; drawBreakdown?: Record<string, unknown>; render?: unknown } };
    const qa = w.__MARKET_QA__;
    return {
      ready: Boolean(qa?.render),
      x: qa?.player?.x ?? null,
      z: qa?.player?.z ?? null,
      breakdownKeys: qa?.drawBreakdown ? Object.keys(qa.drawBreakdown) : [],
    };
  });
}

async function setInput(page: Page, x: number, y: number) {
  await page.evaluate(([ix, iy]) => {
    const w = window as unknown as { __MARKET_SET_PLAYER_INPUT__?: (x: number, y: number) => void };
    w.__MARKET_SET_PLAYER_INPUT__?.(ix, iy);
  }, [x, y]);
}

async function drainQa(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __GPU_QA__: { events: GlEventJson[] }; __FRAME_QA__: FrameJson[]; __LT_QA__: LtJson[] };
    type GlEventJson = { m: string; t: number };
    type FrameJson = { t: number; gap: number };
    type LtJson = { start: number; dur: number };
    return { gl: w.__GPU_QA__.events, frames: w.__FRAME_QA__, longtasks: w.__LT_QA__ };
  });
}

async function drainWarmup(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __WARMUP_QA__?: { initTextureCalls: number[]; compileAsyncCalls: number[]; missing?: boolean } };
    return w.__WARMUP_QA__ ?? { initTextureCalls: [], compileAsyncCalls: [], missing: true };
  });
}

function countInRange(timestamps: number[], fromMs: number, toMs: number) {
  return timestamps.filter((t) => t >= fromMs && t <= toMs).length;
}

/** Steers toward `target` for up to `maxMs`, sampling every 150ms, using
 * closed-loop control (inverting `PlayerController.cameraRelativeMovement`'s
 * basis so the same `x,y` axes the real input pipeline consumes point
 * straight at the target regardless of camera orientation). "Arrival" is a
 * real position match (`ARRIVAL_RADIUS` layout units of the target's real
 * layout coordinates) — the moment the section is close enough to be in the
 * camera frustum, not a guess. */
const ARRIVAL_RADIUS = 3.2;

async function steerToward(page: Page, target: { x: number; z: number }, maxMs: number, arrivalRadius = ARRIVAL_RADIUS): Promise<{ arrivedAt: number | null; finalDist: number | null }> {
  const start = Date.now();
  let arrivedAt: number | null = null;
  let finalDist: number | null = null;
  let lastProgressCheckAt = Date.now();
  let lastProgressDist = Infinity;
  // Straight-line steering stalls against walls/fixtures (no navmesh client
  // for this plain-three build to route around them — the same limitation
  // `qa-pc-harvest-restock.mts` documents for the PlayCanvas port). Escalate
  // the steering angle away from "straight at the target" while stalled,
  // alternating sides and growing the offset, then decay it back toward 0
  // once progress resumes — a cheap wall-following heuristic, not
  // pathfinding, but enough to get around store furniture.
  let offsetAngle = 0;
  let offsetSign = 1;
  while (Date.now() - start < maxMs) {
    const state = await readState(page);
    if (state.x !== null && state.z !== null) {
      const dx = target.x - state.x;
      const dz = target.z - state.z;
      const dist = Math.hypot(dx, dz);
      finalDist = dist;
      if (dist < arrivalRadius) {
        arrivedAt = await page.evaluate(() => performance.now());
        break;
      }
      const ux = dx / dist;
      const uz = dz / dist;
      const now = Date.now();
      if (now - lastProgressCheckAt > 900) {
        const madeProgress = lastProgressDist - dist > 0.25;
        if (madeProgress) {
          offsetAngle = Math.max(0, offsetAngle - Math.PI / 6);
        } else {
          offsetSign = offsetAngle > 0 ? offsetSign : -offsetSign;
          offsetAngle = Math.min(Math.PI * 0.95, offsetAngle + Math.PI / 5);
        }
        lastProgressDist = dist;
        lastProgressCheckAt = now;
      }
      const angle = offsetAngle * offsetSign;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const dirX = ux * cos - uz * sin;
      const dirZ = ux * sin + uz * cos;
      const inputX = dirX * RIGHT.x + dirZ * RIGHT.y;
      const inputY = -(dirX * FORWARD.x + dirZ * FORWARD.y);
      await setInput(page, inputX, inputY);
    }
    await page.waitForTimeout(150);
  }
  await setInput(page, 0, 0);
  // Let the frame that just entered the frustum actually render (and, in the
  // unfixed build, pay its first-render shader/texture cost) before sampling.
  await page.waitForTimeout(400);
  const arrivedForSampling = await page.evaluate(() => performance.now());
  return { arrivedAt: arrivedAt !== null ? arrivedForSampling : null, finalDist };
}

/** Wiggles the player near its current position for `durationMs` — a cheap
 * "same content, still in view, nothing new should ever need to
 * compile/upload again" revisit probe. */
async function wiggleInPlace(page: Page, durationMs = 3000) {
  const end = Date.now() + durationMs;
  let sign = 1;
  while (Date.now() < end) {
    await setInput(page, sign, 0);
    sign = -sign;
    await page.waitForTimeout(400);
  }
  await setInput(page, 0, 0);
}

function summarizeRange(events: GlEvent[], frames: FrameSample[], longtasks: LongTask[], fromMs: number, toMs: number) {
  const glInWindow = events.filter((e) => e.t >= fromMs && e.t <= toMs);
  const frameInWindow = frames.filter((f) => f.t >= fromMs && f.t <= toMs);
  const maxGap = frameInWindow.reduce((max, f) => Math.max(max, f.gap), 0);
  const ltInWindow = longtasks.filter((lt) => lt.start >= fromMs && lt.start <= toMs);
  const byMethod: Record<string, number> = {};
  for (const e of glInWindow) byMethod[e.m] = (byMethod[e.m] ?? 0) + 1;
  return {
    durationMs: Math.round(toMs - fromMs),
    glCallCount: glInWindow.length,
    glByMethod: byMethod,
    maxFrameGapMs: Math.round(maxGap * 10) / 10,
    longtaskCount: ltInWindow.length,
    longtaskMaxMs: Math.round(ltInWindow.reduce((m, lt) => Math.max(m, lt.dur), 0) * 10) / 10,
  };
}

async function runOneSession(browser: Awaited<ReturnType<typeof chromium.launch>>, ablateWarmup: boolean) {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } }); // iPhone-class viewport
  await installInstrumentation(page);
  const url = `${appUrl}/runtime?debug=1${ablateWarmup ? "&ablate=warmup" : ""}`;
  const navStart = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Direct, unambiguous instrumentation of the fix itself: instance-patch
  // the REAL renderer the INSTANT it exists (`__MARKET_QA_RENDERER__`, now
  // exposed at `ClientRuntime` constructor time specifically so this QA can
  // see it — see the doc comment added at that call site) so every
  // `initTexture`/`compileAsync` call `gpuWarmup.ts` makes is directly
  // counted and timestamped, including the curtain-time warm-up dispatched
  // from `finishReady()` BEFORE `onReady()`/`__MARKET_QA__.render` exist —
  // instead of inferring it from raw WebGL call volume, which is dominated
  // by unrelated per-frame noise (troika text SDF updates, instance buffer
  // updates for the crowd/props). A plain string, not a function reference,
  // for the same `__name` reason as `installInstrumentation` above.
  await page.waitForFunction(() => Boolean((window as unknown as { __MARKET_QA_RENDERER__?: unknown }).__MARKET_QA_RENDERER__), { timeout: 30000 });
  await page.evaluate(`
    (function () {
      window.__WARMUP_QA__ = { initTextureCalls: [], compileAsyncCalls: [] };
      var r = window.__MARKET_QA_RENDERER__;
      if (!r) { window.__WARMUP_QA__.missing = true; return; }
      var origInit = r.initTexture.bind(r);
      r.initTexture = function (t) {
        window.__WARMUP_QA__.initTextureCalls.push(performance.now());
        return origInit(t);
      };
      var origCompileAsync = r.compileAsync.bind(r);
      r.compileAsync = function () {
        window.__WARMUP_QA__.compileAsyncCalls.push(performance.now());
        return origCompileAsync.apply(r, arguments);
      };
    })();
  `);

  // Wait for the first playable frame (`ClientRuntime.publishDebug()`'s
  // `__MARKET_QA__.render` only exists once `finishReady()`/`onReady()` ran).
  await page.waitForFunction(() => Boolean((window as unknown as { __MARKET_QA__?: { render?: unknown } }).__MARKET_QA__?.render), { timeout: 60000 });
  const readyAtWall = Date.now() - navStart;
  const base = await page.evaluate(() => (window as unknown as { __MARKET_QA__?: { render?: unknown } }).__MARKET_QA__?.render);

  const diag = await page.evaluate(() => (window as unknown as { __GPU_QA__: { events: unknown[] } }).__GPU_QA__.events.length);
  console.log(`[qa]   diag: __GPU_QA__.events.length at ready = ${diag}`);

  const warmupAtReady = await drainWarmup(page);
  console.log(`[qa]   diag: warmup calls by ready = initTexture=${warmupAtReady.initTextureCalls.length} compileAsync=${warmupAtReady.compileAsyncCalls.length}`);

  const spawnState = await readState(page);
  const results: Record<string, unknown> = { ablateWarmup, readyAtWallMs: readyAtWall, startupMetrics: base, spawnVisibleKeys: spawnState.breakdownKeys };

  // Order matters: dairy and checkout are both reachable in a fairly
  // straight line from `PLAYER_START`. The farm sits behind the one narrow
  // rear-door corridor (`FARM_ROUTE`) — visited LAST, since backtracking
  // through that same corridor to reach dairy afterward is a much harder
  // path for simple closed-loop steering than starting fresh from spawn.
  const sections: { name: string; target: { x: number; z: number }; maxMs: number; waypoints?: { x: number; z: number }[] }[] = [
    { name: "dairy", target: TARGETS.dairy, maxMs: 45000 },
    { name: "checkout", target: TARGETS.checkout, maxMs: 30000 },
    { name: "farm", target: TARGETS.farm, maxMs: 45000, waypoints: FARM_ROUTE },
  ];

  for (const section of sections) {
    console.log(`[qa]   -> steering toward ${section.name} (first visit)`);
    const startedAt = await page.evaluate(() => performance.now());
    for (const waypoint of section.waypoints ?? []) await steerToward(page, waypoint, 15000, 1.6);
    const { arrivedAt, finalDist } = await steerToward(page, section.target, section.maxMs);
    console.log(`[qa]   ${section.name}: arrived=${arrivedAt !== null} finalDist=${finalDist?.toFixed(2) ?? "-"}`);
    if (arrivedAt === null) {
      results[section.name] = { arrived: false, finalDist, note: "never got within ARRIVAL_RADIUS within the time budget" };
      continue;
    }
    const firstVisitDump = await drainQa(page);
    const firstVisit = summarizeRange(firstVisitDump.gl as GlEvent[], firstVisitDump.frames as FrameSample[], firstVisitDump.longtasks as LongTask[], startedAt, arrivedAt);
    const warmupAtArrival = await drainWarmup(page);
    const firstVisitWarmup = { initTexture: countInRange(warmupAtArrival.initTextureCalls, startedAt, arrivedAt), compileAsync: countInRange(warmupAtArrival.compileAsyncCalls, startedAt, arrivedAt) };
    // Revisit probe: same section, same content, still in view — the
    // decisive "did the cost repeat" comparison the owner asked for.
    const revisitStart = await page.evaluate(() => performance.now());
    await wiggleInPlace(page, 3000);
    const revisitEnd = await page.evaluate(() => performance.now());
    const revisitDump = await drainQa(page);
    const revisit = summarizeRange(revisitDump.gl as GlEvent[], revisitDump.frames as FrameSample[], revisitDump.longtasks as LongTask[], revisitStart, revisitEnd);
    const warmupAtRevisit = await drainWarmup(page);
    const revisitWarmup = { initTexture: countInRange(warmupAtRevisit.initTextureCalls, revisitStart, revisitEnd), compileAsync: countInRange(warmupAtRevisit.compileAsyncCalls, revisitStart, revisitEnd) };
    console.log(`[qa]   ${section.name}: firstVisit gl=${firstVisit.glCallCount} maxGap=${firstVisit.maxFrameGapMs}ms warmup(init=${firstVisitWarmup.initTexture},compile=${firstVisitWarmup.compileAsync}) | revisit gl=${revisit.glCallCount} maxGap=${revisit.maxFrameGapMs}ms warmup(init=${revisitWarmup.initTexture},compile=${revisitWarmup.compileAsync})`);
    results[section.name] = { arrived: true, firstVisit: { ...firstVisit, warmupCalls: firstVisitWarmup }, revisit: { ...revisit, warmupCalls: revisitWarmup } };
  }

  const totalWarmup = await drainWarmup(page);
  results.totalWarmupCalls = { initTexture: totalWarmup.initTextureCalls.length, compileAsync: totalWarmup.compileAsyncCalls.length, missing: totalWarmup.missing ?? false };
  console.log(`[qa]   session total warmup calls: initTexture=${totalWarmup.initTextureCalls.length} compileAsync=${totalWarmup.compileAsyncCalls.length}`);

  await page.close();
  return results;
}

const browser = await chromium.launch();
try {
  console.log(`[qa] target: ${appUrl}/runtime — cold (warm-up OFF, ?ablate=warmup) run first`);
  const cold = await runOneSession(browser, true);
  console.log(`[qa] warm-up (fix ON) run`);
  const warm = await runOneSession(browser, false);
  const report = { url: appUrl, at: new Date().toISOString(), coldAblateWarmup: cold, fixed: warm };
  const outFile = path.join(outputRoot, "report.json");
  await fs.writeFile(outFile, JSON.stringify(report, null, 2));
  console.log(`[qa] report written to ${outFile}`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
