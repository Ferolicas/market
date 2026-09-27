// /runtime max-crowd-density stress test — 2026-09-27 investigation.
//
// Real, reproducible A/B tool for the crowd-fluidity regression reported
// after an iPhone playtest of build 81d32c8/c873704 vs the earlier f1698c5
// candidate. Drives a real Chromium session (real GPU via Vulkan ANGLE, not
// SwiftShader — same convention as `qa-runtime-frame-attribution.mts`),
// opens the seeded level-30 store so both crowds populate, walks the player
// to the checkout queue (the densest on-screen crowd area at level 30 — see
// `qa-runtime-frame-attribution.mts`'s own `TARGETS.checkout`), then stands
// there long enough to read the real work/gap percentile summary the owner's
// own device test reported (`RuntimeView.tsx`'s `RUNTIME_CONTRACT` fields,
// published live to `window.__MARKET_QA__.integralSummary` by
// `IntegralPanel.tsx` — the exact panel used for the real device test).
//
// Usage: `pnpm exec tsx scripts/qa-runtime-crowd-density-stress.mts [outputFile]`
// Env: MARKET_QA_URL (default http://localhost:4301), MARKET_QA_STAND_MS
// (default 60000 — time spent standing inside the crowd after arrival),
// MARKET_QA_LABEL (free-text tag stored in the report).
import fs from "node:fs/promises";
import { chromium, type Page } from "playwright";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4301";
const outFile = process.argv[2] ?? "/tmp/market-runtime-crowd-density-report.json";
const standMs = Number(process.env.MARKET_QA_STAND_MS ?? "90000");
const label = process.env.MARKET_QA_LABEL ?? "unlabeled";

const STORE_LAYOUT_SCALE = 2;
const CHECKOUT_RAW = [7.55, 0, 3.95] as const;
const CHECKOUT = { x: CHECKOUT_RAW[0] * STORE_LAYOUT_SCALE, z: CHECKOUT_RAW[2] * STORE_LAYOUT_SCALE };
const FORWARD = { x: -16 / 30.316, y: -25.75 / 30.316 };
const RIGHT = { x: -FORWARD.y, y: FORWARD.x };
const ARRIVAL_RADIUS = 2.4;

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

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

const viewportWidth = Number(process.env.MARKET_QA_VIEWPORT_W ?? "430");
const viewportHeight = Number(process.env.MARKET_QA_VIEWPORT_H ?? "932");
const cpuThrottleRate = Number(process.env.MARKET_QA_CPU_THROTTLE ?? "4");
const arrivalRadius = Number(process.env.MARKET_QA_ARRIVAL_RADIUS ?? String(ARRIVAL_RADIUS));

try {
  const page = await browser.newPage({ viewport: { width: viewportWidth, height: viewportHeight } });
  const cdp = await page.context().newCDPSession(page);
  if (cpuThrottleRate !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottleRate });
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  console.log(`[qa] label=${label} navigating to ${appUrl}/runtime?debug=1`);
  await page.goto(`${appUrl}/runtime?debug=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("canvas").first().waitFor({ timeout: 60000 });
  try { await page.locator("button.store-status").click({ timeout: 20000 }); } catch { /* already open */ }
  await page.waitForFunction(() => {
    const qa = (window as unknown as { __MARKET_QA__?: { customerVisuals?: Record<string, unknown>; employeeVisuals?: Record<string, unknown> } }).__MARKET_QA__;
    return Boolean(qa?.customerVisuals && Object.keys(qa.customerVisuals).length > 0 && qa?.employeeVisuals && Object.keys(qa.employeeVisuals).length > 0);
  }, null, { timeout: 60000 });
  console.log("[qa] crowd ready — steering to checkout queue");
  await steerToward(page, CHECKOUT, 45000, arrivalRadius);
  console.log(`[qa] arrived (or timed out) — standing ${standMs}ms inside the checkout crowd`);
  await setInput(page, 0, 0);
  await page.waitForTimeout(standMs);

  const report = await page.evaluate(() => {
    const qa = (window as unknown as { __MARKET_QA__?: Record<string, unknown> }).__MARKET_QA__ ?? {};
    return {
      integralSummary: qa.integralSummary ?? null,
      spikes: qa.frameAttributionSpikes ?? [],
      player: qa.player ?? null,
    };
  });
  // The integral summary is cumulative since page load (walk-there phase
  // included). `minutes` holds one snapshot per completed 60s wall-clock
  // bucket — with a 90s stand window after the walk, the LAST completed
  // bucket sits entirely (or almost entirely) inside the steady-state
  // "standing in the densest crowd" phase, unlike the cumulative summary.
  const summary = report.integralSummary as { minutes?: unknown[] } | null;
  const lastMinute = summary?.minutes && summary.minutes.length > 0 ? summary.minutes[summary.minutes.length - 1] : null;
  const out = { label, appUrl, standMs, consoleErrors, ...report, lastMinuteInCrowd: lastMinute };
  await fs.writeFile(outFile, JSON.stringify(out, null, 2));
  console.log(`[qa] report written to ${outFile}`);
  console.log(`[qa] lastMinuteInCrowd: ${JSON.stringify(lastMinute)}`);
  console.log(`[qa] consoleErrors: ${consoleErrors.length}`);
  await page.close();
} finally {
  await browser.close();
}
