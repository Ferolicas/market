import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputRoot = process.argv.slice(2).find((argument) => argument !== "--" && !argument.startsWith("--")) ?? "/tmp/market-worker-runtime-qa";
await fs.mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = []; const pageErrors = []; const failedResponses = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });

const suffix = Date.now().toString(36);
await page.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Worker Motion QA");
await page.getByLabel("Nombre de usuario").fill(`worker_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`worker.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Worker-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.saveRevision), null, { timeout: 30_000 });
await page.evaluate(() => sessionStorage.setItem("mini-market-qa-freeze", "1"));
await page.locator(".player-chip button").click();
await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "saved", null, { timeout: 30_000 });
await page.evaluate(() => {
  const qa = structuredClone(window.__MARKET_QA__);
  const state = qa.state;
  const franchise = state.franchises.find((item) => item.id === state.currentFranchiseId);
  state.level = 20;
  state.revision += 10_000;
  franchise.open = true;
  franchise.employees = [
    ["farmer", "red-panda", 1, -8, 12],
    ["operator", "red-fox", 3, -8, 10],
    ["stocker", "chicken", 5, -8, 8],
    ["cashier", "owl", 2, 4.7, 2.2],
  ].map(([role, hat, level, x, z], index) => ({
    id: `qa-worker-${index + 1}`,
    name: `QA ${role}`,
    role,
    level,
    salaryMinor: 1_000,
    energy: 100,
    hat,
    runtime: {
      state: role === "cashier" ? "IDLE" : "NAVIGATE_PICKUP",
      assignedProduct: role === "cashier" ? null : "tomatoes",
      assignedStationId: role === "cashier" ? null : "stockroom",
      carry: { capacity: 4, item: null },
      x, z, targetX: role === "cashier" ? x : 8, targetZ: z,
      path: role === "cashier" ? [] : [[8, z]],
      pathIndex: 0,
      speed: 0.1,
      currentSpeed: 0,
      stateSince: state.simulationTimeMs,
    },
  }));
  localStorage.setItem("mini-market-recovery-v1", JSON.stringify({ state, saveRevision: qa.saveRevision, pendingEvents: [] }));
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => Object.keys(window.__MARKET_QA__?.employeeVisuals ?? {}).length === 4, null, { timeout: 30_000 });
await page.evaluate(() => sessionStorage.removeItem("mini-market-qa-freeze"));
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => Object.values(window.__MARKET_QA__?.employeeVisuals ?? {}).filter((worker) => worker.state.startsWith("NAVIGATE")).length >= 3, null, { timeout: 30_000 });

const samples = await page.evaluate(() => new Promise((resolve) => {
  const result = [];
  const startedAt = performance.now();
  const sample = (now) => {
    for (const [id, worker] of Object.entries(window.__MARKET_QA__?.employeeVisuals ?? {})) result.push({ id, t: now, ...structuredClone(worker) });
    if (now - startedAt >= 6_000) resolve(result);
    else requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}));

await page.screenshot({ path: path.join(outputRoot, "workers-live.png"), fullPage: true });
const byWorker = Map.groupBy(samples, (sample) => sample.id);
const travelRatios = []; const speedByWorker = {};
for (const [id, workerSamples] of byWorker) {
  let previous = workerSamples[0];
  speedByWorker[id] = { role: previous.role, level: previous.level, configuredSpeed: previous.configuredSpeed };
  for (let index = 1; index < workerSamples.length; index += 1) {
    const current = workerSamples[index];
    speedByWorker[id] = { role: current.role, level: current.level, configuredSpeed: current.configuredSpeed };
    if (current.visualFrame === previous.visualFrame) continue;
    const elapsed = Math.max(0.001, (current.t - previous.t) / 1_000);
    const expected = current.speed * 2 * elapsed;
    const travelled = Math.hypot(current.x - previous.x, current.z - previous.z);
    if (expected > 0.001 && current.state.startsWith("NAVIGATE")) travelRatios.push(travelled / expected);
    previous = current;
  }
}
const sortedRatios = travelRatios.toSorted((a, b) => a - b);
const configuredSpeeds = Object.values(speedByWorker).map((worker) => worker.configuredSpeed);
const report = {
  generatedAt: new Date().toISOString(),
  workersObserved: byWorker.size,
  movingFrames: travelRatios.length,
  pauseRatio: travelRatios.filter((ratio) => ratio < 0.2).length / Math.max(1, travelRatios.length),
  medianTravelRatio: percentile(sortedRatios, 0.5),
  speedByWorker,
  distinctLevelSpeeds: new Set(configuredSpeeds).size,
  consoleErrors, pageErrors, failedResponses,
};
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (process.env.MARKET_QA_ALLOW_FAILURE !== "1") {
  if (report.workersObserved < 4 || report.movingFrames < 120) throw new Error(`No se observaron suficientes trabajadores: ${JSON.stringify(report)}`);
  if (report.pauseRatio > 0.02 || Math.abs(report.medianTravelRatio - 1) > 0.08) throw new Error(`Los trabajadores aún avanzan a pulsos: ${JSON.stringify(report)}`);
  if (report.distinctLevelSpeeds < 3) throw new Error(`Se perdió la velocidad por nivel: ${JSON.stringify(report.speedByWorker)}`);
  if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores de navegador o red: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);
}

function percentile(sorted, quantile) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}
