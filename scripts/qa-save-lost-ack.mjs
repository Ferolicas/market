import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:3000";
const output = process.argv[2] ?? "/tmp/market-save-lost-ack-qa";
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
await page.addInitScript(() => sessionStorage.setItem("mini-market-qa-freeze", "1"));
const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));

const suffix = Date.now().toString(36);
await page.goto(`${appUrl}?debug=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Lost ACK QA");
await page.getByLabel("Nombre de usuario").fill(`lost_ack_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`lost.ack.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Lost-Ack-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "saved", null, { timeout: 30_000 });
const initialSaveRevision = await page.evaluate(() => window.__MARKET_QA__.saveRevision);

await page.getByRole("button", { name: "Abrir el supermercado" }).click();
await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "dirty", null, { timeout: 5_000 });

let acceptedAttempt = null;
let forwarded = false;
await page.route("**/api/game/save", async (route) => {
  if (route.request().method() !== "PUT") return route.continue();
  if (!forwarded) {
    forwarded = true;
    acceptedAttempt = route.request().postDataJSON();
    const response = await route.fetch();
    if (!response.ok()) throw new Error(`El servidor rechazó el PUT simulado: ${response.status()}`);
  }
  // The server accepted the first request, but the browser never receives its
  // acknowledgement. Any pagehide retry remains offline until the reload.
  return route.abort("internetdisconnected");
});

await page.locator('.player-chip button[aria-label="Guardar ahora"]').evaluate((button) => button.click());
await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "offline", null, { timeout: 15_000 });
await page.waitForTimeout(3_500);
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => window.__MARKET_QA__?.message === "Confirmé un guardado cuya respuesta se había perdido", null, { timeout: 30_000 });

const recovered = await page.evaluate(() => ({
  saveRevision: window.__MARKET_QA__.saveRevision,
  saveStatus: window.__MARKET_QA__.saveStatus,
  message: window.__MARKET_QA__.message,
  open: window.__MARKET_QA__.state.franchises.find((item) => item.id === window.__MARKET_QA__.state.currentFranchiseId)?.open,
}));
const server = await page.evaluate(async () => {
  const response = await fetch("/api/game/save", { cache: "no-store" });
  if (!response.ok) throw new Error(`GET save ${response.status}`);
  const payload = await response.json();
  return { saveRevision: payload.saveRevision, lastOperationId: payload.lastOperationId };
});
const report = {
  generatedAt: new Date().toISOString(),
  initialSaveRevision,
  acceptedOperationId: acceptedAttempt?.operationId ?? null,
  expectedRevision: acceptedAttempt?.expectedRevision ?? null,
  recovered,
  server,
  consoleErrors,
  unexpectedConsoleErrors: consoleErrors.filter((message) => !message.includes("ERR_INTERNET_DISCONNECTED")),
  pageErrors,
};
await page.screenshot({ path: path.join(output, "save-restored-after-lost-ack.png"), fullPage: true });
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (!report.acceptedOperationId || report.server.lastOperationId !== report.acceptedOperationId) throw new Error(`El recibo idempotente no coincide: ${JSON.stringify(report)}`);
if (report.server.saveRevision !== initialSaveRevision + 1 || report.recovered.saveRevision !== report.server.saveRevision) throw new Error(`El reintento duplicó o perdió la revisión: ${JSON.stringify(report)}`);
if (!report.recovered.open || report.recovered.saveStatus !== "saved") throw new Error(`La copia recuperada no conserva el cambio aceptado: ${JSON.stringify(report.recovered)}`);
if (report.unexpectedConsoleErrors.length || pageErrors.length) throw new Error(`Errores inesperados: ${JSON.stringify({ consoleErrors: report.unexpectedConsoleErrors, pageErrors })}`);
