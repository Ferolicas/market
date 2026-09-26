import fs from "node:fs/promises";
import { chromium } from "playwright";

/**
 * Diagnostic for the 2026-09-27 iPhone playtest regression on `/runtime`:
 * employees standing still, customers teleporting/jerky. Samples
 * `window.__MARKET_QA__.customerVisuals`/`employeeVisuals` (published by
 * `CrowdCustomersSystem`/`CrowdEmployeesSystem` under `?debug=1`) every
 * animation frame for several seconds and reports per-actor x/z deltas.
 */
const BASE_URL = process.argv[2] ?? "http://localhost:4300";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => consoleErrors.push(String(error)));

await page.goto(`${BASE_URL}/runtime?debug=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.locator("canvas").first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(3_000);
// The seeded level-30 store starts closed (no customers). Open it so both
// crowds populate.
try {
  await page.locator("button.store-status").click({ timeout: 20_000 });
} catch (error) { console.error("store-status click failed", error); }
// Let the integral level-30 seed load and the crowd bodies come in (deferred
// after the first playable frame per ClientRuntime's worldKit path).
await page.waitForFunction(() => {
  const qa = window.__MARKET_QA__;
  return qa && qa.customerVisuals && Object.keys(qa.customerVisuals).length > 0 && qa.employeeVisuals && Object.keys(qa.employeeVisuals).length > 0;
}, null, { timeout: 60_000 });
// Give it a few seconds of real simulated gameplay before sampling so actors
// are actually mid-walk, not still spawning.
await page.waitForTimeout(6_000);

const samples = await page.evaluate(() => new Promise((resolve) => {
  const rows = [];
  const start = performance.now();
  const tick = (now) => {
    const qa = window.__MARKET_QA__ ?? {};
    const customers = qa.customerVisuals ?? {};
    const employees = qa.employeeVisuals ?? {};
    for (const [id, v] of Object.entries(customers)) rows.push({ kind: "customer", id, t: now, x: v.x, z: v.z, state: v.state, inView: v.inView });
    for (const [id, v] of Object.entries(employees)) rows.push({ kind: "employee", id, t: now, x: v.x, z: v.z, state: v.state });
    if (now - start >= 6_000) resolve(rows);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));

await browser.close();

// Group by actor, compute per-frame deltas.
const byActor = new Map();
for (const row of samples) {
  const key = `${row.kind}:${row.id}`;
  if (!byActor.has(key)) byActor.set(key, []);
  byActor.get(key).push(row);
}

const report = [];
for (const [key, rows] of byActor) {
  rows.sort((a, b) => a.t - b.t);
  const deltas = [];
  for (let i = 1; i < rows.length; i += 1) {
    const dt = rows[i].t - rows[i - 1].t;
    const dist = Math.hypot(rows[i].x - rows[i - 1].x, rows[i].z - rows[i - 1].z);
    if (dt > 0) deltas.push({ dt, dist, speed: dist / (dt / 1000) });
  }
  const totalDisplacement = Math.hypot(rows[rows.length - 1].x - rows[0].x, rows[rows.length - 1].z - rows[0].z);
  const nonZeroDeltas = deltas.filter((d) => d.dist > 0.0001);
  const maxStepDist = deltas.length ? Math.max(...deltas.map((d) => d.dist)) : 0;
  const zeroStepFraction = deltas.length ? 1 - nonZeroDeltas.length / deltas.length : 1;
  report.push({
    actor: key,
    frames: rows.length,
    totalDisplacement: Number(totalDisplacement.toFixed(4)),
    maxStepDist: Number(maxStepDist.toFixed(4)),
    zeroStepFraction: Number(zeroStepFraction.toFixed(2)),
    firstState: rows[0].state,
    lastState: rows[rows.length - 1].state,
  });
}

report.sort((a, b) => a.actor.localeCompare(b.actor));
console.log(JSON.stringify({ consoleErrors, actorCount: byActor.size, report }, null, 2));
await fs.writeFile("/tmp/runtime-crowd-motion-report.json", JSON.stringify({ consoleErrors, report }, null, 2));
