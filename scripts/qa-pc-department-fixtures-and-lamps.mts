// PlayCanvas department-fixture + storeUtilities QA (2026-09-27 gap-closure
// phase). Verifies:
//  1. Every retail department fixture now has REAL shell geometry (uprights,
//     shelf decks/lips/accents, back panel, sign) instead of the former flat
//     "body"/"base" two-box placeholder — read live off the scene graph via
//     `window.__MARKET_PC_RUNTIME__.app.root.find()`, not a visual guess.
//  2. `buildDecorativeFixtures()`'s new wall clock, two security cameras, two
//     hanging signs and four ceiling lamps all exist in the live scene graph.
//  3. The ceiling lamps' point-light intensity really toggles with
//     `franchise.lightsOn` (real store mutation, then re-read the live light
//     component — not a static assertion).
//
// Usage: `pnpm exec tsx scripts/qa-pc-department-fixtures-and-lamps.mts [outputDir]`
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { normalizeGameState } from "../src/game/engine";
import { RETAIL_DEPARTMENT_IDS } from "../src/game/stations/retail-layout";
import type { GameState } from "../src/game/types";

const appUrl = process.env.MARKET_QA_URL ?? "http://localhost:4300";
const outputRoot = process.argv[2] ?? "/tmp/market-pc-department-fixtures-qa";
await fs.mkdir(outputRoot, { recursive: true });

const baseSeed = JSON.parse(await fs.readFile("public/fixtures/runtime-level30-seed.json", "utf8")) as GameState;
const normalizedBase = normalizeGameState(baseSeed);
// Force the store open for the main load, so the real engine tick keeps
// re-deriving `franchise.lightsOn = franchise.open || ...` as true (the base
// seed itself has the store closed at load).
const state: GameState = {
  ...normalizedBase,
  franchises: normalizedBase.franchises.map((f) => f.id === normalizedBase.currentFranchiseId ? { ...f, open: true, lightsOn: true } : f),
};

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});

interface QaWindow extends Window {
  __MARKET_PC_RUNTIME__?: { app: { root: { find(fn: (node: unknown) => boolean): Array<{ name: string; enabled: boolean }> } } };
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

const countByPrefix = (prefixes: string[]): Promise<Record<string, number>> => page.evaluate((prefixList: string[]) => {
  const runtime = window.__MARKET_PC_RUNTIME__!;
  const all = runtime.app.root.find(() => true) as Array<{ name: string }>;
  const counts: Record<string, number> = {};
  for (const prefix of prefixList) counts[prefix] = 0;
  for (const node of all) {
    for (const prefix of prefixList) {
      if (node.name === prefix || node.name?.startsWith(prefix)) counts[prefix] += 1;
    }
  }
  return counts;
}, prefixes);

// ---- 1. Department fixture shell geometry ----
const shellPieceNames = ["upright", "shelf-deck", "shelf-lip", "shelf-accent", "shelf-tag", "back-panel", "back-panel-slat", "sign-anchor", "sign-frame", "sign-panel", "sign-label", "cap", "rail-post", "rail-bar"];
const shellCounts = await countByPrefix(shellPieceNames);
console.log("shell piece counts:", shellCounts);
const shellOk = shellPieceNames.every((name) => (shellCounts[name] ?? 0) > 0);

// Every `fixture:<departmentId>` element should now have MORE than the old
// two children (body/base) — confirms every single department (not just one)
// got real geometry, per the phase's own scope note.
const fixtureChildCounts: Record<string, number> = await page.evaluate((departmentIds: string[]) => {
  const runtime = window.__MARKET_PC_RUNTIME__!;
  const result: Record<string, number> = {};
  for (const id of departmentIds) {
    const nodes = runtime.app.root.find((node) => {
      const n = node as { name?: string };
      return typeof n.name === "string" && n.name.startsWith(`fixture:${id}`);
    }) as Array<{ name: string; children?: unknown[] }>;
    // Sum descendant counts across every physical fixture of this department
    // (produce/pantry can have two).
    let total = 0;
    for (const node of nodes) {
      const stack: Array<{ children?: unknown[] }> = [node as { children?: unknown[] }];
      while (stack.length) {
        const current = stack.pop()!;
        for (const child of (current.children ?? []) as Array<{ children?: unknown[] }>) {
          total += 1;
          stack.push(child);
        }
      }
    }
    result[id] = total;
  }
  return result;
}, RETAIL_DEPARTMENT_IDS as unknown as string[]);
console.log("descendant count per fixture:", fixtureChildCounts);
// The old placeholder was exactly 2 descendants (body + base) per fixture.
const everyDepartmentUpgraded = Object.values(fixtureChildCounts).every((count) => count > 2);

await page.screenshot({ path: path.join(outputRoot, "overview.png") });

// Walk the player forward into the store for a close-up look at real
// department fixture geometry (visual sanity check alongside the scene-graph
// assertions above).
await page.keyboard.down("s");
await page.waitForTimeout(3_500);
await page.keyboard.up("s");
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outputRoot, "walked-in.png") });

// ---- 2. Decorative fixtures exist ----
const decorativeCounts = await countByPrefix(["wall-clock", "clock-face", "security-camera-left", "security-camera-right", "camera-lens", "hanging-sign-checkout", "hanging-sign-pantry", "sign-board", "ceiling-lamp:", "lamp-shade", "lamp-bulb", "lamp-light"]);
console.log("decorative fixture counts:", decorativeCounts);
const decorativeOk = decorativeCounts["wall-clock"] === 1
  && decorativeCounts["security-camera-left"] === 1
  && decorativeCounts["security-camera-right"] === 1
  && decorativeCounts["hanging-sign-checkout"] === 1
  && decorativeCounts["hanging-sign-pantry"] === 1
  && decorativeCounts["ceiling-lamp:"] === 4
  && decorativeCounts["lamp-light"] === 4;

// ---- 3. Ceiling lamp point-light really toggles with franchise.lightsOn ----
// A direct `store.setState({ lightsOn: true })` gets overwritten on the very
// next world tick (`stepWorldTick()` re-derives `franchise.lightsOn` every
// 200ms via the real engine rule `franchise.lightsOn = franchise.open ||
// ...`/`hasCustomersInStore(franchise)` — see `engine.ts` lines ~964/1061),
// so this loads two SEPARATE seeded states instead: one with the store open
// (real `lightsOn: true` the authoritative tick will keep re-deriving as
// true) and one closed with nobody inside (real `lightsOn: false`), matching
// how the field is actually produced in production.
const readLampIntensitiesOnPage = (targetPage: typeof page): Promise<number[]> => targetPage.evaluate(() => {
  const runtime = window.__MARKET_PC_RUNTIME__!;
  const nodes = runtime.app.root.find((node) => {
    const n = node as { name?: string };
    return n.name === "lamp-light";
  }) as Array<{ light?: { intensity: number } }>;
  return nodes.map((node) => node.light?.intensity ?? -1);
});

const intensitiesOn = await readLampIntensitiesOnPage(page);
await page.screenshot({ path: path.join(outputRoot, "lamps-open-seed.png") });
console.log("lightsOn(open seed) =", state.franchises.find((f) => f.id === state.currentFranchiseId)?.lightsOn, "lamp intensities:", intensitiesOn);

// Second load: force the franchise closed with no customers inside, so the
// real engine tick keeps deriving `lightsOn: false`.
const closedState: GameState = {
  ...state,
  franchises: state.franchises.map((f) => f.id === state.currentFranchiseId
    ? { ...f, open: false, lightsOn: false, customers: [] }
    : f),
};
const page2 = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page2.addInitScript((serialized: string) => {
  try { window.localStorage.setItem("mini-market-playcanvas-integral-v1", serialized); } catch { /* ignore */ }
}, JSON.stringify(closedState));
await page2.goto(`${appUrl}/playcanvas`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page2.waitForFunction(() => Boolean(window.__MARKET_PC_RUNTIME__ && window.__MARKET_STORE__), null, { timeout: 30_000 });
await page2.locator("canvas").first().waitFor({ timeout: 30_000 });
await page2.waitForTimeout(2_500);
const intensitiesOff = await readLampIntensitiesOnPage(page2);
await page2.screenshot({ path: path.join(outputRoot, "lamps-closed-seed.png") });
const closedLightsOn = await page2.evaluate(() => {
  const store = window.__MARKET_STORE__ as unknown as { getState(): { game: { currentFranchiseId: string; franchises: Array<{ id: string; lightsOn: boolean }> } } };
  const game = store.getState().game;
  return (game.franchises.find((f) => f.id === game.currentFranchiseId) ?? game.franchises[0]).lightsOn;
});
console.log("lightsOn(closed seed, post-tick) =", closedLightsOn, "lamp intensities:", intensitiesOff);
await page2.close();

const lampsToggleOk = intensitiesOn.length === 4 && intensitiesOn.every((v) => v > 0) && intensitiesOff.length === 4 && intensitiesOff.every((v) => v === 0) && closedLightsOn === false;

await browser.close();

const report = {
  ok: shellOk && everyDepartmentUpgraded && decorativeOk && lampsToggleOk && consoleErrors.length === 0 && pageErrors.length === 0,
  shellOk,
  everyDepartmentUpgraded,
  decorativeOk,
  lampsToggleOk,
  shellCounts,
  fixtureChildCounts,
  decorativeCounts,
  intensitiesOn,
  intensitiesOff,
  consoleErrors,
  pageErrors,
};
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
