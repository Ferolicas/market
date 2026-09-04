// Screenshot with the player driven away from the storefront: parked at spawn
// the character stands behind the facade and never appears in frame.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync, mkdirSync } from 'node:fs';
const out = process.env.MINIMARKET_SHOT || '/tmp/walk.png';
const hold = Number(process.env.MINIMARKET_HOLD || 2600);
const key = process.env.MINIMARKET_KEY || 'KeyW';
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }).then(c => c.newPage());
let ready; const signal = new Promise(r => { ready = r; });
page.on('console', m => { if (m.text().includes('MINIMARKET_READY')) ready(true); });
await page.goto(process.env.MINIMARKET_QA_URL || 'http://127.0.0.1:4173', { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start').catch(() => {});
await Promise.race([signal, page.waitForTimeout(120_000)]);
await page.waitForTimeout(9_000);
const canvas = await page.$('#unity-canvas');
await canvas?.click({ position: { x: 700, y: 500 } }).catch(() => {});
await page.keyboard.down(key);
await page.waitForTimeout(hold);
await page.keyboard.up(key);
await page.waitForTimeout(1200);
await page.screenshot({ path: out });
console.log('WALK_OK', out);
await browser.close();
