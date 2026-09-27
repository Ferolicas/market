// PlayCanvas phase 15 QA (item 2 scope): verifies the real cart-bay/returns
// dynamic detail `PlayCanvasRuntime.stepCartBay()`/`stepReturnsCubicle()` now
// drive (previously both were one static colored box each, no cart count, no
// returned-item units, no sign text).
//
// Loads the real level-30 seed fixture, reads the LIVE scene graph for the
// baseline `franchise.returnedCartCount`/`franchise.returnsBin`, then — via
// the real `useMarketStore` `setState` — sets `returnedCartCount` to 4 and
// `returnsBin` to a real multi-SKU inventory, and confirms: all 4
// `shopping-cart` entities become enabled, and `returns-unit:*` entities
// appear matching the real capped-at-6 count `returnsCubicle.ts`'s own
// `update()` computes.
//
// Usage: `pnpm exec tsx scripts/qa-pc-cartbay-returns.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState } from "../src/game/engine";
import type { GameState } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-cartbay-returns-qa";
await fs.mkdir(outputRoot, { recursive: true });

const baseSeed = JSON.parse(await fs.readFile("public/fixtures/runtime-level30-seed.json", "utf8")) as GameState;
const state = normalizeGameState(baseSeed);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

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

function countEnabled(prefix: string): Promise<number> {
  return page.evaluate((p: string) => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    const nodes = runtime.app.root.find((node) => {
      const n = node as { name?: string };
      return typeof n.name === "string" && n.name.startsWith(p);
    }) as Array<{ enabled: boolean }>;
    return nodes.filter((n) => n.enabled).length;
  }, prefix);
}

// The level-30 seed's own `returnedCartCount`/`returnsBin` are already
// saturated (964 carts clamps to 4; the bin already sums past 6), which would
// make a bump-to-max mutation a no-op. Zero both first so the later mutation
// is a REAL, visible state delta (2 carts min / 0 return units -> 4 carts /
// 6 return units), not just two saturated reads.
await page.evaluate(() => {
  interface RawGame {
    currentFranchiseId: string;
    franchises: Array<{ id: string; returnedCartCount: number; returnsBin: Record<string, number> }>;
  }
  interface RawStore { getState(): { game: RawGame }; setState(partial: { game: RawGame }): void }
  const store = window.__MARKET_STORE__ as unknown as RawStore;
  const game = store.getState().game;
  const nextFranchises = game.franchises.map((f) => f.id === game.currentFranchiseId
    ? { ...f, returnedCartCount: 0, returnsBin: {} }
    : f);
  store.setState({ game: { ...game, franchises: nextFranchises } });
});
await page.waitForTimeout(500);

const cartsBefore = await countEnabled("shopping-cart");
const returnsBefore = await countEnabled("returns-unit:");
console.log(`before (zeroed): carts enabled=${cartsBefore} returns-units=${returnsBefore}`);
await page.screenshot({ path: path.join(outputRoot, "before.png") });

await page.evaluate(() => {
  interface RawGame {
    currentFranchiseId: string;
    franchises: Array<{ id: string; returnedCartCount: number; returnsBin: Record<string, number> }>;
  }
  interface RawStore { getState(): { game: RawGame }; setState(partial: { game: RawGame }): void }
  const store = window.__MARKET_STORE__ as unknown as RawStore;
  const game = store.getState().game;
  const nextFranchises = game.franchises.map((f) => f.id === game.currentFranchiseId
    ? { ...f, returnedCartCount: 4, returnsBin: { apples: 3, bread: 2, milk: 5 } }
    : f);
  store.setState({ game: { ...game, franchises: nextFranchises } });
});
await page.waitForTimeout(500);

const cartsAfter = await countEnabled("shopping-cart");
const returnsAfter = await countEnabled("returns-unit:");
console.log(`after: carts enabled=${cartsAfter} returns-units=${returnsAfter}`);
await page.screenshot({ path: path.join(outputRoot, "after.png") });

// apples:3 + bread:2 + milk:5(capped at 6 total) -> min(6, 3+2+5)=6
const expectedReturnUnits = 6;
const results = {
  cartsStartedAtMinimum: cartsBefore === 2,
  returnsStartedAtZero: returnsBefore === 0,
  cartsWentToFour: cartsAfter === 4,
  returnsUnitsMatchInventory: returnsAfter === expectedReturnUnits,
};
console.log("RESULTS:", results);

await browser.close();

const report = {
  ok: Object.values(results).every(Boolean) && consoleErrors.length === 0 && pageErrors.length === 0,
  results,
  cartsBefore,
  returnsBefore,
  cartsAfter,
  returnsAfter,
  consoleErrors,
  pageErrors,
};
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
