import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const FRAME_INTERVAL_MS = 200;
const MAX_COMPLETION_LAG_MS = 1_500;
const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:3000";
const output = process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "/tmp/market-transfer-low-fps";
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];
const failedRequests = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? "UNKNOWN" }));

// Throttle the application's animation callbacks before any bundle evaluates.
// All callbacks requested within one native frame remain batched together, as
// with the browser API, but application frames are released only every ~200 ms.
await page.addInitScript((frameIntervalMs) => {
  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  const callbacks = new Map();
  let nextCallbackId = 1;
  let pumpId = null;
  let lastDispatchAt = performance.now();
  const telemetry = {
    requestedIntervalMs: frameIntervalMs,
    dispatchTimes: [],
    stockZonesVisited: [],
    webglContextLosses: 0,
  };
  window.__MARKET_LOW_FPS__ = telemetry;

  const pump = (timestamp) => {
    pumpId = null;
    if (!callbacks.size) return;
    if (timestamp - lastDispatchAt < frameIntervalMs - 1) {
      pumpId = nativeRequestAnimationFrame(pump);
      return;
    }
    lastDispatchAt = timestamp;
    const batch = [...callbacks.entries()];
    callbacks.clear();
    telemetry.dispatchTimes.push(timestamp);
    if (telemetry.dispatchTimes.length > 512) telemetry.dispatchTimes.shift();
    for (const [, callback] of batch) callback(timestamp);
    if (callbacks.size && pumpId === null) pumpId = nativeRequestAnimationFrame(pump);
  };

  window.requestAnimationFrame = (callback) => {
    const id = nextCallbackId++;
    callbacks.set(id, callback);
    if (pumpId === null) pumpId = nativeRequestAnimationFrame(pump);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    callbacks.delete(id);
    if (!callbacks.size && pumpId !== null) {
      nativeCancelAnimationFrame(pumpId);
      pumpId = null;
    }
  };

  window.setInterval(() => {
    const activeZones = window.__MARKET_QA__?.activeZones;
    if (!Array.isArray(activeZones)) return;
    for (const zone of activeZones) {
      if (typeof zone === "string" && zone.startsWith("stock:") && !telemetry.stockZonesVisited.includes(zone)) {
        telemetry.stockZonesVisited.push(zone);
      }
    }
  }, 50);
  window.addEventListener("webglcontextlost", () => { telemetry.webglContextLosses += 1; }, true);
}, FRAME_INTERVAL_MS);

const suffix = Date.now().toString(36);
await page.goto(`${BASE_URL}?debug=1`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("QA transferencia 5 FPS");
await page.getByLabel("Nombre de usuario").fill(`qa_low_fps_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`qa.low.fps.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Low-FPS-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
const setupButton = page.getByRole("button", { name: "Abrir mi primer Mini Market" });
await setupButton.waitFor({ timeout: 90_000 });
await setupButton.click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.state && window.__MARKET_QA__?.stockingTargets && window.__MARKET_FIND_PLAYER_PATH__), null, { timeout: 90_000 });
// The 10 Hz world loop can mark the snapshot dirty again immediately after the
// onboarding save. A positive server revision proves that save completed even
// when the transient `saved` label is no longer observable at 5 FPS.
await page.waitForFunction(() => (window.__MARKET_QA__?.saveRevision ?? 0) >= 1, null, { timeout: 30_000 });

// Restore a deterministic local QA snapshot. This injects stock without
// mutating engine code or depending on the farm/cow unlock path.
await page.evaluate(() => {
  const qa = structuredClone(window.__MARKET_QA__);
  const state = qa.state;
  const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
  state.revision += 10_000;
  franchise.carry = { capacity: 8, items: { milk: 3 } };
  franchise.shelves.milk = 0;
  localStorage.setItem("mini-market-recovery-v1", JSON.stringify({ state, saveRevision: qa.saveRevision, pendingEvents: [] }));
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForFunction(() => {
  const state = window.__MARKET_QA__?.state;
  const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
  const dairy = window.__MARKET_QA__?.stockingTargets?.find((candidate) => candidate.departmentId === "dairy");
  return Boolean(window.__MARKET_QA__?.player && window.__MARKET_FIND_PLAYER_PATH__ && franchise?.carry?.items?.milk === 3 && franchise?.shelves?.milk === 0 && dairy?.productId === "milk");
}, null, { timeout: 90_000 });
await page.evaluate(() => {
  window.__MARKET_QA__.stockBursts = [];
  window.__MARKET_QA__.stockBurstProgress = [];
  window.__MARKET_QA__.stockBurstCompletions = [];
  window.__MARKET_LOW_FPS__.dispatchTimes = [];
  window.__MARKET_LOW_FPS__.stockZonesVisited = [];
});

const initial = await snapshot(page);
await page.screenshot({ path: path.join(output, "01-three-milks-low-fps.png"), fullPage: true });

const dairyTarget = initial.targets.find((candidate) => candidate.departmentId === "dairy");
if (!dairyTarget) throw new Error(`No existe el imán dairy: ${JSON.stringify(initial.targets)}`);
const visibleApproach = [
  dairyTarget.x + (dairyTarget.displayX - dairyTarget.x) * 0.27,
  dairyTarget.z + (dairyTarget.displayZ - dairyTarget.z) * 0.27,
];
const movementStartedAt = Date.now();
await moveTo(page, visibleApproach, 0.35, 45_000);
await page.waitForFunction(() => {
  const state = window.__MARKET_QA__.state;
  const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
  return !(franchise.carry.items.milk > 0) && franchise.shelves.milk === 3;
}, null, { timeout: 12_000 });
const stockCommittedAt = Date.now();
await page.waitForFunction(() => (window.__MARKET_QA__.stockBursts ?? [])
  .some((event) => event.productId === "milk" && event.departmentId === "dairy" && event.quantity === 3), null, { timeout: 5_000 });
await page.waitForFunction(() => {
  const player = window.__MARKET_QA__?.player;
  return player?.basketMounted === true && player?.basketUnits === 3
    && !(window.__MARKET_QA__?.stockBurstProgress ?? []).length
    && !(window.__MARKET_QA__?.stockBurstCompletions ?? []).length;
}, null, { timeout: 5_000 });
const afterCommit = await snapshot(page);
await page.screenshot({ path: path.join(output, "02-stock-committed-flights-alive.png"), fullPage: true });

await page.waitForFunction(() => {
  const completions = (window.__MARKET_QA__.stockBurstCompletions ?? []).filter((event) => event.productId === "milk" && event.departmentId === "dairy");
  const player = window.__MARKET_QA__?.player;
  return completions.some((event) => event.quantity === 3)
    && player?.basketMounted === false
    && player?.basketUnits === 0
    && window.__MARKET_QA__?.retailPresentation?.dairy?.milk === 3;
}, null, { timeout: 15_000 });
const allFlightsCompletedAt = Date.now();
const final = await snapshot(page);
await page.screenshot({ path: path.join(output, "03-batch-completion.png"), fullPage: true });

const milkCompletions = final.stockBurstCompletions.filter((event) => event.productId === "milk" && event.departmentId === "dairy");
const uniqueCompletionSequences = [...new Set(milkCompletions.map((event) => event.sequence))];
const milkBursts = final.stockBursts.filter((event) => event.productId === "milk" && event.departmentId === "dairy");
const milkProgress = final.stockBurstProgress.filter((event) => event.productId === "milk" && event.departmentId === "dairy");
const frameIntervals = final.lowFps.dispatchTimes.slice(1).map((timestamp, index) => timestamp - final.lowFps.dispatchTimes[index]);
const medianFrameIntervalMs = median(frameIntervals);
const effectiveFps = 1000 / medianFrameIntervalMs;
const completionLagAfterStockCommitMs = allFlightsCompletedAt - stockCommittedAt;
const report = {
  requestedFrameIntervalMs: FRAME_INTERVAL_MS,
  medianFrameIntervalMs,
  effectiveFps,
  observedFrameIntervals: summarize(frameIntervals),
  movementDurationMs: stockCommittedAt - movementStartedAt,
  completionLagAfterStockCommitMs,
  maximumCompletionLagMs: MAX_COMPLETION_LAG_MS,
  initial,
  afterCommit,
  final,
  milkBurstCount: milkBursts.length,
  milkProgress,
  milkCompletionCount: milkCompletions.length,
  uniqueCompletionSequences,
  consoleErrors,
  pageErrors,
  failedResponses,
  failedRequests,
};
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const visitedStockZones = final.lowFps.stockZonesVisited;
if (visitedStockZones.length !== 1 || visitedStockZones[0] !== "stock:dairy") throw new Error(`El recorrido tocó otro imán: ${JSON.stringify(visitedStockZones)}`);
if (initial.carry.milk !== 3 || initial.shelves.milk !== 0 || (final.carry.milk ?? 0) !== 0 || final.shelves.milk !== 3) throw new Error(`La transferencia no conservó las tres leches: ${JSON.stringify({ initial, final })}`);
if (milkBursts.length !== 1 || milkBursts[0].quantity !== 3 || milkCompletions.length !== 1 || milkCompletions[0].quantity !== 3 || uniqueCompletionSequences.length !== 1 || milkBursts[0].sequence !== milkCompletions[0].sequence) throw new Error(`No hubo un único lote visual de tres leches con su completion: ${JSON.stringify({ milkBursts, milkCompletions, uniqueCompletionSequences })}`);
if (afterCommit.stockBurstCompletions.some((event) => event.productId === "milk" && event.departmentId === "dairy") || allFlightsCompletedAt <= stockCommittedAt) throw new Error(`La completion ocurrió antes del vaciado autoritativo: ${JSON.stringify({ stockCommittedAt, allFlightsCompletedAt, afterCommit })}`);
if (!afterCommit.player.basketMounted || afterCommit.player.basketUnits !== 3 || (afterCommit.retailPresentation?.dairy?.milk ?? 0) !== 0) throw new Error(`La presentación no conservó las tres leches en la cesta durante el vuelo: ${JSON.stringify(afterCommit)}`);
if (final.player.basketMounted || final.player.basketUnits !== 0 || final.retailPresentation?.dairy?.milk !== 3) throw new Error(`La última llegada no desmontó la cesta o no completó el expositor: ${JSON.stringify(final)}`);
const remainingProgress = milkProgress.map((event) => event.remainingQuantity);
if (!remainingProgress.length || remainingProgress.at(-1) !== 0 || remainingProgress.some((remaining, index) => index > 0 && remaining >= remainingProgress[index - 1])) throw new Error(`El ledger visual no publicó progreso absoluto estrictamente descendente hasta cero a 5 FPS: ${JSON.stringify(milkProgress)}`);
if (completionLagAfterStockCommitMs > MAX_COMPLETION_LAG_MS) throw new Error(`El vuelo quedó ralentizado por el frame rate: ${JSON.stringify({ completionLagAfterStockCommitMs, maximumCompletionLagMs: MAX_COMPLETION_LAG_MS })}`);
if (frameIntervals.length < 5 || medianFrameIntervalMs < 180 || medianFrameIntervalMs > 240) throw new Error(`requestAnimationFrame no quedó cerca de 5 FPS: ${JSON.stringify({ medianFrameIntervalMs, frameIntervals })}`);
if (final.lowFps.webglContextLosses !== 0 || consoleErrors.length || pageErrors.length || failedResponses.length || failedRequests.length) throw new Error(`Errores durante QA: ${JSON.stringify({ webglContextLosses: final.lowFps.webglContextLosses, consoleErrors, pageErrors, failedResponses, failedRequests })}`);

await browser.close();

async function snapshot(targetPage) {
  return targetPage.evaluate(() => {
    const state = window.__MARKET_QA__.state;
    const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
    return {
      carry: structuredClone(franchise.carry.items),
      shelves: { milk: franchise.shelves.milk },
      player: structuredClone(window.__MARKET_QA__.player),
      targets: structuredClone(window.__MARKET_QA__.stockingTargets ?? []),
      activeZones: structuredClone(window.__MARKET_QA__.activeZones ?? []),
      stockBursts: structuredClone(window.__MARKET_QA__.stockBursts ?? []),
      stockBurstProgress: structuredClone(window.__MARKET_QA__.stockBurstProgress ?? []),
      stockBurstCompletions: structuredClone(window.__MARKET_QA__.stockBurstCompletions ?? []),
      retailPresentation: structuredClone(window.__MARKET_QA__.retailPresentation ?? null),
      lowFps: structuredClone(window.__MARKET_LOW_FPS__),
    };
  });
}

async function moveTo(targetPage, target, tolerance, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const carryEmpty = await targetPage.evaluate(() => {
      const state = window.__MARKET_QA__.state;
      const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
      return !(franchise.carry.items.milk > 0);
    });
    if (carryEmpty) {
      await targetPage.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
      return;
    }
    const current = await targetPage.evaluate(() => structuredClone(window.__MARKET_QA__.player));
    if (Math.hypot(current.x - target[0], current.z - target[1]) <= tolerance) {
      await targetPage.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
      return;
    }
    const route = await targetPage.evaluate((destination) => window.__MARKET_FIND_PLAYER_PATH__?.(destination) ?? [], target);
    const next = route[1] ?? target;
    const dx = next[0] - current.x;
    const dz = next[1] - current.z;
    const length = Math.hypot(dx, dz) || 1;
    const worldX = dx / length;
    const worldZ = dz / length;
    const forwardLength = Math.hypot(-16, -25.75);
    const forward = [-16 / forwardLength, -25.75 / forwardLength];
    const right = [-forward[1], forward[0]];
    await targetPage.evaluate(({ x, y }) => window.__MARKET_SET_PLAYER_INPUT__?.(x, y), {
      x: worldX * right[0] + worldZ * right[1],
      y: -(worldX * forward[0] + worldZ * forward[1]),
    });
    await targetPage.waitForTimeout(220);
  }
  await targetPage.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
  throw new Error(`No se alcanzó dairy: ${JSON.stringify(await snapshot(targetPage))}`);
}

function median(values) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(values) {
  if (!values.length) return { count: 0, min: null, median: null, max: null };
  return { count: values.length, min: Math.min(...values), median: median(values), max: Math.max(...values) };
}
