// One screenshot of the running client. Kept minimal on purpose: driving the
// character around made the capture outlast its own time budget.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync, mkdirSync } from 'node:fs';
const out = process.env.MINIMARKET_SHOT || '/tmp/shot.png';
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
await page.waitForTimeout(8_000);
await page.screenshot({ path: out });
console.log('SHOT_OK', out);
await browser.close();
