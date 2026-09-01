import fs from "node:fs/promises";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { chromium } from "playwright";

const outputRoot = process.argv.slice(2).find((argument) => argument !== "--" && !argument.startsWith("--")) ?? "/tmp/market-character-lod-cart-qa";
const forcedTier = Number(process.env.MARKET_QA_CHARACTER_TIER ?? 0);
const previewModel = process.env.MARKET_QA_PREVIEW_MODEL;
await fs.mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
if (previewModel) {
  const previewPath = path.resolve(process.cwd(), "public", "models", "market", previewModel);
  const emptyAccessoryDocument = new Document();
  emptyAccessoryDocument.createScene("QA empty accessory");
  const emptyAccessory = Buffer.from(await new NodeIO().writeBinary(emptyAccessoryDocument));
  await page.route(/\/models\/market\/characters\/lod[12]\/owner_man\.glb$/u, (route) => route.fulfill({ path: previewPath, contentType: "model/gltf-binary" }));
  await page.route(/\/models\/market\/hair\/.*\.glb$/u, (route) => route.fulfill({ body: emptyAccessory, contentType: "model/gltf-binary" }));
}
if (forcedTier === 2) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { configurable: true, get: () => 2 });
    Object.defineProperty(Navigator.prototype, "deviceMemory", { configurable: true, get: () => 2 });
  });
}
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];
const modelResponses = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => {
  const pathname = new URL(response.url()).pathname;
  if (pathname.includes("/models/market/characters/") || pathname.includes("/models/market/customers/")) modelResponses.push({ pathname, status: response.status() });
  if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() });
});

const suffix = Date.now().toString(36);
await page.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Character Mobile QA");
await page.getByLabel("Nombre de usuario").fill(`char_mobile_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`char.mobile.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Character-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
const avatarPreview = page.locator(".avatar-preview-3d");
await avatarPreview.scrollIntoViewIfNeeded();
await avatarPreview.locator("canvas").waitFor({ timeout: 30_000 });
await page.waitForTimeout(1_200);
await avatarPreview.screenshot({ path: path.join(outputRoot, "mobile-lod-owner.png") });
const previewBox = await avatarPreview.boundingBox();
if (previewBox) {
  await page.mouse.move(previewBox.x + previewBox.width * 0.5, previewBox.y + previewBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(previewBox.x + previewBox.width * 0.88, previewBox.y + previewBox.height * 0.5, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await avatarPreview.screenshot({ path: path.join(outputRoot, "mobile-lod-owner-side.png") });
}
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player), null, { timeout: 30_000 });
await page.getByRole("button", { name: "Abrir el supermercado" }).click();
await page.waitForFunction(() => Object.values(window.__MARKET_QA__?.customerVisuals ?? {}).some((customer) => customer.cartVisible), null, { timeout: 30_000 });
await page.waitForFunction(() => Object.values(window.__MARKET_QA__?.customerVisuals ?? {}).some((customer) => customer.cartVisible && !["GET_CART", "RETURN_CART"].includes(customer.state)), null, { timeout: 30_000 });

const samples = await page.evaluate(() => new Promise((resolve) => {
  const collected = [];
  const startedAt = performance.now();
  const collect = (now) => {
    for (const customer of Object.values(window.__MARKET_QA__?.customerVisuals ?? {})) collected.push(structuredClone(customer));
    if (now - startedAt >= 4_000) resolve(collected);
    else requestAnimationFrame(collect);
  };
  requestAnimationFrame(collect);
}));
await page.screenshot({ path: path.join(outputRoot, "mobile-lod-cart.png"), fullPage: true });

const controlledCartSamples = samples.filter((sample) => sample.cartVisible && sample.cartGripDistance !== null && !["GET_CART", "RETURN_CART"].includes(sample.state));
const tiers = [...new Set(samples.map((sample) => sample.characterModelTier).filter((tier) => tier !== undefined))].sort();
const drawCalls = samples.map((sample) => sample.cartBaseDrawCalls).filter((value) => Number.isFinite(value) && value > 0);
const report = {
  generatedAt: new Date().toISOString(),
  forcedTier,
  previewModel: previewModel ?? null,
  viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio, coarse: matchMedia("(any-pointer: coarse)").matches, cores: navigator.hardwareConcurrency })),
  customerSamples: samples.length,
  characterModelTiers: tiers,
  cartBaseDrawCalls: drawCalls.length ? { min: Math.min(...drawCalls), max: Math.max(...drawCalls) } : null,
  cartGripSamples: controlledCartSamples.length,
  maxCartGripDistance: controlledCartSamples.length ? Math.max(...controlledCartSamples.map((sample) => sample.cartGripDistance)) : null,
  modelResponses: [...new Map(modelResponses.map((entry) => [entry.pathname, entry])).values()],
  consoleErrors,
  pageErrors,
  failedResponses,
};
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (!report.customerSamples || !report.characterModelTiers.length || report.characterModelTiers.some((tier) => tier === 0 || (forcedTier === 2 && tier !== 2))) throw new Error(`El viewport móvil no seleccionó el LOD esperado: ${JSON.stringify(report)}`);
if (!report.cartBaseDrawCalls || report.cartBaseDrawCalls.min !== 8 || report.cartBaseDrawCalls.max !== 8) throw new Error(`El chasis del carrito excede ocho draw calls: ${JSON.stringify(report)}`);
if (report.cartGripSamples < 20 || report.maxCartGripDistance > 0.5) throw new Error(`El carrito optimizado perdió el agarre animado: ${JSON.stringify(report)}`);
if (!report.modelResponses.some((response) => /\/characters\/lod[12]\//.test(response.pathname)) || !report.modelResponses.some((response) => /\/customers\/lod[12]\//.test(response.pathname))) throw new Error(`No se cargaron ambos LOD móviles: ${JSON.stringify(report.modelResponses)}`);
if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores de navegador o red: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);
