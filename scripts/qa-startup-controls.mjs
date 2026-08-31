import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = process.argv.slice(2).find((argument) => !argument.startsWith("--"))
  ?? "/tmp/market-startup-controls-qa";
const reportOnly = process.argv.includes("--report-only");
const MAX_AXIS_LEAK_RATIO = 0.003;
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: [
    "--no-sandbox",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--use-angle=vulkan",
    "--enable-features=Vulkan",
    "--disable-background-timer-throttling",
  ],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];

page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
await page.addInitScript(() => {
  window.__MARKET_LOAD_LONG_TASKS__ = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__MARKET_LOAD_LONG_TASKS__.push({ startTime: entry.startTime, duration: entry.duration });
  }).observe({ type: "longtask", buffered: true });
});

const suffix = Date.now().toString(36);
await page.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Startup Controls QA");
await page.getByLabel("Nombre de usuario").fill(`startup_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`startup.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Startup-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
const setupButton = page.getByRole("button", { name: "Abrir mi primer Mini Market" });
await setupButton.waitFor({ timeout: 60_000 });

await page.evaluate(() => {
  performance.clearResourceTimings();
  window.__MARKET_GAME_LOAD_STARTED_AT__ = performance.now();
});
const loadStartedAt = Date.now();
await setupButton.click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.metrics), null, { timeout: 60_000 });
const readyMs = Date.now() - loadStartedAt;
await page.waitForTimeout(6_000);

const runtime = await page.evaluate(() => {
  const startedAt = window.__MARKET_GAME_LOAD_STARTED_AT__ ?? 0;
  const resources = performance.getEntriesByType("resource")
    .filter((entry) => entry.startTime >= startedAt)
    .map((entry) => ({
      name: new URL(entry.name).pathname,
      duration: Math.round(entry.duration * 10) / 10,
      transferSize: entry.transferSize,
      decodedBodySize: entry.decodedBodySize,
    }));
  const totalTransferBytes = resources.reduce((sum, resource) => sum + resource.transferSize, 0);
  const modelResources = resources.filter((resource) => resource.name.endsWith(".glb"));
  const longTasks = (window.__MARKET_LOAD_LONG_TASKS__ ?? []).filter((entry) => entry.startTime >= startedAt);
  return {
    resources,
    totalTransferBytes,
    modelRequests: modelResources.length,
    modelTransferBytes: modelResources.reduce((sum, resource) => sum + resource.transferSize, 0),
    longestResources: [...resources].sort((a, b) => b.duration - a.duration).slice(0, 12),
    longTasks,
    totalLongTaskMs: Math.round(longTasks.reduce((sum, task) => sum + task.duration, 0) * 10) / 10,
    metrics: structuredClone(window.__MARKET_QA__.metrics),
  };
});

const beforeRight = await playerPosition(page);
await page.keyboard.down("ArrowRight");
await page.waitForTimeout(600);
await page.keyboard.up("ArrowRight");
await page.waitForTimeout(180);
const afterRight = await playerPosition(page);
const beforeLeft = afterRight;
await page.keyboard.down("ArrowLeft");
await page.waitForTimeout(600);
await page.keyboard.up("ArrowLeft");
await page.waitForTimeout(180);
const afterLeft = await playerPosition(page);
const beforeUp = afterLeft;
await page.keyboard.down("ArrowUp");
await page.waitForTimeout(600);
await page.keyboard.up("ArrowUp");
await page.waitForTimeout(180);
const afterUp = await playerPosition(page);
const beforeDown = afterUp;
await page.keyboard.down("ArrowDown");
await page.waitForTimeout(600);
await page.keyboard.up("ArrowDown");
await page.waitForTimeout(180);
const afterDown = await playerPosition(page);

// Camera offset is [16, 23, 25.75], so its projected screen-right vector is
// perpendicular to the camera's forward XZ vector: [25.75, -16].
const screenRight = normalize({ x: 25.75, z: -16 });
const screenForward = normalize({ x: -16, z: -25.75 });
const rightDelta = subtract(afterRight, beforeRight);
const leftDelta = subtract(afterLeft, beforeLeft);
const upDelta = subtract(afterUp, beforeUp);
const downDelta = subtract(afterDown, beforeDown);
const controls = {
  rightDelta,
  leftDelta,
  upDelta,
  downDelta,
  rightScreenProjection: dot(rightDelta, screenRight),
  leftScreenProjection: dot(leftDelta, screenRight),
  rightForwardLeak: dot(rightDelta, screenForward),
  leftForwardLeak: dot(leftDelta, screenForward),
  upScreenProjection: dot(upDelta, screenForward),
  downScreenProjection: dot(downDelta, screenForward),
  upSidewaysLeak: dot(upDelta, screenRight),
  downSidewaysLeak: dot(downDelta, screenRight),
};

const reopenStartedAt = Date.now();
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.metrics), null, { timeout: 60_000 });
const reopenReadyMs = Date.now() - reopenStartedAt;
await page.waitForTimeout(1_000);
const reopen = await page.evaluate(() => {
  const resources = performance.getEntriesByType("resource").map((entry) => ({
    name: new URL(entry.name).pathname,
    duration: Math.round(entry.duration * 10) / 10,
    transferSize: entry.transferSize,
    decodedBodySize: entry.decodedBodySize,
  }));
  const longTasks = window.__MARKET_LOAD_LONG_TASKS__ ?? [];
  return {
    resourceRequests: resources.length,
    modelRequests: resources.filter((resource) => resource.name.endsWith(".glb")).length,
    totalTransferBytes: resources.reduce((sum, resource) => sum + resource.transferSize, 0),
    totalLongTaskMs: Math.round(longTasks.reduce((sum, task) => sum + task.duration, 0) * 10) / 10,
    metrics: structuredClone(window.__MARKET_QA__.metrics),
  };
});

const webgl = await page.locator("canvas").first().evaluate((canvas) => {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl ? {
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    contextLost: gl.isContextLost(),
  } : null;
});
await page.screenshot({ path: path.join(output, "game-ready.png"), fullPage: true });

const report = {
  generatedAt: new Date().toISOString(),
  readyMs,
  runtime,
  reopenReadyMs,
  reopen,
  controls,
  webgl,
  consoleErrors,
  pageErrors,
  failedResponses,
};
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (!reportOnly) {
  if (controls.rightScreenProjection <= 0.05) throw new Error(`Flecha derecha invertida: ${controls.rightScreenProjection}`);
  if (controls.leftScreenProjection >= -0.05) throw new Error(`Flecha izquierda invertida: ${controls.leftScreenProjection}`);
  if (controls.upScreenProjection <= 0.05) throw new Error(`Flecha arriba invertida: ${controls.upScreenProjection}`);
  if (controls.downScreenProjection >= -0.05) throw new Error(`Flecha abajo invertida: ${controls.downScreenProjection}`);
  if (Math.abs(controls.upSidewaysLeak) > Math.abs(controls.upScreenProjection) * MAX_AXIS_LEAK_RATIO) throw new Error(`Flecha arriba deriva lateralmente: ${JSON.stringify(controls)}`);
  if (Math.abs(controls.downSidewaysLeak) > Math.abs(controls.downScreenProjection) * MAX_AXIS_LEAK_RATIO) throw new Error(`Flecha abajo deriva lateralmente: ${JSON.stringify(controls)}`);
  if (Math.abs(controls.rightForwardLeak) > Math.abs(controls.rightScreenProjection) * MAX_AXIS_LEAK_RATIO) throw new Error(`Flecha derecha deriva longitudinalmente: ${JSON.stringify(controls)}`);
  if (Math.abs(controls.leftForwardLeak) > Math.abs(controls.leftScreenProjection) * MAX_AXIS_LEAK_RATIO) throw new Error(`Flecha izquierda deriva longitudinalmente: ${JSON.stringify(controls)}`);
  if (reopenReadyMs > 5_000) throw new Error(`La reapertura tardó demasiado: ${reopenReadyMs} ms`);
  if (!webgl?.renderer.includes("NVIDIA GeForce RTX 4080 SUPER") || webgl.contextLost) throw new Error(`La GPU esperada no está activa: ${JSON.stringify(webgl)}`);
  if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores durante QA: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);
}

async function playerPosition(targetPage) {
  return targetPage.evaluate(() => {
    const player = window.__MARKET_QA__.player;
    return { x: player.x, z: player.z };
  });
}

function subtract(a, b) { return { x: a.x - b.x, z: a.z - b.z }; }
function dot(a, b) { return a.x * b.x + a.z * b.z; }
function normalize(vector) {
  const length = Math.hypot(vector.x, vector.z) || 1;
  return { x: vector.x / length, z: vector.z / length };
}
