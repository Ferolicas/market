import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

/**
 * Screenshot evidence for the 2026-09-27 visual-quality parity pass:
 * `/runtime` character/lighting material fixes (`prepareCharacterModel()`
 * wired into crowd + player bodies, day/night `daylightPresentation()`
 * wired into `ClientRuntime`'s lights/fog/background). Loads the seeded
 * level-30 fixture on `/runtime`, opens the store so the crowd populates,
 * and captures a character close-up + wide store shot at the default
 * (daytime) `minuteOfDay` and again after fast-forwarding into sunset/night
 * via `__MARKET_QA__.advanceMinutes()`, to show the lighting actually
 * changes over time (it did not before this fix).
 */
const BASE_URL = process.argv[2] ?? "http://localhost:4300";
const OUT = process.argv[3] ?? "/tmp/market-runtime-visual-quality";
await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => consoleErrors.push(String(error)));

await page.goto(`${BASE_URL}/runtime?debug=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.locator("canvas").first().waitFor({ timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_QA__ && window.__MARKET_PERF_SCENE__), null, { timeout: 60_000 });
await page.waitForTimeout(3_000);
try { await page.locator("button.store-status").click({ timeout: 10_000 }); } catch { /* already open */ }
await page.waitForTimeout(2_000);

await page.screenshot({ path: path.join(OUT, "01-runtime-day.png") });

// Fast-forward the simulation clock into sunset/night and confirm the
// lighting/background/fog actually follow (it did not before this fix —
// ClientRuntime set the key/ambient/background once, statically).
await page.evaluate(() => window.__MARKET_QA__?.advanceMinutes?.(800));
await page.waitForTimeout(1_500);
await page.screenshot({ path: path.join(OUT, "02-runtime-later.png") });

console.log(JSON.stringify({ consoleErrors, out: OUT }, null, 2));
await browser.close();
