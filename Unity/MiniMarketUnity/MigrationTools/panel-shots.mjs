// One screenshot per drawer panel. The panels are opened through the Unity
// instance rather than by clicking the canvas: the quick menu moves between the
// desktop and mobile layouts, and a click at fixed coordinates would silently
// capture the wrong panel.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync, mkdirSync } from 'node:fs';
const dir = process.env.MINIMARKET_SHOTDIR || '/tmp/panels';
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
mkdirSync(dir, { recursive: true });
const width = Number(process.env.MINIMARKET_W || 1440);
const height = Number(process.env.MINIMARKET_H || 900);
const browser = await chromium.launch({ headless: true,
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 }).then(c => c.newPage());
let ready; const signal = new Promise(r => { ready = r; });
page.on('console', m => { if (m.text().includes('MINIMARKET_READY')) ready(true); });
await page.goto(process.env.MINIMARKET_QA_URL || 'http://127.0.0.1:4173', { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start').catch(() => {});
await Promise.race([signal, page.waitForTimeout(120_000)]);
await page.waitForTimeout(10_000);
await page.screenshot({ path: `${dir}/00-hud.png` });
const panels = ['inventory', 'supplier', 'hiring', 'map', 'finance', 'upgrade', 'closet', 'help', 'missions', 'setup'];
for (const id of panels) {
  await page.evaluate(p => window.miniMarketUnity?.SendMessage('MiniMarketRuntime', 'OpenPanel', p), id);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${dir}/${id}.png` });
}
console.log('SHOTS_OK', dir);
await browser.close();
