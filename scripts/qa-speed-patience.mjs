// Isolated HTTP fixture, actual production renderer/physics. No real saves.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { createServer } = await import(pathToFileURL(require.resolve("vite", { paths: [path.dirname(require.resolve("vitest/package.json"))] })));
const modules = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true }, appType: "custom" });
const { createCampaignGame } = await modules.ssrLoadModule("/src/game/engine.ts");
const url = process.env.MARKET_QA_URL ?? "http://127.0.0.1:4305";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Local only");
const output = process.argv[2] ?? "/tmp/market-speed-patience";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: "/home/ferney_oliveros/.local/bin/google-chrome", args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"] });
const reports = [];
try {
  for (const width of [1440, 390]) {
    const state = createCampaignGame();
    state.tutorialStep = 1;
    state.simulationTimeMs = 110_000;
    state.franchises[0].open = true;
    state.franchises[0].customers = [{
      id: "patience-qa", identity: 1, state: "WAIT_RESTOCK", shoppingList: [{ productId: "tomatoes", requested: 1, picked: 0 }],
      currentLine: 0, basket: {}, patienceMs: 120_000, waitingSince: 0, stateSince: 0,
      checkoutPatienceMs: 120_000, queueSlot: null, queueJoinedAt: null, transactionId: null,
      hasCart: true, hasBag: false, angry: false, x: -4, z: 0, targetX: -4, targetZ: 0,
      path: [], pathIndex: 0, speed: 1.4, currentSpeed: 0, reservedSocketId: "tomatoes:0", blockedSince: null, routeFailures: 0,
    }];
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, serviceWorkers: "block", recordVideo: { dir: output } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let revision = 1;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const fulfill = (body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (pathname === "/api/auth/get-session") return fulfill({ session: { id: "fixture", userId: "fixture", expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, user: { id: "fixture", name: "Speed QA", email: "speed@example.test" } });
      if (pathname === "/api/game/save" && request.method() === "GET") return fulfill({ state, saveRevision: revision, recoveryScope: `speed-${width}`, savedAt: new Date().toISOString() });
      if (pathname === "/api/game/save") return fulfill({ saveRevision: ++revision, operationId: request.postDataJSON().operationId, savedAt: new Date().toISOString() });
      return fulfill({ ok: true });
    });
    await page.goto(`${url}?debug=1`);
    await page.locator(".world.scene-ready").waitFor({ timeout: 60_000 });
    const cap = await page.evaluate(() => window.__MARKET_QA__.player.speedCap);
    assert.ok(Math.abs(cap - 10.395) < 0.001, `speed cap ${cap}`);
    await page.waitForFunction(() => Object.values(window.__MARKET_QA__?.customerVisuals ?? {}).some((c) => c.animation === "Impatient"), null, { timeout: 25_000 });
    const reaction = await page.evaluate(() => ({ customer: window.__MARKET_QA__.state.franchises[0].customers.find((c) => c.id === "patience-qa"), visuals: window.__MARKET_QA__.customerVisuals }));
    assert.equal(reaction.customer.angry, true);
    await page.screenshot({ path: `${output}/${width}-angry.png` });
    await page.waitForFunction(() => !window.__MARKET_QA__.state.franchises[0].customers.some((c) => c.id === "patience-qa"), null, { timeout: 60_000 });
    assert.deepEqual(errors, []);
    reports.push({ width, cap, reaction, errors });
    await context.close();
  }
  await fs.writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2));
  console.log("PASS speed cap, existing Impatient clip and customer exit: desktop + mobile");
} finally { await browser.close(); await modules.close(); }
