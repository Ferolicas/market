import assert from 'node:assert/strict';
import {runFirstSaleJourney} from './godot-art/browser-journey.mjs';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
const origin = process.env.MARKET_QA_API_URL;
if (!origin?.startsWith('http://127.0.0.1:')) throw new Error('Requires isolated QA backend');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN ?? '/home/ferney_oliveros/.local/bin/google-chrome', args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-background-timer-throttling'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  context.on('console', message => { if (!message.page()) console.log('Service worker:', message.type(), message.text()); });
  const id = 'web_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const signup = await context.request.post(origin + '/api/auth/sign-up/email', { headers: { Origin: origin }, data: { email: id + '@example.invalid', username: id, password, name: 'Godot Web QA' } });
  assert.equal(signup.ok(), true, 'Real browser auth signup');
  const page = await context.newPage();
  const errors = [];
  let expectedResetRejection = false;
  const telemetry = [];
  page.on('response', response => {
    if(response.url().endsWith('/api/game/telemetry')) telemetry.push({status:response.status(),body:response.request().postDataJSON()});
    if(process.env.MARKET_QA_TRACE_SAVES === '1' && response.url().endsWith('/api/game/save')) {
      const request = response.request().postDataJSON();
      response.json().then(body => console.log('SAVE TRACE', {method:response.request().method(), status:response.status(), expected:request?.expectedRevision, operation:request?.operationId, revision:body.saveRevision, lastOperation:body.lastOperationId})).catch(()=>{});
    }
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if(expectedResetRejection && message.location().url.endsWith('/api/auth/reset-password') && /^Failed to load resource: the server responded with a status of 400 /.test(message.text())) return; if (message.type() === 'error' || /SCRIPT ERROR|ERROR:/.test(message.text())) errors.push(message.text()); });
  await context.clearCookies();
  await page.goto(origin + '/godot/index.html#qa=1', { timeout: 120000 });
  await page.waitForFunction(() => window.__marketGodotQa?.authMode === 'login', {}, {timeout:120000});
  await page.setViewportSize({width:360,height:640});
  await page.waitForTimeout(300);
  for (const [key,value] of [['identity',id],['password',password]]) {
    const rect = await page.evaluate(key=>window.__marketGodotQa.fields[key],key);
    assert.ok(rect[0]>=0&&rect[0]+rect[2]<=360,'Auth field fits actual mobile viewport');
    await page.mouse.click(rect[0]+rect[2]/2,rect[1]+rect[3]/2);
    await page.keyboard.type(value,{delay:35});
  }
  await page.keyboard.press('Enter');
  try { await page.waitForFunction(() => window.__marketGodotQa?.view === 'game', { }, { timeout: 120000 }); }
  catch (error) { await page.screenshot({path:'.migration-validation/auth-web-failure.png'}); console.error('Godot browser errors', errors, await page.evaluate(()=>window.__marketGodotQa)); throw error; }
  assert.deepEqual(errors, [], 'Export must load without Godot or browser errors');
  console.log('PASS: real native login form and Enter submission on small phone');
  await page.goto(origin+'/godot/index.html?auth=reset&token=invalid-qa-token#qa=1',{timeout:120000});
  await page.waitForFunction(()=>window.__marketGodotQa?.authMode==='reset',{}, {timeout:120000});
  for(const key of ['password','confirm']) {
    const rect=await page.evaluate(key=>window.__marketGodotQa.fields[key],key);
    await page.mouse.click(rect[0]+rect[2]/2,rect[1]+rect[3]/2);
    await page.keyboard.type('Password-reset-1234',{delay:35});
  }
  expectedResetRejection=true;
  const rejectedReset=page.waitForResponse(response=>response.url().endsWith('/api/auth/reset-password'));
  await page.keyboard.press('Enter');
  assert.equal((await rejectedReset).status(),400,'Original backend rejects invalid reset token');
  await page.waitForFunction(()=>window.__marketGodotQa.authMessage && !window.__marketGodotQa.authBusy);
  expectedResetRejection=false;
  assert.notEqual(await page.evaluate(()=>window.__marketGodotQa.authMessage),'Contraseña actualizada. Ya puedes volver a entrar.');
  const back=await page.evaluate(()=>window.__marketGodotQa.buttons.find(b=>b.text==='Volver al inicio').rect);
  await page.mouse.click(back[0]+back[2]/2,back[1]+back[3]/2);
  await page.waitForFunction(()=>window.__marketGodotQa?.view==='game',{}, {timeout:120000});
  assert.equal(new URL(page.url()).searchParams.has('token'),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: reset route takes precedence over existing session; invalid token rejected; return restores session');
  await page.setViewportSize({width:1280,height:720});
  await page.screenshot({ path: '.migration-validation/godot-web-setup.png' });
  const initial = await page.evaluate(() => window.__marketGodotQa);
  assert.equal(initial.tutorialStep, 0);
  // Visiting the reset page now flushes the prior view, as GameRuntime does.
  // Compare the actual server revision instead of assuming no lifecycle save.
  const initialRemote = await (await context.request.get(origin+'/api/game/save')).json();
  assert.equal(initial.saveRevision, initialRemote.saveRevision);
  assert.equal(initialRemote.state.tutorialStep, 0);
  console.log('PASS: exported Godot WebAssembly loads original authenticated game and setup', initial);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '.migration-validation/godot-web-mobile.png' });
  assert.deepEqual(errors, [], 'Mobile viewport must not introduce runtime errors');
  async function clickNativeButton(text, insidePanel = true) {
    for (let scroll = 0; scroll < 12; scroll++) {
      const state = await page.evaluate(()=>window.__marketGodotQa);
      const button = state.buttons.find(button=>button.text===text);
      assert.ok(button, `Native button exists: ${text}`);
      const [x, y, width, height] = button.rect;
      const bounds=insidePanel?state.panelBodyRect:[0,0,page.viewportSize().width,page.viewportSize().height];
      if (x>=bounds[0]&&x+width<=bounds[0]+bounds[2]+1&&y>=bounds[1]&&y+height<=Math.min(page.viewportSize().height,bounds[1]+bounds[3])+1) {
        assert.equal(button.disabled, false);
        await page.mouse.click(x + width / 2, y + height / 2);
        return;
      }
      await page.mouse.move(bounds[0]+bounds[2]/2,bounds[1]+bounds[3]/2);
      await page.mouse.wheel(0, 450);
      await page.waitForTimeout(300);
    }
    throw Error(`Could not scroll native button into view: ${text}`);
  }
  await clickNativeButton('Abrir mi primer Mini Market');
  try {await page.waitForFunction(() => window.__marketGodotQa.tutorialStep > 0 && window.__marketGodotQa.saveRevision >= 2 && window.__marketGodotQa.sceneSettled && !window.__marketGodotQa.loading, {}, { timeout: 30000 });}
  catch(error){console.error('Setup failure',errors,await page.evaluate(()=>({state:window.__marketGodotQa,recovery:window.MarketWebGLRecovery?.inspect(document.querySelector('canvas').getContext('webgl2'))})));await page.screenshot({path:'.migration-validation/godot-setup-failure.png'});throw error;}
  const completed = await page.evaluate(() => window.__marketGodotQa);
  assert.equal(completed.panel, '');
  // Simulation can make a successfully saved game dirty before loading fades.
  // Check the authoritative stored snapshot, not simultaneous transient UI flags.
  const storedResponse=await context.request.get(origin+'/api/game/save');
  assert.equal(storedResponse.status(),200);
  const stored=await storedResponse.json();
  assert.ok(stored.saveRevision>=2,'Onboarding must actually be persisted');
  assert.equal(stored.state.tutorialStep,completed.tutorialStep);
  assert.equal(stored.state.countryCode,completed.countryCode);
  await page.screenshot({ path: '.migration-validation/godot-web-campaign.png' });
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(300);
  const moved = await page.evaluate(() => window.__marketGodotQa.playerPosition);
  assert.ok(Math.hypot(moved[0] - completed.playerPosition[0], moved[1] - completed.playerPosition[1]) > 0.1, 'Actual keyboard input moves native physics player');
  if(process.env.MARKET_QA_LIFECYCLE === '1') await (await import('./godot-art/browser-lifecycle.mjs')).verifyBrowserLifecycle(page);
  if(process.env.MARKET_QA_CONTEXT_ONLY==='1') {
    try {await (await import('./godot-art/context-loss-probe.mjs')).probeContextLoss(page);}
    catch(error){console.error('Recovery errors',errors);throw error;}
    assert.deepEqual(errors, [], 'Graphics recovery must remain free of browser and engine errors');
    await page.waitForFunction(()=>window.__marketGodotQa.renderedFrames>0);
    const graphicsEvents=telemetry.filter(entry=>entry.body.kind==='webgl');
    assert.equal(graphicsEvents.filter(entry=>entry.body.name==='context-lost'&&entry.status===201).length,2);
    assert.equal(graphicsEvents.filter(entry=>entry.body.name==='context-restored'&&entry.status===201).length,2);
    const revisionAfterRecovery=await page.evaluate(()=>window.__marketGodotQa.saveRevision);
    const saveAfterRecovery=await page.evaluate(()=>window.__marketGodotQa.buttons.find(button=>button.name==='SaveGame'));
    await page.mouse.click(saveAfterRecovery.rect[0]+saveAfterRecovery.rect[2]/2,saveAfterRecovery.rect[1]+saveAfterRecovery.rect[3]/2);
    await page.waitForFunction(revision=>window.__marketGodotQa.saveRevision>revision,revisionAfterRecovery,{timeout:30000});
    const recoveredSave=await (await context.request.get(origin+'/api/game/save')).json();
    assert.ok(recoveredSave.saveRevision>revisionAfterRecovery);
    console.log('PASS: telemetry and authoritative save continue after GPU reconstruction');
  } else {
  if(process.env.MARKET_QA_PANELS==='1') await (await import('./godot-art/browser-panels.mjs')).verifyManagementPanels(page);
  if(process.env.MARKET_QA_JOURNEY==='1') {
    const before=errors.length;
    try { await runFirstSaleJourney(page,clickNativeButton); }
    catch(error) { console.error('Journey engine errors',errors.slice(before)); await page.screenshot({path:'.migration-validation/godot-web-journey-failure.png'}); throw error; }
    assert.deepEqual(errors.slice(before), [], 'Complete physical journey must remain free of engine errors');
    const performance = telemetry.find(entry=>entry.body.kind === 'performance');
    assert.ok(performance, 'Real browser must report its one-minute performance window');
    assert.equal(performance.status,201,'Original authenticated backend persists browser telemetry');
    assert.ok(performance.body.payload.frameCount>=30);
    console.log('PASS: actual browser timing accepted by original telemetry endpoint');
  }
  await page.reload({ timeout: 120000 });
  try { await page.waitForFunction(() => window.__marketGodotQa?.view === 'game' && window.__marketGodotQa.tutorialStep > 0 && !window.__marketGodotQa.loading, {}, { timeout: 120000 }); }
  catch (error) { console.error('Online reload failed', errors, await page.evaluate(() => document.body.innerText)); throw error; }
  assert.deepEqual(errors, [], 'Setup, movement and authenticated reload must remain error-free');
  console.log('PASS: native setup, server save, keyboard movement and reload through real WebAssembly UI');
  await page.waitForFunction(async () => {
    if (!navigator.serviceWorker.controller) return false;
    const name = (await caches.keys()).find(name => name.startsWith('Mini Market-sw-cache-'));
    if (!name) return false;
    const cache = await caches.open(name);
    const committed = await cache.match('/godot/index.pck?cache-manifest');
    if (!committed || !await cache.match('/godot/index.wasm')) return false;
    const manifest = await committed.json();
    let bytes = 0;
    for (let index = 0; index < manifest.chunks; index++) {
      const chunk = await cache.match('/godot/index.pck?cache-chunk=' + index);
      if (!chunk) return false;
      bytes += (await chunk.arrayBuffer()).byteLength;
    }
    return bytes === manifest.bytes;
  }, {}, { timeout: 60000 });
  await page.waitForFunction(async () => (await window.__marketGodotRecovery.read())?.state?.tutorialStep > 0, {}, { timeout: 10000 });
  const offlineErrorStart = errors.length;
  await context.setOffline(true);
  await page.reload({ timeout: 120000 });
  try {
  await page.waitForFunction(() => window.__marketGodotQa?.view === 'game' && window.__marketGodotQa.tutorialStep > 0 && !window.__marketGodotQa.loading, {}, { timeout: 120000 });
  } catch (error) {
    console.error('Offline runtime', await page.evaluate(() => ({ state: window.__marketGodotQa, requests: window.__marketGodotRequests, recovery: window.__marketGodotRecovery ? 'installed' : 'missing', text: document.body.innerText })), errors);
    await page.screenshot({ path: '.migration-validation/godot-web-offline-failure.png' });
    throw error;
  }
  const offline = await page.evaluate(() => window.__marketGodotQa);
  if(process.env.MARKET_QA_TRACE_SAVES === '1') console.log('OFFLINE TRACE', await page.evaluate(async()=>{const r=await window.__marketGodotRecovery.read();return {native:window.__marketGodotQa.saveRevision, local:r?.saveRevision, pending:r?.pendingSave?.operationId, expected:r?.pendingSave?.expectedRevision};}));
  assert.equal(offline.countryCode, completed.countryCode);
  assert.ok(offline.saveRevision >= completed.saveRevision);
  await page.screenshot({ path: '.migration-validation/godot-web-offline.png' });
  // Deliberately disconnected real HTTP requests must fail; engine/script errors still fail QA.
  const offlineErrors = errors.slice(offlineErrorStart);
  assert.ok(offlineErrors.length > 0, 'Offline API requests must actually fail');
  assert.deepEqual(offlineErrors.filter(error => error !== 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED'), []);
  await page.evaluate(() => { window.__qaOnlineEvents = []; window.addEventListener('online', () => window.__qaOnlineEvents.push(navigator.onLine)); });
  const reconnectSaves = [];
  page.on('response', response => { if(response.url().endsWith('/api/game/save') && response.request().method()==='PUT') reconnectSaves.push({status:response.status(),body:response.request().postDataJSON()}); });
  await context.setOffline(false);
  if (process.env.MARKET_QA_LIFECYCLE === '1') {
    // Chromium network interception can restore HTTP without emitting `online`
    // after a service-worker offline reload (verified: online=true, no event).
    // Deliver the DOM lifecycle event explicitly; the save still uses real HTTP.
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    try { await page.waitForFunction(revision => window.__marketGodotQa.saveRevision > revision, offline.saveRevision, { timeout: 5000 }); }
    catch(error) {
      const remote = await (await context.request.get(origin+'/api/game/save')).json();
      console.error('Reconnect diagnostic', await page.evaluate(async()=>{
        const recovery = await window.__marketGodotRecovery.read();
        return {state:window.__marketGodotQa, online:navigator.onLine, events:window.__qaOnlineEvents, requests:window.__marketGodotRequests,
          recovery: {revision:recovery?.state.revision, saveRevision:recovery?.saveRevision, pendingOperation:recovery?.pendingSave?.operationId, expectedRevision:recovery?.pendingSave?.expectedRevision}};
      }), {remoteSaveRevision:remote.saveRevision,lastOperationId:remote.lastOperationId}, reconnectSaves.map(save=>({status:save.status, expectedRevision:save.body.expectedRevision,operationId:save.body.operationId})), errors);
      throw error;
    }
    console.log('PASS: online DOM event automatically saves pending progress against real backend (event emulated)');
  }
  const saveButton = await page.evaluate(() => window.__marketGodotQa.buttons.find(button => button.name === 'SaveGame'));
  assert.ok(saveButton);
  await page.mouse.click(saveButton.rect[0] + saveButton.rect[2] / 2, saveButton.rect[1] + saveButton.rect[3] / 2);
  await page.waitForFunction(revision => window.__marketGodotQa.saveRevision > revision, offline.saveRevision, { timeout: 30000 });
  console.log('PASS: installed PWA reloads fully offline using real IndexedDB recovery and saves after reconnecting');
  if(process.env.MARKET_QA_CONTEXT === '1') await (await import('./godot-art/context-loss-probe.mjs')).probeContextLoss(page);
  }

  const logoutErrorStart=errors.length;
  const settings=await page.evaluate(()=>window.__marketGodotQa.buttons.find(b=>b.tooltip==='Sonido y vibración'));
  assert.ok(settings,'Settings navigation remains available after recovery');
  await page.mouse.click(settings.rect[0]+settings.rect[2]/2,settings.rect[1]+settings.rect[3]/2);
  await page.waitForFunction(()=>window.__marketGodotQa.panel==='settings');
  await clickNativeButton('Cerrar sesión',false);
  await page.waitForFunction(()=>window.__marketGodotQa?.view==='auth'&&window.__marketGodotQa.authMode==='login');
  await page.waitForFunction(async()=>await window.__marketGodotRecovery.read()===null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('mini-market-offline-player-v1')),null);
  assert.equal(await (await context.request.get(origin+'/api/auth/get-session')).json(),null);
  assert.deepEqual(errors.slice(logoutErrorStart),[],'Logout does not trigger runtime errors');
  console.log('PASS: native logout clears the real session and local recovery after gameplay');
} finally { await browser.close(); }
