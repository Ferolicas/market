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
if (initial.level !== 1 || initial.crop.status !== "EMPTY") throw new Error(`El inicio no es nivel 1 con parcela vacía: ${JSON.stringify(initial)}`);
if (initial.shelves.eggs !== 6 || initial.shelves.milk !== 8 || initial.shelves.apples !== 8) throw new Error(`Los departamentos iniciales no tienen surtido visual: ${JSON.stringify(initial.shelves)}`);
await page.screenshot({ path: path.join(output, "01-level-one-overview.png"), fullPage: true });

await moveTo(page, [0, 14.35], 0.55);
await page.waitForTimeout(1_100);
await moveTo(page, [0, 17.2], 0.55);
await moveTo(page, [-7, 19.2], 0.65);
await moveToWorkstation(page, [-8.1, 21.3], "farm");
await page.waitForFunction(() => window.__MARKET_QA__?.workstation?.zoneId === "farm" && window.__MARKET_QA__.workstation.locked === true, null, { timeout: 10_000 });
await page.waitForFunction(() => window.__MARKET_QA__?.state?.franchises?.[0]?.crops?.[0]?.status === "GROWING", null, { timeout: 10_000 });
const stationarySamples = [];
for (let sample = 0; sample < 10; sample++) {
  stationarySamples.push(await page.evaluate(() => structuredClone(window.__MARKET_QA__.player)));
  await page.waitForTimeout(55);
}
const stationaryDrift = Math.max(...stationarySamples.map((sample) => Math.hypot(sample.x - stationarySamples[0].x, sample.z - stationarySamples[0].z)));
const growing = await snapshot(page);
await page.screenshot({ path: path.join(output, "02-farm-growing.png"), fullPage: true });

await page.waitForFunction(() => window.__MARKET_QA__?.state?.franchises?.[0]?.carry?.item?.productId === "tomatoes" && window.__MARKET_QA__.state.franchises[0].carry.item.quantity === 3, null, { timeout: 30_000 });
const harvested = await snapshot(page);
await page.screenshot({ path: path.join(output, "03-farm-harvested.png"), fullPage: true });

await moveTo(page, [-7, 19.2], 0.7);
await moveTo(page, [0, 17.2], 0.6);
await page.waitForTimeout(1_100);
await moveTo(page, [0, 13.8], 0.55);
await moveTo(page, [-4, 7], 0.6);
await moveToWorkstation(page, [-8.2, 2.16], "shelf");
await page.waitForFunction(() => window.__MARKET_QA__?.state?.franchises?.[0]?.shelves?.tomatoes >= 3 && window.__MARKET_QA__.state.franchises[0].carry.item === null, null, { timeout: 12_000 });
await page.waitForTimeout(700);
const stocked = await snapshot(page);
await page.screenshot({ path: path.join(output, "04-produce-stocked.png"), fullPage: true });

const webgl = await page.locator("canvas").first().evaluate((canvas) => {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl ? { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), contextLost: gl.isContextLost() } : null;
});
const report = { email, initial, growing, harvested, stocked, workstation: { stationaryDrift, stationarySamples }, webgl, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (growing.crop.status !== "GROWING" || harvested.carry?.quantity !== 3 || stocked.shelves.tomatoes < 3 || stocked.carry !== null) throw new Error(`El ciclo de nivel 1 no se completó: ${JSON.stringify({ growing, harvested, stocked })}`);
if (!growing.workstation?.locked || growing.workstation.zoneId !== "farm" || stationaryDrift > 0.01 || stationarySamples.some((sample) => sample.speed > 0.01)) throw new Error(`El vendedor se mueve durante la acción: ${JSON.stringify({ growing: growing.workstation, stationaryDrift, stationarySamples })}`);
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
      carry: structuredClone(franchise.carry.item),
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

async function moveToWorkstation(targetPage, target, zoneId, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await targetPage.evaluate(() => ({ player: structuredClone(window.__MARKET_QA__.player), workstation: structuredClone(window.__MARKET_QA__.workstation) }));
    if (snapshot.workstation?.zoneId === zoneId && snapshot.workstation.locked) {
      await targetPage.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__?.(0, 0));
      return;
    }
    const route = await targetPage.evaluate((destination) => window.__MARKET_FIND_PLAYER_PATH__?.(destination) ?? [], target);
    const next = route[1] ?? target;
    const dx = next[0] - snapshot.player.x;
    const dz = next[1] - snapshot.player.z;
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
  }
  throw new Error(`No se activó el puesto ${zoneId}: ${JSON.stringify(await targetPage.evaluate(() => window.__MARKET_QA__))}`);
}
