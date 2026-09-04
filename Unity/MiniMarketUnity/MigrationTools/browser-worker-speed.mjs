// Hires a worker, opens the store and reads back what the agent actually does.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
const browser = await chromium.launch({ headless: true,
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
let ready; const signal = new Promise(r => { ready = r; });
const lines = [];
page.on('console', m => {
  const t = m.text();
  if (t.includes('MINIMARKET_READY')) ready(true);
  if (t.includes('MINIMARKET_WORKER') || t.includes('MINIMARKET_HIRE')) lines.push(t);
});
await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start').catch(() => {});
await Promise.race([signal, page.waitForTimeout(120_000)]);
await page.waitForTimeout(9_000);
await page.evaluate(() => window.miniMarketUnity?.SendMessage('MiniMarketRuntime', 'DebugHireAndOpen'));
await page.waitForTimeout(60_000);
const per = new Map();
for (const l of lines) {
  const m = l.match(/MINIMARKET_WORKER (\S+) pedida=([\d,.]+) real=([\d,.]+)/);
  if (!m) continue;
  const num = s => Number(s.replace(',', '.'));
  const e = per.get(m[1]) || { n: 0, moving: 0, sum: 0, peak: 0 };
  e.n++; const v = num(m[3]);
  if (v > 0.5) { e.moving++; e.sum += v; }
  e.peak = Math.max(e.peak, v);
  per.set(m[1], e);
}
for (const [name, e] of per)
  console.log(`${name} muestras=${e.n} en_movimiento=${(100*e.moving/e.n).toFixed(0)}% media_movil=${(e.sum/Math.max(1,e.moving)).toFixed(2)} pico=${e.peak.toFixed(2)}`);
console.log('WORKER_OK', lines.length, 'lineas');
await browser.close();
