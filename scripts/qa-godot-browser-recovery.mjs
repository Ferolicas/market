import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('tsx')] }));
const origin = process.env.MARKET_QA_API_URL;
if (!origin?.startsWith('http://127.0.0.1:')) throw new Error('Requires the isolated QA backend');
const source = await build({ entryPoints: ['src/game/persistence/RecoveryStorage.ts'], bundle: true, write: false, format: 'iife', globalName: 'OriginalRecovery' });
const bridge = await readFile('godot/game/persistence/browser_recovery.js', 'utf8');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN ?? '/home/ferney_oliveros/.local/bin/google-chrome', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(origin + '/api/health');
  await page.addScriptTag({ content: source.outputFiles[0].text });
  await page.addScriptTag({ content: bridge });
  const evidence = await page.evaluate(async () => {
    const original = globalThis.OriginalRecovery;
    const native = window.__marketGodotRecovery;
    const scope = 'a'.repeat(64);
    original.setRecoveryScope(scope);
    native.setScope(scope);
    // The storage contract treats state opaquely, including safe integer money.
    const first = { state: { revision: 10, balanceMinor: 9007199254740991 }, saveRevision: 4, pendingEvents: [], pendingSave: null };
    await original.persistRecoverySnapshot(first);
    const fromOriginal = await native.read();
    const second = { ...first, state: { ...first.state, revision: 11 }, pendingSave: { operationId: 'unacknowledged-operation', expectedRevision: 4 } };
    await native.persist(second);
    const fromNative = await original.readRecoverySnapshot();
    localStorage.setItem('mini-market-recovery-campaign-30-20260915', JSON.stringify({ state: { revision: 100 }, saveRevision: 100, scopeId: 'b'.repeat(64) }));
    const filteredNative = await native.read();
    const filteredOriginal = await original.readRecoverySnapshot();
    await native.clear();
    const cleared = await original.readRecoverySnapshot();
    return { fromOriginal, fromNative, filteredNative, filteredOriginal, cleared, first: { ...first, scopeId: scope }, second: { ...second, scopeId: scope } };
  });
  assert.deepEqual(evidence.fromOriginal, evidence.first);
  assert.deepEqual(evidence.fromNative, evidence.second);
  assert.deepEqual(evidence.filteredNative, evidence.filteredOriginal);
  assert.equal(evidence.filteredNative.state.revision, 11);
  assert.equal(evidence.cleared, null);
  const ordered = await page.evaluate(async () => {
    const native = window.__marketGodotRecovery;
    const writes = Array.from({length:20}, (_, revision) => native.persist({state:{revision},saveRevision:4,pendingEvents:[],pendingSave:{operationId:'ordered-'+revision,expectedRevision:4}}));
    await native.settled();
    await Promise.all(writes);
    const latest = await globalThis.OriginalRecovery.readRecoverySnapshot();
    const writing = native.persist({state:{revision:20},saveRevision:4,pendingEvents:[]});
    const clearing = native.clear();
    await Promise.all([writing, clearing]);
    return {latest, afterClear:await globalThis.OriginalRecovery.readRecoverySnapshot()};
  });
  assert.equal(ordered.latest.state.revision,19,'Concurrent real IndexedDB writes preserve creation order');
  assert.equal(ordered.latest.pendingSave.operationId,'ordered-19');
  assert.equal(ordered.afterClear,null,'Logout deletion follows outstanding writes');
  console.log('PASS: original IndexedDB ↔ Godot bridge, pending attempt, exact money, scope isolation and logout cleanup');
} finally { await browser.close(); }
