import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputRoot = process.argv[2] ?? "/tmp/market-30-clients-qa";
await fs.mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({
  headless: process.env.MARKET_QA_HEADFUL !== "1",
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = []; const pageErrors = []; const failedResponses = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });

const suffix = Date.now().toString(36);
await page.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Thirty Customer QA");
await page.getByLabel("Nombre de usuario").fill(`thirty_qa_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`thirty.qa.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Thirty-QA-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.saveRevision), null, { timeout: 30_000 });
// Freeze first and flush the real store.  Otherwise pagehide performs a
// legitimate save during reload and overwrites the synthetic recovery fixture
// before loadGame can select it.
await page.evaluate(() => sessionStorage.setItem("mini-market-qa-freeze", "1"));
await page.locator(".player-chip button").click();
await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "saved", null, { timeout: 30_000 });
await page.evaluate(() => {
  const qa = structuredClone(window.__MARKET_QA__);
  const state = qa.state;
  const franchise = state.franchises.find((item) => item.id === state.currentFranchiseId);
  const base = franchise.customers[0] ?? {
    id: "qa-base", identity: 1, state: "WAIT_CHECKOUT", shoppingList: [{ productId: "tomatoes", requested: 1, picked: 1 }], currentLine: 1,
    basket: { tomatoes: 1 }, patienceMs: 30_000, waitingSince: null, queueSlot: 0, queueLane: 0, queueJoinedAt: state.simulationTimeMs,
    transactionId: null, x: 0, z: 0, targetX: 0, targetZ: 0, path: [], pathIndex: 0, speed: 1.35, currentSpeed: 0,
    stateSince: state.simulationTimeMs, reservedSocketId: null, blockedSince: null, routeFailures: 0,
  };
  state.level = 30;
  state.revision += 10_000;
  state.progression.completedLevels = Array.from({ length: 29 }, (_, index) => index + 1);
  franchise.open = true;
  franchise.doorState = "OPEN";
  franchise.doorProgress = 1;
  for (const area of ["checkout-2", "bread-oven", "flour-mill", "cheese-maker", "juice-machine", "chicken-coop", "cow-station", "endcap-display"]) {
    if (!franchise.unlockedAreas.includes(area)) franchise.unlockedAreas.push(area);
  }
  const employeeFixtures = [
    ["farmer", "red-panda", -5.3, 3.6],
    ["operator", "red-fox", -4.8, -0.9],
    ["stocker", "chicken", 0, -2.2],
    ["cashier", "owl", 4.7, 2.2],
  ];
  franchise.employees = employeeFixtures.map(([role, hat, x, z], index) => ({
    id: `qa-employee-${index + 1}`, name: `QA ${role}`, role, level: 3, salaryMinor: 1_000, energy: 100, hat,
    runtime: { state: "IDLE", assignedProduct: null, assignedStationId: null, carry: { capacity: 4, items: {} }, x, z, targetX: x, targetZ: z, path: [], pathIndex: 0, speed: 1.66, currentSpeed: 0, stateSince: state.simulationTimeMs },
  }));
  franchise.customers = Array.from({ length: 30 }, (_, index) => ({
    ...base,
    id: `qa-customer-${index + 1}`,
    identity: index % 6 + 1,
    state: "WAIT_CHECKOUT",
    queueSlot: index,
    queueLane: index % 2,
    queueJoinedAt: state.simulationTimeMs + index,
    transactionId: null,
    x: -4.5 + index % 6 * 1.7,
    z: -5.5 + Math.floor(index / 6) * 1.8,
    targetX: -4.5 + index % 6 * 1.7,
    targetZ: -5.5 + Math.floor(index / 6) * 1.8,
    path: [],
    pathIndex: 0,
    basket: { tomatoes: 1 },
  }));
  franchise.queueCustomerIds = franchise.customers.map((customer) => customer.id);
  franchise.nextCustomerSequence = 31;
  localStorage.setItem("mini-market-recovery-v1", JSON.stringify({ state, saveRevision: qa.saveRevision, pendingEvents: [] }));
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => window.__MARKET_QA__?.state?.franchises?.find((item) => item.id === window.__MARKET_QA__.state.currentFranchiseId)?.customers?.length >= 30, null, { timeout: 30_000 });
await page.waitForTimeout(12_000);
const qa = await page.evaluate(() => structuredClone(window.__MARKET_QA__));
const debugText = await page.locator(".debug-overlay").innerText();
const webgl = await page.locator("canvas").first().evaluate((canvas) => {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl ? { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), contextLost: gl.isContextLost() } : null;
});
await page.screenshot({ path: path.join(outputRoot, "30-clients-performance.png"), fullPage: true });
const franchise = qa.state.franchises.find((item) => item.id === qa.state.currentFranchiseId);
const report = { generatedAt: new Date().toISOString(), customers: franchise.customers.length, employees: franchise.employees.length, metrics: qa.metrics, renderer: qa.renderer, debugText, webgl, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (report.customers < 30) throw new Error(`La escena de estrés solo conservó ${report.customers} clientes`);
if (report.employees < 4) throw new Error(`La escena de estrés solo cargó ${report.employees} empleados`);
if (!report.metrics || report.metrics.fps < 55) throw new Error(`El perfil de escritorio no sostuvo 60 FPS: ${JSON.stringify(report.metrics)}`);
if (!report.webgl || report.webgl.contextLost || report.renderer?.contextLost) throw new Error(`WebGL no permaneció estable: ${JSON.stringify({ webgl: report.webgl, renderer: report.renderer })}`);
if (report.consoleErrors.length || report.pageErrors.length || report.failedResponses.length) throw new Error(`Errores durante el estrés: ${JSON.stringify({ consoleErrors: report.consoleErrors, pageErrors: report.pageErrors, failedResponses: report.failedResponses })}`);
