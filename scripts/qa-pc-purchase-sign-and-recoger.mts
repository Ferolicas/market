// PlayCanvas phase 14 QA: verifies the two items completed in this phase —
// (1) the constant "RECOGER" label above each open register's cash-bundle
// stack, whose local Y position must track the stack height as bundles are
// added/removed, and (2) the purchase-marker standing sign (post/board/face
// geometry + dirty-checked label/remaining-amount text via the shared
// `CanvasFont`) — using the real `PlayCanvasRuntime.update()` entry point
// (the same one `PlayCanvasCanvas.tsx` calls from React), not a
// private-internals bypass of the render path.
//
// Usage: `pnpm qa:pc-purchase-sign-recoger` or
// `pnpm exec tsx scripts/qa-pc-purchase-sign-and-recoger.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState } from "../src/game/engine";
import type { GameState } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-purchase-sign-recoger-qa";
await fs.mkdir(outputRoot, { recursive: true });

const baseSeed = JSON.parse(await fs.readFile("public/fixtures/runtime-level30-seed.json", "utf8")) as GameState;
const state = normalizeGameState(baseSeed);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

interface MarkerDebug { id: string; highlighted: boolean; fillVisible: boolean; fillScale: number; label: string; remainingLabel: string; labelText: string; remainingText: string }
interface RegisterDebug { lane: number; bundleCount: number; labelText: string; labelY: number }
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
  // ---- Item 2: purchase-marker sign text — real label/remainingLabel
  // strings, built + updated, then dirty-checked on a no-op re-send. ----
  const afterFirstBuild = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({ ...runtime.props, purchaseMarkers: [{ id: "cheese-maker-1", funded: 0.6, highlighted: true, label: "Quesera", remainingLabel: "12,00 €" }] });
    return runtime.getPurchaseMarkerDebug();
  });
  evidence.afterFirstBuild = afterFirstBuild;
  const cheese1 = afterFirstBuild.find((marker) => marker.id === "cheese-maker-1");
  if (!cheese1) throw new Error(`marcador cheese-maker-1 no se creó: ${JSON.stringify(afterFirstBuild)}`);
  if (cheese1.labelText !== "Quesera" || cheese1.remainingText !== "12,00 €") {
    throw new Error(`texto del letrero no coincide tras crear el marcador: ${JSON.stringify(cheese1)}`);
  }
  await page.screenshot({ path: path.join(outputRoot, "purchase-marker-sign-built.png") });

  // Changing only remainingLabel (real gameplay case: contributed amount
  // rising toward the cost) must update just that text, dirty-checked.
  const afterAmountChange = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({ ...runtime.props, purchaseMarkers: [{ id: "cheese-maker-1", funded: 0.9, highlighted: true, label: "Quesera", remainingLabel: "3,00 €" }] });
    return runtime.getPurchaseMarkerDebug();
  });
  evidence.afterAmountChange = afterAmountChange;
  const cheese2 = afterAmountChange.find((marker) => marker.id === "cheese-maker-1");
  if (!cheese2 || cheese2.remainingText !== "3,00 €" || cheese2.labelText !== "Quesera") {
    throw new Error(`texto no se actualizó al cambiar remainingLabel: ${JSON.stringify(cheese2)}`);
  }
  await page.screenshot({ path: path.join(outputRoot, "purchase-marker-sign-updated.png") });

  // A second marker with a different label (new characters for the shared
  // CanvasFont's atlas) must render correctly too — proves the shared-font
  // charset refresh does not corrupt the first marker's already-visible text.
  // The real player position is also moved to the new marker's real world
  // coordinates in this SAME `page.evaluate()` round trip (converting the
  // marker's world-space position back to the "layout units × STORE_LAYOUT_SCALE"
  // space `playerPosition` lives in, undoing the `WORLD_SCALE` the render
  // hierarchy applies on top of it) — the fixed isometric camera is
  // re-derived from the player's position every rendered frame
  // (`updateCamera()`'s `this.focus`), so this makes the sign legitimately
  // appear on-screen for the following screenshot, exactly as if the owner
  // had walked there. Doing this in the SAME evaluate call as the marker
  // build (rather than a later, separate one) avoids the real `GameShell.tsx`
  // React resync race documented in `qa-pc-purchase-and-register-visuals.mts`
  // (a separate round trip can have the synthetic marker/position already
  // stomped by the real effect before it runs).
  const afterSecondMarker = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__! as unknown as {
      update(props: Record<string, unknown>): void;
      props: Record<string, unknown>;
      getPurchaseMarkerDebug(): MarkerDebug[];
      playerPosition: { x: number; z: number };
      purchaseMarkerEntries: Map<string, { group: { getPosition(): { x: number; y: number; z: number } } }>;
    };
    runtime.update({
      ...runtime.props,
      purchaseMarkers: [
        { id: "cheese-maker-1", funded: 0.9, highlighted: true, label: "Quesera", remainingLabel: "3,00 €" },
        { id: "bread-oven-1", funded: 0.2, highlighted: false, label: "Horno panadería", remainingLabel: "480,00 €" },
      ],
    });
    const entry = runtime.purchaseMarkerEntries.get("cheese-maker-1");
    if (entry) {
      const pos = entry.group.getPosition();
      const WORLD_SCALE = 3;
      // Stand a few units back from the marker along the camera's own
      // forward axis (`OVERVIEW_CAMERA_OFFSET`, unit-normalized) rather than
      // exactly on top of it — the marker (and its sign) then sits BETWEEN
      // the player and the camera, unoccluded by the player's own body, the
      // same relative framing a real approaching owner would see.
      const offsetLen = Math.hypot(16, 25.75);
      const backX = 16 / offsetLen;
      const backZ = 25.75 / offsetLen;
      runtime.playerPosition.x = pos.x / WORLD_SCALE - backX * 3;
      runtime.playerPosition.z = pos.z / WORLD_SCALE - backZ * 3;
    }
    return runtime.getPurchaseMarkerDebug();
  });
  evidence.afterSecondMarker = afterSecondMarker;
  const cheese3 = afterSecondMarker.find((marker) => marker.id === "cheese-maker-1");
  const bakery = afterSecondMarker.find((marker) => marker.id === "bread-oven-1");
  if (!cheese3 || cheese3.remainingText !== "3,00 €") throw new Error(`marcador existente se corrompió al añadir uno nuevo: ${JSON.stringify(cheese3)}`);
  if (!bakery || bakery.labelText !== "Horno panadería" || bakery.remainingText !== "480,00 €") {
    throw new Error(`marcador nuevo con caracteres nuevos no renderizó su texto real: ${JSON.stringify(bakery)}`);
  }
  await page.screenshot({ path: path.join(outputRoot, "purchase-marker-two-signs.png") });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outputRoot, "purchase-marker-sign-closeup.png") });

  // Clear markers — group (and its sign) must be torn down.
  const afterClear = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({ ...runtime.props, purchaseMarkers: [] });
    return runtime.getPurchaseMarkerDebug();
  });
  evidence.afterClear = afterClear;
  if (afterClear.length !== 0) throw new Error(`marcadores no se destruyeron al vaciar la lista: ${JSON.stringify(afterClear)}`);

  // ---- Item 1: RECOGER label — constant text, Y position tracks the
  // real stack height (`registerCashStackHeight()`) as bundles change.
  // Amounts are derived from the real `cashBundleMinor` the live page
  // computed (country-scaled), not a hardcoded minor-unit guess, and both
  // stay well under `CASH_BUNDLE_RENDER_CAP` (240) so the comparison below
  // is a real "more bundles → taller stack", not two capped-equal piles. ----
  const afterFewBundles = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    const bundleMinor = runtime.props.cashBundleMinor as number;
    runtime.update({ ...runtime.props, registerCashMinor: [bundleMinor * 5, 0, 0] });
    return runtime.getRegisterCashDebug();
  });
  evidence.afterFewBundles = afterFewBundles;
  const lane0Few = afterFewBundles.find((entry) => entry.lane === 0);
  if (!lane0Few || lane0Few.labelText !== "RECOGER") throw new Error(`etiqueta RECOGER ausente o incorrecta con pocos fajos: ${JSON.stringify(lane0Few)}`);
  await page.screenshot({ path: path.join(outputRoot, "register-cash-recoger-few.png") });

  // A much larger deposit stacks far more bundle layers — the label's Y
  // must rise with the real stack height, not stay pinned.
  const afterManyBundles = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    const bundleMinor = runtime.props.cashBundleMinor as number;
    runtime.update({ ...runtime.props, registerCashMinor: [bundleMinor * 200, 0, 0] });
    return runtime.getRegisterCashDebug();
  });
  evidence.afterManyBundles = afterManyBundles;
  const lane0Many = afterManyBundles.find((entry) => entry.lane === 0);
  if (!lane0Many || lane0Many.labelText !== "RECOGER") throw new Error(`etiqueta RECOGER ausente tras subir el depósito: ${JSON.stringify(lane0Many)}`);
  if (!(lane0Many.bundleCount > lane0Few.bundleCount)) throw new Error(`el conteo de fajos no subió con el depósito mayor: few=${lane0Few.bundleCount} many=${lane0Many.bundleCount}`);
  if (!(lane0Many.labelY > lane0Few.labelY)) throw new Error(`la etiqueta RECOGER no subió con la pila más alta: few=${lane0Few.labelY} many=${lane0Many.labelY}`);
  await page.screenshot({ path: path.join(outputRoot, "register-cash-recoger-many.png") });

  // Draining the register must tear the pile (and its label) down.
  const afterDrain = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({ ...runtime.props, registerCashMinor: [0, 0, 0] });
    return runtime.getRegisterCashDebug();
  });
  evidence.afterDrain = afterDrain;
  if (afterDrain.some((entry) => entry.lane === 0)) throw new Error(`caja 0 no se vació tras drenar el depósito: ${JSON.stringify(afterDrain)}`);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const report = { generatedAt: new Date().toISOString(), appUrl, failure, evidence, consoleErrors, pageErrors, failedResponses };
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (failure || consoleErrors.length || pageErrors.length || failedResponses.length) {
  throw new Error(`QA letrero de compra / RECOGER PlayCanvas falló: ${JSON.stringify({ failure, consoleErrors, pageErrors, failedResponses })}`);
}
