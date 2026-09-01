import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const APP_URL = process.env.MARKET_QA_URL ?? "http://localhost:3000";
const profileName = process.env.MARKET_PERF_PROFILE ?? "hardware-4x";
const enforceBudget = process.env.MARKET_PERF_ENFORCE !== "0";
const freezeWorld = process.env.MARKET_PERF_FREEZE_WORLD === "1";
const keepStoreClosed = process.env.MARKET_PERF_STORE_CLOSED === "1";
const captureCpuProfile = process.env.MARKET_PERF_CPU_PROFILE === "1";
const sampleWindows = Number.parseInt(process.env.MARKET_PERF_SAMPLE_WINDOWS ?? "24", 10);
if (!Number.isSafeInteger(sampleWindows) || sampleWindows < 8 || sampleWindows > 120) throw new Error(`MARKET_PERF_SAMPLE_WINDOWS inválido: ${sampleWindows}`);
const profiles = {
  "hardware-4x": { cpuRate: 4, softwareGpu: false },
  "hardware-6x": { cpuRate: 6, softwareGpu: false },
  "software-4x": { cpuRate: 4, softwareGpu: true },
};
const profile = profiles[profileName];
if (!profile) throw new Error(`Perfil desconocido: ${profileName}. Usa ${Object.keys(profiles).join(", ")}.`);

const output = process.argv[2] ?? `/tmp/market-mobile-render-${profileName}`;
await fs.mkdir(output, { recursive: true });
const gpuArgs = profile.softwareGpu
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"]
  : ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"];
const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-background-timer-throttling", ...gpuArgs],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__MARKET_PERF__ = { samples: [], inventory: null, frameTimes: [], longTasks: [], qualityEvents: [], shadowMode: null, touchEvents: [] };
  let previousFrame = performance.now();
  const recordFrame = (timestamp) => {
    const delta = timestamp - previousFrame;
    previousFrame = timestamp;
    if (window.__MARKET_PERF__.tracking && delta > 0) window.__MARKET_PERF__.frameTimes.push(delta);
    requestAnimationFrame(recordFrame);
  };
  requestAnimationFrame(recordFrame);
  try {
    new PerformanceObserver((list) => {
      if (!window.__MARKET_PERF__.tracking) return;
      window.__MARKET_PERF__.longTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })));
    }).observe({ type: "longtask", buffered: false });
  } catch {}
  window.__MARKET_PERF_RESET__ = () => {
    window.__MARKET_PERF__.samples = [];
    window.__MARKET_PERF__.frameTimes = [];
    window.__MARKET_PERF__.longTasks = [];
    window.__MARKET_PERF__.qualityEvents = [];
    window.__MARKET_PERF__.touchEvents = [];
    window.__MARKET_PERF__.tracking = true;
    previousFrame = performance.now();
  };
  window.addEventListener("market-debug-metrics", (event) => window.__MARKET_PERF__.samples.push(structuredClone(event.detail)));
  window.addEventListener("market-perf-inventory", (event) => { window.__MARKET_PERF__.inventory = structuredClone(event.detail); });
  window.addEventListener("market-quality-regress", (event) => window.__MARKET_PERF__.qualityEvents.push({ at: performance.now(), ...structuredClone(event.detail) }));
  window.addEventListener("market-shadow-mode", (event) => { window.__MARKET_PERF__.shadowMode = event.detail; });
  window.addEventListener("pointerdown", (event) => {
    if (window.__MARKET_PERF__.tracking) window.__MARKET_PERF__.touchEvents.push({
      type: event.type,
      at: performance.now(),
      pointerType: event.pointerType,
      target: event.target instanceof Element ? `${event.target.tagName}.${event.target.className}` : "unknown",
    });
  }, true);
});
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });

const suffix = Date.now().toString(36);
await page.goto(`${APP_URL}?perf=1${freezeWorld ? "&perf-freeze=1" : ""}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Mobile Render QA");
await page.getByLabel("Nombre de usuario").fill(`render_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`render.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Render-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.locator("canvas").first().waitFor({ timeout: 30_000 });
if (!keepStoreClosed) await page.getByRole("button", { name: "Abrir el supermercado" }).click();
await page.waitForFunction(() => window.__MARKET_PERF__?.samples.length >= 5 && window.__MARKET_PERF__?.inventory, null, { timeout: 45_000 });

const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
if (captureCpuProfile) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
}
await page.evaluate(() => { window.__MARKET_PERF__.samples = []; });
await page.waitForTimeout(4_000);
if (captureCpuProfile) await cdp.send("Profiler.start");
await page.evaluate(() => window.__MARKET_PERF_RESET__());
const canvasBox = await page.locator("canvas").first().boundingBox();
if (canvasBox) await page.touchscreen.tap(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.52);
await page.waitForFunction((minimum) => window.__MARKET_PERF__.samples.length >= minimum, sampleWindows, { timeout: 120_000 });
const cpuProfile = captureCpuProfile ? (await cdp.send("Profiler.stop")).profile : null;

const samples = await page.evaluate((minimum) => structuredClone(window.__MARKET_PERF__.samples.slice(-minimum)), sampleWindows);
const inventory = await page.evaluate(() => structuredClone(window.__MARKET_PERF__.inventory));
const frameTimes = await page.evaluate(() => structuredClone(window.__MARKET_PERF__.frameTimes));
const longTasks = await page.evaluate(() => structuredClone(window.__MARKET_PERF__.longTasks));
const qualityEvents = await page.evaluate(() => structuredClone(window.__MARKET_PERF__.qualityEvents));
const shadowMode = await page.evaluate(() => window.__MARKET_PERF__.shadowMode);
const touchEvents = await page.evaluate(() => structuredClone(window.__MARKET_PERF__.touchEvents));
const webgl = await page.locator("canvas").first().evaluate((canvas) => {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl ? {
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
    contextLost: gl.isContextLost(),
  } : null;
});
const summary = summarize(samples, frameTimes, longTasks);
await page.screenshot({ path: path.join(output, `${profileName}.png`), fullPage: true });
const report = {
  generatedAt: new Date().toISOString(),
  profile: { name: profileName, ...profile, freezeWorld, keepStoreClosed, sampleWindows, viewport: page.viewportSize(), deviceScaleFactor: 2 },
  enforceBudget,
  budget: budgetFor(profileName),
  summary,
  samples,
  frameTimes,
  longTasks,
  qualityEvents,
  shadowMode,
  touchEvents,
  inventory,
  webgl,
  consoleErrors,
  pageErrors,
  failedResponses,
};
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
if (cpuProfile) await fs.writeFile(path.join(output, "cpu-profile.json"), JSON.stringify(cpuProfile));
await browser.close();
console.log(JSON.stringify({
  generatedAt: report.generatedAt,
  profile: report.profile,
  budget: report.budget,
  summary: report.summary,
  inventory: report.inventory,
  webgl: report.webgl,
  qualityRegressions: report.qualityEvents.length,
  shadowMode: report.shadowMode,
  touchEvents: report.touchEvents,
  errors: { console: report.consoleErrors, page: report.pageErrors, responses: report.failedResponses },
  reportPath: path.join(output, "report.json"),
}, null, 2));

const budget = report.budget;
if (enforceBudget && (summary.medianFps < budget.minMedianFps || summary.p95FrameMs > budget.maxP95FrameMs || summary.medianDrawCalls > budget.maxDrawCalls || summary.medianTriangles > budget.maxTriangles || summary.maxTextures > budget.maxTextures || summary.maxPrograms > budget.maxPrograms)) {
  throw new Error(`Presupuesto ${profileName} incumplido: ${JSON.stringify({ budget, summary })}`);
}
if (!webgl || webgl.contextLost) throw new Error(`WebGL inestable: ${JSON.stringify(webgl)}`);
if (profile.softwareGpu && !/swiftshader/i.test(webgl.renderer)) throw new Error(`El proxy GPU software no quedó activo: ${webgl.renderer}`);
if (!touchEvents.some((event) => event.pointerType === "touch")) throw new Error(`El canvas no recibió input táctil real: ${JSON.stringify(touchEvents)}`);
if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores durante QA: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);

function summarize(values, measuredFrameTimes, measuredLongTasks) {
  const fps = values.map((sample) => sample.fps);
  const drawCalls = values.map((sample) => sample.drawCalls);
  const triangles = values.map((sample) => sample.triangles);
  return {
    medianFps: median(fps),
    p95FrameMs: percentile(measuredFrameTimes, 0.95),
    maxFrameMs: Math.max(0, ...measuredFrameTimes),
    measuredFrames: measuredFrameTimes.length,
    longTaskCount: measuredLongTasks.length,
    maxLongTaskMs: Math.max(0, ...measuredLongTasks.map((entry) => entry.duration)),
    medianDrawCalls: median(drawCalls),
    maxDrawCalls: Math.max(...drawCalls),
    medianTriangles: median(triangles),
    maxTriangles: Math.max(...triangles),
    maxTextures: Math.max(...values.map((sample) => sample.textures)),
    maxPrograms: Math.max(...values.map((sample) => sample.programs)),
  };
}

function budgetFor(name) {
  if (name === "hardware-4x") return { minMedianFps: 30, maxP95FrameMs: 55, maxDrawCalls: 420, maxTriangles: 330_000, maxTextures: 70, maxPrograms: 100 };
  if (name === "hardware-6x") return { minMedianFps: 24, maxP95FrameMs: 75, maxDrawCalls: 420, maxTriangles: 330_000, maxTextures: 70, maxPrograms: 100 };
  return { minMedianFps: 18, maxP95FrameMs: 110, maxDrawCalls: 420, maxTriangles: 330_000, maxTextures: 70, maxPrograms: 100 };
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function percentile(values, quantile) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * quantile))] ?? 0;
}
