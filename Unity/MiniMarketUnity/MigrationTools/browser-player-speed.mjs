// Walks the player for a fixed time and reads how far it actually got, from the
// door telemetry that already prints the player position.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
const hold = Number(process.env.MINIMARKET_HOLD || 3000);
const browser = await chromium.launch({ headless: true,
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
let ready; const signal = new Promise(r => { ready = r; });
const spots = [];
page.on('console', m => {
  const t = m.text();
  if (t.includes('MINIMARKET_READY')) ready(true);
  const g = t.match(/jugador=\(([-\d,.]+)\)/);
  if (g) spots.push({ t: Date.now(), raw: g[1] });
});
await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start').catch(() => {});
await Promise.race([signal, page.waitForTimeout(120_000)]);
await page.waitForTimeout(9_000);
const canvas = await page.$('#unity-canvas');
await canvas?.click({ position: { x: 700, y: 500 } }).catch(() => {});
const before = spots.at(-1);
const t0 = Date.now();
await page.keyboard.down('KeyW');
await page.waitForTimeout(hold);
await page.keyboard.up('KeyW');
const elapsed = (Date.now() - t0) / 1000;
await page.waitForTimeout(1200);
const after = spots.at(-1);
// The runtime prints with a comma decimal separator, so the three components
// arrive as six comma-joined pieces; they are rejoined in pairs.
// Comma is the decimal separator here, so the pieces rejoin two at a time,
// and the runtime prints this vector with two components.
const parse = r => { const p = r.split(','); const out = []; for (let i = 0; i + 1 < p.length; i += 2) out.push(Number(`${p[i]}.${p[i + 1]}`)); return out; };
if (before && after) {
  const a = parse(before.raw), b = parse(after.raw);
  const ax = a[0], az = a[a.length - 1], bx = b[0], bz = b[b.length - 1];
  const d = Math.hypot(bx - ax, bz - az);
  console.log(`PLAYER crudo antes=(${before.raw}) despues=(${after.raw})`);
  console.log(`PLAYER ${d.toFixed(2)} u en ${elapsed.toFixed(1)}s -> ${(d / elapsed).toFixed(2)} u/s`);
} else console.log('PLAYER sin telemetria', spots.length);
await browser.close();
