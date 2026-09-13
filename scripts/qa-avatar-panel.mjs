import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4011";
const output = process.argv[2] ?? "/tmp/market-avatar-panel-qa";
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => {
  if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() });
});

const suffix = Date.now().toString(36);
await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Avatar Panel QA");
await page.getByLabel("Nombre de usuario").fill(`avatar_panel_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`avatar.panel.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Avatar-Panel-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
const setupButton = page.getByRole("button", { name: "Abrir mi primer Mini Market" });
await Promise.race([
  setupButton.waitFor({ timeout: 120_000 }),
  page.locator(".hud-stat.earnings").waitFor({ timeout: 120_000 }),
]);
if (await setupButton.isVisible().catch(() => false)) {
  // The first-run screen uses the same 3D customizer. Exercise the previously
  // crashing body swap before dismissing onboarding as well as in the panel.
  const setupWoman = page.getByRole("button", { name: /Mujer Adulta/ });
  await setupWoman.click();
  await page.waitForTimeout(1_000);
  if (await setupButton.count() !== 1) throw new Error("El selector desmontó la pantalla inicial");
  await setupButton.click();
}
await page.locator(".hud-stat.earnings").waitFor({ timeout: 60_000 });

await page.getByRole("button", { name: "Avatar" }).click();
await page.getByRole("heading", { name: "Vestuario del fundador" }).waitFor({ timeout: 30_000 });
await page.locator(".avatar-preview-3d canvas").waitFor({ state: "visible", timeout: 30_000 });
const womanButton = page.getByRole("button", { name: /Mujer Adulta/ });
await womanButton.click();
await page.waitForTimeout(2_000);

const womanButtonCount = await womanButton.count();

const report = {
  generatedAt: new Date().toISOString(),
  appUrl,
  gameStillMounted: await page.locator(".game-shell").count() === 1,
  panelStillMounted: await page.getByRole("heading", { name: "Vestuario del fundador" }).count() === 1,
  previewVisible: await page.locator(".avatar-preview-3d canvas").isVisible().catch(() => false),
  selectedWoman: womanButtonCount ? await womanButton.getAttribute("aria-pressed") : null,
  consoleErrors,
  pageErrors,
  failedResponses,
};

await page.screenshot({ path: path.join(output, "avatar-panel.png"), fullPage: true });
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (!report.gameStillMounted || !report.panelStillMounted || !report.previewVisible || report.selectedWoman !== "true") {
  throw new Error(`El selector de avatar no permaneció operativo: ${JSON.stringify(report)}`);
}
if (consoleErrors.length || pageErrors.length || failedResponses.length) {
  throw new Error(`El selector de avatar produjo errores: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);
}
