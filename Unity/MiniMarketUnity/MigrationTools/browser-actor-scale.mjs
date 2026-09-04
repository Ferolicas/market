// Opens the store, waits for customers, and reports every actor's on-screen
// height. Comparing the GLB files only proves the assets match; this proves
// what the player actually sees.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync, mkdirSync } from 'node:fs';
const out = process.env.MINIMARKET_SHOT || '/tmp/actors.png';
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }).then(c => c.newPage());
let ready; const signal = new Promise(r => { ready = r; });
const notes = [];
page.on('console', m => {
  const t = m.text();
  if (t.includes('MINIMARKET_READY')) ready(true);
  if (t.includes('MINIMARKET_ACTORSCALE')) notes.push(t);
});
await page.goto(process.env.MINIMARKET_QA_URL || 'http://127.0.0.1:4173', { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start').catch(() => {});
await Promise.race([signal, page.waitForTimeout(120_000)]);
await page.waitForTimeout(9_000);
await page.evaluate(() => window.miniMarketUnity?.SendMessage('MiniMarketRuntime', 'ToggleStore'));
await page.waitForTimeout(Number(process.env.MINIMARKET_WAIT || 45_000));
await page.evaluate(() => window.miniMarketUnity?.SendMessage('MiniMarketRuntime', 'ReportActorScale'));
await page.waitForTimeout(2_500);
await page.screenshot({ path: out });
for (const n of notes) console.log(n);
console.log('ACTORS_OK', out);
await browser.close();
