"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PlayCanvasRuntime, type PlayCanvasSceneProps } from "./PlayCanvasRuntime";
import { useMarketStore } from "@/game/store";
import { DragJoystick } from "@/game/input/DragJoystick";
import { inputManager } from "@/game/input/InputManager";

/**
 * Mounts the PlayCanvas engine on one canvas. React only renders the
 * `<canvas>` element — the PlayCanvas Application owns its own render loop
 * (`app.on("update", ...)` / `app.start()`), the same "React never touches
 * the scene graph" rule the plain-three `/runtime` client follows in
 * `src/client/ClientCanvas.tsx`. `sceneProps` is read once at mount (the
 * initial franchise state); subsequent changes flow in imperatively via
 * `runtime.update()` from `PlayCanvasIntegralClient`'s store subscription —
 * React never re-renders this component on a game-state tick.
 *
 * Mouse/touch input: reuses production's own `DragJoystick` +
 * `InputManager.setPointer` (`src/components/game/GameInputSurface.tsx`'s
 * exact pointer-event handling, engine-agnostic — the joystick class has no
 * Three.js/PlayCanvas dependency), wired directly on the wrapping div via
 * PointerEvents (unifies mouse + touch, no gamepad). Keyboard is handled by
 * `PlayCanvasRuntime` itself via `window` listeners.
 */
export function PlayCanvasCanvas({ initialProps }: { initialProps: PlayCanvasSceneProps }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<PlayCanvasRuntime | null>(null);
  const joystick = useRef(new DragJoystick());
  const [visual, setVisual] = useState<{ x: number; y: number; thumbX: number; thumbY: number; radius: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runtime = new PlayCanvasRuntime(canvas, initialProps);
    runtimeRef.current = runtime;
    runtime.start();
    const qaWindow = window as typeof window & { __MARKET_PC_RUNTIME__?: PlayCanvasRuntime; __MARKET_STORE__?: typeof useMarketStore };
    qaWindow.__MARKET_PC_RUNTIME__ = runtime;
    // QA-only: lets headless verification read real world-tick state
    // (`minuteOfDay`/`simulationTimeMs`) without a React render, the same
    // way __MARKET_PC_RUNTIME__ already exposes the engine itself.
    qaWindow.__MARKET_STORE__ = useMarketStore;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
      if (qaWindow.__MARKET_PC_RUNTIME__ === runtime) delete qaWindow.__MARKET_PC_RUNTIME__;
      delete qaWindow.__MARKET_STORE__;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    runtimeRef.current?.update(initialProps);
  }, [initialProps]);

  return (
    <div
      className="game-input-surface"
      data-testid="game-input-surface"
      role="application"
      aria-label="Área 3D de Mini Market (PlayCanvas). Arrastra para caminar; también puedes usar flechas o WASD."
      style={{ position: "absolute", inset: 0 }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        const ignored = !event.isPrimary || (event.pointerType === "mouse" && (event.buttons & 1) !== 1);
        if (ignored) return;
        if (!joystick.current.begin(event.pointerId, event.clientX, event.clientY, event.currentTarget.clientWidth, event.currentTarget.clientHeight)) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        inputManager.clearPointer();
        setVisual({ x: event.clientX, y: event.clientY, thumbX: 0, thumbY: 0, radius: joystick.current.visualRadius });
      }}
      onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
        const sample = joystick.current.move(event.pointerId, event.clientX, event.clientY);
        if (!sample) return;
        inputManager.setPointer(sample.input);
        const origin = joystick.current.origin;
        setVisual({ x: origin.x, y: origin.y, thumbX: sample.thumbX, thumbY: sample.thumbY, radius: joystick.current.visualRadius });
      }}
      onPointerUp={(event) => stopPointer(event.currentTarget, event.pointerId, joystick.current, () => setVisual(null))}
      onPointerCancel={(event) => stopPointer(event.currentTarget, event.pointerId, joystick.current, () => setVisual(null))}
      onLostPointerCapture={(event) => stopPointer(event.currentTarget, event.pointerId, joystick.current, () => setVisual(null))}
    >
      <canvas ref={canvasRef} className="playcanvas-client-canvas" style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      {visual && (
        <div className="drag-joystick" style={{ left: visual.x, top: visual.y, width: visual.radius * 2, height: visual.radius * 2 }} aria-hidden="true">
          <i style={{ transform: `translate(${visual.thumbX}px, ${visual.thumbY}px)` }} />
        </div>
      )}
    </div>
  );
}

function stopPointer(element: HTMLDivElement, pointerId: number, joystick: DragJoystick, clearVisual: () => void) {
  if (!joystick.end(pointerId)) return;
  inputManager.clearPointer();
  clearVisual();
  if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
}
