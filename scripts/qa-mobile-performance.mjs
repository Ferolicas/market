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
await page.getByRole("button", { name: "Abrir el supermercado" }).click();
await page.waitForFunction(() => Object.keys(window.__MARKET_QA__?.customerVisuals ?? {}).length >= 1, null, { timeout: 30_000 });

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
const mobileCustomersObserved = await page.evaluate(() => Object.keys(window.__MARKET_QA__?.customerVisuals ?? {}).length);
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
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.locator(".hud-top").waitFor({ timeout: 30_000 });
await page.locator("canvas").first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(2_000);
const mobileLayout390 = await inspectLayout(page);
await page.screenshot({ path: path.join(output, "mobile-production-390.png"), fullPage: true });

await page.setViewportSize({ width: 360, height: 800 });
await page.waitForTimeout(600);
const mobileLayout360 = await inspectLayout(page);
await page.screenshot({ path: path.join(output, "mobile-production-360.png"), fullPage: true });

await page.getByRole("button", { name: "Finanzas" }).click();
await page.locator(".management-panel").waitFor({ timeout: 10_000 });
const financePanel = await page.locator(".management-panel").evaluate((element) => {
  const rect = element.getBoundingClientRect();
  const body = element.querySelector(".management-body");
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, bodyScrollHeight: body?.scrollHeight ?? 0, bodyClientHeight: body?.clientHeight ?? 0 };
});
await page.screenshot({ path: path.join(output, "mobile-finance-360.png"), fullPage: true });

const report = { generatedAt: new Date().toISOString(), samples, medianFps, medianP95FrameMs, touchMoved, mobileCustomersObserved, webgl, mobileLayout390, mobileLayout360, financePanel, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (medianFps < 45) throw new Error(`El perfil móvil no sostuvo el mínimo de 45 FPS: ${medianFps}`);
if (touchMoved < 0.02) throw new Error(`El arrastre táctil no movió al vendedor: ${touchMoved}`);
if (mobileCustomersObserved < 1) throw new Error("La medición móvil no incluyó ningún cliente real.");
if (!webgl || webgl.contextLost) throw new Error(`WebGL móvil inestable: ${JSON.stringify(webgl)}`);
if (!mobileLayout390.withinViewport || !mobileLayout360.withinViewport || mobileLayout390.overlaps.length || mobileLayout360.overlaps.length) throw new Error(`El HUD móvil se sale o se solapa: ${JSON.stringify({ mobileLayout390, mobileLayout360 })}`);
if (mobileLayout390.visibleSaveStatus || mobileLayout360.visibleSaveStatus) throw new Error(`El estado normal de autoguardado sigue ocupando la pantalla: ${JSON.stringify({ mobileLayout390, mobileLayout360 })}`);
if (financePanel.left < 0 || financePanel.right > 360 || financePanel.top < 0 || financePanel.bottom > 800) throw new Error(`El panel financiero no cabe en móvil: ${JSON.stringify(financePanel)}`);
if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores móviles: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);

function median(values) {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

async function inspectLayout(targetPage) {
  return targetPage.evaluate(() => {
    const selectors = [".hud-top", ".mission-card", ".level-one-guide", ".quick-menu"];
    const rectangles = Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [selector, null];
      const rect = element.getBoundingClientRect();
      return [selector, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }];
    }));
    const visible = Object.entries(rectangles).filter((entry) => entry[1]);
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < visible.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < visible.length; rightIndex += 1) {
        const [leftName, left] = visible[leftIndex];
        const [rightName, right] = visible[rightIndex];
        const intersectionWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
        const intersectionHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
        if (intersectionWidth > 1 && intersectionHeight > 1) overlaps.push({ left: leftName, right: rightName, intersectionWidth, intersectionHeight });
      }
    }
    const withinViewport = visible.every(([, rect]) => rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1);
    const firstDockButton = document.querySelector(".quick-menu button");
    const saveStatus = document.querySelector(".save-chip");
    return { viewport: { width: innerWidth, height: innerHeight }, rectangles, overlaps, withinViewport, dockScrollWidth: document.querySelector(".quick-menu")?.scrollWidth ?? 0, dockClientWidth: document.querySelector(".quick-menu")?.clientWidth ?? 0, visibleSaveStatus: saveStatus ? getComputedStyle(saveStatus).visibility !== "hidden" && getComputedStyle(saveStatus).opacity !== "0" : false, firstDockButton: firstDockButton?.outerHTML ?? null };
  });
}
