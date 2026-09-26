"use client";

import { useEffect, useRef, useState } from "react";
import type { MarketSceneProps } from "@/components/game/MarketScene";
import { ClientRuntime, type ClientRuntimeOptions } from "./ClientRuntime";

/**
 * Mounts the plain-three client on one canvas and forwards the shell's
 * state slices to it. The runtime owns the loop; React never touches the
 * scene graph.
 */
export function ClientCanvas(props: MarketSceneProps & { onFrameSample?: ClientRuntimeOptions["onFrameSample"] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ClientRuntime | null>(null);
  const [initialProps] = useState(() => props);
  const onSceneReady = props.onSceneReady;
  const debug = props.debug;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runtime = new ClientRuntime({ canvas, levelName: "level30", debug, onReady: onSceneReady, onFrameSample: initialProps.onFrameSample });
    runtimeRef.current = runtime;
    let disposed = false;
    const resize = () => runtime.resize();
    window.addEventListener("resize", resize);
    runtime.load(initialProps).then(() => { if (!disposed) runtime.start(); }).catch((error: unknown) => console.error("client load", error));
    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [debug, initialProps, onSceneReady]);

  useEffect(() => { runtimeRef.current?.setProps(props); }, [props]);

  return <canvas ref={canvasRef} className="client-canvas" style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />;
}
