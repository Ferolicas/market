// PlayCanvas phase 12 QA: verifies the four transfer-effect magnet bursts
// (harvest → basket, basket → shelf, basket → warehouse return, basket →
// purchase-marker payment) ported from `/runtime`'s real
// `src/client/WorldKit/transferEffects/bursts.ts`. Drives the real
// `PlayCanvasRuntime.update()`/`onUpdate` tick path (the same entry points
// `PlayCanvasCanvas.tsx`/React use), not a private-internals bypass of the
// render path — the only deliberate bypass is calling the runtime's own
// per-frame step function directly in a tight loop from inside ONE
// `page.evaluate()`, instead of waiting on real animation frames + GameShell's
// own re-render cadence. That avoids a real race: `PlayCanvasCanvas`'s
// `useEffect` calls `runtime.update(initialProps)` every time `GameShell`
// re-renders (its own `playCanvasSceneProps` object is a fresh literal every
// render), and the real seeded game never queues our synthetic
// `transferEvents` — so a subsequent real re-render would stomp the injected
// event before real animation frames had time to advance it. Stepping
// deterministically inside one evaluate call sidesteps that race entirely
// while still exercising the exact same `stepTransferBursts`/`tickTransferBurst`
// code the real per-frame `app.on("update", ...)` loop calls.
//
// Usage: `pnpm qa:pc-transfer-bursts` or
// `pnpm exec tsx scripts/qa-pc-transfer-bursts.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState } from "../src/game/engine";
import type { GameState } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-transfer-bursts-qa";
await fs.mkdir(outputRoot, { recursive: true });

const baseSeed = JSON.parse(await fs.readFile("public/fixtures/runtime-level30-seed.json", "utf8")) as GameState;
const state = normalizeGameState(baseSeed);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

interface BurstDebug { sequence: number; kind: string; particleCount: number; remaining: number; firstParticle: { enabled: boolean; x: number; y: number; z: number } | null }
interface RuntimeInternals {
  props: Record<string, unknown>;
  update(props: Record<string, unknown>): void;
  getTransferBurstDebug(): BurstDebug[];
  stepTransferBursts(dt: number): void;
}
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
  // ---- Harvest burst: crop-tomato-1 → basket. Injects the event, then
  // deterministically steps 12 frames of 0.1s (1.2s of visual time — comfortably
  // past the 0.045*4 stagger + 0.52s flight duration for a 5-particle burst)
  // inside one evaluate call, recording the first particle's position on every
  // step and every onProgress(sequence, remaining) call along the way. ----
  // (A synthetic `onTransferProgress` callback function value can't survive
  // Playwright's `page.evaluate` serialization round trip here, so progress
  // is instead read from `getTransferBurstDebug()`'s own `remaining` field —
  // the same value that callback would have been given, sourced from the
  // exact same `settleTransferBurst()` call.)
  const harvest = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({
      ...runtime.props,
      transferEvents: [{ sequence: 1, kind: "harvest", cropId: "crop-tomato-1", productId: "tomatoes", quantity: 5 }],
    });
    const immediate = runtime.getTransferBurstDebug();
    const steps: BurstDebug[] = [];
    for (let i = 0; i < 12; i += 1) {
      runtime.stepTransferBursts(0.1);
      steps.push(runtime.getTransferBurstDebug()[0]);
    }
    return { immediate: immediate[0] ?? null, steps };
  });
  evidence.harvest = harvest;
  if (!harvest.immediate || harvest.immediate.particleCount !== 5) throw new Error(`harvest burst no se creó con 5 partículas: ${JSON.stringify(harvest.immediate)}`);
  const firstStep = harvest.steps[0];
  const midStep = harvest.steps[5];
  const lastStep = harvest.steps[harvest.steps.length - 1];
  if (!firstStep?.firstParticle) throw new Error(`primera partícula de harvest no visible al inicio: ${JSON.stringify(firstStep)}`);
  if (!midStep || !lastStep) throw new Error("faltan pasos de harvest");
  // Real motion evidence: the first particle's x must move meaningfully
  // between an early step and a later one (flying from the crop plot toward
  // the player's basket).
  const movedX = Math.abs((midStep.firstParticle?.x ?? 0) - (firstStep.firstParticle?.x ?? 0));
  if (movedX < 0.01) throw new Error(`la partícula de harvest no se movió en X: first=${JSON.stringify(firstStep)} mid=${JSON.stringify(midStep)}`);
  if (lastStep.remaining !== 0) throw new Error(`harvest no completó su aterrizaje tras 1.2s: ${JSON.stringify(lastStep)}`);
  const remainingSequence = harvest.steps.map((step) => step.remaining);
  if (remainingSequence[0] !== 5 || remainingSequence[remainingSequence.length - 1] !== 0) throw new Error(`remaining no bajó de 5 a 0 a lo largo del vuelo: ${JSON.stringify(remainingSequence)}`);

  // Removing the event from the props array must tear its burst down —
  // exactly like `/runtime`'s own `sync()` disposing a burst whose sequence
  // disappeared from the ledger.
  const afterClearHarvest = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({ ...runtime.props, transferEvents: [] });
    return runtime.getTransferBurstDebug();
  });
  evidence.afterClearHarvest = afterClearHarvest;
  if (afterClearHarvest.length !== 0) throw new Error(`burst de harvest no se destruyó al vaciar transferEvents: ${JSON.stringify(afterClearHarvest)}`);

  // ---- Stock burst: basket → tomato display fixture. ----
  const stock = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({ ...runtime.props, transferEvents: [{ sequence: 2, kind: "stock", productId: "tomatoes", quantity: 3, shelfStart: 0 }] });
    const immediate = runtime.getTransferBurstDebug()[0] ?? null;
    for (let i = 0; i < 12; i += 1) runtime.stepTransferBursts(0.1);
    const settled = runtime.getTransferBurstDebug()[0] ?? null;
    return { immediate, settled };
  });
  evidence.stock = stock;
  if (!stock.immediate || stock.immediate.particleCount !== 3) throw new Error(`stock burst no se creó con 3 partículas: ${JSON.stringify(stock.immediate)}`);
  if (!stock.settled || stock.settled.remaining !== 0) throw new Error(`stock burst no completó su aterrizaje: ${JSON.stringify(stock.settled)}`);

  // ---- Return burst: basket → warehouse return crate. ----
  const returnBurst = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({ ...runtime.props, transferEvents: [{ sequence: 3, kind: "return", productId: "bread", quantity: 2 }] });
    const immediate = runtime.getTransferBurstDebug()[0] ?? null;
    for (let i = 0; i < 12; i += 1) runtime.stepTransferBursts(0.1);
    const settled = runtime.getTransferBurstDebug()[0] ?? null;
    return { immediate, settled };
  });
  evidence.returnBurst = returnBurst;
  if (!returnBurst.immediate || returnBurst.immediate.particleCount !== 2) throw new Error(`return burst no se creó con 2 partículas: ${JSON.stringify(returnBurst.immediate)}`);
  if (!returnBurst.settled || returnBurst.settled.remaining !== 0) throw new Error(`return burst no completó su aterrizaje: ${JSON.stringify(returnBurst.settled)}`);

  // ---- Pay burst: player hands → purchase marker square (shorter flight). ----
  const pay = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({ ...runtime.props, transferEvents: [{ sequence: 4, kind: "pay", purchaseId: "farmer-1", quantity: 4 }] });
    const immediate = runtime.getTransferBurstDebug()[0] ?? null;
    for (let i = 0; i < 8; i += 1) runtime.stepTransferBursts(0.1);
    const settled = runtime.getTransferBurstDebug()[0] ?? null;
    return { immediate, settled };
  });
  evidence.pay = pay;
  if (!pay.immediate || pay.immediate.particleCount !== 4) throw new Error(`pay burst no se creó con 4 partículas: ${JSON.stringify(pay.immediate)}`);
  if (!pay.settled || pay.settled.remaining !== 0) throw new Error(`pay burst no completó su aterrizaje: ${JSON.stringify(pay.settled)}`);

  // All four kinds coexisting at once, then all cleared together.
  const coexist = await page.evaluate(() => {
    const runtime = window.__MARKET_PC_RUNTIME__!;
    runtime.update({
      ...runtime.props,
      transferEvents: [
        { sequence: 10, kind: "harvest", cropId: "crop-tomato-1", productId: "tomatoes", quantity: 2 },
        { sequence: 11, kind: "stock", productId: "tomatoes", quantity: 2, shelfStart: 0 },
        { sequence: 12, kind: "return", productId: "bread", quantity: 2 },
        { sequence: 13, kind: "pay", purchaseId: "farmer-1", quantity: 2 },
      ],
    });
    const active = runtime.getTransferBurstDebug();
    runtime.update({ ...runtime.props, transferEvents: [] });
    const cleared = runtime.getTransferBurstDebug();
    return { active, cleared };
  });
  evidence.coexist = coexist;
  if (coexist.active.length !== 4) throw new Error(`no coexisten los 4 tipos de burst a la vez: ${JSON.stringify(coexist.active)}`);
  if (coexist.cleared.length !== 0) throw new Error(`no se limpiaron los 4 bursts a la vez: ${JSON.stringify(coexist.cleared)}`);

  await page.screenshot({ path: path.join(outputRoot, "transfer-bursts-idle.png") });
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

await fs.writeFile(path.join(outputRoot, "evidence.json"), JSON.stringify({ evidence, consoleErrors, pageErrors, failedResponses }, null, 2));
await browser.close();

if (failure || consoleErrors.length || pageErrors.length || failedResponses.length) {
  console.error("FAIL", failure ?? "", { consoleErrors, pageErrors, failedResponses });
  process.exit(1);
}
console.log("PASS — transfer-effect magnet bursts (harvest/stock/return/pay) verified via real update()/stepTransferBursts(). Evidence:", path.join(outputRoot, "evidence.json"));
