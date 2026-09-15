// Local browser acceptance with an isolated HTTP fixture: no accounts or
// production saves are modified. The fixture runs the real save validator.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const vitePath = require.resolve("vite", { paths: [path.dirname(require.resolve("vitest/package.json"))] });
const { createServer } = await import(pathToFileURL(vitePath));
const modules = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true }, appType: "custom" });
const { createInitialGame, createCampaignGame, normalizeGameState } = await modules.ssrLoadModule("/src/game/engine.ts");
const { PURCHASE_POINT } = await modules.ssrLoadModule("/src/game/stations/purchase-layout.ts");
const testPurchases = process.env.MARKET_QA_PURCHASE === "1";
const testProduce = process.env.MARKET_QA_PRODUCE === "1";
if (testProduce && !testPurchases) throw new Error("Produce QA requires the new campaign fixture");
const { retailServicePoint } = await modules.ssrLoadModule("/src/game/stations/retail-layout.ts");
const { validateSaveTransition } = await modules.ssrLoadModule("/src/game/persistence/SaveAuthority.ts");
const { savePayloadSchema } = await modules.ssrLoadModule("/src/lib/game-validation.ts");
const { registerPickupPosition } = await modules.ssrLoadModule("/src/game/stations/register-layout.ts");
const { STORE_LAYOUT_SCALE } = await modules.ssrLoadModule("/src/game/world-scale.ts");
const output = process.argv[2] ?? "/tmp/market-register-cash-qa";
const url = process.env.MARKET_QA_URL ?? "http://127.0.0.1:4305";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("This fixture is local-only");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: "/home/ferney_oliveros/.local/bin/google-chrome", args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"] });
const report = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    let saved = testPurchases ? createCampaignGame() : createInitialGame();
    saved.tutorialStep = 1;
    saved.balanceMinor = 12_000;
    if (testProduce) {
      saved.franchises[0].shelves.tomatoes = 14;
      saved.franchises[0].carry.items.tomatoes = 3;
    }
    saved.franchises[0].unlockedAreas.push("checkout-2");
    saved.franchises[0].registerCashMinor = [6_800, 10_200];
    let revision = 1;
    const accepted = [];
    const errors = [];
    const context = await browser.newContext({ viewport, serviceWorkers: "block", recordVideo: { dir: output, size: viewport } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const fulfill = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (pathname === "/api/auth/get-session") return fulfill({ session: { id: "fixture-session", userId: "fixture-user", expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, user: { id: "fixture-user", name: "Caja QA", email: "cash@example.test", emailVerified: true } });
      if (pathname === "/api/game/save" && request.method() === "GET") return fulfill({ state: saved, saveRevision: revision, savedAt: new Date().toISOString(), recoveryScope: "register-fixture" });
      if (pathname === "/api/game/save" && request.method() === "PUT") {
        const parsed = savePayloadSchema.safeParse(request.postDataJSON());
        if (!parsed.success) { errors.push(parsed.error.message); return fulfill({ error: "INVALID_SAVE" }, 400); }
        const attempt = parsed.data;
        const authority = validateSaveTransition(normalizeGameState(saved), attempt.state, attempt.events);
        if (!authority.ok || attempt.expectedRevision !== revision) { errors.push(JSON.stringify(authority)); return fulfill({ error: "INVALID_TRANSITION" }, 400); }
        saved = attempt.state;
        revision += 1;
        accepted.push(...attempt.events);
        return fulfill({ saveRevision: revision, savedAt: new Date().toISOString(), operationId: attempt.operationId });
      }
      if (pathname === "/api/game/telemetry") return fulfill({ ok: true });
      errors.push(`Unexpected API request: ${request.method()} ${pathname}`);
      return fulfill({}, 404);
    });
    await page.goto(`${url}?debug=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__MARKET_QA__?.player && window.__MARKET_FIND_PLAYER_PATH__, null, { timeout: 45_000 });
    await page.locator(".world.scene-ready").waitFor({ timeout: 45_000 });
    await page.screenshot({ path: `${output}/${viewport.width}-before.png` });
    for (const lane of [0, 1]) {
      const point = registerPickupPosition(lane);
      await moveTo(page, [point[0] * STORE_LAYOUT_SCALE, point[2] * STORE_LAYOUT_SCALE]);
      await page.waitForFunction((lane) => window.__MARKET_QA__.state.franchises[0].registerCashMinor[lane] === 0, lane, { timeout: 8_000 });
      await page.screenshot({ path: `${output}/${viewport.width}-lane-${lane}.png` });
    }
    let state = await page.evaluate(() => window.__MARKET_QA__.state);
    if (state.balanceMinor !== 29_000) throw new Error(`Wrong wallet: ${state.balanceMinor}`);
    const expectedWallet = testPurchases ? 22_200 : 29_000;
    if (testPurchases) {
      await page.getByRole("button", { name: "Construir", exact: true }).click();
      await page.locator(".upgrade-grid article").filter({ hasText: "Primer cajero" }).getByRole("button", { name: "Señalar compra" }).click();
      await page.screenshot({ path: `${output}/${viewport.width}-purchase-selected.png` });
      await moveTo(page, [PURCHASE_POINT[0] * STORE_LAYOUT_SCALE, PURCHASE_POINT[2] * STORE_LAYOUT_SCALE]);
      await page.waitForFunction(() => window.__MARKET_QA__.state.franchises[0].purchases.purchased.includes("cashier-1"), null, { timeout: 12_000 });
      await page.waitForTimeout(1_000);
      state = await page.evaluate(() => window.__MARKET_QA__.state);
      if (state.balanceMinor !== expectedWallet || state.franchises[0].employees.filter((employee) => employee.role === "cashier").length !== 1) throw new Error("Purchase was not applied exactly once");
      await page.screenshot({ path: `${output}/${viewport.width}-cashier-purchased.png` });
    }
    if (testProduce) {
      const point = retailServicePoint("tomatoes");
      await moveTo(page, point.map((value) => value * STORE_LAYOUT_SCALE));
      await page.waitForFunction(() => window.__MARKET_QA__.state.franchises[0].shelves.tomatoes === 15, null, { timeout: 8_000 });
      await page.waitForTimeout(1_200);
      const stocked = await page.evaluate(() => window.__MARKET_QA__.state.franchises[0]);
      if (stocked.carry.items.tomatoes !== 2) throw new Error("Opening shelf swallowed excess tomatoes");
      if (stocked.purchases.personalProgress?.["player:stock:tomatoes"] !== 1) throw new Error("Personal task counted pre-existing stock or missed the player's unit");
      await page.screenshot({ path: `${output}/${viewport.width}-opening-stocked.png` });
      await page.locator(".mission-card summary").click();
      // Wait for the width transition; visibility alone accepts its first frame.
      await page.waitForFunction(() => {
        const panel = document.querySelector(".mission-card[open]");
        return panel && panel.getBoundingClientRect().width >= (innerWidth <= 600 ? Math.min(300, innerWidth - 12) : 250);
      });
      const personalTask = page.locator(".mission-list").getByText("Repón tú 8 tomates", { exact: true });
      await personalTask.waitFor({ state: "visible" });
      await page.locator(".level-requirement").filter({ hasText: "Repón tú 8 tomates" }).getByText("1 / 8", { exact: true }).waitFor({ state: "visible" });
      if (await page.getByRole("progressbar", { name: "Progreso de Repón tú 8 tomates", exact: true }).getAttribute("aria-valuenow") !== "1") throw new Error("Personal task UI disagrees with saved progress");
      await page.screenshot({ path: `${output}/${viewport.width}-personal-tasks.png` });
      await page.locator(".mission-card summary").click();
    }
    if (viewport.width > 600) await page.locator(".player-chip button").click();
    else await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "saved", null, { timeout: 10_000 });
    await page.reload();
    await page.waitForFunction((expected) => window.__MARKET_QA__?.state?.balanceMinor === expected, expectedWallet, { timeout: 30_000 }).catch(async (error) => {
      await page.screenshot({ path: `${output}/${viewport.width}-reload-failed.png` });
      console.log(JSON.stringify({ savedBalance: saved.balanceMinor, revision, errors, page: await page.evaluate(() => ({ text: document.body.innerText, qa: window.__MARKET_QA__ })) }));
      throw error;
    });
    const collections = accepted.filter((event) => event.category === "cash_collection");
    if (testPurchases) {
      const missions = await page.evaluate(() => window.__MARKET_QA__.state.missions);
      if (missions.length || await page.getByText("BONOS DEL DÍA", { exact: true }).count()) throw new Error("Legacy daily bonuses returned after reload");
      await page.getByRole("button", { name: "Construir", exact: true }).click();
      await page.getByText("Permanente · incluida en tu supermercado", { exact: true }).waitFor();
      if (await page.getByRole("button", { name: "Renovar 14 días" }).count()) throw new Error("Campaign still sells expiring licenses");
      await page.locator(".management-panel .close-button").click();
      await page.getByRole("button", { name: "Equipo", exact: true }).click();
      await page.getByText("Contratación de pago único · sin nómina diaria", { exact: false }).first().waitFor();
      await page.locator(".management-panel .close-button").click();
      await page.getByRole("button", { name: "Finanzas", exact: true }).click();
      await page.getByText("Economía de campaña", { exact: true }).waitFor();
      await page.screenshot({ path: `${output}/${viewport.width}-campaign-finance.png` });
      await page.locator(".management-panel .close-button").click();
    }
    if (testProduce) {
      const restored = await page.evaluate(() => window.__MARKET_QA__.state.franchises[0]);
      if (restored.shelves.tomatoes !== 15 || restored.carry.items.tomatoes !== 2) throw new Error("Opening stock changed after reload");
      if (restored.purchases.personalProgress?.["player:stock:tomatoes"] !== 1) throw new Error("Personal task progress changed after reload");
    }
    if (collections.length !== 2 || errors.length) throw new Error(JSON.stringify({ collections, errors }));
    const purchases = accepted.filter((event) => event.category === "purchase");
    if (testPurchases && purchases.reduce((sum, event) => sum - event.amountMinor, 0) !== 6_800) throw new Error("Incorrect persisted purchase payments");
    report.push({ viewport, status: "PASS", wallet: state.balanceMinor, pending: state.franchises[0].registerCashMinor, collections: collections.map((event) => event.payload), purchases: purchases.map((event) => event.payload), errors });
    console.log(JSON.stringify(report.at(-1)));
    await context.close();
  }
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify({ fixture: "isolated HTTP; real client, physics, engine and save validator; no database", results: report }, null, 2));
  await browser.close();
  await modules.close();
}

async function moveTo(page, target) {
  const deadline = Date.now() + 40_000;
  try {
    while (Date.now() < deadline) {
      const current = await page.evaluate(() => window.__MARKET_QA__.player);
      if (Math.hypot(current.x - target[0], current.z - target[1]) < 0.65) return;
      const route = await page.evaluate((destination) => window.__MARKET_FIND_PLAYER_PATH__(destination), target);
      const next = route[1] ?? target;
      const dx = next[0] - current.x, dz = next[1] - current.z;
      const length = Math.hypot(dx, dz) || 1;
      const f = Math.hypot(16, 25.75), fx = -16 / f, fz = -25.75 / f;
      await page.evaluate(({ x, y }) => window.__MARKET_SET_PLAYER_INPUT__(x, y), { x: (dx * -fz + dz * fx) / length, y: -(dx * fx + dz * fz) / length });
      await page.waitForTimeout(150);
    }
    throw new Error(`Could not reach register: ${JSON.stringify(target)}`);
  } finally {
    await page.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__(0, 0));
  }
}
