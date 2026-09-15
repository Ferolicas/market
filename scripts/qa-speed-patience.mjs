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
const cameraOnly = process.env.MARKET_QA_CAMERA === "1";
const checkoutOnly = process.env.MARKET_QA_CHECKOUT === "1";
try {
  for (const width of [1440, 390]) {
    const state = createCampaignGame();
    state.tutorialStep = 1;
    state.simulationTimeMs = 110_000;
    state.franchises[0].open = !cameraOnly;
    state.franchises[0].customers = [{
      id: "patience-qa", identity: 1, state: "WAIT_RESTOCK", shoppingList: [{ productId: "tomatoes", requested: 1, picked: 0 }],
      currentLine: 0, basket: {}, patienceMs: 120_000, waitingSince: 0, stateSince: 0,
      checkoutPatienceMs: 120_000, queueSlot: null, queueJoinedAt: null, transactionId: null,
      hasCart: true, hasBag: false, angry: false, x: -4, z: 0, targetX: -4, targetZ: 0,
      path: [], pathIndex: 0, speed: 1.4, currentSpeed: 0, reservedSocketId: "tomatoes:0", blockedSince: null, routeFailures: 0,
    }];
    if (checkoutOnly) {
      const c = state.franchises[0].customers[0];
      Object.assign(c, { identity: width === 390 ? 3 : 1, state: "WAIT_CHECKOUT", x: 7, z: 2.85, targetX: 7, targetZ: 2.85, queueSlot: 0, queueLane: 0, queueJoinedAt: 110_000, waitingSince: null, stateSince: 110_000, transactionId: "checkout-qa", basket: { tomatoes: 20 } });
      state.franchises[0].checkoutTransactions = [{ id: "checkout-qa", customerId: c.id, paymentMethod: "cash", state: "SCANNING", pendingItems: [{ productId: "tomatoes", quantity: 20, loaded: 20, scanned: 0, bagged: 0 }], nextUnitIndex: 0, paymentCommitted: false, updatedAt: 110_000, lastLoadedAt: 110_000, lastScannedAt: 110_000, lastBaggedAt: 110_000, checkoutLane: 0 }];
    }
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
    assert.ok(Math.abs(cap - 8.316) < 0.001, `speed cap ${cap}`);
    if (checkoutOnly) {
      const target = [8.05 * 2, 5.12 * 2];
      for (let step = 0; step < 250; step++) {
        const p = await page.evaluate(() => window.__MARKET_QA__.player);
        if (Math.hypot(p.x - target[0], p.z - target[1]) < 0.65) break;
        const route = await page.evaluate((t) => window.__MARKET_FIND_PLAYER_PATH__(t), target);
        const next = route[1] ?? target;
        const dx = next[0] - p.x, dz = next[1] - p.z, length = Math.hypot(dx, dz) || 1;
        const f = Math.hypot(16, 25.75), fx = -16 / f, fz = -25.75 / f;
        await page.evaluate(({ x, y }) => window.__MARKET_SET_PLAYER_INPUT__(x, y), { x: (dx * -fz + dz * fx) / length, y: -(dx * fx + dz * fz) / length });
        await page.waitForTimeout(80);
      }
      await page.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__(0, 0));
      await page.waitForFunction(() => window.__MARKET_QA__.cameraFollow.checkoutBlend > 0.99, null, { timeout: 10_000 }).catch(async (error) => {
        console.log(JSON.stringify(await page.evaluate(() => ({ player: window.__MARKET_QA__.player, workstation: window.__MARKET_QA__.workstation, zones: window.__MARKET_QA__.activeZones, camera: window.__MARKET_QA__.cameraFollow }))));
        throw error;
      });
      const observed = await page.evaluate(() => ({ player: window.__MARKET_QA__.player, customer: window.__MARKET_QA__.customerVisuals["patience-qa"], camera: window.__MARKET_QA__.cameraFollow }));
      assert.equal(observed.player.visible, true);
      assert.equal(observed.customer.cartParked, true);
      await page.screenshot({ path: `${output}/${width}-checkout.png` });
      await page.waitForTimeout(3_000);
      assert.deepEqual(errors, []);
      reports.push({ width, cap, observed, errors });
      await context.close();
      continue;
    }
    if (cameraOnly) {
      const samples = await page.evaluate(() => new Promise((resolve) => {
        const samples = [];
        const directions = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"];
        const start = performance.now();
        let held = null;
        function frame(now) {
          const direction = directions[Math.floor((now - start) / 600)] ?? null;
          if (held !== direction) {
            if (held) window.dispatchEvent(new KeyboardEvent("keyup", { code: held, key: held }));
            if (direction) window.dispatchEvent(new KeyboardEvent("keydown", { code: direction, key: direction }));
            held = direction;
          }
          const qa = window.__MARKET_QA__;
          samples.push({ player: structuredClone(qa.player), camera: structuredClone(qa.cameraFollow) });
          if (now - start > 5_800) resolve(samples);
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }));
      assert.ok(samples.some((s) => s.player.speed > 7), "player must actually run");
      for (const { player, camera } of samples) {
        assert.ok(Math.hypot(player.presentedX - camera.x, player.presentedZ - camera.z) < 0.00001, "same-frame tracking");
        if (camera.checkoutBlend < 0.00001) assert.ok(Math.hypot(player.presentedX - camera.targetX, player.presentedZ - camera.targetZ) < 0.001, "no trailing camera target");
      }
      assert.deepEqual(errors, []);
      reports.push({ width, cap, samples, errors });
      await context.close();
      continue;
    }
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
  console.log(checkoutOnly ? "PASS close checkout, visible player and parked cart: desktop + mobile" : cameraOnly ? "PASS reduced speed and same-frame camera tracking in all directions: desktop + mobile" : "PASS speed cap, existing Impatient clip and customer exit: desktop + mobile");
} finally { await browser.close(); await modules.close(); }
