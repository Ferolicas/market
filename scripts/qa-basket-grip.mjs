import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = process.argv[2] ?? "/tmp/market-basket-grip";
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.stack ?? error.message));

const suffix = Date.now().toString(36);
await page.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Agarre Cesta QA");
await page.getByLabel("Nombre de usuario").fill(`basket_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`basket.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Basket-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
const setupButton = page.getByRole("button", { name: "Abrir mi primer Mini Market" });
await setupButton.waitFor({ timeout: 60_000 });
await setupButton.click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_FIND_PLAYER_PATH__), null, { timeout: 60_000 });
// World ticks can mark the store dirty immediately after a successful PUT, so
// `saveStatus === saved` is an unreliable one-frame condition. A positive
// server revision proves the authoritative baseline needed by recovery.
await page.waitForFunction(() => (window.__MARKET_QA__?.saveRevision ?? 0) >= 2, null, { timeout: 30_000 });
// This QA isolates presentation from the farm/stock flow: a mixed carry is
// restored through the same local-recovery path used by stress fixtures.
await page.evaluate(() => {
  sessionStorage.setItem("mini-market-qa-freeze", "1");
  const qa = structuredClone(window.__MARKET_QA__);
  const state = qa.state;
  const franchise = state.franchises.find((item) => item.id === state.currentFranchiseId);
  state.revision += 10_000;
  franchise.carry = { capacity: 8, items: { tomatoes: 3, milk: 2, eggs: 1 } };
  localStorage.setItem("mini-market-recovery-v1", JSON.stringify({ state, saveRevision: qa.saveRevision, pendingEvents: [] }));
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => window.__MARKET_QA__?.carryGrip?.clip === "CarryIdle", null, { timeout: 30_000 });

await setInput(page, 0, 0);
await page.waitForFunction(() => window.__MARKET_QA__?.carryGrip?.clip === "CarryIdle", null, { timeout: 5_000 });
const idle = await gripSnapshot(page);
await page.screenshot({ path: path.join(output, "carry-idle.png"), fullPage: true });

await setInput(page, 0, -0.28);
await page.waitForFunction(() => window.__MARKET_QA__?.carryGrip?.clip === "CarryWalk", null, { timeout: 5_000 });
await page.waitForTimeout(500);
const walk = await gripSnapshot(page);
await page.screenshot({ path: path.join(output, "carry-walk.png"), fullPage: true });

await setInput(page, 0, -1);
await page.waitForFunction(() => window.__MARKET_QA__?.carryGrip?.clip === "CarryRun", null, { timeout: 5_000 });
await page.waitForTimeout(350);
const run = await gripSnapshot(page);
await page.screenshot({ path: path.join(output, "carry-run.png"), fullPage: true });
await setInput(page, 0, 0);

const samples = { CarryIdle: idle, CarryWalk: walk, CarryRun: run };
const maxPalmGap = Math.max(...Object.values(samples).flatMap((sample) => [sample.leftPalmToGrip, sample.rightPalmToGrip]));
const minWristOffset = Math.min(...Object.values(samples).flatMap((sample) => [sample.leftWristToGrip, sample.rightWristToGrip]));
const report = { samples, maxPalmGap, minWristOffset, errors };
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));

if (maxPalmGap > 0.001) throw new Error(`La canasta no toca ambas palmas: ${maxPalmGap}`);
if (minWristOffset < 0.035) throw new Error(`El agarre volvió al origen de muñeca: ${minWristOffset}`);
if (run.playerSpeedTier !== 1 || Math.abs(run.speedCap - 6.6) > 0.01 || run.playerSpeed < 6.5) throw new Error(`La carrera T1 no alcanzó el triple real: ${JSON.stringify(run)}`);
if (errors.length) throw new Error(`Errores de navegador: ${JSON.stringify(errors)}`);

async function gripSnapshot(targetPage) {
  return targetPage.evaluate(() => ({
    ...structuredClone(window.__MARKET_QA__.carryGrip),
    playerSpeed: window.__MARKET_QA__.player.speed,
    speedCap: window.__MARKET_QA__.player.speedCap,
    playerSpeedTier: window.__MARKET_QA__.player.speedTier,
  }));
}

async function setInput(targetPage, x, y) {
  await targetPage.evaluate(({ inputX, inputY }) => window.__MARKET_SET_PLAYER_INPUT__?.(inputX, inputY), { inputX: x, inputY: y });
}
