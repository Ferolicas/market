import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:3000";
const output = process.argv[2] ?? "/tmp/market-mixed-stocking";
const PRODUCT_IDS = ["wheat", "flour", "bread", "corn", "milk", "eggs", "cheese", "apples", "tomatoes", "coffee", "juice"];
const DEPARTMENT_PRODUCTS = {
  bakery: ["bread", "flour", "wheat"],
  pantry: ["coffee"],
  eggs: ["eggs"],
  produce: ["tomatoes", "apples", "corn"],
  dairy: ["milk", "cheese"],
  drinks: ["juice"],
};
const SEED_ITEMS = {
  tomatoes: 2,
  apples: 1,
  corn: 1,
  eggs: 2,
  milk: 2,
  cheese: 1,
  juice: 1,
  bread: 1,
  flour: 1,
  wheat: 1,
  coffee: 1,
};
const TOTAL_UNITS = Object.values(SEED_ITEMS).reduce((sum, quantity) => sum + quantity, 0);
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

const suffix = Date.now().toString(36);
await page.goto(`${BASE_URL}?debug=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Surtido Mixto QA");
await page.getByLabel("Nombre de usuario").fill(`mixed_stock_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`mixed.stock.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Mixed-Stock-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
const setupButton = page.getByRole("button", { name: "Abrir mi primer Mini Market" });
await setupButton.waitFor({ timeout: 60_000 });
await setupButton.click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.state && window.__MARKET_QA__?.stockingTargets), null, { timeout: 60_000 });
await page.waitForFunction(() => (window.__MARKET_QA__?.saveRevision ?? 0) >= 1, null, { timeout: 30_000 });

// Reload a deterministic QA-only recovery snapshot so React, the real engine
// and all six sensors observe the same 11-product basket from their first tick.
await page.evaluate(({ items, productIds }) => {
  const qa = structuredClone(window.__MARKET_QA__);
  const state = qa.state;
  const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
  state.revision += 10_000;
  franchise.carry = { capacity: 20, items };
  for (const productId of productIds) franchise.shelves[productId] = 0;
  localStorage.setItem("mini-market-recovery-v1", JSON.stringify({ state, saveRevision: qa.saveRevision, pendingEvents: [] }));
}, { items: SEED_ITEMS, productIds: PRODUCT_IDS });
await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForFunction(() => {
  const state = window.__MARKET_QA__?.state;
  const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
  return Boolean(window.__MARKET_QA__?.player && window.__MARKET_FIND_PLAYER_PATH__ && franchise?.carry?.capacity >= 20
    && Object.keys(franchise.carry.items).length === 11
    && (window.__MARKET_QA__?.stockingTargets?.length ?? 0) === 6);
}, null, { timeout: 90_000 });
await page.evaluate(() => {
  window.__MARKET_QA__.stockBursts = [];
  window.__MARKET_QA__.stockBurstCompletions = [];
});

const initial = await snapshot(page);
const discoveredDepartments = initial.targets.map((target) => target.departmentId);
if (initial.carry.capacity < 20 || initial.carry.total !== TOTAL_UNITS || PRODUCT_IDS.some((productId) => initial.carry[productId] !== SEED_ITEMS[productId])) throw new Error(`La cesta mixta no contiene los 11 productos exactos: ${JSON.stringify(initial.carry)}`);
if (initial.targets.length !== 6 || new Set(initial.targets.map((target) => target.id)).size !== 6 || new Set(discoveredDepartments).size !== 6
  || Object.keys(DEPARTMENT_PRODUCTS).some((departmentId) => !discoveredDepartments.includes(departmentId))) {
  throw new Error(`No existen los seis imanes departamentales estables: ${JSON.stringify(initial.targets)}`);
}
assertConservation(initial, "inicio");
await page.screenshot({ path: path.join(output, "01-mixed-basket.png"), fullPage: true });

const steps = [];
for (const [index, departmentId] of discoveredDepartments.entries()) {
  const before = await snapshot(page);
  await approachVisibleFixture(page, departmentId, DEPARTMENT_PRODUCTS[departmentId]);
  const after = await snapshot(page);
  assertDepartmentTransfer(departmentId, before, after);
  assertConservation(after, departmentId);
  steps.push({ departmentId, before, after });
  if (departmentId === "bakery") {
    await page.waitForFunction(() => {
      const bakery = window.__MARKET_QA__?.retailPresentation?.bakery;
      return (bakery?.bread ?? 0) >= 1 && (bakery?.flour ?? 0) >= 1 && (bakery?.wheat ?? 0) >= 1;
    }, null, { timeout: 5_000 });
  }
  await page.screenshot({ path: path.join(output, `${String(index + 2).padStart(2, "0")}-${departmentId}-stocked.png`), fullPage: true });
}

await page.waitForFunction((expectedTotal) => (window.__MARKET_QA__?.stockBurstCompletions ?? [])
  .reduce((sum, event) => sum + (event.quantity ?? 0), 0) >= expectedTotal, TOTAL_UNITS, { timeout: 8_000 });
// Completion is published from the render frame that lands the last unit;
// allow React's immediately following commit to remove the visual overlay.
await page.waitForFunction(() => window.__MARKET_QA__?.player?.basketMounted === false
  && window.__MARKET_QA__?.player?.basketUnits === 0, null, { timeout: 5_000 });
const final = await snapshot(page);
await page.screenshot({ path: path.join(output, "08-empty-basket-all-products.png"), fullPage: true });

const stockedTotal = PRODUCT_IDS.reduce((sum, productId) => sum + (final.shelves[productId] ?? 0), 0);
const mountedQuantity = final.stockBursts.reduce((sum, burst) => sum + (burst.quantity ?? 0), 0);
const completedQuantity = final.stockBurstCompletions.reduce((sum, burst) => sum + (burst.quantity ?? 0), 0);
const burstProducts = new Set(final.stockBursts.map((burst) => burst.productId));
const mountedBySequence = new Map(final.stockBursts.map((burst) => [burst.sequence, burst]));
const completedBySequence = new Map(final.stockBurstCompletions.map((burst) => [burst.sequence, burst]));
const unmatchedTransfers = final.stockBursts.filter((burst) => {
  const completion = completedBySequence.get(burst.sequence);
  return !completion || completion.productId !== burst.productId || completion.departmentId !== burst.departmentId || completion.quantity !== burst.quantity;
});
const orphanCompletions = final.stockBurstCompletions.filter((completion) => !mountedBySequence.has(completion.sequence));
const report = { seedItems: SEED_ITEMS, totalUnits: TOTAL_UNITS, discoveredDepartments, initial, steps, final, stockedTotal, mountedQuantity, completedQuantity, unmatchedTransfers, orphanCompletions, consoleErrors, pageErrors, failedResponses, failedRequests };
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (stockedTotal !== TOTAL_UNITS || final.carry.total !== 0) throw new Error(`El surtido no conservó las ${TOTAL_UNITS} unidades: ${JSON.stringify({ stockedTotal, carry: final.carry })}`);
if (final.player.basketMounted || final.player.basketUnits !== 0) throw new Error(`La cesta siguió visible después del último aterrizaje: ${JSON.stringify(final.player)}`);
if (!PRODUCT_IDS.every((productId) => burstProducts.has(productId))) throw new Error(`Faltan vuelos visuales de algún ProductId: ${JSON.stringify(final.stockBursts)}`);
if (final.stockBursts.length !== PRODUCT_IDS.length || new Set(final.stockBursts.map((burst) => burst.sequence)).size !== PRODUCT_IDS.length
  || final.stockBurstCompletions.length !== PRODUCT_IDS.length || mountedQuantity !== TOTAL_UNITS || completedQuantity !== TOTAL_UNITS
  || unmatchedTransfers.length || orphanCompletions.length) {
  throw new Error(`Los lotes visuales no conservaron cantidad/secuencia: ${JSON.stringify({ mounted: final.stockBursts, completed: final.stockBurstCompletions, mountedQuantity, completedQuantity, unmatchedTransfers, orphanCompletions })}`);
}
if (!["bread", "flour", "wheat"].every((productId) => (final.retailPresentation?.bakery?.[productId] ?? 0) >= 1)) throw new Error(`Panadería no representa pan, harina y trigo: ${JSON.stringify(final.retailPresentation)}`);
if (consoleErrors.length || pageErrors.length || failedResponses.length || failedRequests.length) throw new Error(`Errores del navegador: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses, failedRequests })}`);

async function approachVisibleFixture(targetPage, departmentId, departmentProducts) {
  const target = await targetPage.evaluate((id) => structuredClone(window.__MARKET_QA__.stockingTargets.find((candidate) => candidate.departmentId === id)), departmentId);
  if (!target) throw new Error(`No existe imán para ${departmentId}`);
  // Stop between the walkable service point and the visible face of the
  // fixture. This proves the magnet does not require pixel-perfect alignment.
  // 27% reaches beyond the former narrow 0.70-unit trigger while remaining
  // just outside the furniture padding used by the generated NavMesh.
  const visibleApproach = [target.x + (target.displayX - target.x) * 0.27, target.z + (target.displayZ - target.z) * 0.27];
  // A wide magnet is expected to finish unloading before the actor reaches
  // the requested edge; stop as soon as that real engine condition is met.
  await moveTo(targetPage, visibleApproach, 0.35, 35_000, departmentProducts);
  await targetPage.waitForFunction((productIds) => {
    const state = window.__MARKET_QA__.state;
    const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
    return productIds.every((productId) => !(franchise.carry.items[productId] > 0));
  }, departmentProducts, { timeout: 12_000 });
  await targetPage.waitForTimeout(180);
}

async function snapshot(targetPage) {
  return targetPage.evaluate(() => {
    const state = window.__MARKET_QA__.state;
    const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
    const items = structuredClone(franchise.carry.items);
    return {
      carry: { capacity: franchise.carry.capacity, ...items, total: Object.values(items).reduce((sum, quantity) => sum + (quantity ?? 0), 0) },
      shelves: structuredClone(franchise.shelves),
      targets: structuredClone(window.__MARKET_QA__.stockingTargets ?? []),
      activeZones: structuredClone(window.__MARKET_QA__.activeZones ?? []),
      player: structuredClone(window.__MARKET_QA__.player),
      stockBursts: structuredClone(window.__MARKET_QA__.stockBursts ?? []),
      stockBurstCompletions: structuredClone(window.__MARKET_QA__.stockBurstCompletions ?? []),
      retailPresentation: structuredClone(window.__MARKET_QA__.retailPresentation ?? null),
    };
  });
}

function assertDepartmentTransfer(departmentId, before, after) {
  const accepted = new Set(DEPARTMENT_PRODUCTS[departmentId]);
  for (const productId of PRODUCT_IDS) {
    const beforeCarry = before.carry[productId] ?? 0;
    const afterCarry = after.carry[productId] ?? 0;
    const beforeShelf = before.shelves[productId] ?? 0;
    const afterShelf = after.shelves[productId] ?? 0;
    if (accepted.has(productId)) {
      if (beforeCarry > 0 && (afterCarry !== 0 || afterShelf - beforeShelf !== beforeCarry)) {
        throw new Error(`El imán ${departmentId} no transfirió ${productId} exactamente: ${JSON.stringify({ beforeCarry, afterCarry, beforeShelf, afterShelf })}`);
      }
    } else if (afterCarry !== beforeCarry || afterShelf !== beforeShelf) {
      throw new Error(`El imán ${departmentId} mezcló ${productId}: ${JSON.stringify({ beforeCarry, afterCarry, beforeShelf, afterShelf })}`);
    }
  }
}

function assertConservation(snapshotValue, step) {
  for (const productId of PRODUCT_IDS) {
    const observed = (snapshotValue.carry[productId] ?? 0) + (snapshotValue.shelves[productId] ?? 0);
    if (observed !== SEED_ITEMS[productId]) throw new Error(`Se perdió o duplicó ${productId} en ${step}: esperado=${SEED_ITEMS[productId]} observado=${observed}`);
  }
}

async function moveTo(targetPage, target, tolerance, timeoutMs = 35_000, stopWhenProductsGone = []) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopWhenProductsGone.length && await targetPage.evaluate((productIds) => {
      const carry = window.__MARKET_QA__.state.franchises[0].carry.items;
      return productIds.every((productId) => !(carry[productId] > 0));
    }, stopWhenProductsGone)) {
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
    await targetPage.waitForTimeout(120);
    await targetPage.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
  }
  throw new Error(`No se alcanzó ${JSON.stringify(target)}: ${JSON.stringify(await targetPage.evaluate(() => window.__MARKET_QA__.player))}`);
}
