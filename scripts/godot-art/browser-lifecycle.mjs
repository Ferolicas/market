import assert from 'node:assert/strict';

// Exercise browser events against the real Godot runtime and original backend.
// No gameplay/state mutation or synthetic save responses.
export async function verifyBrowserLifecycle(page) {
  await page.waitForFunction(() => window.__marketGodotQa.saveStatus === 'dirty');
  await page.evaluate(() => {
    const original = window.fetch;
    window.__auditSaveRequests = [];
    window.fetch = function(input, options) {
      if (String(input).endsWith('/api/game/save') && options?.method === 'PUT') {
        const attempt = JSON.parse(options.body);
        window.__auditSaveRequests.push({keepalive:options.keepalive, revision:attempt.state.revision, operationId:attempt.operationId, expectedRevision:attempt.expectedRevision, bytes:new TextEncoder().encode(options.body).length});
      }
      return original.apply(this, arguments);
    };
    window.__auditRestoreFetch = () => { window.fetch = original; delete window.__auditRestoreFetch; };
  });
  try {
    const before = await page.evaluate(() => {
      const state = {...window.__marketGodotQa};
      window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true}));
      return state;
    });
    await page.waitForFunction(() => window.__auditSaveRequests.length > 0, {}, {timeout:5000});
    const save = await page.evaluate(() => window.__auditSaveRequests[0]);
    assert.equal(save.keepalive, save.bytes <= 60000, 'Source bounded keepalive policy');
    assert.ok(save.revision >= before.revision, 'Lifecycle saves newest snapshot');
    await page.waitForFunction(async revision => (await window.__marketGodotRecovery.read())?.state.revision >= revision, before.revision, {timeout:5000});
    await page.waitForFunction(async save => {
      const recovery = await window.__marketGodotRecovery.read();
      return recovery?.pendingSave?.operationId === save.operationId || recovery?.saveRevision > save.expectedRevision;
    }, save, {timeout:5000});
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => window.__marketGodotQa.revision), before.revision, 'Simulation pauses on pagehide');
    // A real visibility event uses the current (visible) document state.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(revision => window.__marketGodotQa.revision > revision, before.revision, {timeout:5000});
    console.log('PASS: pagehide flushes newest IndexedDB recovery, sends bounded keepalive and pauses; visibility resumes simulation');
  } finally {
    await page.evaluate(() => window.__auditRestoreFetch?.());
  }
}
