import { chromium } from '../../../node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const baseUrl = process.env.MINIMARKET_QA_URL || 'http://127.0.0.1:4173';
const output = process.env.MINIMARKET_QA_OUTPUT || '/tmp/mini-market-unity-gameplay.png';
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const events = [];
let ready;
const readySignal = new Promise(resolve => { ready = resolve; });

page.on('console', message => {
  const text = message.text();
  events.push({ type: `console:${message.type()}`, text });
  if (text.includes('MINIMARKET_READY')) ready(text);
});
page.on('pageerror', error => events.push({ type: 'pageerror', text: error.stack || error.message }));
page.on('requestfailed', request => events.push({ type: 'requestfailed', text: `${request.method()} ${request.url()} ${request.failure()?.errorText}` }));
page.on('response', response => {
  if (response.status() >= 400) events.push({ type: 'http', text: `${response.status()} ${response.request().method()} ${response.url()}` });
});

const startedAt = Date.now();
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start');
await Promise.race([readySignal, page.waitForTimeout(180_000).then(() => null)]);
await page.waitForFunction(() => Boolean(window.miniMarketUnity), null, { timeout: 30_000 });
await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'PrepareLocalQaScenario'));
// A real pointer gesture unlocks WebAudio and exercises the actual canvas UI.
await page.mouse.click(700, 450);
await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'ToggleStore'));
let waiting = false;
for (let attempt = 0; attempt < 45 && !waiting; attempt += 1) {
  await page.waitForTimeout(2_000);
  await page.evaluate(() => window.miniMarketUnity.SendMessage('Customers', 'LogCustomerState'));
  waiting = events.some(event => event.text.includes('MINIMARKET_CUSTOMERS') && event.text.includes('Waiting'));
}
// Level one intentionally has no automatic cashier.  Exercise the same public
// checkout command that the player's interaction point invokes.
await page.evaluate(() => window.miniMarketUnity.SendMessage('Customers', 'ServeNext'));
let checkoutCount = 0;
for (let attempt = 0; attempt < 8 && checkoutCount === 0; attempt += 1) {
  await page.waitForTimeout(1_000);
  checkoutCount = events.filter(event => event.text.includes('MINIMARKET_CHECKOUT')).length;
}
await page.evaluate(() => window.miniMarketUnity.SendMessage('Customers', 'LogCustomerState'));
await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'LogRuntimeState'));
await page.evaluate(() => window.miniMarketUnity.SendMessage('MiniMarketRuntime', 'LogPerformanceState'));
await page.waitForTimeout(500);
await page.screenshot({ path: output, fullPage: true });

const relevant = events.filter(event =>
  event.type !== 'console:log' ||
  /MINIMARKET|Cliente|Tienda|Exception|Error|ERROR|failed/i.test(event.text)
);
const result = {
  elapsedMs: Date.now() - startedAt,
  screenshot: output,
  reachedCheckoutQueue: waiting,
  checkoutCount,
  audioPolicyWarnings: events.filter(event => event.text.includes('AudioContext was not allowed')).length,
  failures: events.filter(event => ['pageerror', 'requestfailed', 'http'].includes(event.type)),
  relevant,
};
if (!waiting) result.failures.push({ type: 'assertion', text: 'Ningún cliente alcanzó la caja' });
if (checkoutCount < 1) result.failures.push({ type: 'assertion', text: 'El flujo descargar → escanear → embolsar → pagar no terminó' });
await writeFile('/tmp/mini-market-unity-gameplay-qa.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
