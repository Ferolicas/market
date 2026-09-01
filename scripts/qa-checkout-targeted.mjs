import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "/tmp/market-checkout-targeted";
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
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });

const suffix = Date.now().toString(36);
const email = `checkout.qa.${suffix}@example.test`;
await page.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Checkout QA");
await page.getByLabel("Nombre de usuario").fill(`checkout_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(email);
await page.getByLabel("Contraseña").fill(`Checkout-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
const setupButton = page.getByRole("button", { name: "Abrir mi primer Mini Market" });
await setupButton.waitFor({ timeout: 60_000 });
await setupButton.click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.state), null, { timeout: 60_000 });

await page.evaluate(() => {
  const qa = window.__MARKET_QA__;
  const state = structuredClone(qa.state);
  const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
  state.revision += 100;
  state.simulationTimeMs = 100_000;
  state.lastServerTime = Date.now();
  state.tutorialStep = 1;
  franchise.open = true;
  franchise.lightsOn = true;
  franchise.lastCustomerSpawnAt = state.simulationTimeMs;
  franchise.returnsBin = { wheat: 0, flour: 0, bread: 0, corn: 0, milk: 0, eggs: 0, cheese: 0, apples: 1, tomatoes: 3, coffee: 0, juice: 0 };
  franchise.returnedCartCount = 6;
  franchise.employees = [];
  const shared = {
    shoppingList: [{ productId: "tomatoes", requested: 2, picked: 2 }], currentLine: 1,
    basket: { tomatoes: 2 }, patienceMs: 18_000, checkoutPatienceMs: 300_000, waitingSince: null,
    queueLane: 0, queueJoinedAt: 99_000, path: [], pathIndex: 0, speed: 1.55, currentSpeed: 0,
    reservedSocketId: null, blockedSince: null, routeFailures: 0, hasCart: true, hasBag: false, angry: false,
  };
  franchise.customers = [
    { ...shared, id: "qa-checkout-front", identity: 1, state: "WAIT_CHECKOUT", queueSlot: 0, transactionId: "qa-checkout-transaction", x: 7, z: 2.85, targetX: 7, targetZ: 2.85, stateSince: 99_500 },
    { ...structuredClone(shared), id: "qa-checkout-handoff", identity: 2, state: "NAVIGATE_TO_BAG", shoppingList: [], currentLine: 0, basket: {}, queueSlot: null, queueJoinedAt: null, transactionId: "qa-checkout-complete", x: 7.7, z: 2.85, targetX: 8.9, targetZ: 2.85, path: [[8.9, 2.85]], stateSince: 99_700 },
    { ...structuredClone(shared), id: "qa-checkout-queue", identity: 3, state: "QUEUE_WAIT", shoppingList: [{ productId: "tomatoes", requested: 1, picked: 1 }], currentLine: 1, basket: { tomatoes: 1 }, queueSlot: 1, transactionId: null, x: 5.35, z: 2.85, targetX: 5.35, targetZ: 2.85, stateSince: 99_100 },
    { ...structuredClone(shared), id: "qa-empty-shopper", identity: 4, state: "NAVIGATE_TO_QUEUE", shoppingList: [{ productId: "tomatoes", requested: 1, picked: 0 }], currentLine: 1, basket: {}, queueSlot: 2, transactionId: null, x: 5.35, z: 2.07, targetX: 5.35, targetZ: 2.07, path: [[5.35, 2.07]], stateSince: 99_300 },
    { ...structuredClone(shared), id: "qa-door-exit", identity: 5, state: "EXIT_STORE", shoppingList: [], currentLine: 0, basket: {}, queueSlot: null, queueJoinedAt: null, transactionId: null, hasCart: false, x: 0, z: 7.2, targetX: 0, targetZ: 15.4, path: [[0, 15.4]], currentSpeed: 1.45, stateSince: 99_800 },
  ];
  franchise.queueCustomerIds = ["qa-checkout-front", "qa-checkout-queue"];
  franchise.checkoutTransactions = [
    {
      id: "qa-checkout-transaction", customerId: "qa-checkout-front", paymentMethod: "card", state: "SCANNING",
      pendingItems: [{ productId: "tomatoes", quantity: 2, loaded: 2, scanned: 0, bagged: 0 }],
      nextUnitIndex: 0, paymentCommitted: false, updatedAt: 99_900, lastLoadedAt: 99_900, lastScannedAt: 99_900, lastBaggedAt: 99_900, checkoutLane: 0,
    },
    {
      id: "qa-checkout-complete", customerId: "qa-checkout-handoff", paymentMethod: "cash", state: "COMPLETE",
      pendingItems: [{ productId: "apples", quantity: 1, loaded: 1, scanned: 1, bagged: 1 }],
      nextUnitIndex: 1, paymentCommitted: true, updatedAt: 99_850, lastLoadedAt: 98_000, lastScannedAt: 98_900, lastBaggedAt: 99_700, checkoutLane: 0,
    },
  ];
  localStorage.setItem("mini-market-recovery-v1", JSON.stringify({ state, saveRevision: qa.saveRevision, pendingEvents: [] }));
  sessionStorage.setItem("mini-market-qa-freeze", "1");
});

await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => window.__MARKET_QA__?.state?.franchises?.[0]?.checkoutTransactions?.[0]?.id === "qa-checkout-transaction", null, { timeout: 60_000 });
await page.waitForFunction(() => window.__MARKET_QA__?.checkoutPresentation?.[0] === "qa-checkout-transaction" && window.__MARKET_QA__?.checkoutHandoffPresentation?.[0] === "qa-checkout-complete" && window.__MARKET_QA__?.checkoutBagPresentation?.[0] === "counter", null, { timeout: 10_000 });
const concurrentCheckoutPresentation = await page.evaluate(() => ({
  active: structuredClone(window.__MARKET_QA__.checkoutPresentation),
  handoff: structuredClone(window.__MARKET_QA__.checkoutHandoffPresentation),
  bags: structuredClone(window.__MARKET_QA__.checkoutBagPresentation),
}));
await page.waitForTimeout(1_500);
await page.screenshot({ path: path.join(output, "checkout-overview.png"), fullPage: true });

const normalCameraPlayerVisible = await page.evaluate(() => document.querySelector("canvas") !== null && window.__MARKET_QA__.activeZones?.includes("checkout") !== true);
await moveTo(page, [16.1, 10.24], 0.42, 30_000, "checkout");
await page.waitForFunction(() => window.__MARKET_QA__?.activeZones?.includes("checkout"), null, { timeout: 10_000 });
await page.waitForTimeout(1_300);
await page.screenshot({ path: path.join(output, "checkout-close-camera.png"), fullPage: true });
const closeCamera = await page.evaluate(() => ({ activeZones: structuredClone(window.__MARKET_QA__.activeZones), player: structuredClone(window.__MARKET_QA__.player) }));

await page.addInitScript(() => {
  window.__MARKET_DOOR_SAMPLES__ = [];
  window.__MARKET_DOOR_MONITOR__ = window.setInterval(() => {
    const state = window.__MARKET_QA__?.state;
    const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
    if (!franchise) return;
    const customer = franchise.customers?.find((candidate) => candidate.id === "qa-door-exit");
    window.__MARKET_DOOR_SAMPLES__.push({ progress: franchise.doorProgress ?? 0, state: franchise.doorState ?? "UNKNOWN", customerState: customer?.state ?? "REMOVED", z: customer?.z ?? null });
  }, 20);
});
await page.evaluate(() => sessionStorage.removeItem("mini-market-qa-freeze"));
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.state), null, { timeout: 60_000 });
await page.waitForFunction(() => {
  const state = window.__MARKET_QA__?.state;
  const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
  const customer = franchise?.customers?.find((candidate) => candidate.id === "qa-door-exit");
  return window.__MARKET_DOOR_SAMPLES__?.length > 0 && (!customer || customer.z > 7.4);
}, null, { timeout: 5_000 });
const doorCheck = await page.evaluate(() => {
  window.clearInterval(window.__MARKET_DOOR_MONITOR__);
  const samples = structuredClone(window.__MARKET_DOOR_SAMPLES__);
  return { samples, violations: samples.filter((sample) => sample.z !== null && sample.z > 7.251 && sample.progress < 1) };
});
await page.screenshot({ path: path.join(output, "door-fully-open.png"), fullPage: true });
const beforeUnattended = await snapshot(page);
await page.waitForTimeout(1_500);
const afterUnattended = await snapshot(page);
const emptyShopperCheck = await page.evaluate(() => {
  const state = window.__MARKET_QA__.state;
  const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
  const customer = franchise.customers.find((candidate) => candidate.id === "qa-empty-shopper");
  return { state: customer?.state ?? "REMOVED", queued: franchise.queueCustomerIds.includes("qa-empty-shopper"), hasTransaction: franchise.checkoutTransactions.some((transaction) => transaction.customerId === "qa-empty-shopper") };
});
if (afterUnattended.balanceMinor !== beforeUnattended.balanceMinor || afterUnattended.transaction?.pendingItems[0].scanned !== 0) {
  throw new Error(`La caja se atendió sin trabajador: ${JSON.stringify({ beforeUnattended, afterUnattended })}`);
}

await moveTo(page, [16.1, 10.24], 0.42, 30_000, "checkout");
const serviceStartedAt = Date.now();
await page.waitForFunction(() => {
  const state = window.__MARKET_QA__?.state;
  const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
  return franchise?.customers?.find((customer) => customer.id === "qa-checkout-front")?.state === "PAY";
}, null, { timeout: 10_000 });
const paying = await snapshot(page);
const paymentStartedAt = Date.now();
await page.waitForFunction(() => {
  const state = window.__MARKET_QA__?.state;
  const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
  return (state?.progression?.counters?.customers ?? 0) >= 1 && franchise?.customers?.find((customer) => customer.id === "qa-checkout-front")?.hasBag === true;
}, null, { timeout: 20_000 });
const paid = await snapshot(page);
const serviceTiming = { toPaymentMs: paymentStartedAt - serviceStartedAt, visiblePaymentAndHandoffMs: Date.now() - paymentStartedAt };
await page.screenshot({ path: path.join(output, "checkout-paid.png"), fullPage: true });
await page.waitForFunction(() => {
  const state = window.__MARKET_QA__?.state;
  const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
  const customer = franchise?.customers?.find((candidate) => candidate.id === "qa-checkout-front");
  return !customer || customer.hasCart === false;
}, null, { timeout: 25_000 });
const cartReturned = await snapshot(page);

const webgl = await page.locator("canvas").first().evaluate((canvas) => {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl ? { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), contextLost: gl.isContextLost() } : null;
});
const report = { generatedAt: new Date().toISOString(), email, concurrentCheckoutPresentation, normalCameraPlayerVisible, closeCamera, doorCheck, emptyShopperCheck, beforeUnattended, afterUnattended, paying, paid, serviceTiming, cartReturned, webgl, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (!closeCamera.activeZones.includes("checkout")) throw new Error("La cámara de caja no se activó en el rectángulo del cajero.");
if (concurrentCheckoutPresentation.active[0] !== "qa-checkout-transaction" || concurrentCheckoutPresentation.handoff[0] !== "qa-checkout-complete" || concurrentCheckoutPresentation.bags[0] !== "counter") throw new Error(`La caja no presentó simultáneamente la compra activa y la bolsa pendiente: ${JSON.stringify(concurrentCheckoutPresentation)}`);
if (!doorCheck.samples.length || doorCheck.violations.length) throw new Error(`El cliente cruzó una puerta todavía cerrada o no pudo observarse: ${JSON.stringify(doorCheck)}`);
if (["NAVIGATE_TO_QUEUE", "QUEUE_WAIT", "MOVE_QUEUE", "UNLOAD", "WAIT_CHECKOUT", "PAY"].includes(emptyShopperCheck.state) || emptyShopperCheck.queued || emptyShopperCheck.hasTransaction) throw new Error(`El cliente sin compra fingió pasar por caja: ${JSON.stringify(emptyShopperCheck)}`);
if (paying.balanceMinor !== beforeUnattended.balanceMinor || paying.customer?.state !== "PAY" || paying.customer?.queueSlot !== 0) throw new Error(`El pago no permaneció visible en el puesto: ${JSON.stringify(paying)}`);
if (serviceTiming.visiblePaymentAndHandoffMs < 1_800) throw new Error(`El cliente abandonó el pago demasiado rápido: ${JSON.stringify(serviceTiming)}`);
if (paid.balanceMinor <= beforeUnattended.balanceMinor || paid.customersServed !== 1) throw new Error(`El pago no se confirmó exactamente una vez: ${JSON.stringify(paid)}`);
if (cartReturned.customer?.hasCart !== false && cartReturned.customer !== null) throw new Error(`El cliente no devolvió el carro: ${JSON.stringify(cartReturned.customer)}`);
if (!webgl?.renderer.includes("NVIDIA GeForce RTX 4080 SUPER") || webgl.contextLost) throw new Error(`GPU incorrecta: ${JSON.stringify(webgl)}`);
if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores de navegador: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);

async function snapshot(targetPage) {
  return targetPage.evaluate(() => {
    const state = window.__MARKET_QA__.state;
    const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
    return {
      balanceMinor: state.balanceMinor,
      customersServed: state.progression.counters.customers ?? 0,
      transaction: structuredClone(franchise.checkoutTransactions.find((candidate) => candidate.id === "qa-checkout-transaction") ?? null),
      customer: structuredClone(franchise.customers.find((candidate) => candidate.id === "qa-checkout-front") ?? null),
      returnsBin: structuredClone(franchise.returnsBin),
      returnedCartCount: franchise.returnedCartCount,
    };
  });
}

async function moveTo(targetPage, target, tolerance, timeoutMs = 30_000, stopZone = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopZone && await targetPage.evaluate((zone) => window.__MARKET_QA__?.activeZones?.includes(zone), stopZone)) {
      await targetPage.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
      return;
    }
    const current = await targetPage.evaluate(() => structuredClone(window.__MARKET_QA__.player));
    if (Math.hypot(current.x - target[0], current.z - target[1]) <= tolerance) return;
    const route = await targetPage.evaluate((destination) => window.__MARKET_FIND_PLAYER_PATH__?.(destination) ?? [], target);
    const next = route[1] ?? target;
    const dx = next[0] - current.x;
    const dz = next[1] - current.z;
    const length = Math.hypot(dx, dz) || 1;
    const worldX = dx / length;
    const worldZ = dz / length;
    const forward = normalize([-16, -25.75]);
    const right = [-forward[1], forward[0]];
    const inputX = worldX * right[0] + worldZ * right[1];
    const inputY = -(worldX * forward[0] + worldZ * forward[1]);
    await targetPage.evaluate(({ x, y }) => window.__MARKET_SET_PLAYER_INPUT__?.(x, y), { x: inputX, y: inputY });
    await targetPage.waitForTimeout(180);
    if (!stopZone) await targetPage.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
  }
  throw new Error(`No se alcanzó la caja: ${JSON.stringify(await targetPage.evaluate(() => window.__MARKET_QA__.player))}`);
}

function normalize([x, y]) {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}
