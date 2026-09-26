"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { LoadingCurtain } from "@/components/game/LoadingCurtain";
import { clearRuntimeIntegral, configureRuntimeIntegral, useMarketStore } from "@/game/store";
import type { GameState } from "@/game/types";
import type { PlayCanvasSceneProps } from "@/client-pc/PlayCanvasRuntime";

const PlayCanvasCanvas = dynamic(() => import("@/client-pc/PlayCanvasCanvas").then((module) => module.PlayCanvasCanvas), { ssr: false });

const STORAGE_KEY = "mini-market-playcanvas-integral-v1";
const SEED_URL = "/fixtures/runtime-level30-seed.json";

/**
 * Phase 2 integral test for the PlayCanvas port: seeds the shared
 * `src/game/store.ts` from the same real, fully-populated level-30
 * `GameState` fixture `/runtime`'s integral page uses (see
 * `src/app/runtime/IntegralClient.tsx`), via the same `configureRuntimeIntegral`
 * seam — so `loadGame()` hydrates from this fixture instead of hitting the
 * network, and `/`/`/play2`/`/runtime` are completely unaffected (the seam is
 * only active while this page is mounted).
 *
 * Phase 2 reads the real franchise fields the engine's structural shell now
 * depends on (`unlockedAreas`, `doorState`/`doorProgress`, `open`,
 * `playerSpeedTier`) straight off `useMarketStore`, the same seam `GameShell`
 * uses in production — so the door state and gated furniture always match
 * the real save. There is no `tickWorld` driver mounted yet (that lives in
 * `GameRuntime`, not built here — see the report), so these fields only
 * change if the seeded save itself changes; wiring a world clock is a phase 3
 * item.
 */
export function PlayCanvasIntegralClient() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(SEED_URL, { cache: "force-cache" })
      .then((response) => response.json() as Promise<GameState>)
      .then(async (seed) => {
        if (cancelled) return;
        configureRuntimeIntegral(seed, STORAGE_KEY);
        await useMarketStore.getState().loadGame();
        if (!cancelled) setReady(true);
      })
      .catch((error: unknown) => console.error("[playcanvas] failed to load the level-30 seed", error));
    return () => { cancelled = true; clearRuntimeIntegral(); };
  }, []);

  const unlockedAreas = useMarketStore((state) => {
    const game = state.game;
    if (!game) return undefined;
    const franchise = game.franchises.find((candidate) => candidate.id === game.currentFranchiseId) ?? game.franchises[0];
    return franchise?.unlockedAreas;
  });
  const doorState = useMarketStore((state) => {
    const game = state.game;
    const franchise = game?.franchises.find((candidate) => candidate.id === game.currentFranchiseId) ?? game?.franchises[0];
    return franchise?.doorState;
  });
  const doorProgress = useMarketStore((state) => {
    const game = state.game;
    const franchise = game?.franchises.find((candidate) => candidate.id === game.currentFranchiseId) ?? game?.franchises[0];
    return franchise?.doorProgress;
  });
  const open = useMarketStore((state) => {
    const game = state.game;
    const franchise = game?.franchises.find((candidate) => candidate.id === game.currentFranchiseId) ?? game?.franchises[0];
    return franchise?.open;
  });
  const playerSpeedTier = useMarketStore((state) => {
    const game = state.game;
    const franchise = game?.franchises.find((candidate) => candidate.id === game.currentFranchiseId) ?? game?.franchises[0];
    return franchise?.playerSpeedTier;
  });

  const unlockedAreasSignature = unlockedAreas?.join("|") ?? "";
  const sceneProps: PlayCanvasSceneProps = useMemo(() => ({
    unlockedAreas: unlockedAreasSignature ? unlockedAreasSignature.split("|") : [],
    doorState: doorState ?? "CLOSED",
    doorProgress: doorProgress ?? 0,
    open: open ?? false,
    playerSpeedTier: playerSpeedTier ?? 0,
  }), [unlockedAreasSignature, doorState, doorProgress, open, playerSpeedTier]);

  if (!ready) return <LoadingCurtain title="Cargando nivel 30 (PlayCanvas, fase 2)" detail="Sembrando la partida y preparando el motor PlayCanvas" />;

  return <div style={{ position: "fixed", inset: 0 }}><PlayCanvasCanvas initialProps={sceneProps} /></div>;
}
