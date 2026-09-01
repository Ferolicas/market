import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const APP_URL = process.env.MARKET_QA_URL ?? "http://localhost:3000";
const TRANSIENT_DETACH_TIMEOUT_MS = 8_000;
const MAX_ACCEPTABLE_OBSERVED_MS = 5_000;
const output = process.argv[2] ?? "/tmp/market-notification-lifecycle-qa";
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
await page.addInitScript(() => sessionStorage.setItem("mini-market-qa-freeze", "1"));
await page.emulateMedia({ reducedMotion: "reduce" });
const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));

const suffix = Date.now().toString(36);
await page.goto(`${APP_URL}?debug=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Notification Mobile QA");
await page.getByLabel("Nombre de usuario").fill(`toast_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`toast.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Toast-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "saved", null, { timeout: 30_000 });

// Seed a strictly newer local snapshot with the same server revision. This is
// the real recovery branch, not a DOM fixture, and freezing the world keeps it
// deterministic while the notification lifecycle is observed.
await page.evaluate(() => {
  const qa = window.__MARKET_QA__;
  const state = structuredClone(qa.state);
  state.revision += 10;
  sessionStorage.setItem("mini-market-qa-freeze", "1");
  localStorage.setItem("mini-market-recovery-v1", JSON.stringify({
    state,
    saveRevision: qa.saveRevision,
    pendingEvents: [],
  }));
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => window.__MARKET_QA__?.message === "Recuperé cambios locales pendientes", null, { timeout: 30_000 });
const recovery = await observeTransientToast(page, "Recuperé cambios locales pendientes");
const revisionBeforePartialSave = await page.evaluate(() => window.__MARKET_QA__.state.revision);

// Delay the response to a real save, then mutate the game while that request
// is in flight. The store must take its guarded partial-save path.
let releaseSaveStarted;
const saveStarted = new Promise((resolve) => { releaseSaveStarted = resolve; });
let delayNextSave = true;
await page.route("**/api/game/save", async (route) => {
  if (delayNextSave && route.request().method() === "PUT") {
    delayNextSave = false;
    releaseSaveStarted();
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await route.fulfill({ response });
    return;
  }
  await route.continue();
});
// The compact mobile HUD intentionally hides the manual-save affordance; a
// DOM click exercises that exact React handler without widening the viewport.
await page.locator('.player-chip button[aria-label="Guardar ahora"]').evaluate((button) => button.click());
await saveStarted;
await page.locator(".store-status").click();
await page.waitForFunction((previousRevision) => window.__MARKET_QA__?.state?.revision > previousRevision, revisionBeforePartialSave, { timeout: 5_000 });
await page.waitForFunction(() => window.__MARKET_QA__?.message === "Guardado parcial; sincronizando cambios nuevos", null, { timeout: 30_000 });
const partialSave = await observeTransientToast(page, "Guardado parcial; sincronizando cambios nuevos");

// Abort two distinct saves around a real gameplay transition. Both failures
// intentionally publish identical text with the same server save revision;
// the second occurrence must receive its own full TTL after the first expired.
// Reload first so the 15 s autosave clock cannot introduce a third occurrence
// while the two 3 s lifecycles are being measured.
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => window.__MARKET_QA__?.state && ["dirty", "saved"].includes(window.__MARKET_QA__.saveStatus), null, { timeout: 30_000 });
await page.route("**/api/game/save", async (route) => {
  if (route.request().method() === "PUT") return route.abort("internetdisconnected");
  return route.continue();
});
await page.locator('.player-chip button[aria-label="Guardar ahora"]').evaluate((button) => button.click());
await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "offline", null, { timeout: 10_000 });
const offlineMessage = "Sin conexión: los cambios siguen protegidos en este dispositivo";
const firstOfflineOccurrence = await page.evaluate(() => window.__MARKET_QA__.messageRevision);
const offlineFirst = await observeTransientToast(page, offlineMessage);
await page.locator(".store-status").click();
await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "dirty", null, { timeout: 5_000 });
await page.locator('.player-chip button[aria-label="Guardar ahora"]').evaluate((button) => button.click());
await page.waitForFunction((previousOccurrence) => (
  window.__MARKET_QA__?.saveStatus === "offline"
  && window.__MARKET_QA__?.messageRevision > previousOccurrence
), firstOfflineOccurrence, { timeout: 10_000 });
const secondOfflineOccurrence = await page.evaluate(() => window.__MARKET_QA__.messageRevision);
const offlineSecond = await observeTransientToast(page, offlineMessage);

await page.screenshot({ path: path.join(output, "mobile-after-transient-feedback.png"), fullPage: true });
const report = {
  generatedAt: new Date().toISOString(),
  viewport: page.viewportSize(),
  reducedMotion: await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
  recovery,
  partialSave,
  repeatedOffline: {
    firstOccurrence: firstOfflineOccurrence,
    secondOccurrence: secondOfflineOccurrence,
    first: offlineFirst,
    second: offlineSecond,
  },
  finalToastCount: await page.locator(".toast").count(),
  consoleErrors,
  unexpectedConsoleErrors: consoleErrors.filter((message) => !message.includes("net::ERR_INTERNET_DISCONNECTED")),
  pageErrors,
};
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (!recovery.visibleInitially || recovery.domCountAfterTtl !== 0 || !recovery.stateMessagePreserved || recovery.observedForMs > MAX_ACCEPTABLE_OBSERVED_MS) {
  throw new Error(`La recuperación local no liberó la pantalla sin borrar su estado: ${JSON.stringify(recovery)}`);
}
if (!partialSave.visibleInitially || partialSave.domCountAfterTtl !== 0 || !partialSave.stateMessagePreserved || partialSave.observedForMs > MAX_ACCEPTABLE_OBSERVED_MS) {
  throw new Error(`El guardado parcial no liberó la pantalla sin borrar su estado: ${JSON.stringify(partialSave)}`);
}
if (
  secondOfflineOccurrence <= firstOfflineOccurrence
  || !offlineFirst.visibleInitially
  || !offlineSecond.visibleInitially
  || offlineFirst.domCountAfterTtl !== 0
  || offlineSecond.domCountAfterTtl !== 0
  || !offlineSecond.stateMessagePreserved
) {
  throw new Error(`Dos avisos offline idénticos no recibieron ciclos visuales independientes: ${JSON.stringify({ firstOfflineOccurrence, secondOfflineOccurrence, offlineFirst, offlineSecond })}`);
}
if (report.unexpectedConsoleErrors.length || pageErrors.length) {
  throw new Error(`Errores durante QA móvil de notificaciones: ${JSON.stringify({ consoleErrors: report.unexpectedConsoleErrors, pageErrors })}`);
}

async function observeTransientToast(targetPage, expectedMessage) {
  const toast = targetPage.locator('.toast[data-notification-lifecycle="transient"]', { hasText: expectedMessage });
  await toast.waitFor({ state: "visible", timeout: 5_000 });
  const visibleInitially = await toast.isVisible();
  const rectangle = await toast.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  });
  const startedAt = Date.now();
  await toast.waitFor({ state: "detached", timeout: TRANSIENT_DETACH_TIMEOUT_MS });
  const domCountAfterTtl = await targetPage.locator('.toast[data-notification-lifecycle="transient"]', { hasText: expectedMessage }).count();
  const stateMessagePreserved = await targetPage.evaluate((message) => window.__MARKET_QA__?.message === message, expectedMessage);
  return {
    visibleInitially,
    rectangle,
    observedForMs: Date.now() - startedAt,
    domCountAfterTtl,
    stateMessagePreserved,
  };
}
