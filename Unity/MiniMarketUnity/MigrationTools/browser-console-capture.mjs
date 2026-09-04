// Full console capture. browser-gameplay-qa.mjs stores message.text(), which
// collapses Unity's multi-argument console.error into "ERROR: Shader " and
// hides which shader the player could not resolve.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const baseUrl = process.env.MINIMARKET_QA_URL || 'http://127.0.0.1:4173';
const output = process.env.MINIMARKET_CONSOLE_OUTPUT || '/tmp/mini-market-console.json';
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }).then(c => c.newPage());
const messages = [];
let ready;
const readySignal = new Promise(resolve => { ready = resolve; });
page.on('console', async (message) => {
  let full = message.text();
  try {
    const parts = await Promise.all(message.args().map(arg => arg.jsonValue().catch(() => null)));
    const joined = parts.filter(p => typeof p === 'string').join(' ');
    if (joined.length > full.length) full = joined;
  } catch {}
  messages.push({ type: message.type(), text: full });
  if (full.includes('MINIMARKET_READY')) ready(full);
});
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.click('#start');
await Promise.race([readySignal, page.waitForTimeout(180_000).then(() => null)]);
await page.waitForTimeout(4_000);

const interesting = messages.filter(m => /shader|MINIMARKET_MATERIAL|unsupported|fallback|magenta|error/i.test(m.text));
await writeFile(output, JSON.stringify({ total: messages.length, interesting }, null, 2));
console.log(`captured ${messages.length} console messages, ${interesting.length} interesting`);
for (const m of interesting.slice(0, 40)) console.log(`  [${m.type}] ${m.text.slice(0, 220)}`);
await browser.close();
