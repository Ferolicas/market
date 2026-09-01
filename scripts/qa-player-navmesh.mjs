import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputRoot = process.argv[2] ?? "/tmp/market-player-navmesh-qa";
const farmShowcase = process.env.MARKET_QA_FARM_SHOWCASE === "1";
const serviceFixtureFocus = process.env.MARKET_QA_SERVICE_FIXTURES === "1";
await fs.mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const page = await browser.newPage({ viewport: farmShowcase ? { width: 2560, height: 1000 } : { width: 1440, height: 1000 } });
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
if (farmShowcase) {
  await page.evaluate(() => {
    const qa = structuredClone(Object.fromEntries(
      Object.entries(window.__MARKET_QA__ ?? {}).filter(([, value]) => typeof value !== "function"),
    ));
    const state = qa.state;
    const franchise = state.franchises.find((candidate) => candidate.id === state.currentFranchiseId) ?? state.franchises[0];
    state.revision += 10_000;
    franchise.unlockedAreas = [...new Set([...franchise.unlockedAreas, "chicken-coop", "cow-station"])];
    franchise.productionMachines.forEach((machine) => {
      if (machine.id === "chicken-coop-1" || machine.id === "cow-station-1") machine.status = "IDLE";
    });
    localStorage.setItem("mini-market-recovery-v1", JSON.stringify({ state, saveRevision: qa.saveRevision, pendingEvents: [] }));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_FIND_PLAYER_PATH__), null, { timeout: 30_000 });
  await page.waitForFunction(() => (window.__MARKET_FIND_PLAYER_PATH__?.([15, -10.7])?.length ?? 0) >= 2, null, { timeout: 30_000 });
}

const qa = () => page.evaluate(() => structuredClone(Object.fromEntries(
  Object.entries(window.__MARKET_QA__ ?? {}).filter(([, value]) => typeof value !== "function"),
)));
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
  await page.waitForFunction(() => {
    const presentation = window.__MARKET_QA__?.serviceFixturePresentation;
    return Boolean(presentation?.promotionalEndcap?.fixtureVisible && presentation?.returns?.fixtureVisible && presentation?.cartBay?.fixtureVisible);
  }, null, { timeout: 30_000 });
  const published = await qa();
  const farmTarget = published.farmTargets?.find((candidate) => candidate.id === "crop-tomato-1");
  const farmAccess = published.farmAccessWaypoints ?? [];
  if (!farmTarget || farmAccess.length !== 3 || farmTarget.z >= -20) throw new Error(`Layout de finca trasera inválido: ${JSON.stringify({ farmTarget, farmAccess })}`);
  const serviceFixtures = Object.fromEntries((published.serviceFixtureTargets ?? []).map((fixture) => [fixture.id, fixture]));
  const fixturePresentation = published.serviceFixturePresentation ?? {};
  if (!serviceFixtures.promotionalEndcap || !serviceFixtures.returns || !serviceFixtures.cartBay) throw new Error(`Fixtures de servicio no publicadas: ${JSON.stringify(serviceFixtures)}`);
  if (!fixturePresentation.promotionalEndcap?.fixtureVisible || !fixturePresentation.returns?.fixtureVisible || !fixturePresentation.cartBay?.fixtureVisible) throw new Error(`Fixture sólido sin presentación visible: ${JSON.stringify(fixturePresentation)}`);
  if (![serviceFixtures.returns.serviceX, serviceFixtures.returns.serviceZ, serviceFixtures.cartBay.serviceX, serviceFixtures.cartBay.serviceZ].every(Number.isFinite)) throw new Error(`Sockets de servicio inválidos: ${JSON.stringify(serviceFixtures)}`);
  const serviceCheckpoints = [
    [14, 5.7],
    [serviceFixtures.returns.serviceX, serviceFixtures.returns.serviceZ],
    [serviceFixtures.cartBay.serviceX, serviceFixtures.cartBay.serviceZ],
    [0, 13.8],
  ];
  const checkpoints = serviceFixtureFocus
    ? serviceCheckpoints
    : farmShowcase
    ? [[0, 13.8], ...farmAccess, [farmTarget.x, farmTarget.z]]
    : [[15, -10.7], [12, -10], [4, -10], [4, 3], [0, 7], [-4, 1], [-15.1, -8.1], [-12, -2], [-4, 7], [0, 13.8], ...farmAccess, [farmTarget.x, farmTarget.z], ...[...farmAccess].reverse(), [0, 13.8], [-4, -10], [15, -10.7]];
  for (const target of checkpoints) {
    await moveTo(target);
    if (serviceFixtureFocus) await page.screenshot({ path: path.join(outputRoot, `service-route-${checkpoints.indexOf(target)}.png`), fullPage: true });
    if (farmShowcase && target === farmAccess.at(-1)) {
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(outputRoot, "farm-open-gate.png"), fullPage: true });
    }
    if (farmShowcase && target[0] === farmTarget.x && target[1] === farmTarget.z) {
      const publishedTargets = (await qa()).farmTargets;
      const cropXs = publishedTargets.map((candidate) => candidate.x);
      const cropSpan = Math.max(...cropXs) - Math.min(...cropXs);
      const overview = [Math.max(...cropXs) + cropSpan * 0.56, publishedTargets.reduce((sum, candidate) => sum + candidate.z, 0) / publishedTargets.length];
      await moveTo(overview, 0.72);
      await page.waitForTimeout(1_200);
      await page.screenshot({ path: path.join(outputRoot, "farm-complete-estate.png"), fullPage: true });
      const rearFacilitiesZ = overview[1] - 2.5;
      await moveTo([farmAccess.at(-1)[0] - 4, rearFacilitiesZ], 0.72);
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(outputRoot, "farm-greenhouse-and-paddocks.png"), fullPage: true });
      await moveTo([Math.min(...cropXs) - 4, rearFacilitiesZ], 0.72);
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(outputRoot, "farm-tools-and-compost.png"), fullPage: true });
      await moveTo([farmTarget.x, farmTarget.z]);
    }
  }
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
