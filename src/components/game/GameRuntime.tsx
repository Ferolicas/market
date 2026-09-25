"use client";

import { useEffect } from "react";
import { useMarketStore, hasExternalWorldTickDriver } from "@/game/store";
import { audioSettingsOf, useAudioSettings } from "@/game/feedback/AudioSettingsStore";
import { sharedGameAudio } from "@/game/feedback/GameAudio";
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
    // Music, effects and vibration follow the device preference. Browsers only
    // let sound start from a gesture, so every pointer or key press offers the
    // unlock until the music is actually playing; the output outlives this
    // mount because the shell swaps runtimes when the game finishes loading.
    useAudioSettings.getState().hydrate();
    const audio = sharedGameAudio(audioSettingsOf(useAudioSettings.getState()));
    audio.applySettings(audioSettingsOf(useAudioSettings.getState()));
    const unsubscribeSettings = useAudioSettings.subscribe((settings) => audio.applySettings(audioSettingsOf(settings)));
    const unsubscribe = feedbackBus.subscribe((signal) => audio.play(signal));
    const unlock = () => audio.unlock();
    const visibility = () => audio.setHidden(document.visibilityState !== "visible");
    // A touch pointerdown is not an activation for media: touchend and click
    // are, so every one of them offers the unlock.
    const gestures = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
    for (const type of gestures) window.addEventListener(type, unlock, { capture: true, passive: true });
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      for (const type of gestures) window.removeEventListener(type, unlock, { capture: true });
      document.removeEventListener("visibilitychange", visibility);
      unsubscribe();
      unsubscribeSettings();
    };
  }, []);

  useEffect(() => {
    if (!(["offline", "conflict", "error"] as const).includes(saveStatus as "offline" | "conflict" | "error")) return;
    void reportClientTelemetry({ kind: "save", name: saveStatus, severity: saveStatus === "error" ? "error" : "warning", message: useMarketStore.getState().message.slice(0, 1_000) });
  }, [saveStatus]);

  useEffect(() => {
    const sampler = new FieldPerformanceSampler();
    let frameRequest = 0;
    let previousFrame = 0;
    // The moving cadence the scheduler settled on, so a field window says at
    // what rate the phone was actually presenting while it stuttered or not.
    let motionCadence: { level: number; fps: number; refreshHz: number } | null = null;
    // How long each authoritative tick held the main thread: a 5 Hz hitch
    // is what a phone feels as stutter even when the average frame fits.
    const tickCosts: number[] = [];
    const tickListener = (event: Event) => { tickCosts.push((event as CustomEvent<number>).detail); };
    window.addEventListener("market-world-tick-cost", tickListener);
    const cadenceListener = (event: Event) => { motionCadence = (event as CustomEvent<{ level: number; fps: number; refreshHz: number }>).detail; };
    window.addEventListener("market-motion-cadence", cadenceListener);
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
      const ticks = tickCosts.splice(0, tickCosts.length);
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
          tickCount: ticks.length,
          tickP95Ms: ticks.length ? Math.round([...ticks].sort((a, b) => a - b)[Math.min(ticks.length - 1, Math.floor(ticks.length * 0.95))] * 10) / 10 : null,
          tickMaxMs: ticks.length ? Math.round(Math.max(...ticks) * 10) / 10 : null,
          build: process.env.NEXT_PUBLIC_BUILD_ID ?? null,
          motionFps: motionCadence?.fps ?? null,
          motionLevel: motionCadence?.level ?? null,
          refreshHz: motionCadence?.refreshHz ?? null,
        },
      });
    }, 60_000);
    return () => {
      window.removeEventListener("market-motion-cadence", cadenceListener);
      window.removeEventListener("market-world-tick-cost", tickListener);
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
      if (worldTimer > 0) window.clearInterval(worldTimer);
      window.clearInterval(saveTimer);
      cancelBackgroundSave();
      worldTimer = saveTimer = 0;
    };
    const startTimers = () => {
      if (worldTimer || document.visibilityState !== "visible") return;
      lastWorldTickAt = performance.now();
      // The plain-three client ticks the world from its own frame loop.
      if (hasExternalWorldTickDriver()) { worldTimer = -1; saveTimer = window.setInterval(scheduleBackgroundSave, REMOTE_SYNC_INTERVAL_MS); return; }
      worldTimer = window.setInterval(() => {
        const now = performance.now();
        const elapsedMs = Math.min(1_000, Math.max(0, now - lastWorldTickAt));
        lastWorldTickAt = now;
        tickWorld(elapsedMs);
        window.dispatchEvent(new CustomEvent("market-world-tick-cost", { detail: performance.now() - now }));
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
    // An installed PWA that comes back from the background keeps the page it
    // had; when the server reports another build, reload as soon as the game
    // is saved so the phone runs the code that was actually deployed.
    if (process.env.NODE_ENV !== "production") return;
    const own = process.env.NEXT_PUBLIC_BUILD_ID;
    if (!own || own === "dev") return;
    let stale = false;
    let unsubscribe: (() => void) | null = null;
    // While the store is open every tick dirties the state again before the
    // save round trip returns, so "saved" never holds. A confirmed save is
    // enough: the local recovery snapshot carries the few ticks after it and
    // the next load reconciles them.
    const reloadAfterSave = (confirmedAt: number) => async () => {
      if (!stale || useMarketStore.getState().lastSaveConfirmedAt <= confirmedAt) return;
      unsubscribe?.();
      unsubscribe = null;
      await flushRecoverySnapshot();
      window.location.reload();
    };
    const check = async () => {
      if (document.visibilityState !== "visible" || stale) return;
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const health = await response.json() as { build?: string };
        if (typeof health.build === "string" && health.build !== "dev" && health.build !== own) {
          stale = true;
          unsubscribe ??= useMarketStore.subscribe(reloadAfterSave(useMarketStore.getState().lastSaveConfirmedAt));
          void useMarketStore.getState().saveGame();
        }
      } catch { /* offline: nothing to update to */ }
    };
    const visibility = () => { if (document.visibilityState === "visible") void check(); };
    const initial = window.setTimeout(() => void check(), 15_000);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearTimeout(initial);
      document.removeEventListener("visibilitychange", visibility);
      unsubscribe?.();
    };
  }, []);

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
