// PlayCanvas phase 8 QA: verifies a real purchase-marker interaction
// (`isPurchaseInteractionId`/`purchase:*` zone ids from
// `interactionZoneConfigsPure.ts`) actually dispatches `onInteract` with the
// right purchase id when the real player walks onto a real, currently
// available purchase marker, and that the resulting real franchise state
// (`franchise.purchases` — `PurchaseState`/campaign progress) advances.
//
// Reuses the same real pathfinding-aware-enough walker
// `qa-pc-harvest-restock.mts` (phase 7) built: straight-line steering
// corrected every ~300ms toward a target/zone, read back with
// `window.__MARKET_PC_RUNTIME__.getPlayerPosition()`/`getInteractionZones()`.
//
// Seed: the real level-30 fixture, with one already-fully-paid campaign
// purchase (`corn-canner-1` — no personal tasks gate: `purchaseTasks()`
// returns `[]` for it, so it needs no other mutated game state) put back to
// "available but unpaid" by clearing its `purchased`/`contributions` entry —
// the exact same shape `contributePurchase()` produces for a brand-new
// purchase, not a synthetic one. Its marker sits inside the store proper
// (`PURCHASE_MARKER_PLACEMENTS`/`AUTHORED_POSITIONS["corn-canner-1"]` = layout
// [10.6, -5.6]), so no rear-door corridor crossing is needed to reach it.
//
// Verifies (with real before/after state-delta evidence, read from
// `window.__MARKET_STORE__.getState().game`):
//  1. `purchase:corn-canner-1` zone is published once the purchase is
//     available (real `availablePurchaseIds`/`purchaseMarkers` derivation in
//     `GameShell.tsx`).
//  2. Walking onto it and dwelling fires the real `CONTRIBUTE_PURCHASE`
//     action: `franchise.purchases.contributions["corn-canner-1"]` increases
//     from 0 and `game.balanceMinor` decreases by the same real pulse amount
//     (`purchaseContributionPulseMinor`).
//
// Usage: `pnpm qa:pc-purchase-marker` or `pnpm exec tsx scripts/qa-pc-purchase-marker.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState } from "../src/game/engine";
import type { GameState } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-purchase-marker-qa";
await fs.mkdir(outputRoot, { recursive: true });

// ---- seed: the real level-30 fixture, with corn-canner-1 (no personal-task
// gate) put back to "available, unpaid" — see the file doc comment. ----
const baseSeed = JSON.parse(await fs.readFile("public/fixtures/runtime-level30-seed.json", "utf8")) as GameState;
const state = normalizeGameState(baseSeed);
const franchise = state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0];
if (!franchise.purchases) throw new Error("El fixture base no tiene franchise.purchases (no es una partida de campaña).");
if (!franchise.purchases.purchased.includes("corn-canner-1")) throw new Error("corn-canner-1 no estaba comprado en el fixture base; el seed cambió, revisar el script.");
franchise.purchases = {
  ...franchise.purchases,
  purchased: franchise.purchases.purchased.filter((id) => id !== "corn-canner-1"),
  contributions: { ...franchise.purchases.contributions, "corn-canner-1": 0 },
};

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});
interface Zone { id: string; x: number; z: number; enterRadius: number; halfExtents: [number, number] | null }
interface QaWindow extends Window {
  __MARKET_PC_RUNTIME__?: { getPlayerPosition(): { x: number; z: number }; getInteractionZones(): Zone[] };
  __MARKET_STORE__?: { getState(): { game: unknown } };
}
declare const window: QaWindow;

interface RawPurchases { purchased: string[]; contributions: Record<string, number> }
interface RawFranchise { purchases: RawPurchases | null }
interface RawGame { currentFranchiseId: string; balanceMinor: number; franchises: Array<{ id: string } & RawFranchise> }
interface GameSlice { balanceMinor: number; contributedMinor: number; purchased: boolean }

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
await page.waitForFunction(() => Boolean(window.__MARKET_PC_RUNTIME__?.getPlayerPosition()), null, { timeout: 15_000 });
await page.waitForTimeout(1_500);

const readGameSlice = (): Promise<GameSlice> => page.evaluate(() => {
  const game = window.__MARKET_STORE__!.getState().game as RawGame;
  const franchiseState = game.franchises.find((item) => item.id === game.currentFranchiseId) ?? game.franchises[0];
  const purchases = franchiseState.purchases;
  return {
    balanceMinor: game.balanceMinor,
    contributedMinor: purchases?.contributions["corn-canner-1"] ?? 0,
    purchased: purchases?.purchased.includes("corn-canner-1") ?? false,
  };
});
const readPlayer = () => page.evaluate(() => window.__MARKET_PC_RUNTIME__!.getPlayerPosition());
const readZones = () => page.evaluate(() => window.__MARKET_PC_RUNTIME__!.getInteractionZones());

// ---- keyboard-combo -> real world-direction table (mirrors
// PlayCanvasRuntime's onKey -> inputManager.setKeyboard ->
// cameraRelativeMovement chain exactly — see PlayerController.ts). Copied
// verbatim from qa-pc-harvest-restock.mts (kept in sync manually; both are
// small enough that a shared module would cost more than it saves). ----
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

let failure: string | null = null;
const evidence: Record<string, unknown> = {};
try {
  const zones = await readZones();
  const purchaseZone = zones.find((zone) => zone.id === "purchase:corn-canner-1");
  if (!purchaseZone) throw new Error(`Zona purchase:corn-canner-1 no publicada: ${JSON.stringify(zones.map((z) => z.id))}`);
  evidence.purchaseZone = purchaseZone;

  const before = await readGameSlice();
  evidence.before = before;
  if (before.purchased) throw new Error(`corn-canner-1 ya aparece comprado antes de interactuar: ${JSON.stringify(before)}`);
  if (before.contributedMinor !== 0) throw new Error(`corn-canner-1 ya tiene contribución antes de interactuar: ${JSON.stringify(before)}`);

  await moveToZone("purchase:corn-canner-1", purchaseZone);
  // Standing on the marker pays a pulse every PURCHASE_CONTRIBUTION_PULSE_MS
  // (200ms) — wait for the real contribution to move off zero, then hold a
  // beat longer to also capture the real balance debit in the same slice.
  await page.waitForFunction(() => {
    const game = window.__MARKET_STORE__!.getState().game as RawGame;
    const franchiseState = game.franchises.find((item) => item.id === game.currentFranchiseId) ?? game.franchises[0];
    return (franchiseState.purchases?.contributions["corn-canner-1"] ?? 0) > 0;
  }, null, { timeout: 8_000 });
  await page.waitForTimeout(600);
  const after = await readGameSlice();
  evidence.after = after;
  await releaseAll();
  await page.screenshot({ path: path.join(outputRoot, "at-purchase-corn-canner.png") });

  if (after.contributedMinor <= before.contributedMinor) throw new Error(`franchise.purchases.contributions["corn-canner-1"] no aumentó: ${JSON.stringify({ before, after })}`);
  if (after.balanceMinor >= before.balanceMinor) throw new Error(`game.balanceMinor no disminuyó: ${JSON.stringify({ before, after })}`);
  const spent = before.balanceMinor - after.balanceMinor;
  const gained = after.contributedMinor - before.contributedMinor;
  if (spent !== gained) throw new Error(`El gasto de saldo (${spent}) no coincide con el aporte registrado (${gained}): ${JSON.stringify({ before, after })}`);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const report = { generatedAt: new Date().toISOString(), appUrl, failure, evidence, moveEvidence, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (failure || consoleErrors.length || pageErrors.length || failedResponses.length) {
  throw new Error(`QA marcador de compra PlayCanvas falló: ${JSON.stringify({ failure, consoleErrors, pageErrors, failedResponses })}`);
}
