"use client";

import { create } from "zustand";
import { advanceSimulation, advanceWorld, applyGameAction, normalizeGameState } from "./engine";
import type { ActionResult, GameAction, GameEvent, GameState, WorldInteractionAction } from "./types";
import { ensureStoreNavigation, isStoreNavigationReady, storePathfinder } from "./navigation/NavMeshService";
import { COMMAND_LOG_LIMIT, tickCommand, type GameCommand } from "./persistence/CommandLog";
import { chooseRecovery, restorePendingEventOrigins } from "./persistence/Snapshot";
import { persistRecoverySnapshot, queueRecoverySnapshot, readRecoverySnapshot, setRecoveryScope, type SaveAttempt } from "./persistence/RecoveryStorage";
import { marketQaFreezeEnabled } from "./debug/QaAccess";
import { gameDeviceId, gameSessionId } from "./persistence/ClientIdentity";
import { CAMPAIGN_RELEASE } from "./persistence/CampaignRelease";

type SaveStatus = "idle" | "loading" | "dirty" | "saving" | "saved" | "offline" | "conflict" | "error";

interface MarketStore {
  game: GameState | null;
  saveRevision: number;
  saveStatus: SaveStatus;
  message: string;
  messageRevision: number;
  pendingEvents: GameEvent[];
  /** Wall-clock ms of the last save the server acknowledged (or of a fresh
   * load). The HUD badge derives GUARDADO / SIN GUARDAR from its age. */
  lastSaveConfirmedAt: number;
  loadGame: () => Promise<void>;
  dispatch: (action: GameAction) => ActionResult | null;
  recordPlayerDistance: (meters: number) => void;
  queueInteraction: (action: WorldInteractionAction) => void;
  simulate: (minutes?: number) => void;
  tickWorld: (deltaMs?: number) => void;
  saveGame: (options?: { keepalive?: boolean }) => Promise<void>;
  /** Conflict resolution: this device's copy becomes the official game. */
  adoptLocalCopy: () => Promise<void>;
  /** Conflict resolution: drop this device's copy and load the server's. */
  restoreServerCopy: () => Promise<void>;
}

const MAX_PENDING_INTERACTIONS = 64;

function qaSimulationFrozen() {
  if (typeof window === "undefined") return false;
  return marketQaFreezeEnabled(window.location.search, sessionStorage.getItem("mini-market-qa-freeze"));
}

/** The plain-three client advances the world without cloning it per tick
 * (`advanceWorld` in place); the React scene keeps immutable snapshots. */
let inPlaceWorldTicks = false;
export function setInPlaceWorldTicks(enabled: boolean) { inPlaceWorldTicks = enabled; }
/** Who calls `tickWorld`: the runtime timers (React scene) or the client loop. */
let externalWorldTickDriver = false;
export function setExternalWorldTickDriver(enabled: boolean) { externalWorldTickDriver = enabled; }
export function hasExternalWorldTickDriver() { return externalWorldTickDriver; }

export const useMarketStore = create<MarketStore>((set, get) => {
  let pendingPlayerDistanceMeters = 0;
  let pendingInteractions: WorldInteractionAction[] = [];
  let saveInFlight = false;
  let pendingSaveAttempt: SaveAttempt | null = null;
  // Every command since the last acknowledged save, in order. The PUT carries
  // it so the server can replay the stretch with the same engine; a gap
  // (overflow, a reload that lost the tail) marks the log incomplete until
  // the next fully acknowledged save starts a fresh one.
  let commandLog: GameCommand[] = [];
  let commandLogComplete = true;
  let commandLogGeneration = 0;
  // What the log's first command applies to: the server's stored snapshot as
  // this client normalised it on load, or the raw snapshot the server just
  // acknowledged (the very object this client keeps playing on). A recovered
  // local copy sits between the two, so its log cannot be replayed exactly.
  let commandLogBase: "load" | "acked" | "recovery" = "load";
  const resetCommandLog = (base: "load" | "acked" | "recovery", commands: GameCommand[] = []) => {
    commandLog = commands;
    commandLogBase = base;
    commandLogComplete = base !== "recovery";
    commandLogGeneration += 1;
  };
  const recordCommand = (command: GameCommand) => {
    if (commandLog.length >= COMMAND_LOG_LIMIT) { resetCommandLog("recovery"); return; }
    commandLog.push(command);
  };
  const messageOccurrence = (message: string) => ({ message, messageRevision: get().messageRevision + 1 });
  const recoverySnapshot = (state: GameState, saveRevision: number, pendingEvents: GameEvent[]) => ({ state, saveRevision, pendingEvents, pendingSave: pendingSaveAttempt, commands: commandLog, commandsComplete: commandLogComplete });

  return {
  game: null,
  saveRevision: 0,
  saveStatus: "idle",
  message: "",
  messageRevision: 0,
  pendingEvents: [],
  lastSaveConfirmedAt: 0,

  loadGame: async () => {
    const current = get();
    if (current.game || current.saveStatus === "loading") return;
    pendingPlayerDistanceMeters = 0;
    pendingInteractions = [];
    resetCommandLog("load");
    set({ game: null, saveRevision: 0, saveStatus: "loading", message: "", pendingEvents: [] });
    try {
      const response = await fetch("/api/game/save", { cache: "no-store" });
      if (!response.ok) throw new Error(`Carga ${response.status}`);
      const payload = await response.json();
      if (typeof payload.recoveryScope === "string") setRecoveryScope(payload.recoveryScope);
      const serverState = normalizeGameState(payload.state);
      const recovery = await readRecoverySnapshot();
      if (recovery?.pendingEvents?.length && recovery.state?.currentFranchiseId) {
        recovery.pendingEvents = restorePendingEventOrigins(recovery.pendingEvents, recovery.state.currentFranchiseId);
      }
      pendingSaveAttempt = recovery?.pendingSave ?? null;
      if (recovery && pendingSaveAttempt) {
        const attemptedIds = new Set(pendingSaveAttempt.events.map((event) => event.eventId));
        const operationWasApplied = payload.lastOperationId === pendingSaveAttempt.operationId
          || (payload.saveRevision >= pendingSaveAttempt.expectedRevision + 1
            && pendingSaveAttempt.events.every((event) => serverState.processedEventIds.includes(event.eventId!)));
        if (operationWasApplied) {
          const localState = normalizeGameState(recovery.state);
          const remainingEvents = (recovery.pendingEvents ?? []).filter((event) => !attemptedIds.has(event.eventId));
          const hasNewerLocalState = localState.revision > pendingSaveAttempt.state.revision;
          // The applied attempt covered the head of the stored log; what
          // follows it is the stream from the acknowledged state onwards.
          resetCommandLog(hasNewerLocalState ? "recovery" : "load");
          pendingSaveAttempt = null;
          const selectedState = hasNewerLocalState ? localState : serverState;
          queueRecoverySnapshot(recoverySnapshot(selectedState, payload.saveRevision, remainingEvents));
          set({ game: selectedState, saveRevision: payload.saveRevision, saveStatus: hasNewerLocalState || remainingEvents.length ? "dirty" : "saved", pendingEvents: remainingEvents, lastSaveConfirmedAt: Date.now(), ...messageOccurrence("Confirmé un guardado cuya respuesta se había perdido") });
          return;
        }
        if (payload.saveRevision === pendingSaveAttempt.expectedRevision) {
          const localState = normalizeGameState(recovery.state);
          resetCommandLog("recovery", recovery.commands ?? []);
          queueRecoverySnapshot(recoverySnapshot(localState, recovery.saveRevision, recovery.pendingEvents ?? []));
          set({ game: localState, saveRevision: recovery.saveRevision, saveStatus: "dirty", pendingEvents: recovery.pendingEvents ?? [], ...messageOccurrence("Recuperé un guardado local pendiente") });
          return;
        }
        const localState = normalizeGameState(recovery.state);
        resetCommandLog("recovery");
        queueRecoverySnapshot(recoverySnapshot(localState, recovery.saveRevision, recovery.pendingEvents ?? []));
        set({ game: localState, saveRevision: recovery.saveRevision, saveStatus: "conflict", pendingEvents: recovery.pendingEvents ?? [], ...messageOccurrence("Detecté progreso distinto en otro dispositivo; conservé esta copia sin sobrescribirla") });
        return;
      }
      if (recovery && recovery.saveRevision === payload.saveRevision) {
        const localState = normalizeGameState(recovery.state);
        const selected = chooseRecovery(
          { state: serverState, saveRevision: payload.saveRevision, pendingEvents: [] },
          { state: localState, saveRevision: recovery.saveRevision, pendingEvents: recovery.pendingEvents ?? [] },
        );
        if (selected.source === "local") {
          resetCommandLog("recovery", recovery.commands ?? []);
          queueRecoverySnapshot(recoverySnapshot(selected.envelope.state, payload.saveRevision, selected.envelope.pendingEvents));
          set({ game: selected.envelope.state, saveRevision: payload.saveRevision, saveStatus: "dirty", pendingEvents: selected.envelope.pendingEvents, lastSaveConfirmedAt: Date.now(), ...messageOccurrence("Recuperé cambios locales pendientes") });
          return;
        }
      }
      pendingSaveAttempt = null;
      resetCommandLog("load");
      queueRecoverySnapshot(recoverySnapshot(serverState, payload.saveRevision, []));
      set({ game: serverState, saveRevision: payload.saveRevision, saveStatus: "saved", lastSaveConfirmedAt: Date.now(), ...messageOccurrence("Progreso sincronizado") });
    } catch {
      const recovery = await readRecoverySnapshot();
      pendingSaveAttempt = recovery?.pendingSave ?? null;
      if (recovery?.pendingEvents?.length && recovery.state?.currentFranchiseId) {
        recovery.pendingEvents = restorePendingEventOrigins(recovery.pendingEvents, recovery.state.currentFranchiseId);
      }
      if (recovery) {
        resetCommandLog("recovery", recovery.commands ?? []);
        set({ game: normalizeGameState(recovery.state), saveRevision: recovery.saveRevision, saveStatus: "offline", pendingEvents: recovery.pendingEvents ?? [], ...messageOccurrence("Modo sin conexión: progreso protegido localmente") });
      } else {
        set({ saveStatus: "error", ...messageOccurrence("No se pudo cargar la partida") });
      }
    }
  },

  dispatch: (action) => {
    const game = get().game;
    if (!game) return null;
    const result = applyGameAction(game, action);
    if (!result.ok) {
      set(messageOccurrence(result.message));
      return result;
    }
    recordCommand({ k: "a", a: action });
    const pendingEvents = [...get().pendingEvents, ...result.events];
    queueRecoverySnapshot(recoverySnapshot(result.state, get().saveRevision, pendingEvents));
    set({ game: result.state, saveStatus: saveInFlight ? "saving" : "dirty", pendingEvents, ...messageOccurrence(result.message) });
    return result;
  },

  // Player locomotion runs at 60 Hz. Keep its telemetry outside React state
  // until the next authoritative world tick so walking never clones, renders
  // or serialises the complete game in the middle of a frame.
  recordPlayerDistance: (meters) => {
    const safeMeters = Math.max(0, Math.min(100, Number.isFinite(meters) ? meters : 0));
    pendingPlayerDistanceMeters = Math.min(100, pendingPlayerDistanceMeters + safeMeters);
  },

  // Proximity callbacks run inside the R3F frame. Queue their pure engine
  // actions and consume them in one cloned authoritative world snapshot.
  queueInteraction: (action) => {
    if (pendingInteractions.length < MAX_PENDING_INTERACTIONS) pendingInteractions.push(action);
  },

  simulate: (minutes = 10) => {
    if (qaSimulationFrozen()) return;
    const game = get().game;
    if (!game) return;
    const result = advanceSimulation(game, minutes);
    recordCommand({ k: "s", m: minutes });
    const pendingEvents = [...get().pendingEvents, ...result.events];
    queueRecoverySnapshot(recoverySnapshot(result.state, get().saveRevision, pendingEvents));
    set({ game: result.state, saveStatus: saveInFlight ? "saving" : "dirty", pendingEvents });
  },

  tickWorld: (deltaMs = 250) => {
    if (qaSimulationFrozen()) return;
    const game = get().game;
    if (!game) return;
    const franchise = game.franchises.find((candidate) => candidate.id === game.currentFranchiseId) ?? game.franchises[0];
    void ensureStoreNavigation(franchise.structureRevision, franchise.unlockedAreas);
    const playerDistanceMeters = pendingPlayerDistanceMeters;
    const interactions = pendingInteractions;
    const navigationReady = isStoreNavigationReady();
    const result = advanceWorld(game, deltaMs, storePathfinder, { playerDistanceMeters, interactions, inPlace: inPlaceWorldTicks });
    recordCommand(tickCommand(deltaMs, interactions, playerDistanceMeters, navigationReady));
    pendingPlayerDistanceMeters = Math.max(0, pendingPlayerDistanceMeters - playerDistanceMeters);
    pendingInteractions = pendingInteractions.slice(interactions.length);
    // In-place ticks keep mutating the objects an event may reference; the
    // save authority must see the event as it was when it happened.
    const pendingEvents = [...get().pendingEvents, ...(inPlaceWorldTicks ? structuredClone(result.events) : result.events)];
    // Keep only the newest snapshot. RecoveryStorage persists it through an
    // asynchronous IndexedDB transaction during browser idle time, so the
    // 10 Hz world path never performs JSON.stringify/localStorage.
    queueRecoverySnapshot(recoverySnapshot(result.state, get().saveRevision, pendingEvents));
    // In-place ticks keep the same state object; a shallow copy still tells
    // React subscribers (the HUD) that a tick happened.
    set({ game: inPlaceWorldTicks ? { ...result.state } : result.state, saveStatus: saveInFlight ? "saving" : "dirty", pendingEvents, ...(interactions.length ? messageOccurrence(result.message) : {}) });
  },

  saveGame: async (options) => {
    const { game, saveRevision, saveStatus, pendingEvents } = get();
    if (!game || saveInFlight || (saveStatus === "saved" && pendingEvents.length === 0)) return;
    saveInFlight = true;
    set({ saveStatus: "saving" });
    try {
      // The attempt's state outlives this call (retries, reload reconciliation),
      // so with in-place ticks it must be a real snapshot, not the live object.
      const state = { ...(inPlaceWorldTicks ? structuredClone(game) : game), lastSavedAt: new Date().toISOString() };
      const deviceId = gameDeviceId();
      const canReusePendingAttempt = pendingSaveAttempt?.deviceId === deviceId
        && pendingSaveAttempt.expectedRevision === saveRevision;
      const attempt = canReusePendingAttempt ? pendingSaveAttempt! : {
        expectedRevision: saveRevision,
        operationId: crypto.randomUUID(),
        deviceId,
        sessionId: gameSessionId(),
        state,
        events: pendingEvents,
        commands: commandLogComplete ? commandLog.slice() : null,
        baseNormalized: commandLogBase === "load",
      };
      const attemptLogLength = commandLog.length;
      const attemptLogGeneration = commandLogGeneration;
      pendingSaveAttempt = attempt;
      queueRecoverySnapshot(recoverySnapshot(game, saveRevision, get().pendingEvents));
      const requestBody = JSON.stringify(attempt);
      const response = await fetch("/api/game/save", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-market-release": CAMPAIGN_RELEASE },
        body: requestBody,
        // Browsers cap the aggregate keepalive queue near 64 KiB. Larger
        // snapshots remain protected in IndexedDB and retry on next launch.
        keepalive: Boolean(options?.keepalive && new TextEncoder().encode(requestBody).byteLength <= 60_000),
      });
      const payload = await response.json();
      if (response.status === 409) {
        // World ticks and direct actions are allowed to continue during a slow
        // PUT. If another session wins the revision race, back up the newest
        // local snapshot and its unsent events — not the older request body —
        // before accepting the authoritative server state.
        const latest = get();
        const conflictState = latest.game ?? state;
        await persistRecoverySnapshot(recoverySnapshot(conflictState, saveRevision, latest.pendingEvents));
        const writer = payload.conflict?.deviceId === attempt.deviceId ? "otra pestaña de este dispositivo" : "otro dispositivo";
        set({ game: conflictState, saveRevision, saveStatus: "conflict", pendingEvents: latest.pendingEvents, ...messageOccurrence(`Conflicto con ${writer}; tu progreso local no fue sustituido`) });
        return;
      }
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        // A refused body was never applied (no receipt is written for it), so
        // it must not be replayed verbatim forever: the next save rebuilds the
        // attempt from the current, normalised state.
        if (!retryable) pendingSaveAttempt = null;
        // Name the first offending field so a schema rejection can be traced
        // from the badge and from the telemetry without a server dump.
        const issue = Array.isArray(payload.issues) && payload.issues[0]
          ? ` (${[Array.isArray(payload.issues[0].path) ? payload.issues[0].path.join(".") : "", payload.issues[0].message ?? ""].filter(Boolean).join(": ")})`
          : "";
        set({ saveStatus: retryable ? "offline" : "error", ...messageOccurrence(retryable ? "El servidor está ocupado; el guardado local se reintentará" : `El guardado fue rechazado: ${payload.error ?? response.status}${issue}`) });
        return;
      }
      const latest = get();
      const savedIds = new Set(attempt.events.map((event) => event.eventId));
      const remainingEvents = latest.pendingEvents.filter((event) => !savedIds.has(event.eventId));
      const hasNewerState = Boolean(latest.game && latest.game.revision > attempt.state.revision);
      const latestState = hasNewerState ? latest.game! : attempt.state;
      pendingSaveAttempt = null;
      // The acknowledged state is the new base: what the log holds past the
      // attempt is exactly what happened since, unless the log was reset
      // mid-flight and the split point is gone.
      if (!hasNewerState) resetCommandLog("acked");
      else if (attemptLogGeneration === commandLogGeneration) resetCommandLog("acked", commandLog.slice(attemptLogLength));
      else resetCommandLog("recovery", commandLog);
      await persistRecoverySnapshot(recoverySnapshot(latestState, payload.saveRevision, remainingEvents));
      set({ game: latestState, saveRevision: payload.saveRevision, saveStatus: hasNewerState || remainingEvents.length ? "dirty" : "saved", pendingEvents: remainingEvents, lastSaveConfirmedAt: Date.now(), ...messageOccurrence(hasNewerState || remainingEvents.length ? "Guardado parcial; sincronizando cambios nuevos" : "Partida guardada") });
    } catch {
      set({ saveStatus: "offline", ...messageOccurrence("Sin conexión: los cambios siguen protegidos en este dispositivo") });
    } finally {
      saveInFlight = false;
    }
  },

  // A device that played on without saving (a stale app, a long offline
  // stretch) holds a copy whose event chain can no longer be replayed against
  // the server. On conflict the owner chooses: the server adopts this copy as
  // the next revision, or this device takes the server's copy.
  adoptLocalCopy: async () => {
    const { game } = get();
    if (!game || saveInFlight) return;
    saveInFlight = true;
    set({ saveStatus: "saving" });
    try {
      const head = await fetch("/api/game/save", { cache: "no-store" });
      if (!head.ok) throw new Error(`Carga ${head.status}`);
      const headPayload = await head.json();
      const state = { ...normalizeGameState(game), lastSavedAt: new Date().toISOString() };
      const attempt = {
        expectedRevision: Number(headPayload.saveRevision),
        operationId: crypto.randomUUID(),
        deviceId: gameDeviceId(),
        sessionId: gameSessionId(),
        state,
        events: [] as GameEvent[],
        adoptLocal: true,
      };
      const response = await fetch("/api/game/save", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-market-release": CAMPAIGN_RELEASE },
        body: JSON.stringify(attempt),
      });
      const payload = await response.json();
      if (!response.ok) {
        set({ saveStatus: "conflict", ...messageOccurrence(`No se pudo adoptar esta copia: ${payload.error ?? response.status}`) });
        return;
      }
      pendingSaveAttempt = null;
      resetCommandLog("acked");
      await persistRecoverySnapshot(recoverySnapshot(state, payload.saveRevision, []));
      set({ game: state, saveRevision: payload.saveRevision, saveStatus: "saved", pendingEvents: [], lastSaveConfirmedAt: Date.now(), ...messageOccurrence("Esta copia es ahora la partida oficial") });
    } catch {
      set({ saveStatus: "conflict", ...messageOccurrence("Sin conexión: no se pudo adoptar esta copia") });
    } finally {
      saveInFlight = false;
    }
  },

  restoreServerCopy: async () => {
    if (saveInFlight) return;
    saveInFlight = true;
    set({ saveStatus: "loading" });
    try {
      const response = await fetch("/api/game/save", { cache: "no-store" });
      if (!response.ok) throw new Error(`Carga ${response.status}`);
      const payload = await response.json();
      const serverState = normalizeGameState(payload.state);
      pendingSaveAttempt = null;
      pendingInteractions = [];
      resetCommandLog("load");
      await persistRecoverySnapshot(recoverySnapshot(serverState, payload.saveRevision, []));
      set({ game: serverState, saveRevision: payload.saveRevision, saveStatus: "saved", pendingEvents: [], lastSaveConfirmedAt: Date.now(), ...messageOccurrence("Partida del servidor restaurada") });
    } catch {
      set({ saveStatus: "conflict", ...messageOccurrence("Sin conexión: no se pudo cargar la partida del servidor") });
    } finally {
      saveInFlight = false;
    }
  },
  };
});
