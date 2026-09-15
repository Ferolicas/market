// Isolated HTTP acceptance: real UI/engine/save validator, no database writes.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
async function moveTo(page, target) {
  const deadline = Date.now() + 40_000;
  try {
    while (Date.now() < deadline) {
      const current = await page.evaluate(() => window.__MARKET_QA__.player);
      if (Math.hypot(current.x - target[0], current.z - target[1]) < 0.2) return;
      const route = await page.evaluate((destination) => window.__MARKET_FIND_PLAYER_PATH__(destination), target);
      const next = route[1] ?? target;
      const dx = next[0] - current.x, dz = next[1] - current.z;
      const length = Math.hypot(dx, dz) || 1;
      const f = Math.hypot(16, 25.75), fx = -16 / f, fz = -25.75 / f;
      await page.evaluate(({ x, y }) => window.__MARKET_SET_PLAYER_INPUT__(x, y), { x: (dx * -fz + dz * fx) / length, y: -(dx * fx + dz * fz) / length });
      await page.waitForTimeout(150);
    }
    throw new Error(`Could not reach interaction: ${JSON.stringify({ target, player: await page.evaluate(() => window.__MARKET_QA__.player), route: await page.evaluate((destination) => window.__MARKET_FIND_PLAYER_PATH__(destination), target) })}`);
  } finally {
    await page.evaluate(() => window.__MARKET_SET_PLAYER_INPUT__(0, 0));
  }
}
const require = createRequire(import.meta.url);
const { createServer } = await import(pathToFileURL(require.resolve("vite", { paths: [path.dirname(require.resolve("vitest/package.json"))] })));
const modules = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true }, appType: "custom" });
const { createCampaignGame, applyGameAction, normalizeGameState } = await modules.ssrLoadModule("/src/game/engine.ts");
const { OPENING_PURCHASES } = await modules.ssrLoadModule("/src/game/progression/MartCampaign.ts");
const { CAMPAIGN_TASK_IDS, CAMPAIGN_TASKS } = await modules.ssrLoadModule("/src/game/progression/CampaignTasks.ts");
const { campaignContracts } = await modules.ssrLoadModule("/src/game/progression/CampaignContracts.ts");
const { validateSaveTransition } = await modules.ssrLoadModule("/src/game/persistence/SaveAuthority.ts");
const { savePayloadSchema } = await modules.ssrLoadModule("/src/lib/game-validation.ts");
const output = process.argv[2] ?? "/tmp/market-campaign-expansion-qa";
const url = process.env.MARKET_QA_URL ?? "http://127.0.0.1:4305";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Local-only fixture");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: "/home/ferney_oliveros/.local/bin/google-chrome", args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"] });
const results = [];
const testProduction = process.env.MARKET_QA_PRODUCTION === "1";
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    let saved = createCampaignGame();
    saved.tutorialStep = 1;
    saved.balanceMinor = 100_000_000;
    // Completed-store fixture; this test does not pretend to play the full campaign.
    saved.franchises[0].purchases.personalProgress = Object.fromEntries(CAMPAIGN_TASK_IDS.map((id) => [id, CAMPAIGN_TASKS[id].target]));
    const contracts = campaignContracts(saved.franchises[0]);
    saved.franchises[0].purchases.completedContracts = contracts.slice(0, -1).map((contract) => contract.id);
    saved.franchises[0].carry.items = Object.fromEntries(contracts.at(-1).products.map((product) => [product, 1]));
    for (const purchase of OPENING_PURCHASES) {
      const result = applyGameAction(saved, { type: "CONTRIBUTE_PURCHASE", purchaseId: purchase.id, amountMinor: 100_000_000 });
      if (!result.ok) throw new Error(result.message);
      saved = result.state;
    }
    saved.franchises[0].shelves.cannedCorn = 8;
    if (testProduction) {
    saved.franchises[0].warehouse.cannedCorn = 3;
    saved.franchises[0].warehouse.corn = 1;
    saved.franchises[0].purchases.personalProgress["player:stock:cannedCorn"] = 0;
    saved.franchises[0].purchases.personalProgress["player:collect:cannedCorn"] = 0;
    saved.franchises[0].employees = [];
    }
    let revision = 1;
    const errors = [], accepted = [];
    const context = await browser.newContext({ viewport, serviceWorkers: "block", recordVideo: { dir: output, size: viewport } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      const fulfill = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (pathname === "/api/auth/get-session") return fulfill({ session: { id: "fixture-session", userId: "fixture-user", expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, user: { id: "fixture-user", name: "Expansión QA", email: "expansion@example.test", emailVerified: true } });
      if (pathname === "/api/game/save" && request.method() === "GET") return fulfill({ state: saved, saveRevision: revision, savedAt: new Date().toISOString(), recoveryScope: "expansion-fixture" });
      if (pathname === "/api/game/save" && request.method() === "PUT") {
        const attempt = savePayloadSchema.parse(request.postDataJSON());
        const verdict = validateSaveTransition(normalizeGameState(saved), attempt.state, attempt.events);
        if (!verdict.ok || attempt.expectedRevision !== revision) { errors.push(JSON.stringify(verdict)); return fulfill({ error: "INVALID_TRANSITION" }, 400); }
        saved = attempt.state;
        accepted.push(...attempt.events);
        return fulfill({ saveRevision: ++revision, savedAt: new Date().toISOString(), operationId: attempt.operationId });
      }
      if (pathname === "/api/game/telemetry") return fulfill({ ok: true });
      errors.push(`Unexpected API: ${pathname}`);
      return fulfill({}, 404);
    });
    await page.goto(`${url}?debug=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__MARKET_QA__?.state, null, { timeout: 45_000 });
    await page.waitForFunction(() => window.__MARKET_QA__?.retailPresentation?.preserves?.cannedCorn === 8, null, { timeout: 45_000 });
    await page.locator(".world-preparing").waitFor({ state: "hidden", timeout: 45_000 });
    await page.screenshot({ path: `${output}/${viewport.width}-preserves.png` });
    await page.locator(".mission-card summary").click();
    await page.waitForFunction(() => {
      const panel = document.querySelector(".mission-card[open]");
      return panel && panel.getBoundingClientRect().width >= (innerWidth <= 600 ? Math.min(300, innerWidth - 12) : 250);
    });
    const delivery = page.getByRole("button", { name: "Entregar cesta", exact: true });
    await delivery.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${viewport.width}-contract.png` });
    await delivery.click();
    await page.waitForFunction(() => window.__MARKET_QA__.state.franchises[0].purchases.completedContracts.length === 3);
    const remaining = await page.evaluate(() => Object.values(window.__MARKET_QA__.state.franchises[0].carry.items).reduce((sum, quantity) => sum + quantity, 0));
    if (remaining !== 0) throw new Error("Contract did not consume its basket");
    await page.locator(".mission-card summary").click();
    if (testProduction) {
    await page.waitForFunction(() => window.__MARKET_QA__?.warehousePickupTarget?.sensorEnabled);
    const warehouse = await page.evaluate(() => window.__MARKET_QA__.warehousePickupTarget);
    await moveTo(page, [warehouse.x, warehouse.z]);
    await page.waitForFunction(() => window.__MARKET_QA__.state.franchises[0].carry.items.cannedCorn === 3 && window.__MARKET_QA__.state.franchises[0].carry.items.corn === 1);
    const canner = await page.evaluate(() => window.__MARKET_QA__.productionTargets.find((item) => item.id === "canner"));
    const cannerPoint = [canner.x, canner.z + canner.halfZ + 0.95];
    await moveTo(page, cannerPoint);
    await page.waitForFunction(() => window.__MARKET_QA__.state.franchises[0].carry.items.cannedCorn === 4).catch(async (error) => {
      await page.screenshot({ path: `${output}/${viewport.width}-canner-failed.png` });
      console.log(JSON.stringify(await page.evaluate(() => ({ player: window.__MARKET_QA__.player, zones: window.__MARKET_QA__.activeZones, carry: window.__MARKET_QA__.state.franchises[0].carry, machines: window.__MARKET_QA__.state.franchises[0].productionMachines, target: window.__MARKET_QA__.productionTargets.find((item) => item.id === "canner") }))));
      throw error;
    });
    await page.screenshot({ path: `${output}/${viewport.width}-canner.png` });
    const target = await page.evaluate(() => window.__MARKET_QA__.stockingTargets.find((item) => item.productId === "cannedCorn"));
    if (!target?.sensorEnabled) throw new Error("Preserves stocking sensor disabled with inventory in basket");
    await moveTo(page, [target.x, target.z]);
    await page.waitForFunction(() => window.__MARKET_QA__.state.franchises[0].shelves.cannedCorn === 12);
    await page.waitForFunction(() => window.__MARKET_QA__.retailPresentation.preserves.cannedCorn === 12);
    await moveTo(page, cannerPoint);
    await page.waitForFunction(() => window.__MARKET_QA__.state.franchises[0].carry.items.cannedCorn === 2);
    await moveTo(page, [target.x, target.z]);
    await page.waitForFunction(() => window.__MARKET_QA__.retailPresentation.preserves.cannedCorn === 14);
    await page.screenshot({ path: `${output}/${viewport.width}-preserves-stocked.png` });
    }
    await page.getByRole("button", { name: "Franquicias", exact: true }).click();
    const station = page.locator(".franchise-map article").filter({ hasText: "Market Estación" });
    await station.getByText("Desayunos y café", { exact: true }).waitFor();
    await station.getByRole("button", { name: "Abrir local" }).click();
    await station.getByRole("button", { name: "Viajar", exact: true }).click();
    await page.waitForFunction(() => window.__MARKET_QA__?.state?.currentFranchiseId === "estacion");
    await page.locator(".hud-stat.level").getByText("Nivel 1", { exact: true }).waitFor();
    if (await page.getByRole("progressbar", { name: "Progreso real de Nivel 1", exact: true }).getAttribute("aria-valuenow") !== "0") throw new Error("Fresh store inherited mastery progress");
    await page.getByRole("button", { name: "Franquicias", exact: true }).click();
    const marina = page.locator(".franchise-map article").filter({ hasText: "Market Marina" });
    if (!await marina.getByRole("button", { name: "Abrir local" }).isDisabled()) throw new Error("Third store unlocked without personal work in second");
    await page.screenshot({ path: `${output}/${viewport.width}-map.png` });
    await page.locator(".management-panel .close-button").click();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "saved", null, { timeout: 10_000 });
    await page.reload();
    await page.waitForFunction(() => window.__MARKET_QA__?.state?.currentFranchiseId === "estacion", null, { timeout: 30_000 });
    const active = await page.evaluate(() => window.__MARKET_QA__.state.franchises[1]);
    if (!active.owned || active.purchases.purchased.length || Object.keys(active.purchases.personalProgress ?? {}).length || active.buildProjects.length || errors.length) throw new Error(JSON.stringify({ active, errors }));
    if (accepted.filter((event) => event.category === "capital").length !== 1) throw new Error("Opening missing or duplicated");
    if (accepted.filter((event) => event.category === "contract_delivery").length !== 1 || saved.franchises[0].purchases.completedContracts.length !== 3) throw new Error("Contract delivery missing or duplicated after save");
    if (testProduction && (saved.franchises[0].shelves.cannedCorn !== 14 || saved.franchises[0].warehouse.cannedCorn !== 0 || saved.franchises[0].warehouse.corn !== 0 || saved.franchises[0].purchases.personalProgress["player:stock:cannedCorn"] !== 4 || saved.franchises[0].purchases.personalProgress["player:collect:cannedCorn"] !== 3)) throw new Error("Preserves inventory or personal progress lost after travel/save");
    results.push({ viewport, status: "PASS", currentFranchiseId: "estacion", newLocalPurchases: 0, legacyBuildProjects: 0, openingEvents: 1, contractDeliveries: 1, errors });
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify({ fixture: "completed-store fixture; isolated HTTP and real save validator; no database", results }, null, 2));
  await browser.close();
  await modules.close();
}
