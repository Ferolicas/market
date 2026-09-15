// Browser acceptance for the reorganised campaign: floor purchase rings,
// mission celebration, level hint, the trimmed HUD, the card panels and the
// removal of the automatic warehouse pickup. Local HTTP fixture only: no
// account, database or production save is touched.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const vitePath = require.resolve("vite", { paths: [path.dirname(require.resolve("vitest/package.json"))] });
const { createServer } = await import(pathToFileURL(vitePath));
const modules = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true }, appType: "custom" });
const { applyGameAction, createCampaignGame, normalizeGameState } = await modules.ssrLoadModule("/src/game/engine.ts");
const { PURCHASE_POSITIONS } = await modules.ssrLoadModule("/src/game/stations/purchase-layout.ts");
const { STOCKROOM_POINT } = await modules.ssrLoadModule("/src/game/stations/warehouse-layout.ts");
const { FARM_ANIMAL_STATIONS } = await modules.ssrLoadModule("/src/game/stations/farm-layout.ts");
const { validateSaveTransition } = await modules.ssrLoadModule("/src/game/persistence/SaveAuthority.ts");
const { savePayloadSchema } = await modules.ssrLoadModule("/src/lib/game-validation.ts");
const { STORE_LAYOUT_SCALE } = await modules.ssrLoadModule("/src/game/world-scale.ts");

const output = process.argv[2] ?? "/tmp/market-campaign-rework";
const url = process.env.MARKET_QA_URL ?? "http://127.0.0.1:4305";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("This fixture is local-only");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: "/home/ferney_oliveros/.local/bin/google-chrome", args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"] });
const report = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    // The coop is already built, through the real purchase path, so its work
    // point must stay free of payment rings.
    let saved = createCampaignGame();
    saved.tutorialStep = 1;
    saved.balanceMinor = 406_500;
    for (const purchaseId of ["farmer-1", "egg-display-1", "chicken-1"]) {
      const result = applyGameAction(saved, { type: "CONTRIBUTE_PURCHASE", purchaseId, amountMinor: 10_000 });
      if (!result.ok) throw new Error(`Fixture could not buy ${purchaseId}: ${result.message}`);
      saved = result.state;
    }
    saved.balanceMinor = 400_000;
    saved.franchises[0].warehouse.tomatoes = 6;
    saved.franchises[0].productionMachines.find((machine) => machine.id === "chicken-coop-1").output = 2;
    let revision = 1;
    const errors = [];
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const fulfill = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (pathname === "/api/auth/get-session") return fulfill({ session: { id: "fixture-session", userId: "fixture-user", expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, user: { id: "fixture-user", name: "QA Campaña", email: "campaign@example.test", emailVerified: true } });
      if (pathname === "/api/game/save" && request.method() === "GET") return fulfill({ state: saved, saveRevision: revision, savedAt: new Date().toISOString(), recoveryScope: "campaign-rework-fixture" });
      if (pathname === "/api/game/save" && request.method() === "PUT") {
        const parsed = savePayloadSchema.safeParse(request.postDataJSON());
        if (!parsed.success) { errors.push(parsed.error.message); return fulfill({ error: "INVALID_SAVE" }, 400); }
        const attempt = parsed.data;
        const authority = validateSaveTransition(normalizeGameState(saved), attempt.state, attempt.events);
        if (!authority.ok || attempt.expectedRevision !== revision) { errors.push(JSON.stringify(authority)); return fulfill({ error: "INVALID_TRANSITION" }, 400); }
        saved = attempt.state;
        revision += 1;
        return fulfill({ saveRevision: revision, savedAt: new Date().toISOString(), operationId: attempt.operationId });
      }
      if (pathname === "/api/game/telemetry") return fulfill({ ok: true });
      errors.push(`Unexpected API request: ${request.method()} ${pathname}`);
      return fulfill({}, 404);
    });

    await page.goto(`${url}?debug=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__MARKET_QA__?.player && window.__MARKET_FIND_PLAYER_PATH__, null, { timeout: 60_000 });
    await page.locator(".world.scene-ready").waitFor({ timeout: 60_000 });
    await page.screenshot({ path: `${output}/${viewport.width}-hud.png` });

    // The bar shows the number, the hour, the level, the state and the save.
    const hudText = await page.locator(".hud-top").innerText();
    for (const forbidden of ["Dinero disponible", "Pendiente", "Ventas hoy"]) {
      if (hudText.includes(forbidden)) throw new Error(`HUD still shows "${forbidden}"`);
    }
    if (!(await page.locator(".save-badge").isVisible())) throw new Error("Save badge missing from the bar");
    if (await page.locator(".mission-card").count()) throw new Error("The purchases card is still floating");

    // Standing at the PEDIDOS counter opens its panel and never fills the
    // basket by itself with goods nobody asked for.
    await moveTo(page, [STOCKROOM_POINT[0] * STORE_LAYOUT_SCALE, STOCKROOM_POINT[1] * STORE_LAYOUT_SCALE]);
    await page.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__(0, 0));
    await page.locator(".management-panel").waitFor({ timeout: 10_000 });
    if (!(await page.locator(".management-panel h2").innerText()).includes("Pedidos")) throw new Error("The orders terminal opened the wrong panel");
    await page.screenshot({ path: `${output}/${viewport.width}-orders-terminal.png` });
    await page.locator(".close-button").click();
    const afterDock = await page.evaluate(() => window.__MARKET_QA__.state.franchises[0]);
    const carriedAtDock = Object.values(afterDock.carry.items).reduce((sum, value) => sum + value, 0);
    if (carriedAtDock !== 0) throw new Error(`The dock filled the basket on its own: ${JSON.stringify(afterDock.carry.items)}`);
    if (await page.locator(".interaction-prompt").count()) throw new Error("Proximity prompts are still rendered");

    // Collecting eggs must never cost money: the coop work point is clear.
    const coop = FARM_ANIMAL_STATIONS.chicken.workPosition;
    await moveTo(page, [coop[0] * STORE_LAYOUT_SCALE, coop[2] * STORE_LAYOUT_SCALE]);
    await page.waitForTimeout(1_500);
    const atCoop = await page.evaluate(() => window.__MARKET_QA__.state);
    if (atCoop.balanceMinor !== 400_000) throw new Error(`Standing at the coop spent money: ${atCoop.balanceMinor}`);
    if ((await page.evaluate(() => window.__MARKET_QA__.activeZones ?? [])).some((zone) => String(zone).startsWith("purchase:"))) {
      throw new Error("A payment ring reaches the coop work point");
    }
    if (await page.locator(".management-panel").count()) throw new Error("Walking past the orders terminal opened its panel");
    await page.screenshot({ path: `${output}/${viewport.width}-coop-signs.png` });
    // A farm ring in the open, to read its floor price tag.
    const farmRing = PURCHASE_POSITIONS["tomato-2"];
    await moveTo(page, [farmRing[0] * STORE_LAYOUT_SCALE, farmRing[2] * STORE_LAYOUT_SCALE - 3]);
    await page.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__(0, 0));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${output}/${viewport.width}-floor-price.png` });

    // Each purchase is paid on its own ring, beside the thing it will build.
    const ring = PURCHASE_POSITIONS["player-2"];
    await moveTo(page, [ring[0] * STORE_LAYOUT_SCALE, ring[2] * STORE_LAYOUT_SCALE]);
    await page.waitForFunction(() => window.__MARKET_QA__.state.franchises[0].purchases.purchased.includes("player-2"), null, { timeout: 20_000 });
    await page.screenshot({ path: `${output}/${viewport.width}-purchase-paid.png` });
    await page.locator(".mission-complete").waitFor({ timeout: 4_000 });
    await page.screenshot({ path: `${output}/${viewport.width}-mission-complete.png` });
    await page.locator(".level-hint").waitFor({ timeout: 6_000 });
    const hint = await page.locator(".level-hint").innerText();
    if (!hint.includes("NIVEL 5")) throw new Error(`Level hint does not announce the new level: ${hint}`);
    // The celebration clears itself in three seconds, with no button.
    await page.locator(".mission-complete").waitFor({ state: "detached", timeout: 9_000 });
    const paid = await page.evaluate(() => window.__MARKET_QA__.state);
    if (paid.balanceMinor !== 397_500) throw new Error(`Wrong wallet after the ring: ${paid.balanceMinor}`);
    if (paid.franchises[0].carry.capacity !== 4) throw new Error("The purchase did not apply its content");
    if (paid.level !== 5) throw new Error(`Level did not advance: ${paid.level}`);



    // Panels: inventory cards, orders, roster with four upgrade steps.
    const openPanel = async (name) => {
      await page.getByRole("button", { name, exact: true }).click();
      await page.locator(".management-panel").waitFor({ timeout: 8_000 });
    };
    await openPanel("Inventario");
    await page.locator(".stock-card").first().waitFor();
    if ((await page.locator(".management-body").innerText()).includes("Repón acercándote")) throw new Error("Inventory still repeats the restocking copy");
    await page.screenshot({ path: `${output}/${viewport.width}-inventory.png` });
    await page.locator(".close-button").click();

    await openPanel("Pedidos");
    await page.getByRole("heading", { name: "Retirar del almacén" }).waitFor();
    await page.locator(".warehouse-picks button").first().click();
    await page.waitForFunction(() => (window.__MARKET_QA__.state.franchises[0].carry.items.tomatoes ?? 0) > 0, null, { timeout: 8_000 });
    await page.screenshot({ path: `${output}/${viewport.width}-orders.png` });
    await page.locator(".close-button").click();

    await openPanel("Equipo");
    await page.locator(".roster-card").first().waitFor();
    const teamText = await page.locator(".management-body").innerText();
    if (teamText.includes("Cupo") || teamText.includes("Contratar")) throw new Error("The team panel still hires or shows quotas");
    const steps = await page.locator(".roster-card").first().locator(".roster-upgrades button").count();
    if (steps !== 4) throw new Error(`Expected four upgrade steps, found ${steps}`);
    const beforeUpgrade = await page.evaluate(() => window.__MARKET_QA__.state);
    await page.locator(".roster-card").first().locator(".roster-upgrades button.next").click();
    await page.waitForFunction((previous) => window.__MARKET_QA__.state.balanceMinor === previous - 8_000, beforeUpgrade.balanceMinor, { timeout: 8_000 });
    const upgraded = await page.evaluate(() => window.__MARKET_QA__.state.franchises[0]);
    if (upgraded.carry.capacity !== 5 || upgraded.playerSpeedTier !== 3) throw new Error(`Roster upgrade did not raise speed and capacity: ${upgraded.carry.capacity}/${upgraded.playerSpeedTier}`);
    await page.screenshot({ path: `${output}/${viewport.width}-roster.png` });
    await page.locator(".close-button").click();

    // Wardrobe portraits are the real characters, baked from the rig.
    await openPanel("Avatar");
    await page.locator(".character-options img.avatar-thumbnail").first().waitFor({ timeout: 60_000 });
    await page.locator(".hair-options img.avatar-thumbnail").first().waitFor({ timeout: 60_000 });
    await page.screenshot({ path: `${output}/${viewport.width}-wardrobe.png` });
    await page.locator(".close-button").click();

    // Save and reload: the paid purchase and the upgrade survive.
    await page.locator(".save-badge").click();
    await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "saved", null, { timeout: 15_000 }).catch(async (error) => {
      console.log(JSON.stringify({ saveStatus: await page.evaluate(() => window.__MARKET_QA__?.saveStatus), message: await page.evaluate(() => document.querySelector(".toast")?.textContent), fixtureErrors: errors }, null, 2));
      throw error;
    });
    await page.reload();
    await page.waitForFunction(() => window.__MARKET_QA__?.state?.franchises?.[0]?.purchases?.purchased?.includes("player-2"), null, { timeout: 60_000 });
    const restored = await page.evaluate(() => window.__MARKET_QA__.state);
    if (restored.franchises[0].carry.capacity !== 5) throw new Error("The roster upgrade was lost on reload");
    await page.screenshot({ path: `${output}/${viewport.width}-reloaded.png` });

    report.push({ viewport, level: restored.level, balanceMinor: restored.balanceMinor, carryCapacity: restored.franchises[0].carry.capacity, errors });
    if (errors.length) throw new Error(`Page errors: ${errors.join(" | ")}`);
    await context.close();
  }
  await fs.writeFile(`${output}/report.json`, JSON.stringify({ ok: true, report }, null, 2));
  console.log(JSON.stringify({ ok: true, report }, null, 2));
} finally {
  await browser.close();
  await modules.close();
}

async function moveTo(page, target) {
  const deadline = Date.now() + 40_000;
  try {
    while (Date.now() < deadline) {
      const current = await page.evaluate(() => window.__MARKET_QA__.player);
      if (Math.hypot(current.x - target[0], current.z - target[1]) < 0.55) return;
      const route = await page.evaluate((destination) => window.__MARKET_FIND_PLAYER_PATH__(destination), target);
      const next = route[1] ?? target;
      const dx = next[0] - current.x, dz = next[1] - current.z;
      const length = Math.hypot(dx, dz) || 1;
      const f = Math.hypot(16, 25.75), fx = -16 / f, fz = -25.75 / f;
      await page.evaluate(({ x, y }) => window.__MARKET_SET_PLAYER_INPUT__(x, y), { x: (dx * -fz + dz * fx) / length, y: -(dx * fx + dz * fz) / length });
      await page.waitForTimeout(150);
    }
    throw new Error(`Could not reach ${JSON.stringify(target)}`);
  } finally {
    await page.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__(0, 0));
  }
}
