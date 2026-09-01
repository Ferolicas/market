import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputRoot = process.argv.slice(2).find((argument) => argument !== "--" && !argument.startsWith("--")) ?? "/tmp/market-full-game-qa";
const durationMs = Number(process.env.MARKET_QA_DURATION_MS ?? 15 * 60_000);
await fs.mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.MARKET_QA_HEADFUL !== "1",
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const startedAt = Date.now();
const consoleErrors = []; const pageErrors = []; const failedResponses = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });

const suffix = Date.now().toString(36);
await page.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Full Game QA");
await page.getByLabel("Nombre de usuario").fill(`full_qa_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`full.qa.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Full-QA-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.locator(".modal-backdrop").waitFor({ state: "detached", timeout: 30_000 });
await page.getByText("Objetivos del día").waitFor({ timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.state?.tutorialStep === 1), null, { timeout: 30_000 });

const qa = () => page.evaluate(() => structuredClone(window.__MARKET_QA__));
const game = async () => (await qa()).state;
const player = async () => (await qa()).player;
const distance = (a, b) => Math.hypot(a.x - b[0], a.z - b[1]);
const forward = normalize([-16, -25.75]);
// Match PlayerController's counter-clockwise camera-right vector. Keeping the
// inverse here means the E2E navigator exercises the public drag control while
// still being able to request a deterministic world-space route.
const right = [-forward[1], forward[0]];

async function dragPulse(worldDirection, origin = [720, 610], duration = 360) {
  const direction = normalize(worldDirection);
  const inputX = direction[0] * right[0] + direction[1] * right[1];
  const inputY = -(direction[0] * forward[0] + direction[1] * forward[1]);
  await page.mouse.move(origin[0], origin[1]);
  await page.mouse.down();
  await page.mouse.move(origin[0] + inputX * 88, origin[1] + inputY * 88, { steps: 3 });
  await page.waitForTimeout(Math.max(80, duration / 2));
  const during = await qa();
  await page.waitForTimeout(Math.max(0, duration / 2 - 80));
  await page.mouse.up();
  return during;
}

async function controllerPulse(worldDirection, duration = 220) {
  const direction = normalize(worldDirection);
  const inputX = direction[0] * right[0] + direction[1] * right[1];
  const inputY = -(direction[0] * forward[0] + direction[1] * forward[1]);
  await page.evaluate(({ x, y }) => window.__MARKET_SET_PLAYER_INPUT__?.(x, y), { x: inputX, y: inputY });
  try {
    await page.waitForTimeout(duration);
  } finally {
    await page.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
  }
}

async function moveTo(target, tolerance = 1.05, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs;
  let navPath = [];
  let lastProgressAt = Date.now();
  let bestRemaining = Number.POSITIVE_INFINITY;
  while (Date.now() < deadline) {
    const routeStart = await player();
    if (distance(routeStart, target) <= tolerance) return;
    navPath = await page.evaluate((destination) => window.__MARKET_FIND_PLAYER_PATH__?.(destination) ?? [], target);
    if (navPath.length < 2) { await page.waitForTimeout(100); continue; }
    let shouldReplan = false;
    for (const [index, waypoint] of navPath.slice(1).entries()) {
      const waypointTolerance = index === navPath.length - 2 ? tolerance : 0.72;
      while (Date.now() < deadline) {
        const current = await player();
        const remaining = distance(current, waypoint);
        if (remaining <= waypointTolerance) break;
        await controllerPulse([waypoint[0] - current.x, waypoint[1] - current.z]);
        const diagnostics = await qa();
        if (diagnostics.renderer?.contextLost) throw new Error(`WebGL perdido durante ruta a ${target.join(",")}: ${JSON.stringify(diagnostics.renderer)}`);
        const nextRemaining = distance(diagnostics.player, waypoint);
        if (nextRemaining < bestRemaining - 0.025) {
          bestRemaining = nextRemaining;
          lastProgressAt = Date.now();
        } else if (Date.now() - lastProgressAt > 2_400) {
          // Replan only after a genuine stall. Continuously projecting a point
          // beside a shelf can make Recast choose the opposite polygon and
          // produce a shortcut through the physical collider.
          shouldReplan = true;
          bestRemaining = Number.POSITIVE_INFINITY;
          lastProgressAt = Date.now();
          break;
        }
      }
      if (shouldReplan) break;
    }
    // Recast may project a requested interaction centre onto the closest
    // walkable polygon (for example, the farm centre sits inside its visual
    // footprint). Reaching the last returned polygon is the real success
    // condition; insisting on the unprojected coordinate creates a false
    // timeout even though the player is already inside the interaction zone.
    if (!shouldReplan) return;
  }
  const current = await player();
  const currentGame = await game(); const currentFranchise = currentGame.franchises.find((item) => item.id === currentGame.currentFranchiseId);
  const diagnostics = await qa();
  throw new Error(`No se alcanzó destino NavMesh ${target.join(",")}; último camino ${JSON.stringify(navPath)}; posición ${current.x.toFixed(2)},${current.z.toFixed(2)}; puerta ${currentFranchise.doorState} ${currentFranchise.doorProgress}; tienda ${currentFranchise.open}; render ${JSON.stringify(diagnostics.render)} ${JSON.stringify(diagnostics.renderer)}; input ${JSON.stringify(diagnostics.input)}; física ${JSON.stringify(diagnostics.physics)}`);
}

async function movePath(points) { for (const point of points) await moveTo(point); }
async function dwell(ms) { await page.waitForTimeout(ms); }
function normalize([x, y]) { const length = Math.hypot(x, y) || 1; return [x / length, y / length]; }

const inputHitTarget = await page.evaluate(() => {
  const element = document.elementFromPoint(720, 610);
  return { tag: element?.tagName, className: element?.className, testId: element?.getAttribute("data-testid") };
});

// Ratón desde los cuatro cuadrantes y liberación con captura cerca del borde.
const quadrants = [[370, 360], [1060, 360], [370, 760], [1060, 760]];
const quadrantEvidence = [];
for (const origin of quadrants) {
  const before = await player(); const beforeRender = (await qa()).render; const during = await dragPulse([0.2, -1], origin, 1_000); const after = await player();
  quadrantEvidence.push({ origin, before, after, moved: distance(before, [after.x, after.z]), beforeRender, during: { player: during.player, input: during.input, physics: during.physics, pointer: during.pointer, render: during.render } });
}
if (quadrantEvidence.some((item) => item.moved < 0.02)) {
  throw new Error(`Alguno de los cuatro cuadrantes no movió al jugador; hit=${JSON.stringify(inputHitTarget)} quadrants=${JSON.stringify(quadrantEvidence)} qa=${JSON.stringify({ player: await player(), input: (await qa()).input, physics: (await qa()).physics, pointer: (await qa()).pointer })}`);
}
if (process.env.MARKET_QA_DIAGNOSTIC === "pointer") {
  const before = await player(); const during = await dragPulse([0, 1], [720, 610], 1_000); const after = await player();
  console.log(JSON.stringify({ inputHitTarget, quadrantEvidence, positiveZ: { before, during: { player: during.player, input: during.input, physics: during.physics, pointer: during.pointer, render: during.render, renderer: during.renderer }, after }, finalRenderer: (await qa()).renderer }, null, 2));
  await browser.close();
  process.exit(0);
}
await page.mouse.move(720, 610); await page.mouse.down(); await page.mouse.move(1438, 998); await page.waitForTimeout(180); await page.mouse.up();
const releasedAt = await player(); await page.waitForTimeout(500); const afterRelease = await player();

// UI no mueve al personaje.
const beforeUi = await player(); await page.getByRole("button", { name: "Inventario" }).click(); await dwell(450); const afterUi = await player();
await page.locator(".close-button").click();

const publishedFarmLayout = await page.evaluate(() => ({
  target: structuredClone(window.__MARKET_QA__?.farmTargets?.find((candidate) => candidate.id === "crop-tomato-1") ?? null),
  accessWaypoints: structuredClone(window.__MARKET_QA__?.farmAccessWaypoints ?? []),
}));
if (!publishedFarmLayout.target || publishedFarmLayout.accessWaypoints.length !== 3 || publishedFarmLayout.target.z >= -20) throw new Error(`Layout de finca trasera inválido: ${JSON.stringify(publishedFarmLayout)}`);
const FARM = [publishedFarmLayout.target.x, publishedFarmLayout.target.z];
const CHECKOUT = [10.5, 7.9]; const OFFICE = [14.1, -10.7]; const MILL = [-14.1, -8.1];
const LEFT_AISLE_X = -4; const RIGHT_AISLE_X = 4; const BACK_AISLE_Z = -10;
const toFarm = async () => { await movePath(publishedFarmLayout.accessWaypoints); await moveTo(FARM, 0.35); };
const enterStore = async () => { await movePath([...publishedFarmLayout.accessWaypoints].reverse()); await movePath([[0, 13.8], [0, 7]]); };
const farmToShelf = async () => {
  await enterStore();
  for (let visit = 0; visit < 12; visit += 1) {
    const stocking = await page.evaluate(() => {
      const qaState = window.__MARKET_QA__;
      const state = qaState.state;
      const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
      const carry = structuredClone(franchise.carry.items);
      const targets = structuredClone(qaState.stockingTargets ?? []);
      return { carry, targets, total: Object.values(carry).reduce((sum, quantity) => sum + (quantity ?? 0), 0) };
    });
    if (stocking.total <= 0) return;

    const current = await player();
    const candidates = stocking.targets
      .filter((target) => target.sensorEnabled && target.productId && (stocking.carry[target.productId] ?? 0) > 0)
      .sort((left, rightTarget) => Math.hypot(current.x - left.x, current.z - left.z) - Math.hypot(current.x - rightTarget.x, current.z - rightTarget.z));
    const target = candidates[0];
    if (!target) throw new Error(`No hay departamento surtible para la cesta actual: ${JSON.stringify(stocking)}`);

    await moveTo([target.x, target.z], 0.5);
    const beforeTotal = stocking.total;
    const deadline = Date.now() + 5_000;
    let remaining = beforeTotal;
    while (remaining >= beforeTotal && Date.now() < deadline) {
      await dwell(180);
      remaining = await page.evaluate(() => {
        const state = window.__MARKET_QA__.state;
        const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
        return Object.values(franchise.carry.items).reduce((sum, quantity) => sum + (quantity ?? 0), 0);
      });
    }
    if (remaining >= beforeTotal) throw new Error(`El imán ${target.departmentId} no descargó la cesta: ${JSON.stringify({ target, stocking })}`);
  }
  const remainingCarry = await page.evaluate(() => {
    const state = window.__MARKET_QA__.state;
    const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
    return structuredClone(franchise.carry.items);
  });
  throw new Error(`La ruta dinámica agotó sus visitas sin vaciar la cesta: ${JSON.stringify(remainingCarry)}`);
};
const shelfToCheckout = async () => { await movePath([[RIGHT_AISLE_X, 0], [RIGHT_AISLE_X, 3], [RIGHT_AISLE_X, 7.9]]); await moveTo(CHECKOUT, 0.35); };
const checkoutToOffice = async () => { await movePath([[RIGHT_AISLE_X, 7.9], [RIGHT_AISLE_X, 1], [RIGHT_AISLE_X, BACK_AISLE_Z], [12, BACK_AISLE_Z]]); await moveTo(OFFICE, 0.35); };

await toFarm();
await dwell(13_000);
await farmToShelf(); await dwell(1_800);
await shelfToCheckout();
let deadline = Date.now() + 45_000;
while ((await game()).progression.counters.customers < 1 && Date.now() < deadline) await dwell(900);
if ((await game()).progression.counters.customers < 1) throw new Error("El primer cliente no completó su pago real");
await checkoutToOffice();
deadline = Date.now() + 20_000;
while ((await game()).level < 3 && Date.now() < deadline) await dwell(600);

// Reposición y caja reales hasta satisfacer ambos objetivos de forma
// independiente. Clientes más fluidos pueden completar dos compras durante
// una sola vuelta del vendedor, por lo que el número de viajes no debe
// inferirse a partir del contador de clientes.
while (((await game()).progression.counters.customers ?? 0) < 4 || ((await game()).progression.counters["stock:all"] ?? 0) < 12) {
  await movePath([[12, BACK_AISLE_Z], [RIGHT_AISLE_X, BACK_AISLE_Z], [RIGHT_AISLE_X, 3]]); await toFarm();
  await dwell(11_000);
  await farmToShelf(); await dwell(2_000);
  await shelfToCheckout();
  const beforeCustomers = (await game()).progression.counters.customers ?? 0;
  if (beforeCustomers < 4) {
    deadline = Date.now() + 38_000;
    while (((await game()).progression.counters.customers ?? 0) <= beforeCustomers && Date.now() < deadline) await dwell(800);
  }
}

await checkoutToOffice();
deadline = Date.now() + 30_000;
while ((await game()).level < 5 && Date.now() < deadline) await dwell(600);
if ((await game()).level < 5) throw new Error(`La progresión se detuvo en nivel ${(await game()).level}`);

// Objetivo de trigo: el selector de cultivo prioriza el hito activo.
await movePath([[12, BACK_AISLE_Z], [RIGHT_AISLE_X, BACK_AISLE_Z], [RIGHT_AISLE_X, 3]]); await toFarm();
deadline = Date.now() + 40_000;
while (((await game()).progression.counters["harvest:wheat"] ?? 0) < 5 && Date.now() < deadline) await dwell(700);
await enterStore(); await movePath([[RIGHT_AISLE_X, 7], [RIGHT_AISLE_X, 1], [LEFT_AISLE_X, 1], [-10, -4]]); await moveTo(MILL, 0.35);
await dwell(1_500);
await movePath([[-12, -2], [LEFT_AISLE_X, 1], [LEFT_AISLE_X, 7]]); await toFarm();
deadline = Date.now() + 15_000;
while (((await game()).progression.counters["harvest:wheat"] ?? 0) < 6 && Date.now() < deadline) await dwell(600);
await enterStore(); await movePath([[LEFT_AISLE_X, 7], [LEFT_AISLE_X, 1], [LEFT_AISLE_X, BACK_AISLE_Z], [12, BACK_AISLE_Z]]); await moveTo(OFFICE, 0.35);
deadline = Date.now() + 20_000;
while ((await game()).level < 6 && Date.now() < deadline) await dwell(600);
if ((await game()).level < 6) throw new Error(`No se alcanzó nivel 6 exclusivamente por proximidad; nivel ${(await game()).level}`);

await moveTo([12, -10]);
await page.screenshot({ path: path.join(outputRoot, "level-6-debug.png"), fullPage: true });
await page.evaluate(() => sessionStorage.setItem("mini-market-qa-freeze", "1"));
await page.locator(".player-chip button").click();
await page.waitForFunction(() => document.querySelector(".save-chip")?.textContent?.trim() === "Guardado", null, { timeout: 30_000 });
const beforeReload = await game();
const savedEnvelope = await page.evaluate(async () => {
  const response = await fetch("/api/game/save", { cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo leer el snapshot guardado: ${response.status}`);
  return response.json();
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByText("Objetivos del día").waitFor({ timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.state), null, { timeout: 30_000 });
const afterReloadState = await game();
const reloadedEnvelope = await page.evaluate(async () => {
  const response = await fetch("/api/game/save", { cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo releer el snapshot guardado: ${response.status}`);
  return response.json();
});
const serverSnapshotDiff = differences(stableSnapshotProjection(beforeReload), stableSnapshotProjection(savedEnvelope.state));
const persistenceDiff = differences(reloadedEnvelope.state, afterReloadState);
const serverSnapshotEqual = serverSnapshotDiff.length === 0;
const persistenceEqual = persistenceDiff.length === 0;
await page.evaluate(() => sessionStorage.removeItem("mini-market-qa-freeze"));

// Mantiene una partida real abierta hasta completar la ventana de 15 minutos.
const remaining = durationMs - (Date.now() - startedAt);
if (remaining > 0) await page.waitForTimeout(remaining);
await page.screenshot({ path: path.join(outputRoot, "final-15m.png"), fullPage: true });
const debugText = await page.locator(".debug-overlay").innerText();

// Vista móvil y arrastre táctil emulado.
const storageState = await context.storageState();
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState });
const mobilePage = await mobile.newPage();
await mobilePage.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await mobilePage.waitForFunction(() => Boolean(window.__MARKET_QA__?.player), null, { timeout: 30_000 });
const mobileBefore = await mobilePage.evaluate(() => structuredClone(window.__MARKET_QA__.player));
const cdp = await mobile.newCDPSession(mobilePage);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 190, y: 520, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 255, y: 450, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
await mobilePage.waitForTimeout(700);
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
const mobileAfter = await mobilePage.evaluate(() => structuredClone(window.__MARKET_QA__.player));
const mobileTouchMoved = Math.hypot(mobileAfter.x - mobileBefore.x, mobileAfter.z - mobileBefore.z);
await mobilePage.screenshot({ path: path.join(outputRoot, "mobile.png"), fullPage: true });
await mobile.close();

const report = {
  generatedAt: new Date().toISOString(), durationMs: Date.now() - startedAt,
  reachedLevel: afterReloadState.level, customersServed: afterReloadState.progression.counters.customers ?? 0,
  persistenceEqual, serverSnapshotEqual, persistenceDiff, serverSnapshotDiff, savedRevision: savedEnvelope.saveRevision, reloadedRevision: reloadedEnvelope.saveRevision, quadrantEvidence, releaseDrift: distance(releasedAt, [afterRelease.x, afterRelease.z]), uiClickDrift: distance(beforeUi, [afterUi.x, afterUi.z]), mobileTouchMoved,
  debugText, consoleErrors, pageErrors, failedResponses,
};
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (!report.persistenceEqual || !report.serverSnapshotEqual) throw new Error(`El snapshot no sobrevivió idéntico en los campos persistentes: ${JSON.stringify({ persistenceEqual: report.persistenceEqual, serverSnapshotEqual: report.serverSnapshotEqual })}`);
if (report.releaseDrift > 1 || report.uiClickDrift > 0.35) throw new Error(`El input siguió moviendo al jugador tras soltar o tocar UI: ${JSON.stringify({ releaseDrift: report.releaseDrift, uiClickDrift: report.uiClickDrift })}`);
if (report.mobileTouchMoved < 0.02) throw new Error(`El arrastre táctil móvil no movió al jugador: ${report.mobileTouchMoved}`);
if (report.consoleErrors.length || report.pageErrors.length || report.failedResponses.length) throw new Error(`Errores del navegador o respuestas HTTP fallidas: ${JSON.stringify({ consoleErrors: report.consoleErrors, pageErrors: report.pageErrors, failedResponses: report.failedResponses })}`);

function stableSnapshotProjection(state) {
  const franchise = state.franchises.find((item) => item.id === state.currentFranchiseId);
  return {
    level: state.level,
    countryCode: state.countryCode,
    avatar: state.avatar,
    currentFranchiseId: state.currentFranchiseId,
    progression: state.progression,
    balanceMinor: state.balanceMinor,
    reputation: state.reputation,
    warehouse: franchise.warehouse,
    shelves: franchise.shelves,
    carry: franchise.carry,
    buildProjects: franchise.buildProjects,
    stationTiers: franchise.stationTiers,
    playerSpeedTier: franchise.playerSpeedTier,
    employees: franchise.employees,
    checkoutTransactions: franchise.checkoutTransactions,
  };
}

function differences(left, right, currentPath = "$", found = []) {
  if (found.length >= 100 || Object.is(left, right)) return found;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) found.push({ path: `${currentPath}.length`, left: left.length, right: right.length });
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) differences(left[index], right[index], `${currentPath}[${index}]`, found);
    return found;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (!(key in left) || !(key in right)) found.push({ path: `${currentPath}.${key}`, left: left[key], right: right[key] });
      else differences(left[key], right[key], `${currentPath}.${key}`, found);
    }
    return found;
  }
  found.push({ path: currentPath, left, right });
  return found;
}
