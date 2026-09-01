import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:3000";
const output = process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "/tmp/market-warehouse-pickup";
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MARKET_CHROME_PATH ?? "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__MARKET_WAREHOUSE_QA__ = { supplierZoneSeen: false };
  window.setInterval(() => {
    if (window.__MARKET_QA__?.activeZones?.includes("supplier")) window.__MARKET_WAREHOUSE_QA__.supplierZoneSeen = true;
  }, 25);
});
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];
const failedRequests = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? "UNKNOWN" }));

const suffix = Date.now().toString(36);
await page.goto(`${BASE_URL}?debug=1`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("QA almacén autoritativo");
await page.getByLabel("Nombre de usuario").fill(`qa_warehouse_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`qa.warehouse.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Warehouse-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
const setupButton = page.getByRole("button", { name: "Abrir mi primer Mini Market" });
await setupButton.waitFor({ timeout: 90_000 });
await setupButton.click();
await page.waitForFunction(() => Boolean(
  window.__MARKET_QA__?.player
  && window.__MARKET_QA__?.state
  && window.__MARKET_QA__?.warehousePickupTarget
  && window.__MARKET_QA__?.stockingTargets
  && window.__MARKET_QA__?.advanceMinutes
  && window.__MARKET_FIND_PLAYER_PATH__,
), null, { timeout: 90_000 });
await page.waitForFunction(() => (window.__MARKET_QA__?.saveRevision ?? 0) >= 1, null, { timeout: 30_000 });

const initial = await snapshot(page);
if (initial.carry.total !== 0 || initial.player.basketMounted || initial.player.basketUnits !== 0) {
  throw new Error(`La cesta no empieza ausente y vacía: ${JSON.stringify(initial)}`);
}
if (initial.warehouse.total !== 0 || initial.pickupTarget.sensorEnabled) {
  throw new Error(`El muelle vacío se publicó como recogible: ${JSON.stringify(initial)}`);
}

// Visit the authored dock point before ordering. Its conditional collider must
// remain unmounted, so empty/full polling cannot enqueue a failing action or
// leave an unusable prompt on screen.
await moveTo(page, [initial.pickupTarget.x, initial.pickupTarget.z], 0.6);
const emptySensorBaseline = await snapshot(page);
await page.waitForTimeout(1_000);
const emptySensorSettled = await snapshot(page);
if (emptySensorSettled.messageRevision !== emptySensorBaseline.messageRevision || emptySensorSettled.carry.total !== 0) {
  throw new Error(`El muelle vacío repitió una acción/fallo: ${JSON.stringify({ emptySensorBaseline, emptySensorSettled })}`);
}
if (emptySensorSettled.prompt?.includes("Recoger mercancía")) {
  throw new Error(`El muelle vacío mostró un prompt no accionable: ${JSON.stringify(emptySensorSettled.prompt)}`);
}
if (emptySensorSettled.activeZones.includes("supplier") || await page.evaluate(() => window.__MARKET_WAREHOUSE_QA__.supplierZoneSeen)) {
  throw new Error(`El sensor físico siguió activo sin mercancía: ${JSON.stringify(emptySensorSettled.activeZones)}`);
}
await page.screenshot({ path: path.join(output, "01-empty-dock.png"), fullPage: true });

await moveTo(page, [0, 10.5], 0.65);
await page.getByRole("button", { name: "Proveedores" }).click();
await page.getByRole("button", { name: /Trigo/ }).click();
await page.getByRole("button", { name: "×", exact: true }).click();
await page.waitForFunction(() => window.__MARKET_QA__?.state?.pendingOrders?.some((order) => order.productId === "wheat" && order.quantity === 10), null, { timeout: 5_000 });

const ordered = await snapshot(page);
const wheatOrder = ordered.pendingOrders.find((order) => order.productId === "wheat");
if (!wheatOrder || wheatOrder.totalMinor !== 700 || initial.balanceMinor - ordered.balanceMinor !== wheatOrder.totalMinor) {
  throw new Error(`El pedido real no debitó exactamente 700 unidades menores: ${JSON.stringify({ initial, ordered })}`);
}
if (![initial.balanceMinor, ordered.balanceMinor, wheatOrder.totalMinor].every(Number.isSafeInteger)) {
  throw new Error(`El dinero dejó de ser entero seguro: ${JSON.stringify({ initial: initial.balanceMinor, ordered: ordered.balanceMinor, order: wheatOrder.totalMinor })}`);
}

// This invokes the public store simulation path in debug mode. It accelerates
// the real 80-minute supplier lead time; it does not inject carry/warehouse or
// rewrite local recovery.
await page.evaluate(() => window.__MARKET_QA__.advanceMinutes(80));
await page.waitForFunction(() => {
  const state = window.__MARKET_QA__?.state;
  const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
  return franchise?.warehouse?.wheat === 10
    && !(state?.pendingOrders ?? []).some((order) => order.productId === "wheat")
    && window.__MARKET_QA__?.warehousePickupTarget?.sensorEnabled === true;
}, null, { timeout: 10_000 });

const delivered = await snapshot(page);
if (delivered.carry.total !== 0 || delivered.player.basketMounted || delivered.player.basketUnits !== 0) {
  throw new Error(`La entrega saltó directamente a una cesta visual: ${JSON.stringify(delivered)}`);
}
if (delivered.balanceMinor !== ordered.balanceMinor) {
  throw new Error(`La entrega volvió a alterar caja: ${JSON.stringify({ ordered: ordered.balanceMinor, delivered: delivered.balanceMinor })}`);
}
await page.screenshot({ path: path.join(output, "02-delivered-to-warehouse.png"), fullPage: true });

await page.evaluate(() => { window.__MARKET_WAREHOUSE_QA__.supplierZoneSeen = false; });
await moveTo(page, [delivered.pickupTarget.x, delivered.pickupTarget.z], 0.6);
await page.waitForFunction(() => {
  const state = window.__MARKET_QA__?.state;
  const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
  const player = window.__MARKET_QA__?.player;
  return franchise?.carry?.items?.wheat === 3
    && franchise?.warehouse?.wheat === 7
    && player?.basketMounted === true
    && player?.basketUnits === 3
    && window.__MARKET_QA__?.warehousePickupTarget?.sensorEnabled === false;
}, null, { timeout: 12_000 });

await page.waitForTimeout(250);
const pickedUp = await snapshot(page);
const supplierZoneSeen = await page.evaluate(() => window.__MARKET_WAREHOUSE_QA__.supplierZoneSeen);
if (!supplierZoneSeen) throw new Error(`La recogida ocurrió sin atravesar el sensor físico: ${JSON.stringify(pickedUp)}`);
await page.waitForTimeout(1_000);
const fullSensorSettled = await snapshot(page);
if (fullSensorSettled.messageRevision !== pickedUp.messageRevision || fullSensorSettled.carry.total !== 3 || fullSensorSettled.warehouse.items.wheat !== 7) {
  throw new Error(`El muelle siguió ejecutando/fallando con la cesta llena: ${JSON.stringify({ pickedUp, fullSensorSettled })}`);
}
if (fullSensorSettled.prompt?.includes("Recoger mercancía")) {
  throw new Error(`La cesta llena dejó visible un prompt no accionable: ${JSON.stringify(fullSensorSettled.prompt)}`);
}
await page.screenshot({ path: path.join(output, "03-picked-up-basket-visible.png"), fullPage: true });

const bakeryTarget = pickedUp.stockingTargets.find((target) => target.departmentId === "bakery");
if (!bakeryTarget || bakeryTarget.productId !== "wheat") {
  throw new Error(`El trigo no encontró su estación real de panadería: ${JSON.stringify(pickedUp.stockingTargets)}`);
}
const stockCompletionBaseline = await page.evaluate(() => window.__MARKET_QA__?.stockBurstCompletions?.length ?? 0);
await moveTo(page, [bakeryTarget.x, bakeryTarget.z], 0.62);
await page.waitForFunction((baseline) => {
  const state = window.__MARKET_QA__?.state;
  const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
  const completions = (window.__MARKET_QA__?.stockBurstCompletions ?? []).slice(baseline);
  return franchise?.shelves?.wheat === 3
    && !(franchise?.carry?.items?.wheat > 0)
    && completions.some((event) => event.productId === "wheat" && event.departmentId === "bakery" && event.quantity === 3)
    && window.__MARKET_QA__?.player?.basketMounted === false
    && window.__MARKET_QA__?.player?.basketUnits === 0;
}, stockCompletionBaseline, { timeout: 15_000 });

const stocked = await snapshot(page);
await page.screenshot({ path: path.join(output, "04-final-shelf-landing.png"), fullPage: true });
const conservedWheat = stocked.warehouse.items.wheat + stocked.shelves.wheat + (stocked.carry.items.wheat ?? 0);
if (conservedWheat !== 10 || stocked.balanceMinor !== ordered.balanceMinor) {
  throw new Error(`El circuito no conservó producto/dinero: ${JSON.stringify({ conservedWheat, ordered: ordered.balanceMinor, stocked })}`);
}
if (stocked.player.basketMounted || stocked.player.basketUnits !== 0) {
  throw new Error(`La cesta no desapareció al aterrizar la última unidad: ${JSON.stringify(stocked.player)}`);
}

const webgl = await page.locator("canvas").first().evaluate((canvas) => {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl ? {
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    contextLost: gl.isContextLost(),
  } : null;
});
const report = {
  account: `qa.warehouse.${suffix}@example.test`,
  initial,
  emptySensorBaseline,
  emptySensorSettled,
  ordered,
  delivered,
  pickedUp,
  supplierZoneSeen,
  fullSensorSettled,
  stocked,
  conservedWheat,
  webgl,
  consoleErrors,
  pageErrors,
  failedResponses,
  failedRequests,
};
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (consoleErrors.length || pageErrors.length || failedResponses.length || failedRequests.length) {
  throw new Error(`Errores de navegador: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses, failedRequests })}`);
}
if (!webgl || webgl.contextLost) throw new Error(`WebGL no permaneció sano: ${JSON.stringify(webgl)}`);

async function snapshot(targetPage) {
  return targetPage.evaluate(() => {
    const state = window.__MARKET_QA__.state;
    const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
    const carryItems = structuredClone(franchise.carry.items);
    const warehouseItems = structuredClone(franchise.warehouse);
    return {
      revision: state.revision,
      messageRevision: window.__MARKET_QA__.messageRevision,
      message: window.__MARKET_QA__.message,
      balanceMinor: state.balanceMinor,
      minuteOfDay: state.minuteOfDay,
      pendingOrders: structuredClone(state.pendingOrders),
      carry: {
        capacity: franchise.carry.capacity,
        items: carryItems,
        total: Object.values(carryItems).reduce((sum, quantity) => sum + (quantity ?? 0), 0),
      },
      warehouse: {
        items: warehouseItems,
        total: Object.values(warehouseItems).reduce((sum, quantity) => sum + (quantity ?? 0), 0),
      },
      shelves: structuredClone(franchise.shelves),
      pickupTarget: structuredClone(window.__MARKET_QA__.warehousePickupTarget),
      stockingTargets: structuredClone(window.__MARKET_QA__.stockingTargets ?? []),
      activeZones: structuredClone(window.__MARKET_QA__.activeZones ?? []),
      prompt: document.querySelector(".interaction-prompt")?.textContent ?? null,
      player: structuredClone(window.__MARKET_QA__.player),
    };
  });
}

async function moveTo(targetPage, target, tolerance, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await targetPage.evaluate(() => structuredClone(window.__MARKET_QA__.player));
    if (Math.hypot(current.x - target[0], current.z - target[1]) <= tolerance) {
      await targetPage.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
      return [current.x, current.z];
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
    const inputX = worldX * right[0] + worldZ * right[1];
    const inputY = -(worldX * forward[0] + worldZ * forward[1]);
    await targetPage.evaluate(({ x, y }) => window.__MARKET_SET_PLAYER_INPUT__?.(x, y), { x: inputX, y: inputY });
    await targetPage.waitForTimeout(170);
    await targetPage.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
  }
  throw new Error(`No se alcanzó ${JSON.stringify(target)}: ${JSON.stringify(await targetPage.evaluate(() => window.__MARKET_QA__.player))}`);
}
