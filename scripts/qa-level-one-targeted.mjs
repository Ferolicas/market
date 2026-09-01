import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = process.argv[2] ?? "/tmp/market-level-one-targeted";
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
await page.screenshot({ path: path.join(output, "01-level-one-overview.png"), fullPage: true });

await page.waitForFunction(() => window.__MARKET_QA__?.state?.franchises?.[0]?.crops?.find((crop) => crop.id === "crop-tomato-1")?.status === "READY", null, { timeout: 15_000 });
const ready = await snapshot(page);
await page.screenshot({ path: path.join(output, "02-farm-ready.png"), fullPage: true });

const walkStartedAt = structuredClone(ready.player);
await moveTo(page, [0, 14.35], 0.55);
await page.waitForTimeout(1_100);
await moveTo(page, [0, 17.2], 0.55);
await moveTo(page, [-12, 18.8], 0.65);
await moveTo(page, [-18.9, 20.2], 0.6);
await page.waitForFunction(() => {
  const franchise = window.__MARKET_QA__?.state?.franchises?.[0];
  const crop = franchise?.crops?.find((candidate) => candidate.id === "crop-tomato-1");
  return (franchise?.carry?.items?.tomatoes ?? 0) === 3 && crop?.status === "GROWING";
}, null, { timeout: 12_000 });
const harvested = await snapshot(page);
await page.screenshot({ path: path.join(output, "03-farm-harvested.png"), fullPage: true });

await moveTo(page, [-12, 18.8], 0.7);
await moveTo(page, [0, 17.2], 0.6);
await page.waitForTimeout(1_100);
await moveTo(page, [0, 13.8], 0.55);
await moveTo(page, [-4, 7], 0.6);
await moveTo(page, [-8.2, 2.16], 0.65);
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
await page.screenshot({ path: path.join(output, "05-produce-stocked.png"), fullPage: true });

const webgl = await page.locator("canvas").first().evaluate((canvas) => {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl ? { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), contextLost: gl.isContextLost() } : null;
});
const movementDistance = Math.hypot(harvested.player.x - walkStartedAt.x, harvested.player.z - walkStartedAt.z);
const savedConfirmationVisible = await page.evaluate(() => document.body.innerText.includes("Partida guardada") || [...document.querySelectorAll(".save-chip")].some((element) => element.getAttribute("aria-hidden") !== "true" && element.textContent?.trim() === "Guardado"));
const report = { email, initial, ready, harvested, stocked, movement: { distance: movementDistance, workstationAtHarvest: harvested.workstation }, savedConfirmationVisible, webgl, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (ready.crop.status !== "READY" || ready.crop.available !== 3 || harvested.crop.status !== "GROWING" || harvested.carry.items.tomatoes !== 3 || stocked.shelves.tomatoes < initial.shelves.tomatoes + 3 || stocked.carry.total !== 0) throw new Error(`El ciclo automático de nivel 1 no se completó: ${JSON.stringify({ ready, harvested, stocked })}`);
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
  while (Date.now() < deadline) {
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
    const inputX = worldX * right[0] + worldZ * right[1];
    const inputY = -(worldX * forward[0] + worldZ * forward[1]);
    await targetPage.evaluate(({ x, y }) => window.__MARKET_SET_PLAYER_INPUT__?.(x, y), { x: inputX, y: inputY });
    await targetPage.waitForTimeout(170);
    await targetPage.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
  }
  throw new Error(`No se alcanzó el destino ${JSON.stringify(target)}: ${JSON.stringify(await targetPage.evaluate(() => window.__MARKET_QA__.player))}`);
}
