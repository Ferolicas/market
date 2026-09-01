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
  await page.waitForFunction(() => {
    const target = window.__MARKET_QA__?.farmAccessWaypoints?.[0];
    return Boolean(target && (window.__MARKET_FIND_PLAYER_PATH__?.(target)?.length ?? 0) >= 2);
  }, null, { timeout: 30_000 });
}

const qa = () => page.evaluate(() => structuredClone(Object.fromEntries(
  Object.entries(window.__MARKET_QA__ ?? {}).filter(([, value]) => typeof value !== "function"),
)));
const player = async () => (await qa()).player;
const distance = (a, b) => Math.hypot(a.x - b[0], a.z - b[1]);
const forward = normalize([-16, -25.75]);
const right = [-forward[1], forward[0]];
const routeEvidence = [];
let rearDoorEvidence = null;
const storefrontDoorEvidence = [];
const farmAccessFenceEvidence = [];

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
  const rearDoor = published.rearDoor;
  const storefrontDoor = published.storefrontDoor;
  if (!farmTarget || farmAccess.length !== 3 || !rearDoor || farmTarget.z >= -20) throw new Error(`Layout de finca trasera inválido: ${JSON.stringify({ farmTarget, farmAccess, rearDoor })}`);
  if (!storefrontDoor) throw new Error("Sensor de puerta principal no publicado.");

  for (const side of [-1, 1]) {
    await moveTo([0, storefrontDoor.sensorCenterZ - storefrontDoor.sensorHalfDepth - 1.2], 0.5);
    await page.waitForFunction(() => {
      const state = window.__MARKET_QA__?.state;
      const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
      return (franchise?.doorProgress ?? 1) <= 0.01;
    }, null, { timeout: 4_000 });
    const edgeTarget = [side * Math.min(2.6, storefrontDoor.sensorHalfWidth - 0.3), storefrontDoor.z - 0.8];
    await moveTo(edgeTarget, 0.42);
    await page.waitForFunction(() => {
      const state = window.__MARKET_QA__?.state;
      const franchise = state?.franchises?.find((candidate) => candidate.id === state.currentFranchiseId) ?? state?.franchises?.[0];
      return (franchise?.doorProgress ?? 0) >= 0.99;
    }, null, { timeout: 3_000 });
    const edgeSnapshot = await qa();
    const edgeFranchise = edgeSnapshot.state.franchises.find((candidate) => candidate.id === edgeSnapshot.state.currentFranchiseId) ?? edgeSnapshot.state.franchises[0];
    if (Math.hypot(edgeSnapshot.player.x - edgeTarget[0], edgeSnapshot.player.z - edgeTarget[1]) > 0.65) throw new Error(`No se alcanzó el lateral ${side} de la puerta principal: ${JSON.stringify({ edgeTarget, player: edgeSnapshot.player })}`);
    storefrontDoorEvidence.push({ side, target: edgeTarget, player: edgeSnapshot.player, progress: edgeFranchise.doorProgress });
    await page.screenshot({ path: path.join(outputRoot, `front-door-${side < 0 ? "left" : "right"}-edge.png`), fullPage: true });
  }
  const directFarmPath = await page.evaluate((target) => window.__MARKET_FIND_PLAYER_PATH__?.(target) ?? [], [farmTarget.x, farmTarget.z]);
  const crossing = crossingAtZ(directFarmPath, rearDoor.z);
  rearDoorEvidence = { layout: rearDoor, directFarmPath, crossing };
  if (directFarmPath.some(([x]) => x > 23.1) || !crossing || Math.abs(crossing.x - rearDoor.x) >= rearDoor.clearHalfWidth) throw new Error(`La ruta store→finca no usa el hueco trasero directo: ${JSON.stringify(rearDoorEvidence)}`);
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
    if (target === farmAccess[0]) {
      await page.waitForFunction(() => (window.__MARKET_QA__?.rearDoor?.progress ?? 0) >= 0.99, null, { timeout: 3_000 });
      await page.screenshot({ path: path.join(outputRoot, "rear-door-fully-open.png"), fullPage: true });
    }
    if (serviceFixtureFocus) await page.screenshot({ path: path.join(outputRoot, `service-route-${checkpoints.indexOf(target)}.png`), fullPage: true });
    if (farmShowcase && target === farmAccess.at(-1)) {
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(outputRoot, "farm-open-gate.png"), fullPage: true });
    }
    if (farmShowcase && target[0] === farmAccess[1][0] && target[1] === farmAccess[1][1]) {
      const fences = (await qa()).farmAccessCorridorFences ?? [];
      if (fences.length !== 2) throw new Error(`Guías del acceso no publicadas: ${JSON.stringify(fences)}`);
      for (const fence of [...fences].sort((left, rightFence) => left.side - rightFence.side)) {
        const side = fence.side;
        const expectedX = rearDoor.x + side * rearDoor.clearHalfWidth;
        if ((side !== -1 && side !== 1) || Math.abs(fence.x - expectedX) > 0.02) {
          throw new Error(`Guía desalineada con el borde de la puerta: ${JSON.stringify({ fence, rearDoor, expectedX })}`);
        }
        const innerTarget = [fence.x - side * 1.15, fence.z];
        await moveTo(innerTarget, 0.5);
        const beforeImpact = await qa();
        await dragPulse([side, 0], 1_050);
        const impact = await qa();
        const crossed = side < 0 ? impact.player.x < fence.x : impact.player.x > fence.x;
        const advanced = Math.abs(impact.player.x - beforeImpact.player.x);
        const collisions = impact.physics?.collisions ?? [];
        const touchedFence = collisions.some((collision) => (
          Math.abs((collision?.colliderPosition?.[0] ?? Number.POSITIVE_INFINITY) - fence.x) < 0.02
          && Math.abs((collision?.colliderPosition?.[2] ?? Number.POSITIVE_INFINITY) - fence.z) < 0.02
          && Math.abs(collision?.normal?.[0] ?? 0) > 0.95
        ));
        const expectedContactX = fence.x - side * (fence.halfX + 0.24);
        const contactError = Math.abs(impact.player.x - expectedContactX);
        const zDrift = Math.abs(impact.player.z - fence.z);
        const insideFenceSpan = zDrift <= fence.halfZ - 0.2;
        farmAccessFenceEvidence.push({ fence, innerTarget, before: beforeImpact.player, player: impact.player, advanced, collisions, expectedContactX, contactError, zDrift, insideFenceSpan, touchedFence, crossed });
        await page.screenshot({ path: path.join(outputRoot, `farm-access-${side < 0 ? "left" : "right"}-blocked.png`), fullPage: true });
        if (crossed || advanced < 0.35 || contactError > 0.35 || !insideFenceSpan || !touchedFence) {
          throw new Error(`El acceso permite desviarse al pasillo ${side < 0 ? "izquierdo" : "derecho"}: ${JSON.stringify(farmAccessFenceEvidence.at(-1))}`);
        }
        await moveTo(farmAccess[1], 0.6);
      }
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

const report = { generatedAt: new Date().toISOString(), failure, final: await qa(), storefrontDoorEvidence, farmAccessFenceEvidence, rearDoorEvidence, routeEvidence, consoleErrors, pageErrors, failedResponses };
await page.screenshot({ path: path.join(outputRoot, "player-navmesh.png"), fullPage: true });
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (failure || consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`QA NavMesh/Rapier falló: ${JSON.stringify({ failure, consoleErrors, pageErrors, failedResponses })}`);

function normalize([x, y]) {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}

function crossingAtZ(pathPoints, z) {
  for (let index = 1; index < pathPoints.length; index += 1) {
    const previous = pathPoints[index - 1];
    const next = pathPoints[index];
    if ((previous[1] - z) * (next[1] - z) > 0 || Math.abs(next[1] - previous[1]) < 1e-8) continue;
    const progress = (z - previous[1]) / (next[1] - previous[1]);
    if (progress >= 0 && progress <= 1) return { x: previous[0] + (next[0] - previous[0]) * progress, z };
  }
  return null;
}
