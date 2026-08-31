import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputRoot = process.argv[2] ?? "/tmp/market-player-navmesh-qa";
await fs.mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = []; const pageErrors = []; const failedResponses = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });

const suffix = Date.now().toString(36);
await page.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Player NavMesh QA");
await page.getByLabel("Nombre de usuario").fill(`navmesh_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`navmesh.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`NavMesh-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_FIND_PLAYER_PATH__), null, { timeout: 30_000 });

const qa = () => page.evaluate(() => structuredClone(window.__MARKET_QA__));
const player = async () => (await qa()).player;
const distance = (a, b) => Math.hypot(a.x - b[0], a.z - b[1]);
const forward = normalize([-16, -25.75]);
const right = [-forward[1], forward[0]];
const routeEvidence = [];

async function dragPulse(worldDirection, duration = 360) {
  const direction = normalize(worldDirection);
  const inputX = direction[0] * right[0] + direction[1] * right[1];
  const inputY = -(direction[0] * forward[0] + direction[1] * forward[1]);
  await page.mouse.move(720, 610);
  await page.mouse.down();
  await page.mouse.move(720 + inputX * 88, 610 + inputY * 88, { steps: 3 });
  await page.waitForTimeout(duration);
  await page.mouse.up();
}

async function moveTo(target, tolerance = 1.05) {
  const before = await player();
  if (distance(before, target) <= tolerance) return;
  let navPath = [];
  for (let attempt = 0; attempt < 20 && navPath.length < 2; attempt += 1) {
    navPath = await page.evaluate((destination) => window.__MARKET_FIND_PLAYER_PATH__?.(destination) ?? [], target);
    if (navPath.length < 2) await page.waitForTimeout(100);
  }
  if (navPath.length < 2) throw new Error(`NavMesh no encontró ruta hasta ${target.join(",")}`);
  routeEvidence.push({ from: before, target, navPath });
  for (const [index, waypoint] of navPath.slice(1).entries()) await moveDirectTo(waypoint, index === navPath.length - 2 ? tolerance : 0.72);
}

async function moveDirectTo(target, tolerance) {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const current = await player();
    if (distance(current, target) <= tolerance) return;
    await dragPulse([target[0] - current.x, target[1] - current.z]);
  }
  const diagnostics = await qa();
  throw new Error(`Bloqueo hacia ${target.join(",")}: ${JSON.stringify({ player: diagnostics.player, physics: diagnostics.physics, renderer: diagnostics.renderer })}`);
}

let failure = null;
try {
  const checkpoints = [[15, -10.7], [12, -10], [4, -10], [4, 3], [0, 7], [-4, 1], [-15.1, -8.1], [-12, -2], [-4, 7], [0, 13.8], [-10.4, 21.3], [0, 13.8], [-4, -10], [15, -10.7]];
  for (const target of checkpoints) await moveTo(target);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const report = { generatedAt: new Date().toISOString(), failure, final: await qa(), routeEvidence, consoleErrors, pageErrors, failedResponses };
await page.screenshot({ path: path.join(outputRoot, "player-navmesh.png"), fullPage: true });
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (failure || consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`QA NavMesh/Rapier falló: ${JSON.stringify({ failure, consoleErrors, pageErrors, failedResponses })}`);

function normalize([x, y]) {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}
