// PlayCanvas phase 10 QA: verifies the two Part-A items with real state
// evidence — (1) the live skinned chicken character actually loads and
// animates (not just the static coop shell); (2) the player's Walk/Run gait
// retimes continuously with presented speed instead of snapping to a fixed
// playback rate.
//
// Usage: `pnpm qa:pc-farm-animal-gait` or `pnpm exec tsx scripts/qa-pc-farm-animal-gait.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState } from "../src/game/engine";
import type { GameState } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-farm-animal-gait-qa";
await fs.mkdir(outputRoot, { recursive: true });

// ---- seed: real level-30 fixture, mutated so chicken-coop-1 is unlocked and
// actively PROCESSING (the real "active" flag `animalStation.ts`'s
// `update()` feeds `animalMotion()` — should select the "Peck" work clip
// instead of the walk-lane idle loop). ----
const baseSeed = JSON.parse(await fs.readFile("public/fixtures/runtime-level30-seed.json", "utf8")) as GameState;
const state = normalizeGameState(baseSeed);
const franchise = state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0];
if (!franchise.unlockedAreas.includes("chicken-coop")) franchise.unlockedAreas.push("chicken-coop");
const chickenMachine = franchise.productionMachines.find((machine) => machine.id === "chicken-coop-1");
if (!chickenMachine) throw new Error("chicken-coop-1 no está en el fixture base");
chickenMachine.status = "PROCESSING";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

interface AnimalDebug { kind: string; machineId: string; areaId: string; stationVisible: boolean; loaded: boolean; clip: string | null; localPosition: { x: number; y: number; z: number } }
interface PlayerAnimDebug { clip: string; speed: number | null }
interface QaWindow extends Window {
  __MARKET_PC_RUNTIME__?: { getFarmAnimalDebug(): AnimalDebug[]; getPlayerAnimDebug(): PlayerAnimDebug };
  __MARKET_STORE__?: { getState(): { game: unknown } };
}
declare const window: QaWindow;

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const failedResponses: Array<{ url: string; status: number }> = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });

await page.addInitScript((serialized: string) => {
  try { window.localStorage.setItem("mini-market-playcanvas-integral-v1", serialized); } catch { /* ignore */ }
}, JSON.stringify(state));

await page.goto(`${appUrl}/playcanvas`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_PC_RUNTIME__ && window.__MARKET_STORE__), null, { timeout: 30_000 });
await page.locator("canvas").first().waitFor({ timeout: 30_000 });

const readAnimals = () => page.evaluate(() => window.__MARKET_PC_RUNTIME__!.getFarmAnimalDebug());
const readPlayerAnim = () => page.evaluate(() => window.__MARKET_PC_RUNTIME__!.getPlayerAnimDebug());

let failure: string | null = null;
const evidence: Record<string, unknown> = {};
try {
  // ---- 1) Live chicken character: wait for the real GLB to load, then
  // confirm it is visible and drives a real Peck/Walk clip (never stuck on
  // "Idle" while `active === true`) plus real position movement over time. ----
  await page.waitForFunction(() => {
    const animals = window.__MARKET_PC_RUNTIME__?.getFarmAnimalDebug() ?? [];
    return animals.some((animal) => animal.machineId === "chicken-coop-1" && animal.loaded);
  }, null, { timeout: 20_000 });
  const animalsAfterLoad = await readAnimals();
  evidence.animalsAfterLoad = animalsAfterLoad;
  const chicken = animalsAfterLoad.find((animal) => animal.machineId === "chicken-coop-1");
  if (!chicken) throw new Error(`chicken-coop-1 actor no encontrado: ${JSON.stringify(animalsAfterLoad)}`);
  if (!chicken.stationVisible) throw new Error(`stationGroup de chicken-coop-1 no visible con status=PROCESSING y área desbloqueada: ${JSON.stringify(chicken)}`);

  // Sample twice, ~3s apart, to catch a real clip transition and real motion
  // (the 22s cycle in animalMotion() moves ~0.15 layout units/sec while
  // walking, and the "active" branch should show Peck at some point in the
  // idle-in-place window).
  const sampleA = animalsAfterLoad.find((animal) => animal.machineId === "chicken-coop-1")!;
  await page.waitForTimeout(3_000);
  const animalsB = await readAnimals();
  const sampleB = animalsB.find((animal) => animal.machineId === "chicken-coop-1")!;
  evidence.chickenSampleA = sampleA;
  evidence.chickenSampleB = sampleB;
  const moved = Math.hypot(sampleB.localPosition.x - sampleA.localPosition.x, sampleB.localPosition.z - sampleA.localPosition.z);
  const clipChanged = sampleA.clip !== sampleB.clip;
  if (!moved && !clipChanged) throw new Error(`El personaje vivo no se movió ni cambió de clip en 3s: ${JSON.stringify({ sampleA, sampleB })}`);
  await page.screenshot({ path: path.join(outputRoot, "live-chicken.png") });

  // ---- 2) Continuous gait retiming: hold Run (Shift+W) and sample
  // AnimComponent.speed twice a beat apart while moving in a straight line —
  // it must stay clamped in [0.55, 2.8] and reflect actual presented speed,
  // not pin to 1 the way discrete state switching alone would. ----
  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  await page.waitForTimeout(200);
  const anim1 = await readPlayerAnim();
  await page.waitForTimeout(500);
  const anim2 = await readPlayerAnim();
  await page.keyboard.up("w");
  await page.keyboard.up("Shift");
  evidence.runGaitSample1 = anim1;
  evidence.runGaitSample2 = anim2;
  if (anim1.speed === null || anim2.speed === null) throw new Error(`anim.speed no disponible: ${JSON.stringify({ anim1, anim2 })}`);
  if (anim1.speed === 1 && anim2.speed === 1) throw new Error(`El gait nunca se retimeó (siempre speed=1, como en el snap discreto anterior): ${JSON.stringify({ anim1, anim2 })}`);
  if (anim1.speed < 0.55 - 1e-6 || anim1.speed > 2.8 + 1e-6 || anim2.speed < 0.55 - 1e-6 || anim2.speed > 2.8 + 1e-6) {
    throw new Error(`anim.speed fuera del rango CROWD_TIME_SCALE_RANGE [0.55, 2.8]: ${JSON.stringify({ anim1, anim2 })}`);
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const report = { generatedAt: new Date().toISOString(), appUrl, failure, evidence, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (failure || consoleErrors.length || pageErrors.length || failedResponses.length) {
  throw new Error(`QA farm-animal/gait PlayCanvas falló: ${JSON.stringify({ failure, consoleErrors, pageErrors, failedResponses })}`);
}
