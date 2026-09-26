"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { LoadingCurtain } from "@/components/game/LoadingCurtain";
import { clearRuntimeIntegral, configureRuntimeIntegral } from "@/game/store";
import type { GameState } from "@/game/types";

const GameShell = dynamic(() => import("@/components/game/GameShell").then((module) => module.GameShell), { ssr: false });
const GameRuntime = dynamic(() => import("@/components/game/GameRuntime").then((module) => module.GameRuntime), { ssr: false });

const STORAGE_KEY = "mini-market-playcanvas-integral-v1";
const SEED_URL = "/fixtures/runtime-level30-seed.json";

/**
 * Phase 5 integral test for the PlayCanvas port: the real production HUD
 * (`GameShell` — header, quick-menu, footer, every panel) mounted on top of
 * the PlayCanvas engine, seeded from the same real, fully-populated level-30
 * `GameState` fixture `/runtime`'s integral page uses, via the same
 * `configureRuntimeIntegral` seam (`src/game/store.ts`) — so `loadGame()`
 * hydrates from this fixture instead of hitting the network, and
 * `/`/`/play2`/`/runtime` are completely unaffected (the seam is only active
 * while this page is mounted).
 *
 * `GameShell` itself now detects `/playcanvas` by pathname (mirroring how it
 * already detects `/play2`/`/runtime` for the plain-three `ClientCanvas`) and
 * swaps in `PlayCanvasCanvas` for its 3D child, computing the reduced real
 * `PlayCanvasSceneProps` slice from the same `useMarketStore` state the
 * header/panels already read — no HUD logic is forked or duplicated here.
 * This mirrors `/runtime`'s own `IntegralClient.tsx` exactly, replacing only
 * `ClientCanvas` with `PlayCanvasCanvas` under the hood.
 */
export function PlayCanvasIntegralClient() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(SEED_URL, { cache: "force-cache" })
      .then((response) => response.json() as Promise<GameState>)
      .then((seed) => {
        if (cancelled) return;
        configureRuntimeIntegral(seed, STORAGE_KEY);
        setReady(true);
      })
      .catch((error: unknown) => console.error("[playcanvas] failed to load the level-30 seed", error));
    return () => { cancelled = true; clearRuntimeIntegral(); };
  }, []);

  if (!ready) return <LoadingCurtain title="Cargando nivel 30 (PlayCanvas, prueba integral)" detail="Sembrando la partida y preparando el motor PlayCanvas" />;

  return (
    <>
      <GameRuntime />
      <GameShell playerName="Prueba integral" />
    </>
  );
}
