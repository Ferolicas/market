// PlayCanvas phase 15 QA: verifies the real checkout/production dynamic
// detail `PlayCanvasRuntime.stepCheckout()`/`stepProductionMachines()` now
// drive (previously the checkout counter and every production machine were
// static, transaction/machine-state-blind geometry — no belt light, no bags,
// no sliding units, no "LISTA"/"CAJA N" board text, no machine status board
// at all).
//
// Loads the real level-30 seed fixture, then — via the real `useMarketStore`
// zustand `setState` (like `qa-pc-retail-stock-visuals.mts`'s live-update
// check, not a direct scene-graph poke) — injects one real
// `CheckoutTransaction` (SCANNING state, partially scanned/bagged) into lane
// 0 and one real `ProductionMachineState` (PROCESSING, mid-queue) for the
// bread oven. Reads the LIVE scene graph via
// `window.__MARKET_PC_RUNTIME__.app.root.find()` before/after each mutation
// to confirm: the belt scanning-light intensity turns on, the register
// screen text switches from "LISTA" to "bagged/total", a belt product unit
// entity appears, a checkout bag becomes visible, the bakery's processing
// light turns on, and the bakery's status board text updates
// ("BLOQUEADA"/"CARGAR" -> "EN PROCESO") — real state-delta evidence, not a
// visual guess.
//
// Usage: `pnpm exec tsx scripts/qa-pc-checkout-and-production.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState } from "../src/game/engine";
import type { GameState } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-checkout-production-qa";
await fs.mkdir(outputRoot, { recursive: true });

const baseSeed = JSON.parse(await fs.readFile("public/fixtures/runtime-level30-seed.json", "utf8")) as GameState;
const state = normalizeGameState(baseSeed);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

interface SceneNode { name: string; enabled: boolean; text?: string; color?: { r: number; g: number; b: number }; intensity?: number; }
interface QaWindow extends Window {
  __MARKET_PC_RUNTIME__?: { app: { root: { find(fn: (node: unknown) => boolean): unknown[] } } };
  __MARKET_STORE__?: { getState(): { game: unknown }; setState(partial: unknown): void };
}
declare const window: QaWindow;

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));

await page.addInitScript((serialized: string) => {
  try { window.localStorage.setItem("mini-market-playcanvas-integral-v1", serialized); } catch { /* ignore */ }
}, JSON.stringify(state));

await page.goto(`${appUrl}/playcanvas`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_PC_RUNTIME__ && window.__MARKET_STORE__), null, { timeout: 30_000 });
await page.locator("canvas").first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(2_500);

function readNodes(prefixes: string[]): Promise<Record<string, SceneNode[]>> {
  return page.evaluate((wantedPrefixes: string[]) => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    const out: Record<string, SceneNode[]> = {};
    for (const prefix of wantedPrefixes) out[prefix] = [];
    const nodes = runtime.app.root.find((node) => {
      const n = node as { name?: string };
      return typeof n.name === "string" && wantedPrefixes.some((p) => n.name!.startsWith(p));
    }) as Array<Record<string, unknown>>;
    for (const node of nodes) {
      const name = node.name as string;
      const prefix = wantedPrefixes.find((p) => name.startsWith(p))!;
      const element = node.element as { text?: string; color?: { r: number; g: number; b: number } } | undefined;
      const light = node.light as { intensity?: number } | undefined;
      out[prefix].push({ name, enabled: node.enabled as boolean, text: element?.text, color: element?.color, intensity: light?.intensity });
    }
    return out;
  }, prefixes);
}

// ---- baseline read (no active transaction, no processing machine) ----
const before = await readNodes(["checkout-scanning-light", "screen-text", "checkout-unit:", "checkout-bag", "machine-processing-light", "machine-status-label", "machine-output"]);
console.log("BEFORE:", JSON.stringify(before, null, 2));

await page.screenshot({ path: path.join(outputRoot, "before.png") });

// ---- inject a real SCANNING transaction on lane 0 + a real PROCESSING bakery ----
await page.evaluate(() => {
  interface RawGame {
    currentFranchiseId: string;
    franchises: Array<{
      id: string;
      checkoutTransactions: unknown[];
      customers: unknown[];
      productionMachines: Array<{ id: string; productId: string; status: string; input: Record<string, number>; output: number; outputCapacity: number; startedAt: number | null; completesAt: number | null; tier: number }>;
    }>;
  }
  interface RawStore { getState(): { game: RawGame }; setState(partial: { game: RawGame }): void }
  const store = window.__MARKET_STORE__ as unknown as RawStore;
  const game = store.getState().game;
  const franchise = game.franchises.find((f) => f.id === game.currentFranchiseId)!;
  const transaction = {
    id: "qa-txn-1",
    customerId: "qa-customer-1",
    pendingItems: [{ productId: "apples", quantity: 4, loaded: 4, scanned: 2, bagged: 1 }],
    paymentMethod: "CASH",
    state: "SCANNING",
    nextUnitIndex: 2,
    paymentCommitted: false,
    updatedAt: Date.now(),
    lastLoadedAt: Date.now(),
    lastScannedAt: Date.now(),
    lastBaggedAt: Date.now(),
    checkoutLane: 0,
    handledByPlayer: true,
  };
  const customer = {
    id: "qa-customer-1", identity: 1, state: "WAIT_CHECKOUT", shoppingList: [], currentLine: 0, basket: {},
    patienceMs: 60000, checkoutPatienceMs: 60000, waitingSince: null, queueSlot: 0, queueLane: 0, queueJoinedAt: null,
    transactionId: "qa-txn-1", hasCart: true, hasBag: false, angry: false, x: 7, z: 2.85, targetX: 7, targetZ: 2.85,
    path: [], pathIndex: 0, speed: 1, stateSince: Date.now(), reservedSocketId: null, blockedSince: null, routeFailures: 0,
  };
  const nextMachines = franchise.productionMachines.map((m) => m.id === "bread-oven-1"
    ? { ...m, status: "PROCESSING", input: { flour: 3 }, startedAt: Date.now(), completesAt: Date.now() + 30_000 }
    : m);
  const nextFranchises = game.franchises.map((f) => f.id === game.currentFranchiseId
    ? { ...f, checkoutTransactions: [transaction], customers: [...f.customers, customer], productionMachines: nextMachines }
    : f);
  store.setState({ game: { ...game, franchises: nextFranchises } });
});

await page.waitForTimeout(700);
const after = await readNodes(["checkout-scanning-light", "screen-text", "checkout-unit:", "checkout-bag", "machine-processing-light", "machine-status-label", "machine-output"]);
console.log("AFTER:", JSON.stringify(after, null, 2));
await page.screenshot({ path: path.join(outputRoot, "after.png") });

const scanningLightOn = (after["checkout-scanning-light"]?.some((n) => (n.intensity ?? 0) > 0)) ?? false;
// pendingItems: quantity=4, bagged=1 -> "1/4" (`bagged`, not `scanned`, is the
// numerator `checkoutKit.ts`'s own screen text uses).
const screenShowsProgress = (after["screen-text"]?.some((n) => n.text === "1/4")) ?? false;
const beltUnitAppeared = (after["checkout-unit:"]?.length ?? 0) > (before["checkout-unit:"]?.length ?? 0);
const bagVisible = (after["checkout-bag"]?.some((n) => n.enabled)) ?? false;
const processingLightOn = (after["machine-processing-light"]?.some((n) => (n.intensity ?? 0) > 0)) ?? false;
const statusTextUpdated = (after["machine-status-label"]?.some((n) => n.text === "EN PROCESO")) ?? false;

const results = { scanningLightOn, screenShowsProgress, beltUnitAppeared, bagVisible, processingLightOn, statusTextUpdated };
console.log("RESULTS:", results);

await browser.close();

const report = {
  ok: Object.values(results).every(Boolean) && consoleErrors.length === 0 && pageErrors.length === 0,
  results,
  consoleErrors,
  pageErrors,
  before,
  after,
};
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
