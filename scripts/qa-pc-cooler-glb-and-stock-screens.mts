// PlayCanvas gap-closure QA (2026-09-27, "punch list" phase): verifies the
// three items ported this pass:
//  1. Real GLB cooler case for dairy/eggs (`buildChillerFixtureShell`) — the
//     `fixture-model:retail-dairy` / `fixture-model:retail-eggs` anchors now
//     carry real loaded render geometry (meshInstances > 0), not the former
//     primitive back-panel/uprights/canopy/glass placeholder.
//  2. Real GLB ceiling light (`equipment_ceiling_light.glb`) — each
//     `ceiling-lamp:<x>` entity now contains real loaded render geometry
//     (previously a primitive cylinder shade+bulb, `lamp-shade`/`lamp-bulb`,
//     which no longer exist at all).
//  3. Real per-SKU stock-screen dynamic count/status text
//     (`buildStockScreenFace`) — a `dynamic:stock-screen` group with
//     `stock-screen-count`/`stock-screen-status` text elements exists per
//     retail SKU with a screen, and the live text matches the seeded
//     `franchise.shelves` count exactly (a real state-delta read off the
//     scene graph, not a screenshot guess).
//
// Usage: `pnpm exec tsx scripts/qa-pc-cooler-glb-and-stock-screens.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState, shelfCapacityForTier } from "../src/game/engine";
import { RETAIL_DEPARTMENTS, distributedFixtureQuantity, retailFixtureDisplayPositions } from "../src/game/stations/retail-layout";
import type { GameState, ProductId } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-cooler-stock-screens-qa";
await fs.mkdir(outputRoot, { recursive: true });

const baseSeed = JSON.parse(await fs.readFile("public/fixtures/runtime-level30-seed.json", "utf8")) as GameState;
const normalizedBase = normalizeGameState(baseSeed);
const state: GameState = {
  ...normalizedBase,
  franchises: normalizedBase.franchises.map((f) => f.id === normalizedBase.currentFranchiseId ? { ...f, open: true, lightsOn: true } : f),
};
const franchise = state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0];
console.log("seeded franchise.shelves:", franchise.shelves);

const shelfTier = franchise.stationTiers["shelves-1"] ?? franchise.shelvesLevel;
interface Expected { productId: ProductId; count: string }
const expectations: Expected[] = [];
for (const departmentId of Object.keys(RETAIL_DEPARTMENTS) as Array<keyof typeof RETAIL_DEPARTMENTS>) {
  if (departmentId === "produce") continue; // no stock screen in the source
  const department = RETAIL_DEPARTMENTS[departmentId];
  const fixtureCount = departmentId === "pantry" ? retailFixtureDisplayPositions(departmentId, franchise.unlockedAreas).length : 1;
  for (const productId of department.products) {
    const total = franchise.shelves[productId] ?? 0;
    for (let fixtureIndex = 0; fixtureIndex < fixtureCount; fixtureIndex += 1) {
      const rawCount = distributedFixtureQuantity(total, fixtureIndex, fixtureCount);
      const capacity = distributedFixtureQuantity(shelfCapacityForTier(shelfTier, productId, franchise.unlockedAreas), fixtureIndex, fixtureCount);
      expectations.push({ productId, count: `${rawCount}/${capacity}` });
    }
  }
}
console.log("expected stock-screen readouts:", expectations);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

interface QaWindow extends Window {
  __MARKET_PC_RUNTIME__?: { app: { root: { find(fn: (node: unknown) => boolean): unknown[] } } };
  __MARKET_STORE__?: { getState(): { game: unknown } };
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
// Real async GLB loads (dairy/egg-display/ceiling-light) need real settle time.
await page.waitForTimeout(4_000);

// ---- 1 & 2: real GLB geometry present ----
const glbMeshCounts = await page.evaluate(() => {
  const runtime = window.__MARKET_PC_RUNTIME__!;
  const targets = ["fixture-model:retail-dairy", "fixture-model:retail-eggs"];
  const result: Record<string, number> = {};
  for (const target of targets) {
    const nodes = runtime.app.root.find((node) => (node as { name?: string }).name === target) as Array<{ children?: unknown[] }>;
    let meshCount = 0;
    for (const node of nodes) {
      const stack: Array<{ children?: unknown[]; render?: { meshInstances?: unknown[] } }> = [node as never];
      while (stack.length) {
        const current = stack.pop()!;
        if (current.render?.meshInstances) meshCount += current.render.meshInstances.length;
        for (const child of (current.children ?? []) as never[]) stack.push(child);
      }
    }
    result[target] = meshCount;
  }
  const lamps = runtime.app.root.find((node) => (node as { name?: string }).name === "lamp-model") as Array<{ children?: unknown[] }>;
  let lampMeshCount = 0;
  for (const lamp of lamps) {
    const stack: Array<{ children?: unknown[]; render?: { meshInstances?: unknown[] } }> = [lamp as never];
    while (stack.length) {
      const current = stack.pop()!;
      if (current.render?.meshInstances) lampMeshCount += current.render.meshInstances.length;
      for (const child of (current.children ?? []) as never[]) stack.push(child);
    }
  }
  result["lamp-model(x4 total)"] = lampMeshCount;
  // Confirm the OLD primitive placeholders are gone.
  result["lamp-shade(old)"] = runtime.app.root.find((node) => (node as { name?: string }).name === "lamp-shade").length;
  result["lamp-bulb(old)"] = runtime.app.root.find((node) => (node as { name?: string }).name === "lamp-bulb").length;
  result["canopy(old)"] = runtime.app.root.find((node) => (node as { name?: string }).name === "canopy").length;
  result["glass-front(old)"] = runtime.app.root.find((node) => (node as { name?: string }).name === "glass-front").length;
  return result;
});
console.log("GLB mesh counts:", glbMeshCounts);
const glbOk = glbMeshCounts["fixture-model:retail-dairy"] > 0
  && glbMeshCounts["fixture-model:retail-eggs"] > 0
  && glbMeshCounts["lamp-model(x4 total)"] > 0
  && glbMeshCounts["lamp-shade(old)"] === 0
  && glbMeshCounts["lamp-bulb(old)"] === 0
  && glbMeshCounts["canopy(old)"] === 0
  && glbMeshCounts["glass-front(old)"] === 0;

// ---- 3: stock-screen live text matches expected counts ----
// Pantry has two PHYSICAL fixtures, each with its own `stock-screen:coffee`
// entity (screens are named by productId, not globally unique — real
// fixtures, not a dedup key), so this collects every screen instance as a
// list rather than a productId-keyed map that would silently collapse
// pantry's two coffee screens into one.
const screenTexts = await page.evaluate(() => {
  const runtime = window.__MARKET_PC_RUNTIME__!;
  const nodes = runtime.app.root.find((node) => {
    const n = node as { name?: string };
    return typeof n.name === "string" && n.name.startsWith("stock-screen:");
  }) as Array<{ name: string; children?: unknown[] }>;
  const result: Array<{ productId: string; count: string; status: string }> = [];
  for (const screen of nodes) {
    const productId = screen.name.split(":")[1];
    const stack: Array<{ name?: string; children?: unknown[]; element?: { text?: string } }> = [screen as never];
    let count = "";
    let status = "";
    while (stack.length) {
      const current = stack.pop()!;
      if (current.name === "stock-screen-count") count = current.element?.text ?? "";
      if (current.name === "stock-screen-status") status = current.element?.text ?? "";
      for (const child of (current.children ?? []) as never[]) stack.push(child);
    }
    result.push({ productId, count, status });
  }
  return result;
});
console.log("live stock-screen texts:", screenTexts);
const actualCounts = [...screenTexts.map((s) => `${s.productId}=${s.count}`)].sort();
const expectedCounts = [...expectations.map((e) => `${e.productId}=${e.count}`)].sort();
const screensOk = JSON.stringify(actualCounts) === JSON.stringify(expectedCounts);
const screenCountMatches = screenTexts.length === expectations.length;

await page.screenshot({ path: path.join(outputRoot, "overview.png") });
await page.keyboard.down("s");
await page.waitForTimeout(3_500);
await page.keyboard.up("s");
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outputRoot, "walked-in.png") });

await browser.close();

const report = {
  ok: glbOk && screensOk && screenCountMatches && consoleErrors.length === 0 && pageErrors.length === 0,
  glbOk,
  screensOk,
  screenCountMatches,
  glbMeshCounts,
  expectations,
  screenTexts,
  consoleErrors,
  pageErrors,
};
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
