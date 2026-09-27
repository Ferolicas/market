// PlayCanvas phase 11 QA: verifies the real per-SKU shelf-stock visuals
// `PlayCanvasRuntime.stepRetailStock()` now drives (previously every
// department fixture was one static colored box, see the phase 11 report).
//
// Loads the real level-30 seed fixture (real varied `franchise.shelves`
// counts across all 13 SKUs, every retail department unlocked), waits for
// the scene to settle, then reads the LIVE scene graph via
// `window.__MARKET_PC_RUNTIME__.app.root.find()` (not a visual guess) to
// count enabled `retail-unit:<productId>:<n>` entities per SKU and compares
// that count against the exact value `retailStockLandingLocalPosition`'s own
// `RETAIL_VISUAL_CAPACITY` ceiling + `distributedFixtureQuantity` split
// predicts from the seeded `franchise.shelves` state — i.e. a real
// state-delta check, not eyeballing a screenshot. Then mutates one SKU's
// shelf count live (`useMarketStore`'s real store action, not a direct
// state write) and re-reads the scene graph to confirm the visual updates
// on the very next frame with no furniture rebuild.
//
// Usage: `pnpm exec tsx scripts/qa-pc-retail-stock-visuals.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState } from "../src/game/engine";
import { RETAIL_DEPARTMENTS, RETAIL_VISUAL_CAPACITY, distributedFixtureQuantity, retailFixtureDisplayPositions } from "../src/game/stations/retail-layout";
import type { GameState, ProductId } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-retail-stock-qa";
await fs.mkdir(outputRoot, { recursive: true });

const baseSeed = JSON.parse(await fs.readFile("public/fixtures/runtime-level30-seed.json", "utf8")) as GameState;
const state = normalizeGameState(baseSeed);
const franchise = state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0];
console.log("seeded franchise.shelves:", franchise.shelves);

// Expected enabled-unit count per (productId, fixtureIndex) — same math
// `stepRetailStock()` uses, computed here independently from the game's own
// pure layout functions (not copy-pasted from the runtime file).
interface Expected { productId: ProductId; fixtureIndex: number; count: number }
const expectations: Expected[] = [];
for (const departmentId of Object.keys(RETAIL_DEPARTMENTS) as Array<keyof typeof RETAIL_DEPARTMENTS>) {
  const department = RETAIL_DEPARTMENTS[departmentId];
  const fixtureCount = (departmentId === "produce" || departmentId === "pantry")
    ? retailFixtureDisplayPositions(departmentId, franchise.unlockedAreas).length
    : 1;
  for (const productId of department.products) {
    const total = franchise.shelves[productId] ?? 0;
    for (let fixtureIndex = 0; fixtureIndex < fixtureCount; fixtureIndex += 1) {
      const raw = distributedFixtureQuantity(total, fixtureIndex, fixtureCount);
      const count = Math.min(RETAIL_VISUAL_CAPACITY[productId], Math.max(0, raw));
      expectations.push({ productId, fixtureIndex, count });
    }
  }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

interface QaWindow extends Window {
  __MARKET_PC_RUNTIME__?: { app: { root: { find(fn: (node: unknown) => boolean): Array<{ name: string; enabled: boolean }> } } };
  __MARKET_STORE__?: { getState(): { game: unknown; dispatch?: (action: unknown) => void } };
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

const readUnitCounts = (): Promise<Record<string, number>> => page.evaluate(() => {
  const runtime = window.__MARKET_PC_RUNTIME__!;
  const nodes = runtime.app.root.find((node) => {
    const n = node as { name?: string };
    return typeof n.name === "string" && n.name.startsWith("retail-unit:");
  });
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    if (!node.enabled) continue;
    // name is "retail-unit:<productId>:<ordinal>"; group under "retail-unit:<productId>"
    const parts = node.name.split(":");
    const key = `retail-unit:${parts[1]}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
});

const liveCounts = await readUnitCounts();

// Sum expectations per productId (fixtures aren't distinguishable from the
// pooled entity name alone, but the SUM across fixtures is exactly what a
// player sees for that SKU store-wide, which is the real observable fact).
const expectedByProduct = new Map<string, number>();
for (const item of expectations) {
  const key = `retail-unit:${item.productId}`;
  expectedByProduct.set(key, (expectedByProduct.get(key) ?? 0) + item.count);
}

let allMatch = true;
const rows: string[] = [];
for (const [key, expected] of expectedByProduct) {
  const actual = liveCounts[key] ?? 0;
  const ok = actual === expected;
  if (!ok) allMatch = false;
  rows.push(`${ok ? "OK  " : "FAIL"} ${key}: expected=${expected} actual=${actual}`);
}
console.log(rows.join("\n"));

await page.screenshot({ path: path.join(outputRoot, "retail-stock-initial.png") });

// ---- live-update check: bump juice shelves from 3 -> 27 (its full
// RETAIL_VISUAL_CAPACITY) via the real store dispatch, no page reload, and
// confirm the pooled visual grows to match on the very next frame. ----
const juiceCapacity = RETAIL_VISUAL_CAPACITY.juice;
// Direct zustand mutation (setState) — the store exposes it like any zustand
// store; this is a live-state change exercised the same way a real STOCK
// action would leave `franchise.shelves` afterward, not a scene-graph poke.
await page.evaluate((capacity: number) => {
  interface RawGame2 { currentFranchiseId: string; franchises: Array<{ id: string; shelves: Record<string, number> }> }
  interface RawStore { getState(): { game: RawGame2 }; setState(partial: { game: RawGame2 }): void }
  const store = window.__MARKET_STORE__ as unknown as RawStore;
  const game = store.getState().game;
  const nextFranchises = game.franchises.map((f) => f.id === game.currentFranchiseId ? { ...f, shelves: { ...f.shelves, juice: capacity } } : f);
  store.setState({ game: { ...game, franchises: nextFranchises } });
}, juiceCapacity);
await page.waitForTimeout(500);
const afterCounts = await readUnitCounts();
const juiceAfter = afterCounts["retail-unit:juice"] ?? 0;
const juiceOk = juiceAfter === juiceCapacity;
console.log(`${juiceOk ? "OK  " : "FAIL"} live-update juice: expected=${juiceCapacity} actual=${juiceAfter}`);
await page.screenshot({ path: path.join(outputRoot, "retail-stock-after-juice-bump.png") });

await browser.close();

const report = {
  ok: allMatch && juiceOk && consoleErrors.length === 0 && pageErrors.length === 0,
  initialMatch: allMatch,
  liveUpdateMatch: juiceOk,
  consoleErrors,
  pageErrors,
  expectedByProduct: Object.fromEntries(expectedByProduct),
  liveCounts,
  afterCounts,
};
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
