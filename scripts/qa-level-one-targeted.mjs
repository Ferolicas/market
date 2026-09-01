import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = process.argv[2] ?? "/tmp/market-level-one-targeted";
const mobile = process.env.MARKET_QA_MOBILE === "1";
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });

const suffix = Date.now().toString(36);
const email = `level.one.qa.${suffix}@example.test`;
await page.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Nivel Uno QA");
await page.getByLabel("Nombre de usuario").fill(`level_one_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(email);
await page.getByLabel("Contraseña").fill(`Level-One-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
const setupButton = page.getByRole("button", { name: "Abrir mi primer Mini Market" });
await setupButton.waitFor({ timeout: 60_000 });
await setupButton.click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.state), null, { timeout: 60_000 });
await page.waitForTimeout(1_500);

const initial = await snapshot(page);
if (initial.level !== 1 || !["GROWING", "READY"].includes(initial.crop.status)) throw new Error(`El inicio no es nivel 1 con cultivo automático: ${JSON.stringify(initial)}`);
if (initial.shelves.eggs !== 6 || initial.shelves.milk !== 8 || initial.shelves.apples !== 8) throw new Error(`Los departamentos iniciales no tienen surtido visual: ${JSON.stringify(initial.shelves)}`);
if (initial.player.basketMounted || initial.player.basketUnits !== 0) throw new Error(`La cesta vacía aparece como accesorio permanente: ${JSON.stringify(initial.player)}`);
await page.screenshot({ path: path.join(output, "01-level-one-overview.png"), fullPage: true });

await page.waitForFunction(() => window.__MARKET_QA__?.state?.franchises?.[0]?.crops?.find((crop) => crop.id === "crop-tomato-1")?.status === "READY", null, { timeout: 15_000 });
const ready = await snapshot(page);
const farmLayout = await page.evaluate(() => ({
  target: structuredClone(window.__MARKET_QA__?.farmTargets?.find((candidate) => candidate.id === "crop-tomato-1") ?? null),
  accessWaypoints: structuredClone(window.__MARKET_QA__?.farmAccessWaypoints ?? []),
}));
if (!farmLayout.target || farmLayout.accessWaypoints.length !== 3) throw new Error(`No se publicó el layout navegable de la finca: ${JSON.stringify(farmLayout)}`);
if (farmLayout.target.z >= -20) throw new Error(`El cultivo sigue en fachada/calle en vez de detrás del edificio: ${JSON.stringify(farmLayout.target)}`);
const plannedFarmPath = await page.evaluate((target) => window.__MARKET_FIND_PLAYER_PATH__?.([target.x, target.z]) ?? [], farmLayout.target);
if (!plannedFarmPath.some(([x]) => x > 23.1)) throw new Error(`La ruta no usa el pasillo exterior lateral: ${JSON.stringify(plannedFarmPath)}`);
if (plannedFarmPath.some(([x, z]) => Math.abs(x) < 22.8 && z < -16.4 && z > -17.45)) throw new Error(`La ruta atraviesa la pared trasera: ${JSON.stringify(plannedFarmPath)}`);

const walkStartedAt = structuredClone(ready.player);
for (const waypoint of farmLayout.accessWaypoints) await moveTo(page, waypoint, 0.55);
// Leave enough approach margin for T1 braking distance; otherwise a mobile
// frame can coast into the magnet before the measured pass begins.
const harvestPassStart = [farmLayout.target.x + 4.5, farmLayout.target.z];
const harvestPassEnd = [farmLayout.target.x - 4.5, farmLayout.target.z];
await moveTo(page, harvestPassStart, 0.45);
const beforeHarvestPass = await snapshot(page);
if (beforeHarvestPass.crop.status !== "READY" || beforeHarvestPass.carry.total !== 0) throw new Error(`La aproximación entró al sensor antes de la pasada medida: ${JSON.stringify(beforeHarvestPass)}`);
await page.screenshot({ path: path.join(output, "02-farm-ready.png"), fullPage: true });
const harvestCompletionBaseline = await page.evaluate(() => window.__MARKET_QA__?.harvestBurstCompletions?.length ?? 0);
const harvestPass = await moveTo(page, harvestPassEnd, 1.1);
try {
  await page.waitForFunction((previousPlantedAt) => {
    const franchise = window.__MARKET_QA__?.state?.franchises?.[0];
    const crop = franchise?.crops?.find((candidate) => candidate.id === "crop-tomato-1");
    return (franchise?.carry?.items?.tomatoes ?? 0) === 3 && crop?.plantedAt > previousPlantedAt && ["GROWING", "READY"].includes(crop?.status);
  }, ready.crop.plantedAt, { timeout: 12_000 });
} catch (error) {
  throw new Error(`La pasada T1 no agotó el bancal: ${JSON.stringify(await snapshot(page))}; pass=${JSON.stringify(harvestPass)}`, { cause: error });
}
try {
  await page.waitForFunction((baseline) => (window.__MARKET_QA__?.harvestBurstCompletions?.length ?? 0) >= baseline + 1, harvestCompletionBaseline, { timeout: 5_000 });
} catch (error) {
  const flightDiagnostics = await page.evaluate(() => ({
    mounted: structuredClone(window.__MARKET_QA__?.harvestBursts ?? []),
    completed: structuredClone(window.__MARKET_QA__?.harvestBurstCompletions ?? []),
    player: structuredClone(window.__MARKET_QA__?.player ?? null),
  }));
  throw new Error(`Los vuelos magnéticos no terminaron: ${JSON.stringify(flightDiagnostics)}`, { cause: error });
}
const harvestFlights = await page.evaluate((baseline) => ({
  mounted: structuredClone((window.__MARKET_QA__?.harvestBursts ?? []).filter((burst) => burst.cropId === "crop-tomato-1").slice(-1)),
  completed: structuredClone((window.__MARKET_QA__?.harvestBurstCompletions ?? []).slice(baseline).filter((burst) => burst.cropId === "crop-tomato-1")),
}), harvestCompletionBaseline);
const harvested = await snapshot(page);
if (!harvested.player.basketMounted || harvested.player.basketUnits !== 3) throw new Error(`La cesta no apareció con el primer lote cosechado: ${JSON.stringify(harvested.player)}`);
await page.screenshot({ path: path.join(output, "03-farm-harvested.png"), fullPage: true });

for (const waypoint of [...farmLayout.accessWaypoints].reverse()) await moveTo(page, waypoint, 0.6);
await moveTo(page, [0, 13.8], 0.55);
await moveTo(page, [-4, 7], 0.6);
await page.waitForFunction(() => window.__MARKET_QA__?.stockingTarget?.sensorEnabled && window.__MARKET_QA__?.stockingTarget?.productId === "tomatoes", null, { timeout: 5_000 });
const stockingTarget = await page.evaluate(() => structuredClone(window.__MARKET_QA__.stockingTarget));
await moveTo(page, [stockingTarget.x, stockingTarget.z], 0.65);
try {
  await page.waitForFunction((before) => window.__MARKET_QA__?.state?.franchises?.[0]?.shelves?.tomatoes > before && !(window.__MARKET_QA__.state.franchises[0].carry.items?.tomatoes > 0), initial.shelves.tomatoes, { timeout: 12_000 });
} catch (error) {
  const diagnostics = await snapshot(page);
  await page.screenshot({ path: path.join(output, "04-stock-failure.png"), fullPage: true });
  throw new Error(`No se completó el surtido automático: ${JSON.stringify(diagnostics)}`, { cause: error });
}
await page.screenshot({ path: path.join(output, "04-produce-stock-flight.png"), fullPage: true });
await page.waitForTimeout(700);
const stocked = await snapshot(page);
if (stocked.player.basketMounted || stocked.player.basketUnits !== 0) throw new Error(`La cesta no desapareció al surtir la última unidad: ${JSON.stringify(stocked.player)}`);
await page.screenshot({ path: path.join(output, "05-produce-stocked.png"), fullPage: true });

const webgl = await page.locator("canvas").first().evaluate((canvas) => {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl ? { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), contextLost: gl.isContextLost() } : null;
});
const movementDistance = Math.hypot(harvested.player.x - walkStartedAt.x, harvested.player.z - walkStartedAt.z);
const savedConfirmationVisible = await page.evaluate(() => document.body.innerText.includes("Partida guardada") || [...document.querySelectorAll(".save-chip")].some((element) => element.getAttribute("aria-hidden") !== "true" && element.textContent?.trim() === "Guardado"));
const report = { email, viewport: mobile ? "mobile-390x844@2" : "desktop-1440x1000", initial, ready, farmLayout, plannedFarmPath, beforeHarvestPass, harvestPass, harvestFlights, harvested, stockingTarget, stocked, movement: { distance: movementDistance, workstationAtHarvest: harvested.workstation }, savedConfirmationVisible, webgl, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (ready.crop.status !== "READY" || ready.crop.available !== 3 || !["GROWING", "READY"].includes(harvested.crop.status) || harvested.crop.plantedAt <= ready.crop.plantedAt || harvested.carry.items.tomatoes !== 3 || stocked.shelves.tomatoes < initial.shelves.tomatoes + 3 || stocked.carry.total !== 0) throw new Error(`El ciclo automático de nivel 1 no se completó: ${JSON.stringify({ ready, harvested, stocked })}`);
if (Math.abs(harvestPass.maxSpeedCap - 6.6) > 0.01 || harvestPass.maxSpeed < 6.45) throw new Error(`La pasada de cosecha no reprodujo T1=6.6: ${JSON.stringify(harvestPass)}`);
if (harvestFlights.mounted.length !== 1 || harvestFlights.mounted[0].visualUnits !== 3 || harvestFlights.completed.length !== 1 || harvestFlights.completed[0].sequence !== harvestFlights.mounted[0].sequence) throw new Error(`Los tres tomates no completaron un único lote visual: ${JSON.stringify(harvestFlights)}`);
if (movementDistance < 8 || harvested.workstation?.locked) throw new Error(`La cosecha no conservó el movimiento libre: ${JSON.stringify({ movementDistance, workstation: harvested.workstation })}`);
if (savedConfirmationVisible) throw new Error("La confirmación permanente de partida guardada sigue visible.");
if (!webgl?.renderer.includes("NVIDIA GeForce RTX 4080 SUPER") || webgl.contextLost) throw new Error(`GPU incorrecta: ${JSON.stringify(webgl)}`);
if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores de navegador: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);

async function snapshot(targetPage) {
  return targetPage.evaluate(() => {
    const state = window.__MARKET_QA__.state;
    const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
    return {
      level: state.level,
      guide: document.querySelector(".level-one-guide")?.textContent ?? null,
      crop: structuredClone(franchise.crops.find((candidate) => candidate.productId === "tomatoes")),
      carry: {
        capacity: franchise.carry.capacity,
        items: structuredClone(franchise.carry.items),
        total: Object.values(franchise.carry.items).reduce((sum, quantity) => sum + (quantity ?? 0), 0),
      },
      shelves: structuredClone(franchise.shelves),
      activeZones: structuredClone(window.__MARKET_QA__.activeZones ?? []),
      workstation: structuredClone(window.__MARKET_QA__.workstation ?? null),
      player: structuredClone(window.__MARKET_QA__.player ?? null),
    };
  });
}

async function moveTo(targetPage, target, tolerance, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs;
  let maxSpeed = 0;
  let maxSpeedCap = 0;
  while (Date.now() < deadline) {
    const current = await targetPage.evaluate(() => structuredClone(window.__MARKET_QA__.player));
    maxSpeed = Math.max(maxSpeed, current.speed ?? 0);
    maxSpeedCap = Math.max(maxSpeedCap, current.speedCap ?? 0);
    if (Math.hypot(current.x - target[0], current.z - target[1]) <= tolerance) {
      await targetPage.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
      return { maxSpeed, maxSpeedCap, destination: target, arrived: [current.x, current.z] };
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
  throw new Error(`No se alcanzó el destino ${JSON.stringify(target)}: ${JSON.stringify(await targetPage.evaluate(() => window.__MARKET_QA__.player))}`);
}
