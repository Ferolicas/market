"use client";

import { useEffect } from "react";
import { useMarketStore } from "@/game/store";
import { AudioFeedback } from "@/game/feedback/AudioFeedback";
import { feedbackBus } from "@/game/feedback/FeedbackBus";
import { WORLD_TICK_INTERVAL_MS } from "@/game/core/timing";
import { marketQaFreezeEnabled } from "@/game/debug/QaAccess";

export function GameRuntime() {
  const loadGame = useMarketStore((state) => state.loadGame);
  const saveGame = useMarketStore((state) => state.saveGame);
  const simulate = useMarketStore((state) => state.simulate);
  const tickWorld = useMarketStore((state) => state.tickWorld);

  useEffect(() => { void loadGame(); }, [loadGame]);

  useEffect(() => {
    const audio = new AudioFeedback();
    const unsubscribe = feedbackBus.subscribe((signal) => audio.play(signal));
    return () => { unsubscribe(); audio.close(); };
  }, []);

  useEffect(() => {
    // The real-browser persistence audit reloads once with simulation paused so
    // it can compare the restored snapshot byte-for-byte before the first tick.
    if (marketQaFreezeEnabled(window.location.search, sessionStorage.getItem("mini-market-qa-freeze"))) return;
    const worldTimer = window.setInterval(() => tickWorld(WORLD_TICK_INTERVAL_MS), WORLD_TICK_INTERVAL_MS);
    const simulationTimer = window.setInterval(() => simulate(1), 5000);
    const saveTimer = window.setInterval(() => void saveGame(), 15000);
    const online = () => void saveGame();
    const hidden = () => { if (document.visibilityState === "hidden") void saveGame(); };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.clearInterval(worldTimer);
      window.clearInterval(simulationTimer);
      window.clearInterval(saveTimer);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hidden);
      void saveGame();
    };
  }, [saveGame, simulate, tickWorld]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      // A production service worker must never control the Next.js dev server:
      // it serves stale chunks and used to re-fetch every loaded 3D asset while
      // the scene was decoding. Clean it once so localhost stays deterministic.
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
      if ("caches" in window) void caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("mini-market-")).map((key) => caches.delete(key))));
      return;
    }
    void navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}
