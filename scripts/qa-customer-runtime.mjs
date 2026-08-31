import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputRoot = process.argv.slice(2).find((argument) => argument !== "--" && !argument.startsWith("--")) ?? "/tmp/market-customer-runtime-qa";
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
await page.getByLabel("Tu nombre").fill("Customer Motion QA");
await page.getByLabel("Nombre de usuario").fill(`customer_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`customer.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Customer-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.getByText("Objetivos del día").waitFor({ timeout: 30_000 });
await page.waitForFunction(() => Object.values(window.__MARKET_QA__?.customerVisuals ?? {}).some((customer) => customer.basketVisible), null, { timeout: 30_000 });

const samples = await page.evaluate(() => new Promise((resolve) => {
  const result = [];
  const startedAt = performance.now();
  const sample = (now) => {
    const visuals = window.__MARKET_QA__?.customerVisuals ?? {};
    for (const [id, customer] of Object.entries(visuals)) result.push({ id, t: now, ...structuredClone(customer) });
    if (now - startedAt >= 6_000) resolve(result);
    else requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}));

const movementStart = await page.evaluate(() => ({
  revision: window.__MARKET_QA__?.state?.revision ?? 0,
  simulationTimeMs: window.__MARKET_QA__?.state?.simulationTimeMs ?? 0,
  player: structuredClone(window.__MARKET_QA__?.player ?? null),
}));
const movingAlongsideSamples = await page.evaluate(() => new Promise((resolve) => {
  const result = [];
  const startedAt = performance.now();
  let direction = "ArrowLeft";
  window.dispatchEvent(new KeyboardEvent("keydown", { code: direction, key: direction }));
  const sample = (now) => {
    const elapsed = now - startedAt;
    if (elapsed >= 3_000 && direction === "ArrowLeft") {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: direction, key: direction }));
      direction = "ArrowRight";
      window.dispatchEvent(new KeyboardEvent("keydown", { code: direction, key: direction }));
    }
    const visuals = window.__MARKET_QA__?.customerVisuals ?? {};
    for (const [id, customer] of Object.entries(visuals)) result.push({ id, t: now, ...structuredClone(customer) });
    if (elapsed >= 6_000) {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: direction, key: direction }));
      resolve(result);
    } else requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}));
const movementEnd = await page.evaluate(() => ({
  revision: window.__MARKET_QA__?.state?.revision ?? 0,
  simulationTimeMs: window.__MARKET_QA__?.state?.simulationTimeMs ?? 0,
  player: structuredClone(window.__MARKET_QA__?.player ?? null),
}));

await page.screenshot({ path: path.join(outputRoot, "customers-live.png"), fullPage: true });
const byCustomer = Map.groupBy(samples, (sample) => sample.id);
const travelRatios = []; const headFrameDegrees = []; const basketDistances = [];
const movementByState = {}; let maxHeadFrame = null;
for (const customerSamples of byCustomer.values()) {
  let previous = customerSamples[0];
  for (let index = 1; index < customerSamples.length; index += 1) {
    const current = customerSamples[index];
    if (current.visualFrame === previous.visualFrame) continue;
    const elapsed = Math.max(0.001, (current.t - previous.t) / 1_000);
    const expected = current.speed * 2 * elapsed;
    const travelled = Math.hypot(current.x - previous.x, current.z - previous.z);
    if (expected > 0.001 && ["ENTER_STORE", "NAVIGATE_TO_PRODUCT", "NAVIGATE_TO_QUEUE", "MOVE_QUEUE", "EXIT_STORE"].includes(current.state)) {
      const ratio = travelled / expected;
      travelRatios.push(ratio);
      (movementByState[current.state] ??= []).push(ratio);
    }
    if (previous.headQuaternion && current.headQuaternion) {
      const dot = Math.min(1, Math.abs(current.headQuaternion.reduce((sum, value, component) => sum + value * previous.headQuaternion[component], 0)));
      const degrees = 2 * Math.acos(dot) * 180 / Math.PI;
      headFrameDegrees.push(degrees);
      if (!maxHeadFrame || degrees > maxHeadFrame.degrees) maxHeadFrame = { id: current.id, degrees, elapsedMs: current.t - previous.t, from: previous.animation, to: current.animation, state: current.state };
    }
    if (current.basketVisible && current.basketHandDistance !== null) basketDistances.push(current.basketHandDistance);
    previous = current;
  }
}

const sortedRatios = travelRatios.toSorted((a, b) => a - b);
const sortedHead = headFrameDegrees.toSorted((a, b) => a - b);
const movingAlongsideRatios = customerTravelRatios(movingAlongsideSamples);
const sortedMovingAlongsideRatios = movingAlongsideRatios.toSorted((a, b) => a - b);
const report = {
  generatedAt: new Date().toISOString(),
  customersObserved: byCustomer.size,
  movingFrames: travelRatios.length,
  pauseRatio: travelRatios.filter((ratio) => ratio < 0.2).length / Math.max(1, travelRatios.length),
  p10TravelRatio: percentile(sortedRatios, 0.1),
  medianTravelRatio: percentile(sortedRatios, 0.5),
  p95TravelRatio: percentile(sortedRatios, 0.95),
  movementByState: Object.fromEntries(Object.entries(movementByState).map(([state, ratios]) => [state, { frames: ratios.length, pauseRatio: ratios.filter((ratio) => ratio < 0.2).length / ratios.length, median: percentile(ratios.toSorted((a, b) => a - b), 0.5) }])),
  maxHeadFrameDegrees: sortedHead.at(-1) ?? 0,
  p95HeadFrameDegrees: percentile(sortedHead, 0.95),
  maxHeadFrame,
  basketSamples: basketDistances.length,
  basketHandDistance: basketDistances.length ? { min: Math.min(...basketDistances), max: Math.max(...basketDistances) } : null,
  movingAlongside: {
    frames: movingAlongsideRatios.length,
    pauseRatio: movingAlongsideRatios.filter((ratio) => ratio < 0.2).length / Math.max(1, movingAlongsideRatios.length),
    p10TravelRatio: percentile(sortedMovingAlongsideRatios, 0.1),
    medianTravelRatio: percentile(sortedMovingAlongsideRatios, 0.5),
    revisionDelta: movementEnd.revision - movementStart.revision,
    simulationTimeDelta: movementEnd.simulationTimeMs - movementStart.simulationTimeMs,
    excessRevisions: movementEnd.revision - movementStart.revision - Math.round((movementEnd.simulationTimeMs - movementStart.simulationTimeMs) / 100),
    maxSnapshotRefreshes: maximumSnapshotRefreshes(movingAlongsideSamples),
    playerStart: movementStart.player,
    playerEnd: movementEnd.player,
  },
  consoleErrors, pageErrors, failedResponses,
};
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (report.customersObserved < 2 || report.movingFrames < 120) throw new Error(`No se observaron suficientes clientes en movimiento: ${JSON.stringify(report)}`);
if (report.pauseRatio > 0.08) throw new Error(`Los clientes aún presentan pausas entre snapshots: ${JSON.stringify(report)}`);
if (report.movingAlongside.frames < 120 || report.movingAlongside.revisionDelta < 3) throw new Error(`La prueba no ejercitó suficiente movimiento simultáneo del vendedor y los clientes: ${JSON.stringify(report.movingAlongside)}`);
if (report.movingAlongside.excessRevisions > 3) throw new Error(`El movimiento del vendedor todavía crea actualizaciones globales fuera del tick mundial: ${JSON.stringify(report.movingAlongside)}`);
if (report.movingAlongside.maxSnapshotRefreshes > 66) throw new Error(`Los snapshots de clientes todavía se reinician fuera del reloj autoritativo: ${JSON.stringify(report.movingAlongside)}`);
if (report.movingAlongside.pauseRatio > report.pauseRatio + 0.03 || report.movingAlongside.p10TravelRatio < Math.max(0.5, report.p10TravelRatio * 0.7)) throw new Error(`Caminar junto a los clientes todavía degrada su movimiento: ${JSON.stringify({ stationary: { pauseRatio: report.pauseRatio, p10TravelRatio: report.p10TravelRatio }, moving: report.movingAlongside })}`);
if (report.maxHeadFrameDegrees > 5) throw new Error(`La cabeza da un salto no anatómico: ${JSON.stringify(report)}`);
if (!report.basketHandDistance || report.basketHandDistance.max > 1.2) throw new Error(`La canasta no permanece unida a la mano: ${JSON.stringify(report)}`);
if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores de navegador o red: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);

function percentile(sorted, quantile) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

function customerTravelRatios(samplesToMeasure) {
  const ratios = [];
  for (const customerSamples of Map.groupBy(samplesToMeasure, (sample) => sample.id).values()) {
    let previous = customerSamples[0];
    for (let index = 1; index < customerSamples.length; index += 1) {
      const current = customerSamples[index];
      if (current.visualFrame === previous.visualFrame) continue;
      const elapsed = Math.max(0.001, (current.t - previous.t) / 1_000);
      const expected = current.speed * 2 * elapsed;
      const travelled = Math.hypot(current.x - previous.x, current.z - previous.z);
      if (expected > 0.001 && ["ENTER_STORE", "NAVIGATE_TO_PRODUCT", "NAVIGATE_TO_QUEUE", "MOVE_QUEUE", "EXIT_STORE"].includes(current.state)) ratios.push(travelled / expected);
      previous = current;
    }
  }
  return ratios;
}

function maximumSnapshotRefreshes(samplesToMeasure) {
  let maximum = 0;
  for (const customerSamples of Map.groupBy(samplesToMeasure, (sample) => sample.id).values()) {
    let refreshes = 0;
    let capturedAtMs;
    for (const sample of customerSamples) {
      if (sample.snapshotCapturedAtMs === capturedAtMs) continue;
      capturedAtMs = sample.snapshotCapturedAtMs;
      refreshes += 1;
    }
    maximum = Math.max(maximum, refreshes);
  }
  return maximum;
}
