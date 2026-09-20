// Shared storage contract with the original RecoveryStorage.ts. Native gameplay
// stays in GDScript; this bridge only uses the browser's existing IndexedDB.
(() => {
  if (window.__marketGodotRecovery) return;
  const release = 'campaign-30-20260915';
  const databaseName = `mini-market-recovery-${release}`;
  const legacyKey = databaseName;
  const markerKey = `mini-market-recovery-available-${release}`;
  const scopeKey = `mini-market-recovery-scope-${release}`;
  let chain = Promise.resolve();
  let database;
  let opening;
  let activeScope = "";
  const results = {};
  const scope = () => { if (activeScope) return activeScope; try { const value = localStorage.getItem(scopeKey); activeScope = /^[a-f0-9]{32,64}$/i.test(value ?? '') ? value.toLowerCase() : ''; return activeScope; } catch { return ''; } };
  const key = () => scope() ? `scope:${scope()}:slot:1` : 'current';
  const connect = () => opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('snapshots')) request.result.createObjectStore('snapshots'); };
      request.onsuccess = () => {
        database = request.result;
        database.onversionchange = () => { database.close(); database = undefined; opening = undefined; };
        resolve(database);
      };
      request.onerror = () => { opening = undefined; reject(request.error); };
    });
  const withStore = (mode, operation) => {
    const transact = database => new Promise((resolve, reject) => {
      const transaction = database.transaction('snapshots', mode);
      const request = operation(transaction.objectStore('snapshots'));
      let value;
      request.onsuccess = () => { value = request.result; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
    return database ? transact(database) : connect().then(transact);
  };
  const read = async () => {
    const indexed = await withStore('readonly', store => store.get(key())).catch(() => null);
    const oldIndexed = indexed || key() === 'current' ? null : await withStore('readonly', store => store.get('current')).catch(() => null);
    let legacy;
    try { legacy = JSON.parse(localStorage.getItem(legacyKey)); } catch {}
    return [indexed, oldIndexed, legacy].filter(value => value?.state && Number.isFinite(value.saveRevision))
      .filter(value => !scope() || !value.scopeId || value.scopeId === scope())
      .sort((a, b) => b.state.revision - a.state.revision || b.saveRevision - a.saveRevision)[0] ?? null;
  };
  const persist = snapshot => {
    const value = { ...snapshot, scopeId: scope() || snapshot.scopeId };
    const snapshotKey = key();
    // Create the transaction now, including during pagehide. Deferring its
    // creation behind another promise/open request can lose a pending save on
    // unload. IndexedDB serializes readwrite transactions in creation order.
    const write = withStore('readwrite', store => store.put(value, snapshotKey));
    chain = (async () => {
      try {
        await write;
        try { localStorage.setItem(markerKey, '1'); localStorage.removeItem(legacyKey); } catch {}
      } catch {
        try { localStorage.setItem(legacyKey, JSON.stringify(value)); localStorage.setItem(markerKey, '1'); } catch {}
      }
    })();
    return chain;
  };
  const clear = () => {
    const snapshotKey = key();
    const hints = () => { try { localStorage.removeItem(legacyKey); localStorage.removeItem(markerKey); } catch {} };
    hints();
    chain = withStore('readwrite', store => store.delete(snapshotKey)).catch(() => {}).finally(hints);
    return chain;
  };
  window.__marketGodotRecovery = { results, scope, read, persist, clear, settled: () => chain,
    setScope(value) { if (/^[a-f0-9]{32,64}$/i.test(value)) { activeScope = value.toLowerCase(); try { localStorage.setItem(scopeKey, activeScope); } catch {} } },
    requestRead(token) { read().then(value => { results[token] = JSON.stringify(value); }).catch(() => { results[token] = 'null'; }); }
  };
})();
