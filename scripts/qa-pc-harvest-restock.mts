// PlayCanvas phase 7 QA: a pathfinding-aware-enough player walker for the
// PlayCanvas port. There is no navmesh client for this port yet (unlike
// `/runtime`'s `window.__MARKET_FIND_PLAYER_PATH__`), so this drives the real
// player with real `window` keydown/keyup events (the same path
// `PlayCanvasRuntime.onKey()` listens to) using straight-line steering
// corrected every ~300ms toward a target, plus a handful of the game's own
// real corridor waypoints (`STORE_REAR_DOOR.interiorCorridor`,
// `FARM_ACCESS_WAYPOINTS`) to get through the one doorway a straight line
// cannot cross, and a lateral unstick nudge if progress stalls. Arrival is
// verified with `getPlayerPosition()`/`getInteractionZones()` — both already
// real QA accessors on `window.__MARKET_PC_RUNTIME__`.
//
// Verifies (with real before/after state-delta evidence, read from
// `window.__MARKET_STORE__.getState().game`):
//  1. `stock:eggs` (a `isStockingInteractionId` zone) — walking into it with
//     eggs in the carry and a near-empty shelf fires the real STOCK action.
//  2. `farm:crop-tomato-1` (a `farm-plot` zone) — walking onto a real
//     `status: "READY"` crop fires the real HARVEST action.
//
// Usage: `pnpm qa:pc-harvest-restock` or `pnpm exec tsx scripts/qa-pc-harvest-restock.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState } from "../src/game/engine";
import { FARM_ACCESS_WAYPOINTS } from "../src/game/stations/farm-layout";
import { STORE_REAR_DOOR } from "../src/game/stations/storefront-layout";
import { scaleStorePoint } from "../src/game/world-scale";
import type { GameState } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-harvest-restock-qa";
await fs.mkdir(outputRoot, { recursive: true });

// ---- seed: the real level-30 fixture `/playcanvas` already ships with,
// mutated only for the two facts this QA needs to be true (a near-empty
// eggs shelf with eggs in the carry to restock; crop-tomato-1 is already
// `status: "READY"` in the base fixture, kept as-is). ----
const baseSeed = JSON.parse(await fs.readFile("public/fixtures/runtime-level30-seed.json", "utf8")) as GameState;
const state = normalizeGameState(baseSeed);
const franchise = state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0];
franchise.shelves.eggs = 2;
franchise.carry.capacity = 10;
franchise.carry.items = { eggs: 5 };
const cropTomato1 = franchise.crops.find((crop) => crop.id === "crop-tomato-1");
if (!cropTomato1 || cropTomato1.status !== "READY") throw new Error(`crop-tomato-1 no está READY en el fixture base: ${JSON.stringify(cropTomato1)}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});
interface Zone { id: string; x: number; z: number; enterRadius: number; halfExtents: [number, number] | null }
interface CropSlice { id: string; status: string; available: number; plantedAt: number }
interface GameSlice { crops: CropSlice[]; shelvesEggs: number; carry: { capacity: number; items: Record<string, number> } }
// Minimal shape of the two real QA/debug globals this walker reads —
// `window.__MARKET_PC_RUNTIME__` (PlayCanvasCanvas.tsx) and
// `window.__MARKET_STORE__` (the real zustand store, same one). `game` is
// left as `unknown` and narrowed with plain runtime lookups in-page (its
// full `GameState` shape is not needed here — see src/game/types.ts for the
// real type).
interface QaWindow extends Window {
  __MARKET_PC_RUNTIME__?: { getPlayerPosition(): { x: number; z: number }; getInteractionZones(): Zone[] };
  __MARKET_STORE__?: { getState(): { game: unknown } };
}
declare const window: QaWindow;

interface RawFranchise {
  crops: CropSlice[];
  shelves: Record<string, number>;
  carry: { capacity: number; items: Record<string, number> };
}
interface RawGame { currentFranchiseId: string; franchises: Array<{ id: string } & RawFranchise> }

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const failedResponses: Array<{ url: string; status: number }> = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });

// Seeds the exact real GameState into the same localStorage key
// `PlayCanvasIntegralClient.tsx` reads via `configureRuntimeIntegral()`'s
// `integralStorageKey` seam, before any page script runs.
await page.addInitScript((serialized: string) => {
  try { window.localStorage.setItem("mini-market-playcanvas-integral-v1", serialized); } catch { /* ignore */ }
}, JSON.stringify(state));

await page.goto(`${appUrl}/playcanvas`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_PC_RUNTIME__ && window.__MARKET_STORE__), null, { timeout: 30_000 });
await page.locator("canvas").first().waitFor({ timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_PC_RUNTIME__?.getPlayerPosition()), null, { timeout: 15_000 });
await page.waitForTimeout(1_500);

const readGameSlice = (): Promise<GameSlice> => page.evaluate(() => {
  const game = window.__MARKET_STORE__!.getState().game as RawGame;
  const franchiseState = game.franchises.find((item) => item.id === game.currentFranchiseId) ?? game.franchises[0];
  return {
    crops: franchiseState.crops.map((crop) => ({ id: crop.id, status: crop.status, available: crop.available, plantedAt: crop.plantedAt })),
    shelvesEggs: franchiseState.shelves.eggs ?? 0,
    carry: franchiseState.carry,
  };
});
const readPlayer = () => page.evaluate(() => window.__MARKET_PC_RUNTIME__!.getPlayerPosition());
const readZones = () => page.evaluate(() => window.__MARKET_PC_RUNTIME__!.getInteractionZones());

// ---- keyboard-combo -> real world-direction table (mirrors
// PlayCanvasRuntime's onKey -> inputManager.setKeyboard ->
// cameraRelativeMovement chain exactly — see PlayerController.ts). ----
const OVERVIEW_CAMERA_OFFSET = { x: 16, z: 25.75 };
function normalize([x, y]: [number, number]): [number, number] { const length = Math.hypot(x, y) || 1; return [x / length, y / length]; }
const cameraForward = normalize([-OVERVIEW_CAMERA_OFFSET.x, -OVERVIEW_CAMERA_OFFSET.z]);
const cameraRight: [number, number] = [-cameraForward[1], cameraForward[0]];
function worldDirForKeys(keys: Set<string>): [number, number] | null {
  let x = 0, y = 0;
  if (keys.has("a")) x -= 1;
  if (keys.has("d")) x += 1;
  if (keys.has("w")) y += 1;
  if (keys.has("s")) y -= 1;
  if (x === 0 && y === 0) return null;
  const length = Math.hypot(x, y) || 1;
  const inputX = x / length, inputY = y / length;
  const worldX = cameraRight[0] * inputX + cameraForward[0] * -inputY;
  const worldZ = cameraRight[1] * inputX + cameraForward[1] * -inputY;
  return normalize([worldX, worldZ]);
}
const KEY_COMBOS = [["w"], ["s"], ["a"], ["d"], ["w", "a"], ["w", "d"], ["s", "a"], ["s", "d"]];
const COMBO_TABLE = KEY_COMBOS.map((combo) => ({ combo, dir: worldDirForKeys(new Set(combo))! }));
function bestCombo(targetDir: [number, number]): string[] {
  let best = COMBO_TABLE[0];
  let bestDot = -Infinity;
  for (const entry of COMBO_TABLE) {
    const dot = entry.dir[0] * targetDir[0] + entry.dir[1] * targetDir[1];
    if (dot > bestDot) { bestDot = dot; best = entry; }
  }
  return best.combo;
}

let heldKeys = new Set<string>();
async function setKeys(nextKeys: readonly string[]) {
  const next = new Set(nextKeys);
  for (const key of heldKeys) if (!next.has(key)) await page.keyboard.up(key);
  for (const key of next) if (!heldKeys.has(key)) await page.keyboard.down(key);
  heldKeys = next;
}
async function releaseAll() { await setKeys([]); }

// Mirrors InteractionZone.ts's interactionZonePlanarDistance(): a zone with a
// real fixture footprint (halfExtents) activates when the player is within
// enterRadius of the BOX SURFACE, not of its center — the box interior is the
// solid fixture itself, so aiming at the center walks the player into a wall
// it can never enter.
function planarDistanceToZone(zone: Zone, x: number, z: number) {
  const halfX = zone.halfExtents ? Math.max(0, zone.halfExtents[0]) : 0;
  const halfZ = zone.halfExtents ? Math.max(0, zone.halfExtents[1]) : 0;
  const outsideX = Math.max(0, Math.abs(x - zone.x) - halfX);
  const outsideZ = Math.max(0, Math.abs(z - zone.z) - halfZ);
  return Math.hypot(outsideX, outsideZ);
}
function approachPointForZone(zone: Zone, fromX: number, fromZ: number, clearance: number) {
  const halfX = zone.halfExtents ? Math.max(0, zone.halfExtents[0]) : 0;
  const halfZ = zone.halfExtents ? Math.max(0, zone.halfExtents[1]) : 0;
  if (halfX === 0 && halfZ === 0) return { x: zone.x, z: zone.z };
  const dx = fromX - zone.x;
  const dz = fromZ - zone.z;
  if (Math.abs(dx) / (halfX + 1) >= Math.abs(dz) / (halfZ + 1)) {
    return { x: zone.x + Math.sign(dx || 1) * (halfX + clearance), z: Math.max(zone.z - halfZ, Math.min(zone.z + halfZ, fromZ)) };
  }
  return { x: Math.max(zone.x - halfX, Math.min(zone.x + halfX, fromX)), z: zone.z + Math.sign(dz || 1) * (halfZ + clearance) };
}

const moveEvidence: unknown[] = [];
const DEBUG = Boolean(process.env.MARKET_QA_DEBUG_MOVE);

/** Steers toward a plain point (used for the real corridor/gate waypoints
 * that a straight line cannot cross — the actual doorway is not otherwise
 * discoverable from getInteractionZones() alone, which only lists real
 * *interaction* zones, not passable corridors). */
async function moveToPoint(label: string, target: { x: number; z: number }, tolerance: number, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  let lastCheckPos = await readPlayer();
  let stuckPulses = 0;
  let pulses = 0;
  while (Date.now() < deadline) {
    const current = await readPlayer();
    const dist = Math.hypot(current.x - target.x, current.z - target.z);
    if (dist <= tolerance) { await releaseAll(); moveEvidence.push({ label, target, tolerance, reached: current, distance: dist, pulses }); return; }
    const targetDir = normalize([target.x - current.x, target.z - current.z]);
    const combo = bestCombo(targetDir);
    await setKeys(combo);
    await page.waitForTimeout(300);
    pulses += 1;
    if (DEBUG) console.error(JSON.stringify({ label, current, dist, combo }));
    if (pulses % 4 === 0) {
      const moved = Math.hypot(current.x - lastCheckPos.x, current.z - lastCheckPos.z);
      if (moved < 0.15) {
        stuckPulses += 1;
        const perp: [number, number] = stuckPulses % 2 === 0 ? [-targetDir[1], targetDir[0]] : [targetDir[1], -targetDir[0]];
        await setKeys(bestCombo(perp));
        await page.waitForTimeout(320);
      } else stuckPulses = 0;
      lastCheckPos = current;
    }
  }
  await releaseAll();
  throw new Error(`Timeout moviendo hacia ${label} (${JSON.stringify(target)}): ${JSON.stringify({ player: await readPlayer() })}`);
}

/** Steers toward a real interaction zone's activation surface (box-aware —
 * see planarDistanceToZone/approachPointForZone above). */
async function moveToZone(label: string, zone: Zone, deadlineMs = 45_000) {
  const deadline = Date.now() + deadlineMs;
  let lastCheckPos = await readPlayer();
  let stuckPulses = 0;
  let pulses = 0;
  const clearance = Math.max(0.18, zone.enterRadius * 0.55);
  while (Date.now() < deadline) {
    const current = await readPlayer();
    const dist = planarDistanceToZone(zone, current.x, current.z);
    if (dist <= zone.enterRadius * 0.75) { await releaseAll(); moveEvidence.push({ label, zone, reached: current, distance: dist, pulses }); return; }
    const target = approachPointForZone(zone, current.x, current.z, clearance);
    const targetDir = normalize([target.x - current.x, target.z - current.z]);
    const combo = bestCombo(targetDir);
    await setKeys(combo);
    await page.waitForTimeout(300);
    pulses += 1;
    if (DEBUG) console.error(JSON.stringify({ label, current, dist, target, combo }));
    if (pulses % 4 === 0) {
      const moved = Math.hypot(current.x - lastCheckPos.x, current.z - lastCheckPos.z);
      if (moved < 0.15) {
        stuckPulses += 1;
        const perp: [number, number] = stuckPulses % 2 === 0 ? [-targetDir[1], targetDir[0]] : [targetDir[1], -targetDir[0]];
        await setKeys(bestCombo(perp));
        await page.waitForTimeout(320);
      } else stuckPulses = 0;
      lastCheckPos = current;
    }
  }
  await releaseAll();
  const diagnostics = { player: await readPlayer(), zones: await readZones() };
  throw new Error(`Timeout moviendo hacia ${label} (zona ${JSON.stringify(zone)}): ${JSON.stringify(diagnostics)}`);
}

// Real corridor from the sales floor through the rear door to the farm's
// interior entrance apron — the one route a straight line cannot take
// (it must pass through the doorway), built from the game's own real layout
// constants (never hand-guessed coordinates).
const FARM_ROUTE_WAYPOINTS_LAYOUT: Array<readonly [number, number]> = [
  ...STORE_REAR_DOOR.interiorCorridor,
  ...FARM_ACCESS_WAYPOINTS,
];
const FARM_ROUTE_WAYPOINTS = FARM_ROUTE_WAYPOINTS_LAYOUT.map(([x, z]) => {
  const [sx, sz] = scaleStorePoint([x, z]);
  return { x: sx, z: sz };
});

let failure: string | null = null;
const evidence: Record<string, unknown> = {};
try {
  const zones = await readZones();
  const farmZone = zones.find((zone) => zone.id === "farm:crop-tomato-1");
  const stockZone = zones.find((zone) => zone.id === "stock:eggs");
  if (!farmZone) throw new Error(`Zona farm:crop-tomato-1 no publicada: ${JSON.stringify(zones.map((z) => z.id))}`);
  if (!stockZone) throw new Error(`Zona stock:eggs no publicada: ${JSON.stringify(zones.map((z) => z.id))}`);
  evidence.farmZone = farmZone;
  evidence.stockZone = stockZone;

  // ---- 1) Restock (stock:eggs) first: frees carry capacity before harvest ----
  const beforeStock = await readGameSlice();
  evidence.beforeStock = beforeStock;
  await moveToZone("stock:eggs", stockZone);
  await page.waitForFunction((eggsBefore: number) => {
    const game = window.__MARKET_STORE__!.getState().game as RawGame;
    const franchiseState = game.franchises.find((item) => item.id === game.currentFranchiseId) ?? game.franchises[0];
    return (franchiseState.shelves.eggs ?? 0) !== eggsBefore;
  }, beforeStock.shelvesEggs, { timeout: 8_000 });
  const afterStock = await readGameSlice();
  evidence.afterStock = afterStock;
  await releaseAll();
  await page.screenshot({ path: path.join(outputRoot, "at-stock-eggs.png") });

  // ---- 2) Harvest (farm:crop-tomato-1): walk the real rear-door corridor first ----
  const beforeHarvest = await readGameSlice();
  evidence.beforeHarvest = beforeHarvest;
  for (const [index, waypoint] of FARM_ROUTE_WAYPOINTS.entries()) {
    await moveToPoint(`farm-route[${index}]`, waypoint, 1.1);
  }
  await moveToZone("farm:crop-tomato-1", farmZone);
  // Polled tightly from Node (not from inside one page.evaluate — a promise
  // built from a named recursive inner function does not survive Playwright's
  // per-call function serialization) so the transient GROWING state (crop-
  // tomato-1 regrows fast enough at this level/tier to cycle back to READY
  // within roughly a second) is reliably observed before it flips back.
  interface HarvestSnapshot { crop: { id: string; status: string; available: number; plantedAt: number } | null; carry: { capacity: number; items: Record<string, number> } }
  let harvestTransition: HarvestSnapshot | null = null;
  const harvestSnapshots: HarvestSnapshot[] = [];
  const originalAvailable = beforeHarvest.crops.find((c) => c.id === "crop-tomato-1")!.available;
  const originalPlantedAt = beforeHarvest.crops.find((c) => c.id === "crop-tomato-1")!.plantedAt;
  const harvestDeadline = Date.now() + 15_000;
  while (Date.now() < harvestDeadline) {
    const snap: HarvestSnapshot = await page.evaluate(() => {
      const game = window.__MARKET_STORE__!.getState().game as RawGame;
      const franchiseState = game.franchises.find((item) => item.id === game.currentFranchiseId) ?? game.franchises[0];
      const crop = franchiseState.crops.find((c) => c.id === "crop-tomato-1");
      return { crop: crop ? { ...crop } : null, carry: JSON.parse(JSON.stringify(franchiseState.carry)) as { capacity: number; items: Record<string, number> } };
    });
    if (DEBUG) harvestSnapshots.push(snap);
    // Robust against missing the narrow (single-poll-width) GROWING window:
    // a real harvest always changes plantedAt (re-planted) and/or available
    // (consumed then regrown), even if status has already cycled back to
    // READY by the time this Node round-trip lands.
    if (snap.crop && (snap.crop.plantedAt !== originalPlantedAt || snap.crop.available !== originalAvailable)) {
      harvestTransition = snap;
      break;
    }
    await page.waitForTimeout(30);
  }
  if (!harvestTransition) throw new Error(`timeout esperando la transición de cosecha de crop-tomato-1: ${JSON.stringify(harvestSnapshots.slice(-5))}`);
  evidence.harvestTransition = harvestTransition;
  const afterHarvest = await readGameSlice();
  evidence.afterHarvest = afterHarvest;
  await releaseAll();
  await page.screenshot({ path: path.join(outputRoot, "at-harvest-tomato.png") });

  if (afterStock.shelvesEggs <= beforeStock.shelvesEggs) throw new Error(`shelves.eggs no aumentó: ${JSON.stringify({ beforeStock, afterStock })}`);
  const tomatoBefore = beforeHarvest.crops.find((c) => c.id === "crop-tomato-1")!;
  if (!tomatoBefore || tomatoBefore.status !== "READY") throw new Error(`Estado previo a la cosecha inválido: ${JSON.stringify(tomatoBefore)}`);
  if (!harvestTransition.crop || (harvestTransition.crop.plantedAt === originalPlantedAt && harvestTransition.crop.available === originalAvailable)) throw new Error(`franchise.crops[crop-tomato-1] no cambió: ${JSON.stringify(harvestTransition)}`);
  const carryTomatoesAfter = harvestTransition.carry.items.tomatoes ?? afterHarvest.carry.items.tomatoes ?? 0;
  if (carryTomatoesAfter <= 0) throw new Error(`franchise.carry no recibió tomates cosechados: ${JSON.stringify({ harvestTransition, afterHarvest })}`);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const report = { generatedAt: new Date().toISOString(), appUrl, failure, evidence, moveEvidence, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (failure || consoleErrors.length || pageErrors.length || failedResponses.length) {
  throw new Error(`QA harvest/restock PlayCanvas falló: ${JSON.stringify({ failure, consoleErrors, pageErrors, failedResponses })}`);
}
