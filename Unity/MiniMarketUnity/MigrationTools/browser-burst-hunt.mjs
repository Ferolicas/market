// Long roaming session that listens for MINIMARKET_BURST. CharacterActor logs
// that line the moment its own skinned bounds exceed a sane body size, which is
// what the reported flat shard is. Screenshots the frame it happens.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync, writeFileSync } from 'node:fs';

const baseUrl = process.env.MINIMARKET_QA_URL || 'http://127.0.0.1:4173';
const seconds = Number(process.env.MINIMARKET_BURST_SECONDS ?? 90);
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}), args: ['--no-sandbox','--disable-gpu-sandbox'] });
const page = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }).then(c => c.newPage());
const bursts = [];
let ready; const readySignal = new Promise(r => { ready = r; });
page.on('console', m => {
  const t = m.text();
  if (t.includes('MINIMARKET_READY')) ready(1);
  if (t.includes('MINIMARKET_BURST')) bursts.push(t.trim());
});
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start');
await Promise.race([readySignal, page.waitForTimeout(180_000)]);
await page.waitForFunction(() => Boolean(window.miniMarketUnity), null, { timeout: 30_000 });
await page.waitForTimeout(4_000);
await page.click('#unity-canvas', { position: { x: 700, y: 450 } });
// Customers are characters too, so open the store to exercise them as well.
await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'PrepareLocalQaScenario'));
await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'ToggleStore'));

const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const deadline = Date.now() + seconds * 1_000;
let shots = 0, seen = 0;
while (Date.now() < deadline) {
  const key = keys[Math.floor(Math.random() * keys.length)];
  await page.keyboard.down(key);
  await page.waitForTimeout(400 + Math.random() * 700);
  await page.keyboard.up(key);
  await page.waitForTimeout(150);
  if (bursts.length > seen && shots < 4) {
    seen = bursts.length;
    writeFileSync(`/tmp/burst-${shots}.png`, await page.screenshot());
    shots += 1;
  }
}
console.log(`sesión de ${seconds}s · estallidos detectados: ${bursts.length} · capturas: ${shots}`);
for (const b of bursts.slice(0, 12)) console.log('  ' + b.slice(0, 200));
await browser.close();
