"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DragJoystick } from "@/game/input/DragJoystick";
import { inputManager } from "@/game/input/InputManager";

const MOVEMENT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);

export function GameInputSurface() {
  const joystick = useRef(new DragJoystick());
  const keys = useRef(new Set<string>());
  const [visual, setVisual] = useState<{ x: number; y: number; thumbX: number; thumbY: number; radius: number } | null>(null);

  useEffect(() => {
    const publishKeyboard = () => {
      const x = Number(keys.current.has("KeyD") || keys.current.has("ArrowRight")) - Number(keys.current.has("KeyA") || keys.current.has("ArrowLeft"));
      const y = Number(keys.current.has("KeyS") || keys.current.has("ArrowDown")) - Number(keys.current.has("KeyW") || keys.current.has("ArrowUp"));
      inputManager.setKeyboard(x, y);
    };
    const down = (event: KeyboardEvent) => {
      if (!MOVEMENT_KEYS.has(event.code)) return;
      keys.current.add(event.code);
      publishKeyboard();
    };
    const up = (event: KeyboardEvent) => {
      if (!MOVEMENT_KEYS.has(event.code)) return;
      keys.current.delete(event.code);
      publishKeyboard();
    };
    const clear = () => {
      keys.current.clear();
      joystick.current.end();
      inputManager.clearAll();
      setVisual(null);
    };
    const visibility = () => { if (document.visibilityState !== "visible") clear(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
      clear();
    };
  }, []);

  return <div
    className="game-input-surface"
    data-testid="game-input-surface"
    role="application"
    aria-label="Área 3D de Mini Market. Arrastra para caminar; también puedes usar flechas, WASD o mando."
    tabIndex={0}
    onContextMenu={(event) => event.preventDefault()}
    onPointerDown={(event) => {
      const ignored = !event.isPrimary || (event.pointerType === "mouse" && (event.buttons & 1) !== 1) || shouldIgnore(event.target);
      recordPointerEvent("down", event, { ignored });
      if (ignored) return;
      if (!joystick.current.begin(event.pointerId, event.clientX, event.clientY, event.currentTarget.clientWidth, event.currentTarget.clientHeight)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      inputManager.clearPointer();
      recordPointerEvent("captured", event, { ignored: false });
      setVisual({ x: event.clientX, y: event.clientY, thumbX: 0, thumbY: 0, radius: joystick.current.visualRadius });
    }}
    onPointerMove={(event) => {
      const sample = joystick.current.move(event.pointerId, event.clientX, event.clientY);
      if (!sample) return;
      inputManager.setPointer(sample.input);
      recordPointerEvent("move", event, { ignored: false, input: sample.input, managedInput: inputManager.sample() });
      const origin = joystick.current.origin;
      setVisual({ x: origin.x, y: origin.y, thumbX: sample.thumbX, thumbY: sample.thumbY, radius: joystick.current.visualRadius });
    }}
    onPointerUp={(event) => stopPointer(event.currentTarget, event.pointerId, joystick.current, () => setVisual(null))}
    onPointerCancel={(event) => stopPointer(event.currentTarget, event.pointerId, joystick.current, () => setVisual(null))}
    onLostPointerCapture={(event) => stopPointer(event.currentTarget, event.pointerId, joystick.current, () => setVisual(null))}
  >
    {visual && <div className="drag-joystick" style={{ left: visual.x, top: visual.y, width: visual.radius * 2, height: visual.radius * 2 }} aria-hidden="true">
      <i style={{ transform: `translate(${visual.thumbX}px, ${visual.thumbY}px)` }} />
    </div>}
  </div>;
}

function shouldIgnore(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('[data-game-ui-interactive="true"],button,a,input,select,textarea,[role="button"],[role="dialog"]'));
}

function recordPointerEvent(name: string, event: ReactPointerEvent<HTMLDivElement>, extra: Record<string, unknown>) {
  const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
  if (!qaWindow.__MARKET_QA__) return;
  qaWindow.__MARKET_QA__.pointer = {
    name,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    buttons: event.buttons,
    x: event.clientX,
    y: event.clientY,
    target: event.target instanceof Element ? event.target.className : null,
    ...extra,
  };
}

function stopPointer(element: HTMLDivElement, pointerId: number, joystick: DragJoystick, clearVisual: () => void) {
  if (!joystick.end(pointerId)) return;
  inputManager.clearPointer();
  clearVisual();
  if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
}
