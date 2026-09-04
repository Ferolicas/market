// Walks well past the store footprint and checks the player stays on the
// ground. The navigation floor only covers 53.4 x 68.6, so anyone exploring the
// street used to drop out of the world while the camera kept tracking X and Z.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';

const baseUrl = process.env.MINIMARKET_QA_URL || 'http://127.0.0.1:4173';
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}), args: ['--no-sandbox','--disable-gpu-sandbox'] });
const page = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }).then(c => c.newPage());
const events = []; let ready; const r = new Promise(res => { ready = res; });
page.on('console', m => { const t = m.text(); events.push(t); if (t.includes('MINIMARKET_READY')) ready(1); });
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start');
await Promise.race([r, page.waitForTimeout(180_000)]);
await page.waitForFunction(() => Boolean(window.miniMarketUnity), null, { timeout: 30_000 });
await page.waitForTimeout(4_000);
await page.click('#unity-canvas', { position: { x: 700, y: 450 } });

const readPosition = async (label) => {
  const from = events.length;
  await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'LogRuntimeState'));
  await page.waitForTimeout(400);
  const line = events.slice(from).find(e => e.includes('MINIMARKET_STATE'));
  if (!line) return null;
  const p = JSON.parse(line.slice(line.indexOf('{')).trim());
  return { label, x: p.playerX, y: p.playerY, z: p.playerZ, grounded: p.grounded };
};

const track = [await readPosition('inicio')];
// Each key held long enough to leave the 53.4 x 68.6 navigation floor.
for (const [key, label] of [['KeyS', 'hacia la calle'], ['KeyS', 'más lejos'], ['KeyA', 'lateral'], ['KeyA', 'más lateral']]) {
  await page.keyboard.down(key);
  await page.waitForTimeout(5_000);
  await page.keyboard.up(key);
  await page.waitForTimeout(700);
  track.push(await readPosition(label));
}
await page.screenshot({ path: '/tmp/boundary-final.png' });
const falls = events.filter(e => e.includes('MINIMARKET_FALL'));
const sank = track.filter(t => t && (t.y < -0.5 || !t.grounded));
console.log(JSON.stringify({ track, caidasRecuperadas: falls.length, muestrasHundidas: sank.length }, null, 2));
console.log(sank.length || falls.length ? 'FALLO: el jugador salió del suelo' : 'OK: el jugador se mantuvo sobre el suelo fuera de la tienda');
await browser.close();
