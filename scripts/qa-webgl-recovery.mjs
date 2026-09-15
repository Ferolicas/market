import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:3000";
const output = process.argv[2] ?? "/tmp/market-webgl-recovery-qa";
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
const telemetry = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", async (response) => {
  if (!response.url().endsWith("/api/game/telemetry") || response.request().method() !== "POST") return;
  let body = null;
  try { body = response.request().postDataJSON(); } catch {}
  telemetry.push({ status: response.status(), name: body?.name ?? null });
});

const suffix = Date.now().toString(36);
await page.goto(`${appUrl}?debug=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("WebGL Recovery QA");
await page.getByLabel("Nombre de usuario").fill(`webgl_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`webgl.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`WebGL-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.locator("canvas").first().waitFor({ timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player), null, { timeout: 30_000 });

const navigationStartedAt = await page.evaluate(() => performance.timeOrigin);
const supported = await page.locator("canvas").first().evaluate((canvas) => {
  window.__WEBGL_RECOVERY_QA__ = { lost: 0, restored: 0 };
  canvas.addEventListener("webglcontextlost", () => { window.__WEBGL_RECOVERY_QA__.lost += 1; });
  canvas.addEventListener("webglcontextrestored", () => { window.__WEBGL_RECOVERY_QA__.restored += 1; });
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_lose_context");
  extension?.loseContext();
  return Boolean(extension);
});
if (!supported) throw new Error("WEBGL_lose_context no está disponible en este navegador de QA");
await page.waitForFunction(() => window.__WEBGL_RECOVERY_QA__?.lost >= 1, null, { timeout: 5_000 });
await page.waitForFunction(() => window.__WEBGL_RECOVERY_QA__?.restored >= 1, null, { timeout: 8_000 });
await page.waitForFunction(() => {
  const canvas = document.querySelector("canvas");
  const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
  return gl && !gl.isContextLost();
}, null, { timeout: 5_000 });
await page.waitForTimeout(1_000);

const state = await page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
  return {
    events: structuredClone(window.__WEBGL_RECOVERY_QA__),
    contextLost: gl?.isContextLost() ?? null,
    timeOrigin: performance.timeOrigin,
    hasPlayer: Boolean(window.__MARKET_QA__?.player),
  };
});
const report = {
  generatedAt: new Date().toISOString(),
  supported,
  reloaded: state.timeOrigin !== navigationStartedAt,
  state,
  telemetry,
  consoleErrors,
  unexpectedConsoleErrors: consoleErrors.filter((message) => !/context (lost|restored)/i.test(message)),
  pageErrors,
};
await page.screenshot({ path: path.join(output, "scene-after-webgl-restore.png"), fullPage: true });
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (report.reloaded || state.contextLost || !state.hasPlayer || state.events.lost !== 1 || state.events.restored !== 1) throw new Error(`La escena no se recuperó en caliente: ${JSON.stringify(report)}`);
if (!telemetry.some((event) => event.name === "context-lost" && event.status === 201) || !telemetry.some((event) => event.name === "context-restored" && event.status === 201)) throw new Error(`Falta telemetría de recuperación: ${JSON.stringify(telemetry)}`);
if (report.unexpectedConsoleErrors.length || pageErrors.length) throw new Error(`Errores inesperados: ${JSON.stringify({ consoleErrors: report.unexpectedConsoleErrors, pageErrors })}`);
