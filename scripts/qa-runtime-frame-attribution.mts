// /runtime tail-latency attribution — 2026-09-27 investigation.
//
// The owner's real 15-minute iPhone playtest of build f1698c5 already has
// GOOD averages (work avg 3.2ms/p95 5.1ms/p99 7.0ms, only 10/8399 frames
// over 16.7ms) but a real `maxWorkMs` of 146.2ms and `maxGapMs` of 154ms —
// anomalous tail frames with a real, still-unknown cause. This script drives
// a real, sustained `/runtime` session (real Chromium GPU, not SwiftShader —
// same convention as `qa-runtime-first-visit-hitch.mts`) long enough to
// reproduce comparable anomalies, then reads `FrameAttribution`'s real
// per-subsystem breakdown (`src/runtime/frameAttribution.ts`, wired into
// `ClientRuntime`'s `present()`/`tick()`, `/runtime`'s worldKit path +
// `?debug=1` only) for the worst frames it recorded, plus GLTF-parse and
// async (`setProps`) events that happen OUTSIDE the rAF loop and therefore
// show up as `gapMs`, not `workMs`.
//
// Usage: `pnpm exec tsx scripts/qa-runtime-frame-attribution.mts [outputDir]`
// Env: MARKET_QA_URL (default http://localhost:4300), MARKET_QA_CPU_THROTTLE
// (default 4 — see `qa-runtime-first-visit-hitch.mts`'s own doc comment for
// why a throttled CPU + a real GPU is the one combination that reproduces
// the owner's iPhone-reported severity on desktop hardware),
// MARKET_QA_DURATION_MS (default 360000 = 6 minutes).
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-runtime-attribution-qa";
const durationMs = Number(process.env.MARKET_QA_DURATION_MS ?? "360000");
const cpuThrottle = Number(process.env.MARKET_QA_CPU_THROTTLE ?? "4");
await fs.mkdir(outputRoot, { recursive: true });

// Same layout-space targets as `qa-runtime-first-visit-hitch.mts` (copied
// verbatim so this script can never drift from the real layout modules).
const STORE_LAYOUT_SCALE = 2;
const RAW = {
  farm: [5.9, 0, -16.65] as const,
  dairy: [-10.34, 0, 0.45 + 3 * (46 / (12 * 3 * 2))] as const,
  checkout: [7.55, 0, 3.95] as const,
  produce: [-6.2, 0, -8.4] as const,
};
const TARGETS = {
  farm: { x: RAW.farm[0] * STORE_LAYOUT_SCALE, z: RAW.farm[2] * STORE_LAYOUT_SCALE },
  dairy: { x: RAW.dairy[0] * STORE_LAYOUT_SCALE, z: RAW.dairy[2] * STORE_LAYOUT_SCALE },
  checkout: { x: RAW.checkout[0] * STORE_LAYOUT_SCALE, z: RAW.checkout[2] * STORE_LAYOUT_SCALE },
  produce: { x: RAW.produce[0] * STORE_LAYOUT_SCALE, z: RAW.produce[2] * STORE_LAYOUT_SCALE },
};
const FARM_ROUTE_RAW: readonly [number, number][] = [
  [3.1, 0.45], [3.1, -4.6], [6.8, -6.35], [7.5, -6.9], [7.5, -9.35],
];
const FARM_ROUTE = FARM_ROUTE_RAW.map(([x, z]) => ({ x: x * STORE_LAYOUT_SCALE, z: z * STORE_LAYOUT_SCALE }));

const FORWARD = { x: -16 / 30.316, y: -25.75 / 30.316 };
const RIGHT = { x: -FORWARD.y, y: FORWARD.x };

async function readState(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __MARKET_QA__?: { player?: { x: number; z: number } } };
    return { x: w.__MARKET_QA__?.player?.x ?? null, z: w.__MARKET_QA__?.player?.z ?? null };
  });
}

async function setInput(page: Page, x: number, y: number) {
  await page.evaluate(([ix, iy]) => {
    (window as unknown as { __MARKET_SET_PLAYER_INPUT__?: (x: number, y: number) => void }).__MARKET_SET_PLAYER_INPUT__?.(ix, iy);
  }, [x, y]);
}

const ARRIVAL_RADIUS = 3.2;

/** Same closed-loop steering as `qa-runtime-first-visit-hitch.mts` (wall
 * escalation included), trimmed to what this script needs. */
async function steerToward(page: Page, target: { x: number; z: number }, maxMs: number, arrivalRadius = ARRIVAL_RADIUS) {
  const start = Date.now();
  let offsetAngle = 0;
  let offsetSign = 1;
  let lastProgressCheckAt = Date.now();
  let lastProgressDist = Infinity;
  while (Date.now() - start < maxMs) {
    const state = await readState(page);
    if (state.x !== null && state.z !== null) {
      const dx = target.x - state.x;
      const dz = target.z - state.z;
      const dist = Math.hypot(dx, dz);
      if (dist < arrivalRadius) break;
      const ux = dx / dist;
      const uz = dz / dist;
      const now = Date.now();
      if (now - lastProgressCheckAt > 900) {
        const madeProgress = lastProgressDist - dist > 0.25;
        offsetAngle = madeProgress ? Math.max(0, offsetAngle - Math.PI / 6) : Math.min(Math.PI * 0.95, offsetAngle + Math.PI / 5);
        if (!madeProgress) offsetSign = -offsetSign;
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
}

async function standIdle(page: Page, ms: number) {
  await setInput(page, 0, 0);
  await page.waitForTimeout(ms);
}

interface DrainedAttribution {
  spikes: unknown[];
  gltfParse: unknown[];
  async: unknown[];
  summary: unknown;
}

async function drain(page: Page): Promise<DrainedAttribution> {
  return page.evaluate(() => {
    const w = window as unknown as { __MARKET_QA__?: Record<string, unknown> };
    const qa = w.__MARKET_QA__ ?? {};
    return {
      spikes: (qa.frameAttributionSpikes as unknown[]) ?? [],
      gltfParse: (qa.frameAttributionGltfParse as unknown[]) ?? [],
      async: (qa.frameAttributionAsync as unknown[]) ?? [],
      summary: qa.integralSummary ?? null,
    };
  });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

try {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  if (cpuThrottle !== 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  }
  console.log(`[qa] navigating to ${appUrl}/runtime?debug=1 (cpuThrottle=${cpuThrottle}, durationMs=${durationMs})`);
  await page.goto(`${appUrl}/runtime?debug=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as unknown as { __MARKET_QA__?: { render?: unknown } }).__MARKET_QA__?.render), { timeout: 60000 });
  console.log("[qa] ready — starting sustained wander session");

  const sections = [
    { name: "dairy", target: TARGETS.dairy, maxMs: 40000 },
    { name: "produce", target: TARGETS.produce, maxMs: 30000 },
    { name: "checkout", target: TARGETS.checkout, maxMs: 30000 },
    { name: "farm", target: TARGETS.farm, maxMs: 40000, waypoints: FARM_ROUTE },
  ];

  const sessionStart = Date.now();
  let cycle = 0;
  while (Date.now() - sessionStart < durationMs) {
    cycle += 1;
    for (const section of sections) {
      if (Date.now() - sessionStart >= durationMs) break;
      console.log(`[qa] cycle ${cycle}: steering to ${section.name} (t=${Math.round((Date.now() - sessionStart) / 1000)}s)`);
      for (const waypoint of section.waypoints ?? []) await steerToward(page, waypoint, 15000, 1.6);
      await steerToward(page, section.target, section.maxMs);
      // A real player doesn't sprint continuously — stand and look around
      // (idle-cadence path), matching the owner's real playtest mix.
      await standIdle(page, 2500 + Math.random() * 2500);
    }
  }
  await setInput(page, 0, 0);

  const result = await drain(page);
  const outFile = path.join(outputRoot, "report.json");
  await fs.writeFile(outFile, JSON.stringify(result, null, 2));
  console.log(`[qa] report written to ${outFile}`);
  console.log(`[qa] integralSummary: ${JSON.stringify(result.summary)}`);
  const spikes = (result.spikes as { workMs: number }[]).slice().sort((a, b) => b.workMs - a.workMs);
  console.log(`[qa] recorded ${spikes.length} spikes (workMs >= 20ms), top 15:`);
  for (const spike of spikes.slice(0, 15)) console.log(`[qa]   ${JSON.stringify(spike)}`);
  console.log(`[qa] gltfParse events: ${result.gltfParse.length}, async events: ${result.async.length}`);
  const asyncEvents = (result.async as { durMs: number }[]).slice().sort((a, b) => b.durMs - a.durMs);
  for (const event of asyncEvents.slice(0, 10)) console.log(`[qa]   async: ${JSON.stringify(event)}`);
  const parseEvents = (result.gltfParse as { durMs: number }[]).slice().sort((a, b) => b.durMs - a.durMs);
  for (const event of parseEvents.slice(0, 10)) console.log(`[qa]   gltfParse: ${JSON.stringify(event)}`);
  await page.close();
} finally {
  await browser.close();
}
