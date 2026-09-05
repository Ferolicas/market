// Performance run on a real GPU: workers hired (level 6), store open, customers
// arriving; samples MINIMARKET_PERF and requestAnimationFrame deltas for a
// while, walks into the store and screenshots. Numbers, not impressions.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const baseUrl = process.env.MINIMARKET_QA_URL || 'http://127.0.0.1:4173';
const out = process.env.MINIMARKET_QA_OUTPUT || '/tmp/mini-market-unity-perf';
const seconds = Number(process.env.MINIMARKET_PERF_SECONDS ?? 60);
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
const browser = await chromium.launch({
  headless: process.env.MINIMARKET_HEADFUL !== '1',
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan',
         '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
const perf = []; const events = []; let ready;
const readySignal = new Promise(r => { ready = r; });
page.on('console', m => {
  const t = m.text();
  if (t.includes('MINIMARKET_READY')) ready(1);
  if (t.includes('MINIMARKET_PERF')) perf.push(t.trim());
  if (/MINIMARKET_(WORKERS|CUSTOMERS|EMPLOYEE|HEAVY)|Exception|Empleados|Visual|Precalentar/.test(t)) events.push(t.trim().slice(0, 900));
});
page.on('requestfailed', r => events.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`));
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start');
await Promise.race([readySignal, page.waitForTimeout(180_000)]);
await page.waitForFunction(() => Boolean(window.miniMarketUnity), null, { timeout: 30_000 });
await page.waitForTimeout(3_000);
const gpu = await page.evaluate(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'desconocido'; });
await page.mouse.click(700, 450);
await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'PrepareLocalWorkerQaScenario'));
await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'ToggleStore'));
// frame deltas from the page's own animation clock
await page.evaluate(() => { window.__frames = []; let last = performance.now(); const tick = t => { window.__frames.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
const started = Date.now();
while (Date.now() - started < seconds * 1000) {
  await page.waitForTimeout(5_000);
  await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'LogPerformanceState'));
  await page.evaluate(() => window.miniMarketUnity.SendMessage('Customers', 'LogCustomerState'));
}
await page.evaluate(() => window.miniMarketUnity.SendMessage('Employees', 'LogWorkerState'));
const frames = await page.evaluate(() => window.__frames.slice(30));
frames.sort((a, b) => a - b);
const q = p => frames[Math.min(frames.length - 1, Math.floor(p * frames.length))];
const stats = { frames: frames.length, mean: frames.reduce((a, b) => a + b, 0) / frames.length, p50: q(.5), p95: q(.95), p99: q(.99), max: frames[frames.length - 1], over50ms: frames.filter(f => f > 50).length, over100ms: frames.filter(f => f > 100).length };
// walk in and look
await page.keyboard.down('KeyW'); await page.waitForTimeout(2_500); await page.keyboard.up('KeyW'); await page.waitForTimeout(1_500);
await page.screenshot({ path: `${out}-tienda.png` });
await page.keyboard.down('KeyW'); await page.waitForTimeout(2_500); await page.keyboard.up('KeyW'); await page.waitForTimeout(1_500);
await page.screenshot({ path: `${out}-fondo.png` });
// the retail floor: displays with stock and customers with carts
await page.keyboard.down('KeyS'); await page.waitForTimeout(2_000); await page.keyboard.up('KeyS'); await page.waitForTimeout(600);
await page.keyboard.down('KeyD'); await page.waitForTimeout(2_500); await page.keyboard.up('KeyD'); await page.waitForTimeout(1_500);
await page.screenshot({ path: `${out}-tienda-der.png` });
await page.keyboard.down('KeyA'); await page.waitForTimeout(5_000); await page.keyboard.up('KeyA'); await page.waitForTimeout(1_500);
await page.screenshot({ path: `${out}-tienda-izq.png` });
await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'LogHeavyRenderers'));
await page.waitForTimeout(500);
const result = { gpu, stats, perf, events: events.slice(0, 80) };
await writeFile(`${out}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ gpu, stats, lastPerf: perf[perf.length - 1] }, null, 1));
await browser.close();
