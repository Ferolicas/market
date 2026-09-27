// PlayCanvas phase 16 QA: verifies the real tube-instanced ShoppingCart
// lattice (buildSimplifiedCart -> buildTubeSegment, ported from
// checkout/cartBay.ts's buildShoppingCart) and the real PEDIDOS supplier
// corner (buildSupplierCornerDetail, ported from
// production/supplierAndWarehouse.ts's SupplierCorner) both actually build
// real geometry — not the prior box-basket cart / unlabeled placeholder box.
//
// Usage: `pnpm exec tsx scripts/qa-pc-cart-and-orders-detail.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState } from "../src/game/engine";
import type { GameState } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-cart-orders-qa";
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
await page.waitForTimeout(3_000);

function countNamed(prefix: string): Promise<number> {
  return page.evaluate((p: string) => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    const nodes = runtime.app.root.find((node) => {
      const n = node as { name?: string };
      return typeof n.name === "string" && n.name.startsWith(p);
    }) as Array<{ enabled: boolean }>;
    return nodes.length;
  }, prefix);
}

const cartTubes = await countNamed("cart-tube");
const cartWheelsOuter = await countNamed("cart-wheel-outer");
const cartForks = await countNamed("cart-fork");
const ordersTerminal = await countNamed("fixture:fixture:orders");
const terminalScreen = await countNamed("terminal-screen");
const terminalIndicator = await countNamed("terminal-indicator");
const ordersPallet = await countNamed("orders-pallet");
const ordersParcels = await countNamed("orders-parcel");

await page.screenshot({ path: path.join(outputRoot, "playcanvas-overview.png") });

const results = {
  // 4 carts x (1 grip + 2 fixed frame + 12 frame015 + 4 diagonalBasket + 6 sideRail + 2 legStrut) = 4 x 27 = 108
  cartTubesMatchLattice: cartTubes === 108,
  cartWheelsPresent: cartWheelsOuter === 16, // 4 carts x 4 wheel positions
  cartForksPresent: cartForks === 16,
  ordersFixtureExists: ordersTerminal >= 1,
  terminalScreenExists: terminalScreen === 2, // "terminal-screen" + "terminal-screen-text"
  terminalIndicatorExists: terminalIndicator === 1,
  ordersPalletExists: ordersPallet === 1,
  ordersParcelsExist: ordersParcels === 3,
  noConsoleErrors: consoleErrors.length === 0,
  noPageErrors: pageErrors.length === 0,
};
console.log("RESULTS:", results);
console.log({ cartTubes, cartWheelsOuter, cartForks, ordersTerminal, terminalScreen, terminalIndicator, ordersPallet, ordersParcels });

await browser.close();

const report = { ok: Object.values(results).every(Boolean), results, raw: { cartTubes, cartWheelsOuter, cartForks, ordersTerminal, terminalScreen, terminalIndicator, ordersPallet, ordersParcels }, consoleErrors, pageErrors };
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
