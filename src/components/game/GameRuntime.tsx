"use client";

import { useEffect } from "react";
import { useMarketStore } from "@/game/store";
import { AudioFeedback } from "@/game/feedback/AudioFeedback";
import { feedbackBus } from "@/game/feedback/FeedbackBus";
import { WORLD_TICK_INTERVAL_MS } from "@/game/core/timing";
import { marketQaFreezeEnabled } from "@/game/debug/QaAccess";
import { flushRecoverySnapshot } from "@/game/persistence/RecoveryStorage";
import { FieldPerformanceSampler } from "@/game/telemetry/FieldPerformance";
import { reportClientTelemetry } from "@/lib/client-telemetry";

const REMOTE_SYNC_INTERVAL_MS = 30_000;

export function GameRuntime() {
  const loadGame = useMarketStore((state) => state.loadGame);
  const saveGame = useMarketStore((state) => state.saveGame);
  const tickWorld = useMarketStore((state) => state.tickWorld);
  const saveStatus = useMarketStore((state) => state.saveStatus);

  useEffect(() => { void loadGame(); }, [loadGame]);

  useEffect(() => {
    const audio = new AudioFeedback();
    const unsubscribe = feedbackBus.subscribe((signal) => audio.play(signal));
    return () => { unsubscribe(); audio.close(); };
  }, []);

  useEffect(() => {
    if (!(["offline", "conflict", "error"] as const).includes(saveStatus as "offline" | "conflict" | "error")) return;
    void reportClientTelemetry({ kind: "save", name: saveStatus, severity: saveStatus === "error" ? "error" : "warning", message: useMarketStore.getState().message.slice(0, 1_000) });
  }, [saveStatus]);

  useEffect(() => {
    const sampler = new FieldPerformanceSampler();
    let frameRequest = 0;
    let previousFrame = 0;
    const frame = (now: number) => {
      if (previousFrame > 0) sampler.addFrame(now - previousFrame);
      previousFrame = now;
      frameRequest = window.requestAnimationFrame(frame);
    };
    frameRequest = window.requestAnimationFrame(frame);
    const observer = typeof PerformanceObserver !== "undefined"
      ? new PerformanceObserver((list) => list.getEntries().forEach((entry) => sampler.addLongTask(entry.duration)))
      : null;
    try { observer?.observe({ type: "longtask", buffered: true }); } catch { /* browser does not expose long tasks */ }
    const report = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const summary = sampler.take();
      if (summary.frameCount < 30) return;
      const state = useMarketStore.getState().game;
      const franchise = state?.franchises.find((candidate) => candidate.id === state.currentFranchiseId);
      void reportClientTelemetry({
        kind: "performance",
        name: "one-minute-window",
        severity: summary.p95FrameMs > 40 || summary.longTaskCount > 2 ? "warning" : "info",
        payload: {
          ...summary,
          level: state?.level ?? null,
          customers: franchise?.customers.length ?? null,
          employees: franchise?.employees.length ?? null,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
      });
    }, 60_000);
    return () => {
      window.cancelAnimationFrame(frameRequest);
      window.clearInterval(report);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    // The real-browser persistence audit reloads once with simulation paused so
    // it can compare the restored snapshot byte-for-byte before the first tick.
    if (marketQaFreezeEnabled(window.location.search, sessionStorage.getItem("mini-market-qa-freeze"))) return;
    let worldTimer = 0;
    let saveTimer = 0;
    let saveIdleCallback = 0;
    let lastWorldTickAt = performance.now();
    const cancelBackgroundSave = () => {
      if (saveIdleCallback && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(saveIdleCallback);
      saveIdleCallback = 0;
    };
    const scheduleBackgroundSave = () => {
      if (saveIdleCallback) return;
      if (typeof window.requestIdleCallback === "function") {
        saveIdleCallback = window.requestIdleCallback(() => {
          saveIdleCallback = 0;
          void saveGame();
        }, { timeout: 4_000 });
        return;
      }
      void saveGame();
    };
    const stopTimers = () => {
      window.clearInterval(worldTimer);
      window.clearInterval(saveTimer);
      cancelBackgroundSave();
      worldTimer = saveTimer = 0;
    };
    const startTimers = () => {
      if (worldTimer || document.visibilityState !== "visible") return;
      lastWorldTickAt = performance.now();
      worldTimer = window.setInterval(() => {
        const now = performance.now();
        const elapsedMs = Math.min(1_000, Math.max(0, now - lastWorldTickAt));
        lastWorldTickAt = now;
        tickWorld(elapsedMs);
      }, WORLD_TICK_INTERVAL_MS);
      saveTimer = window.setInterval(scheduleBackgroundSave, REMOTE_SYNC_INTERVAL_MS);
    };
    const online = () => void saveGame();
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        stopTimers();
        void flushRecoverySnapshot();
        void saveGame({ keepalive: true });
      } else startTimers();
    };
    const pageHide = () => {
      stopTimers();
      void flushRecoverySnapshot();
      void saveGame({ keepalive: true });
    };
    startTimers();
    window.addEventListener("online", online);
    window.addEventListener("pagehide", pageHide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopTimers();
      window.removeEventListener("online", online);
      window.removeEventListener("pagehide", pageHide);
      document.removeEventListener("visibilitychange", visibility);
      void flushRecoverySnapshot();
      void saveGame({ keepalive: true });
    };
  }, [saveGame, tickWorld]);

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
