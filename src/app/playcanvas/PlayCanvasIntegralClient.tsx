"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { LoadingCurtain } from "@/components/game/LoadingCurtain";
import { clearRuntimeIntegral, configureRuntimeIntegral, useMarketStore } from "@/game/store";
import type { GameState } from "@/game/types";

const PlayCanvasCanvas = dynamic(() => import("@/client-pc/PlayCanvasCanvas").then((module) => module.PlayCanvasCanvas), { ssr: false });

const STORAGE_KEY = "mini-market-playcanvas-integral-v1";
const SEED_URL = "/fixtures/runtime-level30-seed.json";

/**
 * Phase 1 integral test for the PlayCanvas port: seeds the shared
 * `src/game/store.ts` from the same real, fully-populated level-30
 * `GameState` fixture `/runtime`'s integral page uses (see
 * `src/app/runtime/IntegralClient.tsx`), via the same `configureRuntimeIntegral`
 * seam — so `loadGame()` hydrates from this fixture instead of hitting the
 * network, and `/`/`/play2`/`/runtime` are completely unaffected (the seam is
 * only active while this page is mounted).
 *
 * Phase 1 itself only renders the structural shell (see
 * `src/client-pc/PlayCanvasRuntime.ts`); it does not yet read shelves,
 * crops, customers, employees, etc. from the loaded state. Loading the real
 * save here (rather than an empty/toy state) proves the seam works end to
 * end for the phases that will need it.
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

  if (!ready) return <LoadingCurtain title="Cargando nivel 30 (PlayCanvas, fase 1)" detail="Sembrando la partida y preparando el motor PlayCanvas" />;

  return <div style={{ position: "fixed", inset: 0 }}><PlayCanvasCanvas /></div>;
}
