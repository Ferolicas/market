"use client";

import { useEffect, useRef } from "react";
import { PlayCanvasRuntime, type PlayCanvasSceneProps } from "./PlayCanvasRuntime";

/**
 * Mounts the PlayCanvas engine on one canvas. React only renders the
 * `<canvas>` element — the PlayCanvas Application owns its own render loop
 * (`app.on("update", ...)` / `app.start()`), the same "React never touches
 * the scene graph" rule the plain-three `/runtime` client follows in
 * `src/client/ClientCanvas.tsx`. `sceneProps` is read once at mount (the
 * initial franchise state); subsequent changes flow in imperatively via
 * `runtime.update()` from `PlayCanvasIntegralClient`'s store subscription —
 * React never re-renders this component on a game-state tick.
 */
export function PlayCanvasCanvas({ initialProps }: { initialProps: PlayCanvasSceneProps }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<PlayCanvasRuntime | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runtime = new PlayCanvasRuntime(canvas, initialProps);
    runtimeRef.current = runtime;
    runtime.start();
    const qaWindow = window as typeof window & { __MARKET_PC_RUNTIME__?: PlayCanvasRuntime };
    qaWindow.__MARKET_PC_RUNTIME__ = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
      if (qaWindow.__MARKET_PC_RUNTIME__ === runtime) delete qaWindow.__MARKET_PC_RUNTIME__;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    runtimeRef.current?.update(initialProps);
  }, [initialProps]);

  return <canvas ref={canvasRef} className="playcanvas-client-canvas" style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />;
}
