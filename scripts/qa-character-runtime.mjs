import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputRoot = process.argv[2] ?? "/tmp/market-character-runtime-qa";
await fs.mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];
const modelResponses = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => {
  const url = response.url();
  if (url.includes("/models/market/")) modelResponses.push({ url: new URL(url).pathname, status: response.status() });
  if (response.status() >= 400) failedResponses.push({ url, status: response.status() });
});

const suffix = Date.now().toString(36);
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Market QA");
await page.getByLabel("Nombre de usuario").fill(`market_qa_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`market.qa.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Market-QA-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();

await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.locator("canvas").first().waitFor({ state: "visible", timeout: 30_000 });
await page.waitForTimeout(4_000);
await page.getByRole("button", { name: "Sin gorro" }).click();
await page.getByRole("button", { name: "Raya lateral" }).click();
await page.waitForTimeout(1_000);
await page.screenshot({ path: path.join(outputRoot, "01-owner-man-side-part.png"), fullPage: true });

await page.getByRole("button", { name: "Mujer Adulta" }).click();
await page.getByRole("button", { name: "Largo ondulado" }).click();
await page.waitForTimeout(1_000);
await page.screenshot({ path: path.join(outputRoot, "02-owner-woman-long-wavy.png"), fullPage: true });

await page.getByRole("button", { name: "Niño Joven" }).click();
await page.getByRole("button", { name: "Rizos" }).click();
await page.waitForTimeout(1_000);
await page.screenshot({ path: path.join(outputRoot, "03-owner-boy-curls.png"), fullPage: true });

await page.getByRole("button", { name: "Niña Joven" }).click();
await page.getByRole("button", { name: "Coleta alta" }).click();
await page.waitForTimeout(1_000);
await page.screenshot({ path: path.join(outputRoot, "04-owner-girl-high-ponytail.png"), fullPage: true });

await page.getByRole("button", { name: "Hombre Adulto" }).click();
await page.getByRole("button", { name: "Elefante" }).click();
await page.waitForTimeout(1_000);
await page.screenshot({ path: path.join(outputRoot, "05-owner-man-elephant.png"), fullPage: true });

await page.getByRole("button", { name: "Mujer Adulta" }).click();
await page.getByRole("button", { name: "Jirafa" }).click();
await page.waitForTimeout(1_000);
await page.screenshot({ path: path.join(outputRoot, "06-owner-woman-giraffe.png"), fullPage: true });

await page.getByRole("button", { name: "Hombre Adulto" }).click();
await page.getByRole("button", { name: "Raya lateral" }).click();
await page.getByRole("button", { name: "Sin gorro" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.getByText("Objetivos del día").waitFor({ timeout: 30_000 });
await page.waitForTimeout(5_000);
await page.screenshot({ path: path.join(outputRoot, "07-world-idle.png"), fullPage: true });

await page.keyboard.down("ArrowUp");
await page.waitForTimeout(220);
await page.screenshot({ path: path.join(outputRoot, "08-world-walk-a.png"), fullPage: true });
await page.waitForTimeout(240);
await page.screenshot({ path: path.join(outputRoot, "09-world-walk-b.png"), fullPage: true });
await page.waitForTimeout(240);
await page.screenshot({ path: path.join(outputRoot, "10-world-walk-c.png"), fullPage: true });
await page.keyboard.up("ArrowUp");
await page.waitForTimeout(450);
await page.screenshot({ path: path.join(outputRoot, "11-world-after-walk.png"), fullPage: true });

const storeStatus = page.locator(".store-status");
if ((await storeStatus.textContent())?.includes("CERRADO")) {
  await storeStatus.click();
  await page.getByRole("button", { name: "ABIERTO" }).waitFor({ timeout: 10_000 });
}
await page.waitForTimeout(6_000);
await page.screenshot({ path: path.join(outputRoot, "12-world-customers.png"), fullPage: true });

const webgl = await page.locator("canvas").first().evaluate((canvas) => {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) return null;
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  webgl,
  consoleErrors,
  pageErrors,
  failedResponses,
  modelResponses: [...new Map(modelResponses.map((entry) => [entry.url, entry])).values()],
  screenshots: [
    "01-owner-man-side-part.png",
    "02-owner-woman-long-wavy.png",
    "03-owner-boy-curls.png",
    "04-owner-girl-high-ponytail.png",
    "05-owner-man-elephant.png",
    "06-owner-woman-giraffe.png",
    "07-world-idle.png",
    "08-world-walk-a.png",
    "09-world-walk-b.png",
    "10-world-walk-c.png",
    "11-world-after-walk.png",
    "12-world-customers.png",
  ],
};
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (!webgl?.renderer.includes("NVIDIA GeForce RTX 4080 SUPER")) throw new Error(`La GPU esperada no está activa: ${JSON.stringify(webgl)}`);
if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores durante QA visual: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);
