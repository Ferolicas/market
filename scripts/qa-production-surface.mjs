import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4011";
const output = process.argv[2] ?? "/tmp/market-production-surface";
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
await page.addInitScript(() => {
  window.__MARKET_PUBLIC_PROBE__ = { metricEvents: 0, qualityEvents: 0 };
  window.addEventListener("market-debug-metrics", () => { window.__MARKET_PUBLIC_PROBE__.metricEvents += 1; });
  window.addEventListener("market-quality-regress", () => { window.__MARKET_PUBLIC_PROBE__.qualityEvents += 1; });
});

const suffix = Date.now().toString(36);
await page.goto(`${appUrl}?debug=1&perf=1&perf-freeze=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Production Surface QA");
await page.getByLabel("Nombre de usuario").fill(`prod_surface_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`prod.surface.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Production-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.locator("canvas").first().waitFor({ timeout: 30_000 });
await page.locator(".hud-stat.earnings").waitFor({ timeout: 30_000 });

const clockBefore = await page.locator(".hud-stat.earnings").innerText();
await page.waitForTimeout(6_200);
const clockAfter = await page.locator(".hud-stat.earnings").innerText();
const runtimeSurface = await page.evaluate(() => ({
  hasQaHook: Object.prototype.hasOwnProperty.call(window, "__MARKET_QA__"),
  hasPathHook: Object.prototype.hasOwnProperty.call(window, "__MARKET_FIND_PLAYER_PATH__"),
  metricEvents: window.__MARKET_PUBLIC_PROBE__.metricEvents,
  qualityEvents: window.__MARKET_PUBLIC_PROBE__.qualityEvents,
}));
const debugOverlayCount = await page.locator(".debug-overlay").count();
const serviceWorkerSource = await page.evaluate(async () => {
  const response = await fetch("/sw.js", { cache: "no-store" });
  if (!response.ok) throw new Error(`GET /sw.js ${response.status}`);
  return response.text();
});
await page.screenshot({ path: path.join(output, "public-production.png"), fullPage: true });

const report = {
  generatedAt: new Date().toISOString(),
  appUrl,
  hostileQuery: "debug=1&perf=1&perf-freeze=1",
  runtimeSurface,
  debugOverlayCount,
  simulationAdvanced: clockBefore !== clockAfter,
  clockBefore,
  clockAfter,
  serviceWorkerCacheV8: serviceWorkerSource.includes("mini-market-v8"),
  consoleErrors,
  pageErrors,
  failedResponses,
};
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (runtimeSurface.hasQaHook || runtimeSurface.hasPathHook || runtimeSurface.metricEvents || runtimeSurface.qualityEvents || debugOverlayCount) {
  throw new Error(`El build público expuso superficie QA: ${JSON.stringify({ runtimeSurface, debugOverlayCount })}`);
}
if (!report.simulationAdvanced) throw new Error(`perf-freeze detuvo indebidamente el build público: ${JSON.stringify({ clockBefore, clockAfter })}`);
if (!report.serviceWorkerCacheV8) throw new Error("El service worker público no usa mini-market-v8.");
if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores durante QA pública: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);
