import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = process.argv[2] ?? "/tmp/market-mobile-performance-qa";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const consoleErrors = []; const pageErrors = []; const failedResponses = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
const suffix = Date.now().toString(36);
await page.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Mobile Performance QA");
await page.getByLabel("Nombre de usuario").fill(`mobile_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`mobile.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Mobile-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.metrics), null, { timeout: 30_000 });

await page.waitForTimeout(5_000);
const samples = [];
for (let index = 0; index < 10; index += 1) {
  await page.waitForTimeout(1_000);
  samples.push(await page.evaluate(() => structuredClone(window.__MARKET_QA__.metrics)));
}
const before = await page.evaluate(() => structuredClone(window.__MARKET_QA__.player));
const cdp = await context.newCDPSession(page);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 190, y: 520, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 255, y: 450, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
await page.waitForTimeout(700);
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
const after = await page.evaluate(() => structuredClone(window.__MARKET_QA__.player));
const touchMoved = Math.hypot(after.x - before.x, after.z - before.z);
const fps = samples.map((sample) => sample.fps).sort((a, b) => a - b);
const p95 = samples.map((sample) => sample.p95FrameMs).sort((a, b) => a - b);
const medianFps = median(fps);
const medianP95FrameMs = median(p95);
const webgl = await page.locator("canvas").first().evaluate((canvas) => {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl ? { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), contextLost: gl.isContextLost() } : null;
});
await page.screenshot({ path: path.join(output, "mobile-stable.png"), fullPage: true });
const report = { generatedAt: new Date().toISOString(), samples, medianFps, medianP95FrameMs, touchMoved, webgl, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (medianFps < 45) throw new Error(`El perfil móvil no sostuvo el mínimo de 45 FPS: ${medianFps}`);
if (touchMoved < 0.02) throw new Error(`El arrastre táctil no movió al vendedor: ${touchMoved}`);
if (!webgl || webgl.contextLost) throw new Error(`WebGL móvil inestable: ${JSON.stringify(webgl)}`);
if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores móviles: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);

function median(values) {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}
