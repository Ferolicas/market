"use client";

import { create } from "zustand";
import { advanceSimulation, advanceWorld, applyGameAction, normalizeGameState } from "./engine";
import type { ActionResult, GameAction, GameEvent, GameState, WorldInteractionAction } from "./types";
import { ensureStoreNavigation, storePathfinder } from "./navigation/NavMeshService";
import { chooseRecovery } from "./persistence/Snapshot";

type SaveStatus = "idle" | "loading" | "dirty" | "saving" | "saved" | "offline" | "conflict" | "error";

interface MarketStore {
  game: GameState | null;
  saveRevision: number;
  saveStatus: SaveStatus;
  message: string;
  pendingEvents: GameEvent[];
  loadGame: () => Promise<void>;
  dispatch: (action: GameAction) => ActionResult | null;
  recordPlayerDistance: (meters: number) => void;
  queueInteraction: (action: WorldInteractionAction) => void;
  simulate: (minutes?: number) => void;
  tickWorld: (deltaMs?: number) => void;
  saveGame: () => Promise<void>;
  dismissMessage: () => void;
}

const LOCAL_KEY = "mini-market-recovery-v1";
const WORLD_RECOVERY_INTERVAL_MS = 1_000;
const MAX_PENDING_INTERACTIONS = 64;

interface RecoverySnapshot {
  state: GameState;
  saveRevision: number;
  pendingEvents?: GameEvent[];
}

function readRecovery(): RecoverySnapshot | null {
  try {
    const value = localStorage.getItem(LOCAL_KEY);
    return value ? JSON.parse(value) as RecoverySnapshot : null;
  } catch {
    return null;
  }
}

function writeRecovery(state: GameState, saveRevision: number, pendingEvents: GameEvent[] = []) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ state, saveRevision, pendingEvents } satisfies RecoverySnapshot));
}

function gameSessionId() {
  const key = "mini-market-session-id";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
}

function qaSimulationFrozen() {
  return typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("debug")
    && sessionStorage.getItem("mini-market-qa-freeze") === "1";
}

export const useMarketStore = create<MarketStore>((set, get) => {
  let lastWorldRecoveryWriteAt = 0;
  let pendingPlayerDistanceMeters = 0;
  let pendingInteractions: WorldInteractionAction[] = [];

  return {
  game: null,
  saveRevision: 0,
  saveStatus: "idle",
  message: "",
  pendingEvents: [],

  loadGame: async () => {
    const current = get();
    if (current.game || current.saveStatus === "loading") return;
    pendingPlayerDistanceMeters = 0;
    pendingInteractions = [];
    set({ game: null, saveRevision: 0, saveStatus: "loading", message: "", pendingEvents: [] });
    try {
      const response = await fetch("/api/game/save", { cache: "no-store" });
      if (!response.ok) throw new Error(`Carga ${response.status}`);
      const payload = await response.json();
      const serverState = normalizeGameState(payload.state);
      const recovery = readRecovery();
      if (recovery && recovery.saveRevision === payload.saveRevision) {
        const localState = normalizeGameState(recovery.state);
        const selected = chooseRecovery(
          { state: serverState, saveRevision: payload.saveRevision, pendingEvents: [] },
          { state: localState, saveRevision: recovery.saveRevision, pendingEvents: recovery.pendingEvents ?? [] },
        );
        if (selected.source === "local") {
          writeRecovery(selected.envelope.state, payload.saveRevision, selected.envelope.pendingEvents);
          set({ game: selected.envelope.state, saveRevision: payload.saveRevision, saveStatus: "dirty", pendingEvents: selected.envelope.pendingEvents, message: "Recuperé cambios locales pendientes" });
          return;
        }
      }
      writeRecovery(serverState, payload.saveRevision);
      set({ game: serverState, saveRevision: payload.saveRevision, saveStatus: "saved", message: "Progreso sincronizado" });
    } catch {
      const recovery = readRecovery();
      if (recovery) {
        set({ game: normalizeGameState(recovery.state), saveRevision: recovery.saveRevision, saveStatus: "offline", pendingEvents: recovery.pendingEvents ?? [], message: "Modo sin conexión: progreso protegido localmente" });
      } else {
        set({ saveStatus: "error", message: "No se pudo cargar la partida" });
      }
    }
  },

  dispatch: (action) => {
    const game = get().game;
    if (!game) return null;
    const result = applyGameAction(game, action);
    if (!result.ok) {
      set({ message: result.message });
      return result;
    }
    const pendingEvents = [...get().pendingEvents, ...result.events];
    writeRecovery(result.state, get().saveRevision, pendingEvents);
    set({ game: result.state, saveStatus: "dirty", message: result.message, pendingEvents });
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
    if (get().saveStatus === "saving" || qaSimulationFrozen()) return;
    const game = get().game;
    if (!game) return;
    const result = advanceSimulation(game, minutes);
    const pendingEvents = [...get().pendingEvents, ...result.events];
    writeRecovery(result.state, get().saveRevision, pendingEvents);
    set({ game: result.state, saveStatus: "dirty", pendingEvents });
  },

  tickWorld: (deltaMs = 250) => {
    if (get().saveStatus === "saving" || qaSimulationFrozen()) return;
    const game = get().game;
    if (!game) return;
    const franchise = game.franchises.find((candidate) => candidate.id === game.currentFranchiseId) ?? game.franchises[0];
    void ensureStoreNavigation(franchise.structureRevision);
    const playerDistanceMeters = pendingPlayerDistanceMeters;
    const interactions = pendingInteractions;
    const result = advanceWorld(game, deltaMs, storePathfinder, { playerDistanceMeters, interactions });
    pendingPlayerDistanceMeters = Math.max(0, pendingPlayerDistanceMeters - playerDistanceMeters);
    pendingInteractions = pendingInteractions.slice(interactions.length);
    const pendingEvents = [...get().pendingEvents, ...result.events];
    // The world simulation advances ten times per second, but serialising the
    // complete franchise/customer snapshot to localStorage at that same rate
    // blocks the main thread.  A one-second recovery window keeps crash loss
    // negligible while avoiding a synchronous storage write on every AI tick.
    const now = Date.now();
    if (now - lastWorldRecoveryWriteAt >= WORLD_RECOVERY_INTERVAL_MS) {
      writeRecovery(result.state, get().saveRevision, pendingEvents);
      lastWorldRecoveryWriteAt = now;
    }
    set({ game: result.state, saveStatus: "dirty", pendingEvents, ...(interactions.length ? { message: result.message } : {}) });
  },

  saveGame: async () => {
    const { game, saveRevision, saveStatus, pendingEvents } = get();
    if (!game || saveStatus === "saving" || (saveStatus === "saved" && pendingEvents.length === 0)) return;
    set({ saveStatus: "saving" });
    try {
      const state = { ...game, lastSavedAt: new Date().toISOString() };
      const response = await fetch("/api/game/save", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: saveRevision, sessionId: gameSessionId(), state, events: pendingEvents }),
      });
      const payload = await response.json();
      if (response.status === 409) {
        localStorage.setItem(`mini-market-conflict-${Date.now()}`, JSON.stringify({ state, saveRevision }));
        const serverState = normalizeGameState(payload.state);
        writeRecovery(serverState, payload.saveRevision);
        set({ game: serverState, saveRevision: payload.saveRevision, saveStatus: "conflict", pendingEvents: [], message: "Otra sesión guardó primero; cargué la versión más reciente y conservé una copia local" });
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "SAVE_FAILED");
      const latest = get();
      const savedIds = new Set(pendingEvents.map((event) => event.eventId));
      const remainingEvents = latest.pendingEvents.filter((event) => !savedIds.has(event.eventId));
      const hasNewerState = Boolean(latest.game && latest.game.revision > state.revision);
      const latestState = hasNewerState ? latest.game! : state;
      writeRecovery(latestState, payload.saveRevision, remainingEvents);
      set({ game: latestState, saveRevision: payload.saveRevision, saveStatus: hasNewerState || remainingEvents.length ? "dirty" : "saved", pendingEvents: remainingEvents, message: hasNewerState || remainingEvents.length ? "Guardado parcial; sincronizando cambios nuevos" : "Partida guardada" });
    } catch {
      set({ saveStatus: "offline", message: "Sin conexión: los cambios siguen protegidos en este dispositivo" });
    }
  },

  dismissMessage: () => set({ message: "" }),
  };
});
