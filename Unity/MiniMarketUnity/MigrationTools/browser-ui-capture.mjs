// Capture what the client actually puts on screen, so the interface can be
// reviewed against a reference instead of described from memory.
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { existsSync, mkdirSync } from 'node:fs';

const baseUrl = process.env.MINIMARKET_QA_URL || 'http://127.0.0.1:4173';
const outDir = process.env.MINIMARKET_UI_OUT || '/tmp/ui';
const chromePath = '/home/ferney_oliveros/.local/bin/google-chrome';
mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: 'escritorio', width: 1440, height: 900 },
  { name: 'movil', width: 430, height: 932 },
];

const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--no-sandbox', '--disable-gpu-sandbox'],
});

for (const vp of viewports) {
  const page = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 })
    .then(c => c.newPage());
  let ready; const readySignal = new Promise(r => { ready = r; });
  page.on('console', m => { if (m.text().includes('MINIMARKET_READY')) ready(true); });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.click('#start').catch(() => {});
  await Promise.race([readySignal, page.waitForTimeout(180_000)]);
  await page.waitForFunction(() => Boolean(window.miniMarketUnity), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(6_000);
  await page.screenshot({ path: `${outDir}/hud-${vp.name}.png` });
  // and one with a management panel open, which is where most of the surface is
  for (const panel of ['inventory', 'finance']) {
    await page.evaluate(id => window.miniMarketUnity?.SendMessage?.('MiniMarketRuntime', 'OpenPanelFromWeb', id), panel).catch(() => {});
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: `${outDir}/panel-${panel}-${vp.name}.png` });
  }
  await page.close();
  console.log(`capturado ${vp.name}`);
}
await browser.close();
console.log('CAPTURA_OK', outDir);
