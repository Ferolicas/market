"use client";

import { create } from "zustand";
import { advanceSimulation, applyGameAction, normalizeGameState } from "./engine";
import type { ActionResult, GameAction, GameEvent, GameState } from "./types";

type SaveStatus = "idle" | "loading" | "dirty" | "saving" | "saved" | "offline" | "conflict" | "error";

interface MarketStore {
  game: GameState | null;
  saveRevision: number;
  saveStatus: SaveStatus;
  message: string;
  pendingEvents: GameEvent[];
  loadGame: () => Promise<void>;
  dispatch: (action: GameAction) => ActionResult | null;
  simulate: (minutes?: number) => void;
  saveGame: () => Promise<void>;
  dismissMessage: () => void;
}

const LOCAL_KEY = "mini-market-recovery-v1";

export const useMarketStore = create<MarketStore>((set, get) => ({
  game: null,
  saveRevision: 0,
  saveStatus: "idle",
  message: "",
  pendingEvents: [],

  loadGame: async () => {
    set({ saveStatus: "loading" });
    try {
      const response = await fetch("/api/game/save", { cache: "no-store" });
      if (!response.ok) throw new Error(`Carga ${response.status}`);
      const payload = await response.json();
      const state = normalizeGameState(payload.state);
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ state, saveRevision: payload.saveRevision }));
      set({ game: state, saveRevision: payload.saveRevision, saveStatus: "saved", message: "Progreso sincronizado" });
    } catch {
      const recovery = localStorage.getItem(LOCAL_KEY);
      if (recovery) {
        const parsed = JSON.parse(recovery) as { state: GameState; saveRevision: number };
        set({ game: normalizeGameState(parsed.state), saveRevision: parsed.saveRevision, saveStatus: "offline", message: "Modo sin conexión: progreso protegido localmente" });
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
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ state: result.state, saveRevision: get().saveRevision }));
    set((current) => ({ game: result.state, saveStatus: "dirty", message: result.message, pendingEvents: [...current.pendingEvents, ...result.events] }));
    return result;
  },

  simulate: (minutes = 10) => {
    const game = get().game;
    if (!game) return;
    const result = advanceSimulation(game, minutes);
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ state: result.state, saveRevision: get().saveRevision }));
    set((current) => ({ game: result.state, saveStatus: "dirty", pendingEvents: [...current.pendingEvents, ...result.events] }));
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
        body: JSON.stringify({ expectedRevision: saveRevision, state, events: pendingEvents }),
      });
      const payload = await response.json();
      if (response.status === 409) {
        localStorage.setItem(`mini-market-conflict-${Date.now()}`, JSON.stringify({ state, saveRevision }));
        const serverState = normalizeGameState(payload.state);
        localStorage.setItem(LOCAL_KEY, JSON.stringify({ state: serverState, saveRevision: payload.saveRevision }));
        set({ game: serverState, saveRevision: payload.saveRevision, saveStatus: "conflict", pendingEvents: [], message: "Otra sesión guardó primero; cargué la versión más reciente y conservé una copia local" });
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "SAVE_FAILED");
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ state, saveRevision: payload.saveRevision }));
      set({ game: state, saveRevision: payload.saveRevision, saveStatus: "saved", pendingEvents: [], message: "Partida guardada" });
    } catch {
      set({ saveStatus: "offline", message: "Sin conexión: los cambios siguen protegidos en este dispositivo" });
    }
  },

  dismissMessage: () => set({ message: "" }),
}));
