"use client";

import { useEffect, useRef } from "react";
import { PlayCanvasRuntime } from "./PlayCanvasRuntime";

/**
 * Mounts the PlayCanvas engine on one canvas. React only renders the
 * `<canvas>` element — the PlayCanvas Application owns its own render loop
 * (`app.on("update", ...)` / `app.start()`), the same "React never touches
 * the scene graph" rule the plain-three `/runtime` client follows in
 * `src/client/ClientCanvas.tsx`.
 */
export function PlayCanvasCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<PlayCanvasRuntime | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runtime = new PlayCanvasRuntime(canvas);
    runtimeRef.current = runtime;
    runtime.start();
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  return <canvas ref={canvasRef} className="playcanvas-client-canvas" style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />;
}
