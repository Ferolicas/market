import type { GameEvent, GameState } from "../types";

export const LEGACY_RECOVERY_KEY = "mini-market-recovery-v1";
export const RECOVERY_MARKER_KEY = "mini-market-recovery-available-v2";

const DATABASE_NAME = "mini-market-recovery";
const DATABASE_VERSION = 1;
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "current";
const RECOVERY_WRITE_INTERVAL_MS = 3_000;

export interface RecoverySnapshot {
  state: GameState;
  saveRevision: number;
  pendingEvents?: GameEvent[];
}

let queuedSnapshot: RecoverySnapshot | null = null;
let scheduledTimer: number | null = null;
let scheduledIdleCallback: number | null = null;
let writeChain = Promise.resolve();
let lastWriteAt = 0;

/**
 * Reads the async recovery snapshot first and transparently imports snapshots
 * written by older builds. IndexedDB keeps the large structured clone away
 * from localStorage's synchronous main-thread JSON path.
 */
export async function readRecoverySnapshot(): Promise<RecoverySnapshot | null> {
  const indexed = await readIndexedRecovery().catch(() => null);
  const legacy = readLegacyRecovery();
  const legacyIsNewer = Boolean(legacy && (!indexed
    || legacy.state.revision > indexed.state.revision
    || (legacy.state.revision === indexed.state.revision && legacy.saveRevision > indexed.saveRevision)));
  const selected = legacyIsNewer ? legacy : indexed;
  if (selected === legacy && legacy && canUseIndexedDb()) void persistRecoverySnapshot(legacy);
  return selected;
}

/** Coalesces rapid world ticks into one asynchronous durable local snapshot. */
export function queueRecoverySnapshot(snapshot: RecoverySnapshot) {
  queuedSnapshot = snapshot;
  if (!canScheduleInBrowser()) {
    void flushRecoverySnapshot();
    return;
  }
  scheduleQueuedWrite(Math.max(0, RECOVERY_WRITE_INTERVAL_MS - (performance.now() - lastWriteAt)));
}

/** Flushes the latest queued state, used when the app is hidden or closed. */
export async function flushRecoverySnapshot() {
  cancelScheduledWrite();
  const snapshot = queuedSnapshot;
  queuedSnapshot = null;
  if (!snapshot) return writeChain;
  return persistRecoverySnapshot(snapshot);
}

/** Writes in sequence so an older async transaction can never win a race. */
export function persistRecoverySnapshot(snapshot: RecoverySnapshot) {
  queuedSnapshot = null;
  cancelScheduledWrite();
  writeChain = writeChain.then(async () => {
    if (canUseIndexedDb()) {
      try {
        await writeIndexedRecovery(snapshot);
        markRecoveryAvailable();
        try { localStorage.removeItem(LEGACY_RECOVERY_KEY); } catch { /* storage may be blocked */ }
        lastWriteAt = canScheduleInBrowser() ? performance.now() : 0;
        return;
      } catch {
        // Private browsing and storage pressure can reject IndexedDB. Keep the
        // legacy fallback so offline recovery remains more important than jank.
      }
    }
    writeLegacyRecovery(snapshot);
    lastWriteAt = canScheduleInBrowser() ? performance.now() : 0;
  });
  return writeChain;
}

export function hasRecoverySnapshotHint() {
  try {
    return localStorage.getItem(RECOVERY_MARKER_KEY) === "1" || Boolean(localStorage.getItem(LEGACY_RECOVERY_KEY));
  } catch {
    return false;
  }
}

export function clearRecoverySnapshot() {
  queuedSnapshot = null;
  cancelScheduledWrite();
  clearLocalRecoveryHints();
  if (!canUseIndexedDb()) return Promise.resolve();
  writeChain = writeChain
    .then(() => withStore("readwrite", (store) => store.delete(SNAPSHOT_KEY)))
    .then(() => undefined)
    .catch(() => undefined);
  return writeChain.finally(clearLocalRecoveryHints);
}

function scheduleQueuedWrite(delayMs: number) {
  if (scheduledTimer !== null || scheduledIdleCallback !== null || !queuedSnapshot) return;
  scheduledTimer = window.setTimeout(() => {
    scheduledTimer = null;
    if (typeof window.requestIdleCallback === "function") {
      scheduledIdleCallback = window.requestIdleCallback(() => {
        scheduledIdleCallback = null;
        void flushRecoverySnapshot().finally(scheduleNextQueuedWrite);
      }, { timeout: 2_000 });
      return;
    }
    void flushRecoverySnapshot().finally(scheduleNextQueuedWrite);
  }, delayMs);
}

function scheduleNextQueuedWrite() {
  if (queuedSnapshot) scheduleQueuedWrite(RECOVERY_WRITE_INTERVAL_MS);
}

function cancelScheduledWrite() {
  if (scheduledTimer !== null) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
  if (scheduledIdleCallback !== null && canScheduleInBrowser() && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(scheduledIdleCallback);
    scheduledIdleCallback = null;
  }
}

function readLegacyRecovery(): RecoverySnapshot | null {
  try {
    const value = localStorage.getItem(LEGACY_RECOVERY_KEY);
    return value ? JSON.parse(value) as RecoverySnapshot : null;
  } catch {
    return null;
  }
}

function writeLegacyRecovery(snapshot: RecoverySnapshot) {
  try {
    localStorage.setItem(LEGACY_RECOVERY_KEY, JSON.stringify(snapshot));
  } catch { /* no durable storage is available */ }
}

function markRecoveryAvailable() {
  try {
    if (localStorage.getItem(RECOVERY_MARKER_KEY) !== "1") localStorage.setItem(RECOVERY_MARKER_KEY, "1");
  } catch { /* storage may be blocked */ }
}

function clearLocalRecoveryHints() {
  try {
    localStorage.removeItem(RECOVERY_MARKER_KEY);
    localStorage.removeItem(LEGACY_RECOVERY_KEY);
  } catch { /* storage may be blocked */ }
}

function canScheduleInBrowser(): boolean {
  return typeof window !== "undefined" && typeof performance !== "undefined";
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openRecoveryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("RECOVERY_DB_OPEN_FAILED"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openRecoveryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error ?? new Error("RECOVERY_DB_REQUEST_FAILED"));
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("RECOVERY_DB_TRANSACTION_FAILED"));
    };
    transaction.onabort = transaction.onerror;
  });
}

function readIndexedRecovery() {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  return withStore<RecoverySnapshot | undefined>("readonly", (store) => store.get(SNAPSHOT_KEY))
    .then((snapshot) => snapshot ?? null);
}

function writeIndexedRecovery(snapshot: RecoverySnapshot) {
  return withStore<IDBValidKey>("readwrite", (store) => store.put(snapshot, SNAPSHOT_KEY)).then(() => undefined);
}
