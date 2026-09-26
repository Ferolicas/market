"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { LoadingCurtain } from "@/components/game/LoadingCurtain";
import { clearRuntimeIntegral, configureRuntimeIntegral } from "@/game/store";
import { getNavRebuildCount } from "@/game/navigation/NavMeshService";
import type { GameState } from "@/game/types";
import { IntegralMetrics, readUsedJsHeapMb } from "@/runtime/integralMetrics";
import { IntegralPanel } from "./IntegralPanel";

const GameShell = dynamic(() => import("@/components/game/GameShell").then((module) => module.GameShell), { ssr: false });
const GameRuntime = dynamic(() => import("@/components/game/GameRuntime").then((module) => module.GameRuntime), { ssr: false });

const STORAGE_KEY = "mini-market-runtime-integral-v1";
const SEED_URL = "/fixtures/runtime-level30-seed.json";

/**
 * The integral test: the real level-30 game (real player, crowd, economy,
 * navmesh, HUD, input) on the same plain-three architecture `/play2` already
 * runs in production, seeded once from a real, fully-populated level-30
 * `GameState` (`scripts/qa-seed-state.mts`, the same tool used for other
 * render-budget QA) instead of a logged-in account's save. `configureRuntimeIntegral`
 * (`src/game/store.ts`) makes the shared store's `loadGame`/`saveGame` skip
 * the network entirely for this page only — `/` and `/play2` never call it,
 * so their behaviour is unchanged.
 */
export function IntegralClient() {
  const [ready, setReady] = useState(false);
  const [metrics] = useState(() => new IntegralMetrics());
  const [startedAt] = useState(() => performance.now());
  // Top-level sanity-check ablation for the 2026-09-26 iPhone frame-pacing
  // causal audit: `?worldkit=0` reverts this exact deployed build to the old
  // level30.glb bake + navmesh player (byte-for-byte pre-port behaviour) so
  // the same commit can be compared against itself on the same device.
  // Absent (default), behaviour is unchanged. See `docs/RUNTIME-PARITY-INVENTORY.md`.
  const [worldKitEnabled] = useState(() => typeof window === "undefined" || new URLSearchParams(window.location.search).get("worldkit") !== "0");

  useEffect(() => {
    let cancelled = false;
    const beforeNames = new Set(performance.getEntriesByType("resource").map((entry) => entry.name));
    fetch(SEED_URL, { cache: "force-cache" })
      .then((response) => response.json() as Promise<GameState>)
      .then((seed) => {
        if (cancelled) return;
        configureRuntimeIntegral(seed, STORAGE_KEY);
        let coldBytes = 0;
        for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
          if (beforeNames.has(entry.name)) continue;
          coldBytes += entry.transferSize || entry.encodedBodySize || 0;
        }
        metrics.setColdBytes(coldBytes);
        setReady(true);
      })
      .catch((error: unknown) => console.error("[runtime] failed to load the level-30 seed", error));
    return () => { cancelled = true; clearRuntimeIntegral(); };
  }, [metrics]);

  useEffect(() => () => metrics.dispose(), [metrics]);

  if (!ready) return <LoadingCurtain title="Cargando nivel 30 (prueba integral)" detail="Sembrando la partida y preparando el motor 3D" />;

  return (
    <>
      <GameRuntime />
      <GameShell
        playerName="Prueba integral"
        levelName={worldKitEnabled ? "level30-shell" : "level30"}
        worldKit={worldKitEnabled}
        onFrameSample={(workMs, gapMs, drawCalls, triangles) => {
          const elapsedMs = performance.now() - startedAt;
          if (metrics.loadMs === null) metrics.markLoad(elapsedMs);
          metrics.addFrame(workMs, gapMs, drawCalls, triangles, getNavRebuildCount(), readUsedJsHeapMb);
        }}
        onInteractiveVerified={() => metrics.markInteractive(performance.now() - startedAt)}
      />
      <IntegralPanel metrics={metrics} />
    </>
  );
}
