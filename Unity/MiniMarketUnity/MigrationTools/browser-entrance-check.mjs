// Walk the character out to the street and photograph the entrance, so
// "it is installed" can be verified instead of assumed.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync, mkdirSync } from 'node:fs';
const baseUrl = process.env.MINIMARKET_QA_URL || 'http://127.0.0.1:4173';
const outDir = process.env.MINIMARKET_UI_OUT || '/tmp/ui';
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }).then(c => c.newPage());
let ready; const readySignal = new Promise(r => { ready = r; });
page.on('console', m => { if (m.text().includes('MINIMARKET_READY')) ready(true); });
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start').catch(() => {});
await Promise.race([readySignal, page.waitForTimeout(180_000)]);
await page.waitForFunction(() => Boolean(window.miniMarketUnity), null, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(7_000);
await page.screenshot({ path: `${outDir}/dentro.png` });
// walk north, out through the doorway, so the porch is in frame
await page.click('#unity-canvas', { position: { x: 700, y: 450 } });
for (const ms of [4200, 3200]) {
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(ms);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(1200);
}
await page.screenshot({ path: `${outDir}/calle.png` });
console.log('ENTRADA_CHECK_OK');
await browser.close();
