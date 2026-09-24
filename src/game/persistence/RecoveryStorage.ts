import type { GameEvent, GameState } from "../types";
import type { GameCommand } from "./CommandLog";
import { CAMPAIGN_RELEASE } from "./CampaignRelease";

export const LEGACY_RECOVERY_KEY = `mini-market-recovery-${CAMPAIGN_RELEASE}`;
export const RECOVERY_MARKER_KEY = `mini-market-recovery-available-${CAMPAIGN_RELEASE}`;
export const RECOVERY_SCOPE_KEY = `mini-market-recovery-scope-${CAMPAIGN_RELEASE}`;

const DATABASE_NAME = `mini-market-recovery-${CAMPAIGN_RELEASE}`;
const DATABASE_VERSION = 1;
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "current";
const RECOVERY_WRITE_INTERVAL_MS = 3_000;

export interface RecoverySnapshot {
  state: GameState;
  saveRevision: number;
  pendingEvents?: GameEvent[];
  pendingSave?: SaveAttempt | null;
  scopeId?: string;
  /** Commands applied since the last acknowledged save, so a reload can keep
   * the replayable stream intact. */
  commands?: GameCommand[];
  commandsComplete?: boolean;
}

export interface SaveAttempt {
  expectedRevision: number;
  operationId: string;
  deviceId: string;
  sessionId: string;
  state: GameState;
  events: GameEvent[];
  /** `null` when the log could not cover the whole stretch since the base
   * revision; the server then validates the snapshot alone and records it. */
  commands?: GameCommand[] | null;
  /** True when the log starts from the stored snapshot as loaded (normalised);
   * false when it starts from the raw snapshot the server acknowledged. */
  baseNormalized?: boolean;
}

let queuedSnapshot: RecoverySnapshot | null = null;
let scheduledTimer: number | null = null;
let scheduledIdleCallback: number | null = null;
let writeChain = Promise.resolve();
let lastWriteAt = 0;
let activeRecoveryScope: string | null = null;

export function setRecoveryScope(scopeId: string) {
  const normalized = /^[a-f0-9]{32,64}$/i.test(scopeId) ? scopeId.toLowerCase() : null;
  if (!normalized) return;
  activeRecoveryScope = normalized;
  try { localStorage.setItem(RECOVERY_SCOPE_KEY, normalized); } catch { /* storage may be blocked */ }
}

/**
 * Reads the async recovery snapshot first and transparently imports snapshots
 * written by older builds. IndexedDB keeps the large structured clone away
 * from localStorage's synchronous main-thread JSON path.
 */
export async function readRecoverySnapshot(): Promise<RecoverySnapshot | null> {
  const indexed = await readIndexedRecovery(recoverySnapshotKey()).catch(() => null);
  const legacyIndexed = indexed || recoverySnapshotKey() === SNAPSHOT_KEY
    ? null
    : await readIndexedRecovery(SNAPSHOT_KEY).catch(() => null);
  const legacy = readLegacyRecovery();
  const candidates = [indexed, legacyIndexed, legacy]
    .filter((candidate): candidate is RecoverySnapshot => Boolean(candidate))
    .filter((candidate) => !activeScope() || !candidate.scopeId || candidate.scopeId === activeScope())
    .sort((a, b) => b.state.revision - a.state.revision || b.saveRevision - a.saveRevision);
  const selected = candidates[0] ?? null;
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
        await writeIndexedRecovery({ ...snapshot, scopeId: activeScope() ?? snapshot.scopeId }, recoverySnapshotKey());
        markRecoveryAvailable();
        try { localStorage.removeItem(LEGACY_RECOVERY_KEY); } catch { /* storage may be blocked */ }
        lastWriteAt = canScheduleInBrowser() ? performance.now() : 0;
        return;
      } catch {
        // Private browsing and storage pressure can reject IndexedDB. Keep the
        // legacy fallback so offline recovery remains more important than jank.
      }
    }
    writeLegacyRecovery({ ...snapshot, scopeId: activeScope() ?? snapshot.scopeId });
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
    .then(() => withStore("readwrite", (store) => store.delete(recoverySnapshotKey())))
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

function readIndexedRecovery(key: string) {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  return withStore<RecoverySnapshot | undefined>("readonly", (store) => store.get(key))
    .then((snapshot) => snapshot ?? null);
}

function writeIndexedRecovery(snapshot: RecoverySnapshot, key: string) {
  return withStore<IDBValidKey>("readwrite", (store) => store.put(snapshot, key)).then(() => undefined);
}

function activeScope() {
  if (activeRecoveryScope) return activeRecoveryScope;
  try {
    const stored = localStorage.getItem(RECOVERY_SCOPE_KEY);
    if (stored && /^[a-f0-9]{32,64}$/i.test(stored)) activeRecoveryScope = stored.toLowerCase();
  } catch { /* storage may be blocked */ }
  return activeRecoveryScope;
}

function recoverySnapshotKey() {
  return activeScope() ? `scope:${activeScope()}:slot:1` : SNAPSHOT_KEY;
}
