// PlayCanvas phase 10 QA: verifies the two new real visuals from Part B's
// gap audit — the purchase-marker pulsing floor square (fill scales with
// `funded`, colour reflects `highlighted`) and the register-cash stacked
// bundle pile (bundle count reflects `registerCashMinor`) — using the real
// `PlayCanvasRuntime.update()` entry point (the same one `PlayCanvasCanvas.tsx`
// calls from React), not a private-internals bypass of the render path.
//
// Usage: `pnpm qa:pc-purchase-register-visuals` or
// `pnpm exec tsx scripts/qa-pc-purchase-and-register-visuals.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState } from "../src/game/engine";
import type { GameState } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-purchase-register-qa";
await fs.mkdir(outputRoot, { recursive: true });

const baseSeed = JSON.parse(await fs.readFile("public/fixtures/runtime-level30-seed.json", "utf8")) as GameState;
const state = normalizeGameState(baseSeed);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

interface MarkerDebug { id: string; highlighted: boolean; fillVisible: boolean; fillScale: number }
interface RegisterDebug { lane: number; bundleCount: number }
interface RuntimeInternals { props: Record<string, unknown>; update(props: Record<string, unknown>): void; getPurchaseMarkerDebug(): MarkerDebug[]; getRegisterCashDebug(): RegisterDebug[] }
interface QaWindow extends Window {
  __MARKET_PC_RUNTIME__?: RuntimeInternals;
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
await page.waitForTimeout(1_000);

let failure: string | null = null;
const evidence: Record<string, unknown> = {};
try {
  // ---- Purchase marker: drive a real `update()` call (the same seam React
  // uses) with a synthetic marker on a real, already-laid-out fixture id. ----
  const beforeMarkers = await page.evaluate(() => window.__MARKET_PC_RUNTIME__!.getPurchaseMarkerDebug());
  evidence.beforeMarkers = beforeMarkers;
  // `update()` (and the debug read right after it) run inside ONE
  // `page.evaluate()` round trip deliberately — the real `GameShell.tsx`
  // React effect re-syncs `runtime.update(initialProps)` on its own tick
  // cadence, so a synthetic props override made via a separate `page.evaluate`
  // round trip can be stomped by that real resync before a later
  // `page.evaluate` reads it back; reading synchronously in the same
  // in-page call captures this call's own effect deterministically.
  const afterUpdate = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({ ...runtime.props, purchaseMarkers: [{ id: "cheese-maker-1", funded: 0.6, highlighted: true }], registerCashMinor: [500_000, 0, 0] });
    return { markers: runtime.getPurchaseMarkerDebug(), register: runtime.getRegisterCashDebug() };
  });
  const afterMarkers = afterUpdate.markers;
  evidence.afterMarkers = afterMarkers;
  const cheese = afterMarkers.find((marker) => marker.id === "cheese-maker-1");
  if (!cheese) throw new Error(`marcador cheese-maker-1 no se creó: ${JSON.stringify(afterMarkers)}`);
  if (!cheese.highlighted) throw new Error(`marcador no quedó highlighted: ${JSON.stringify(cheese)}`);
  if (!cheese.fillVisible || Math.abs(cheese.fillScale - 0.6) > 1e-6) throw new Error(`fill no refleja funded=0.6: ${JSON.stringify(cheese)}`);
  await page.screenshot({ path: path.join(outputRoot, "purchase-marker-highlighted.png") });

  // The 500_000 minor-unit deposit set above already produced a real
  // rendered bundle pile at lane 0 (read back in the same evaluate call
  // that made it visible, above — for the same race-avoidance reason).
  const registerDebug = afterUpdate.register;
  evidence.registerDebug = registerDebug;
  const lane0 = registerDebug.find((entry) => entry.lane === 0);
  if (!lane0 || lane0.bundleCount <= 0) throw new Error(`caja 0 no muestra fajos con registerCashMinor=[500000,0,0]: ${JSON.stringify(registerDebug)}`);
  await page.screenshot({ path: path.join(outputRoot, "register-cash-bundles.png") });

  // Drop funded to 0 and unhighlight — fill must hide, colour must revert.
  const afterReset = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({ ...runtime.props, purchaseMarkers: [{ id: "cheese-maker-1", funded: 0, highlighted: false }] });
    return runtime.getPurchaseMarkerDebug();
  });
  evidence.afterReset = afterReset;
  const cheeseReset = afterReset.find((marker) => marker.id === "cheese-maker-1");
  if (!cheeseReset || cheeseReset.fillVisible || cheeseReset.highlighted) throw new Error(`marcador no volvió a estado sin fondear: ${JSON.stringify(cheeseReset)}`);

  // Removing the marker from the list must tear down its entity; zeroing
  // registerCashMinor must tear that pile down too — both in one call.
  const afterClear = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({ ...runtime.props, purchaseMarkers: [], registerCashMinor: [0, 0, 0] });
    return { markers: runtime.getPurchaseMarkerDebug(), register: runtime.getRegisterCashDebug() };
  });
  evidence.afterClear = afterClear;
  if (afterClear.markers.some((marker) => marker.id === "cheese-maker-1")) throw new Error(`marcador no se destruyó al quitarlo de la lista: ${JSON.stringify(afterClear.markers)}`);
  if (afterClear.register.some((entry) => entry.lane === 0)) throw new Error(`caja 0 no se vació al bajar registerCashMinor a 0: ${JSON.stringify(afterClear.register)}`);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const report = { generatedAt: new Date().toISOString(), appUrl, failure, evidence, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (failure || consoleErrors.length || pageErrors.length || failedResponses.length) {
  throw new Error(`QA purchase/register visuals PlayCanvas falló: ${JSON.stringify({ failure, consoleErrors, pageErrors, failedResponses })}`);
}
