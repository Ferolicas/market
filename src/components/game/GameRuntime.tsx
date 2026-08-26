"use client";

import { useEffect } from "react";
import { useMarketStore } from "@/game/store";

export function GameRuntime() {
  const loadGame = useMarketStore((state) => state.loadGame);
  const saveGame = useMarketStore((state) => state.saveGame);
  const simulate = useMarketStore((state) => state.simulate);

  useEffect(() => { void loadGame(); }, [loadGame]);

  useEffect(() => {
    const simulationTimer = window.setInterval(() => simulate(10), 5000);
    const saveTimer = window.setInterval(() => void saveGame(), 10000);
    const online = () => void saveGame();
    const hidden = () => { if (document.visibilityState === "hidden") void saveGame(); };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.clearInterval(simulationTimer);
      window.clearInterval(saveTimer);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hidden);
      void saveGame();
    };
  }, [saveGame, simulate]);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}
