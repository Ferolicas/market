// The owner's acceptance test, automated: three minutes on the seeded
// level-30 store in the mobile profile with customers spawning, panels
// opening, saves firing and the owner walking the aisles. Reports frame
// times per phase, draw calls, triangles, initial download and time to the
// first playable frame against the budget.
//   MARKET_QA_PATH=/play2 MARKET_QA_SEED_STATE=/tmp/market-perf/level30.json node scripts/qa-acceptance-session.mjs /tmp/market-perf/accept
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const out = process.argv[2] ?? "/tmp/market-acceptance";
await fs.mkdir(out, { recursive: true });
const url = process.env.MARKET_QA_URL ?? "http://localhost:3000";
const route = process.env.MARKET_QA_PATH ?? "/play2";
const seedPath = process.env.MARKET_QA_SEED_STATE ?? "/tmp/market-perf/level30.json";
const durationMs = Number(process.env.MARKET_QA_DURATION_MS ?? 180_000);
const cpuRate = Number(process.env.MARKET_QA_CPU_RATE ?? 4);
const budget = { readyMs: 5_000, downloadBytes: 15 * 1024 * 1024, drawCalls: 100, triangles: 150_000, p95FrameMs: 16.8, slowFramesPerMinute: 5 };
const seed = JSON.parse(await fs.readFile(seedPath, "utf8"));
const key = "mini-market-recovery-campaign-30-20260915";

const browser = await chromium.launch({ headless: true, executablePath: "/home/ferney_oliveros/.local/bin/google-chrome", args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push(`PAGE ${e.message.slice(0, 300)}`));
let failedSaves = 0;
page.on("response", async (response) => {
  if (response.status() < 400 || !response.url().includes("/api/")) return;
  errors.push(`${response.status()} ${response.url().split("/api/")[1]} ${(await response.text().catch(() => "")).slice(0, 200)}`);
  // Keep the refused save bodies for offline analysis against the server copy.
  const body = response.request().postData();
  if (body && response.url().includes("/api/game/save")) { failedSaves += 1; await fs.writeFile(path.join(out, `failed-save-${failedSaves}.json`), body).catch(() => {}); }
});
await page.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ state: { ...state, revision: state.revision + 10_000 }, saveRevision: 1, pendingEvents: [] })); }, { key, state: seed });
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
let downloadBytes = 0; let downloadCounting = true;
cdp.on("Network.loadingFinished", (event) => { if (downloadCounting) downloadBytes += event.encodedDataLength ?? 0; });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });

const suffix = Date.now().toString(36);

await page.goto(`${url}${route}?perf=1&debug=1${process.env.MARKET_QA_QUERY ?? ""}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Accept QA");
await page.getByLabel("Nombre de usuario").fill(`accept_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`accept.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Accept-${suffix}-Safe!`);
const playStart = Date.now();
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.locator(".world.scene-ready").waitFor({ timeout: 120_000 });
const readyMs = Date.now() - playStart;
downloadCounting = false;
try { await page.getByRole("button", { name: "Abrir el supermercado" }).click({ timeout: 15_000 }); } catch {}
// The seeded save only exists on this device: adopt it on the server so the
// later saves are ordinary revisions instead of a level 1 → 30 rejection.
await page.evaluate(() => window.__MARKET_QA_ACTIONS__?.adoptLocalCopy?.());
await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "saved", null, { timeout: 30_000 }).catch(() => {});

// In-page sampler: frame times, long tasks, renderer stats, markers.
await page.evaluate(() => {
  const s = { frames: [], phases: [], longTasks: [], render: [], customers: [], phase: "walk", t0: performance.now() };
  window.__ACCEPT__ = s;
  let last = performance.now();
  const frame = (now) => { s.frames.push([now - s.t0, now - last, s.phase]); last = now; requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) s.longTasks.push([e.startTime - s.t0, e.duration, s.phase]); }).observe({ entryTypes: ["longtask"] }); } catch {}
  setInterval(() => {
    const r = window.__MARKET_QA__?.render; if (r) s.render.push([performance.now() - s.t0, r.calls, r.triangles]);
    const c = window.__MARKET_QA__?.state?.franchises?.[0]?.customers?.length ?? Object.keys(window.__MARKET_QA__?.customerVisuals ?? {}).length; s.customers.push([performance.now() - s.t0, c]);
  }, 1000);
});
const setPhase = (phase) => page.evaluate((p) => { window.__ACCEPT__.phase = p; window.__ACCEPT__.phases.push([performance.now() - window.__ACCEPT__.t0, p]); }, phase);

// Steering (layout units) around the store: aisles, produce, checkouts, farm door.
const forward = normalize([-16, -25.75]); const right = [-forward[1], forward[0]];
function normalize([x, y]) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
async function moveTo(target, tolerance = 1.2, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const player = await page.evaluate(() => window.__MARKET_QA__?.player ?? null);
    if (!player) break;
    const dx = target[0] - player.x, dz = target[1] - player.z;
    if (Math.hypot(dx, dz) <= tolerance) break;
    const d = normalize([dx, dz]);
    await page.evaluate(({ x, y }) => window.__MARKET_SET_PLAYER_INPUT__?.(x, y), { x: d[0] * right[0] + d[1] * right[1], y: -(d[0] * forward[0] + d[1] * forward[1]) });
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
}
const waypoints = [[0, -2], [-8.2, -1.8], [-8, 6], [10.7, 5.7], [12, -3], [3, 3], [0, -6], [-4, -9]];
const start = Date.now();
let leg = 0; let panels = 0; let saves = 0; let nextPanelAt = 25_000; let nextSaveAt = 60_000;
while (Date.now() - start < durationMs) {
  const elapsed = Date.now() - start;
  if (elapsed >= nextSaveAt) {
    nextSaveAt += 70_000; saves += 1;
    await setPhase("save");
    try { await page.getByRole("button", { name: "Guardar ahora" }).click({ timeout: 3_000 }); } catch {}
    await page.waitForTimeout(2_500);
    await setPhase("walk");
    continue;
  }
  if (elapsed >= nextPanelAt) {
    nextPanelAt += 35_000; panels += 1;
    await setPhase("panel");
    const buttons = page.locator("nav button, .hud-nav button, .toolbar button");
    const count = await buttons.count();
    if (count) { await buttons.nth(panels % count).click({ timeout: 2_000 }).catch(() => {}); await page.waitForTimeout(1_800); await page.keyboard.press("Escape").catch(() => {}); await page.getByRole("button", { name: "Cerrar" }).first().click({ timeout: 800 }).catch(() => {}); }
    await page.waitForTimeout(600);
    await setPhase("walk");
    continue;
  }
  await moveTo(waypoints[leg % waypoints.length]);
  leg += 1;
  await page.waitForTimeout(800);
}
await page.screenshot({ path: path.join(out, "end.png") });
const samples = await page.evaluate(() => window.__ACCEPT__);
await browser.close();

const byPhase = {};
for (const [, dt, phase] of samples.frames) { (byPhase[phase] ??= []).push(dt); }
const stats = (values) => { const s = [...values].sort((a, b) => a - b); const p = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0; return { frames: s.length, avgMs: +(s.reduce((n, v) => n + v, 0) / Math.max(1, s.length)).toFixed(2), p95Ms: +p(0.95).toFixed(1), maxMs: +(s.at(-1) ?? 0).toFixed(1), over25: s.filter((v) => v > 25).length }; };
const minutes = samples.frames.length ? (samples.frames.at(-1)[0] - samples.frames[0][0]) / 60_000 : 1;
const all = stats(samples.frames.map((f) => f[1]));
const draws = samples.render.map((r) => r[1]); const tris = samples.render.map((r) => r[2]);
const report = {
  route, readyMs, downloadMB: +(downloadBytes / 1024 / 1024).toFixed(2), minutes: +minutes.toFixed(2),
  overall: all, slowFramesPerMinute: +(all.over25 / Math.max(0.1, minutes)).toFixed(1),
  phases: Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, stats(v)])),
  longTasks: samples.longTasks.length, maxLongTaskMs: Math.max(0, ...samples.longTasks.map((t) => t[1])),
  drawCalls: draws.length ? { median: draws.sort((a, b) => a - b)[Math.floor(draws.length / 2)], max: Math.max(...draws) } : null,
  triangles: tris.length ? { median: tris.sort((a, b) => a - b)[Math.floor(tris.length / 2)], max: Math.max(...tris) } : null,
  customers: samples.customers.length ? { min: Math.min(...samples.customers.map((c) => c[1])), max: Math.max(...samples.customers.map((c) => c[1])) } : null,
  panels, saves, errors: errors.slice(0, 10),
  budget,
  verdict: {
    ready: readyMs <= budget.readyMs, download: downloadBytes <= budget.downloadBytes,
    drawCalls: draws.length ? Math.max(...draws) <= budget.drawCalls : null, triangles: tris.length ? Math.max(...tris) <= budget.triangles : null,
    p95: all.p95Ms <= budget.p95FrameMs, slowFrames: all.over25 / Math.max(0.1, minutes) <= budget.slowFramesPerMinute,
  },
};
await fs.writeFile(path.join(out, "report.json"), JSON.stringify({ ...report, samples }, null, 2));
console.log(JSON.stringify(report, null, 2));
