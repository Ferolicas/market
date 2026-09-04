// Playability check: does the player actually respond to input? The gameplay
// QA drives the store through SendMessage commands and never touches the
// keyboard, so it passes even when the character cannot be moved at all.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const baseUrl = process.env.MINIMARKET_QA_URL || 'http://127.0.0.1:4173';
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }).then(c => c.newPage());
const events = [];
let ready;
const readySignal = new Promise(resolve => { ready = resolve; });
page.on('console', m => { events.push({ type: m.type(), text: m.text() }); if (m.text().includes('MINIMARKET_READY')) ready(m.text()); });
page.on('pageerror', e => events.push({ type: 'pageerror', text: e.stack || e.message }));

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start');
await Promise.race([readySignal, page.waitForTimeout(180_000).then(() => null)]);
await page.waitForFunction(() => Boolean(window.miniMarketUnity), null, { timeout: 30_000 });
await page.waitForTimeout(3_000);
// Focus the canvas the way a player does before typing.
await page.click('#unity-canvas', { position: { x: 700, y: 450 } });
await page.waitForTimeout(500);

// PNG bytes are compressed, so any change scrambles the whole buffer and every
// comparison reads as 100%. Decode first and compare actual pixels.
const decode = async (buffer) => sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const differs = async (a, b) => {
  const [x, y] = await Promise.all([decode(a), decode(b)]);
  let changed = 0;
  for (let i = 0; i < x.data.length; i += x.info.channels) if (Math.abs(x.data[i] - y.data[i]) > 12) changed += 1;
  return (100 * changed) / (x.info.width * x.info.height);
};
const shot = async (name) => { const b = await page.screenshot({ path: `/tmp/play-${name}.png` }); return b; };

const before = await shot('before');
const results = {};
const positions = [];
const readPosition = async (label) => {
  const seen = events.length;
  await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'LogRuntimeState'));
  await page.waitForTimeout(400);
  const line = events.slice(seen).find(e => e.text.includes('MINIMARKET_STATE'));
  if (!line) return;
  const parsed = JSON.parse(line.text.slice(line.text.indexOf('{')).trim());
  positions.push({ label, x: parsed.playerX, y: parsed.playerY, z: parsed.playerZ, grounded: parsed.grounded });
};
await readPosition('start');
for (const key of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) {
  const start = await page.screenshot();
  await page.keyboard.down(key);
  await page.waitForTimeout(1_600);
  await page.keyboard.up(key);
  await page.waitForTimeout(400);
  const end = await page.screenshot();
  results[key] = Number((await differs(start, end)).toFixed(2));
  await readPosition(`after ${key}`);
}
await shot('after');
await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'LogRuntimeState'));
await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'LogPerformanceState'));
await page.waitForTimeout(800);
const after = await shot('final');

const report = {
  movedPixelsPercentByKey: results,
  positions,
  totalDriftFromStart: Number((await differs(before, after)).toFixed(2)),
  errors: events.filter(e => e.type === 'pageerror' || /exception|error/i.test(e.text)).slice(0, 10),
  state: events.filter(e => e.text.includes('MINIMARKET_STATE') || e.text.includes('MINIMARKET_PERF') || e.text.includes('MINIMARKET_READY')).map(e => e.text.slice(0, 260)),
};
await writeFile('/tmp/mini-market-playability.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
