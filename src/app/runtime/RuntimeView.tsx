"use client";

import { useEffect, useRef } from "react";
import { RUNTIME_CONTRACT, type RuntimeFrameSummary, type RuntimeGate } from "@/runtime/contract";
import { RuntimeLoop } from "@/runtime/loop";
import styles from "./runtime.module.css";

/**
 * Labels here are display-only shorthand for the same `RuntimeFrameSummary`
 * keys/values — kept short so all rows fit one iPhone screen in a two-column
 * grid (see `runtime.module.css`). No telemetry, key or value changed.
 */
const PANEL_ROWS = [
  ["averageMs", "Trab. medio", "ms"],
  ["p95Ms", "Trab. p95", "ms"],
  ["p99Ms", "Trab. p99", "ms"],
  ["framesOver16Ms", "Trab. >16,7ms", "count"],
  ["maxMs", "Trab. máx", "ms"],
  ["gapAverageMs", "Hueco medio", "ms"],
  ["gapP95Ms", "Hueco p95", "ms"],
  ["gapP99Ms", "Hueco p99", "ms"],
  ["gapMaxMs", "Hueco máx", "ms"],
  ["gapsOver16Ms", "Huecos >16,7ms", "count"],
  ["gapsOver25Ms", "Huecos >25ms", "count"],
  ["drawCalls", "Draw calls", "count"],
  ["triangles", "Triángulos", "count"],
  ["renderCount", "Renders", "count"],
  ["rafCount", "rAF", "count"],
  ["loadMs", "1er cuadro", "ms"],
  ["frameCount", "Cuadros", "count"],
  ["crowdReadyMs", "Multitud lista", "ms"],
  ["crowdBytes", "Descarga multitud", "bytes"],
  ["navReadyMs", "Navmesh listo", "ms"],
  ["navMaxStallMs", "Bloqueo init navmesh", "ms"],
  ["navBytes", "Descarga navmesh", "bytes"],
  ["playerMoveAverageMs", "Jugador media", "ms"],
  ["playerMoveP95Ms", "Jugador p95", "ms"],
  ["playerMoveP99Ms", "Jugador p99", "ms"],
  ["playerMoveMaxMs", "Jugador máx", "ms"],
  ["playerMoveCallsPerSecond", "Jugador llam/s", "rate"],
  ["gamepadPollAverageMs", "Gamepad poll media", "ms"],
  ["gamepadPollP95Ms", "Gamepad poll p95", "ms"],
  ["gamepadPollP99Ms", "Gamepad poll p99", "ms"],
  ["gamepadPollMaxMs", "Gamepad poll máx", "ms"],
  ["inputSampleAverageMs", "Input sample media", "ms"],
  ["inputSampleP95Ms", "Input sample p95", "ms"],
  ["inputSampleP99Ms", "Input sample p99", "ms"],
  ["inputSampleMaxMs", "Input sample máx", "ms"],
  ["inputTotalAverageMs", "Input total media", "ms"],
  ["inputTotalP95Ms", "Input total p95", "ms"],
  ["inputTotalP99Ms", "Input total p99", "ms"],
  ["inputTotalMaxMs", "Input total máx", "ms"],
  ["inputSamplesPerSecond", "Input muestras/s", "rate"],
] as const;

const LOADING_MS_KEYS = new Set(["crowdReadyMs", "navReadyMs"]);

function formatValue(summary: RuntimeFrameSummary, key: (typeof PANEL_ROWS)[number][0], unit: "ms" | "count" | "bytes" | "rate") {
  const value = summary[key];
  if (unit === "bytes") return value > 0 ? `${(value / (1024 * 1024)).toFixed(2)} MB` : "—";
  if (unit === "ms") return LOADING_MS_KEYS.has(key) && value === 0 ? "cargando…" : `${value.toFixed(1)} ms`;
  if (unit === "rate") return `${value.toFixed(1)} /s`;
  return String(value);
}

function paint(panel: HTMLElement, summary: RuntimeFrameSummary, gate: RuntimeGate) {
  const verdict = panel.querySelector("[data-verdict]");
  if (!verdict) return;
  const ready = summary.frameCount >= 60;
  verdict.textContent = ready ? (gate.pass ? "Base dentro del contrato" : "Base fuera del contrato") : "Midiendo el primer segundo…";
  verdict.setAttribute("data-state", ready ? (gate.pass ? "pass" : "fail") : "wait");
  for (const [key, , unit] of PANEL_ROWS) {
    const node = panel.querySelector(`[data-value="${key}"]`);
    if (node) node.textContent = formatValue(summary, key, unit);
  }
  const view = window as Window & { __RUNTIME_BASE__?: unknown };
  view.__RUNTIME_BASE__ = {
    contract: RUNTIME_CONTRACT.id,
    ...summary,
    pass: gate.pass,
    failures: gate.failures,
  };
}

/** Canvas plus a DOM readout. The animation loop never touches this panel. */
export function RuntimeView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const loopRef = useRef<RuntimeLoop | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const panel = panelRef.current;
    if (!canvas || !panel) return;
    let loop: RuntimeLoop;
    try {
      loop = new RuntimeLoop(canvas);
    } catch (error) {
      const verdict = panel.querySelector("[data-verdict]");
      if (verdict) {
        verdict.textContent = "El lienzo no arrancó";
        verdict.setAttribute("data-state", "fail");
      }
      const view = window as Window & { __RUNTIME_BASE__?: unknown };
      view.__RUNTIME_BASE__ = { pass: false, failures: [error instanceof Error ? error.message : "webgl"] };
      return;
    }
    loopRef.current = loop;
    const publish = () => {
      const reading = loop.snapshot();
      paint(panel, reading.summary, reading.gate);
    };
    const onResize = () => loop.resize();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") loop.suspend();
      else loop.resume();
    };
    void loop.start().then(() => {
      if (loopRef.current === loop) publish();
    }).catch((error: unknown) => {
      const verdict = panel.querySelector("[data-verdict]");
      if (verdict) {
        verdict.textContent = "El local no cargó";
        verdict.setAttribute("data-state", "fail");
      }
      const view = window as Window & { __RUNTIME_BASE__?: unknown };
      view.__RUNTIME_BASE__ = { pass: false, failures: [error instanceof Error ? error.message : "store"] };
    });
    const panelTimer = window.setInterval(publish, 500);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(panelTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      loopRef.current = null;
      loop.stop();
    };
  }, []);

  return (
    <main className={styles.stage}>
      <canvas ref={canvasRef} className={styles.canvas} />
      <section ref={panelRef} className={styles.panel} aria-live="polite">
        <p className={styles.kicker}>Runtime base · /runtime</p>
        <h1>Local horneado</h1>
        <p data-verdict data-state="wait">Preparando el lienzo…</p>
        <div className={styles.rows}>
          {PANEL_ROWS.map(([key, label]) => (
            <span key={key}>{label}<strong data-value={key}>—</strong></span>
          ))}
        </div>
        <button type="button" className={styles.reset} onClick={() => {
          const loop = loopRef.current;
          const panel = panelRef.current;
          if (!loop || !panel) return;
          loop.resetStats();
          const reading = loop.snapshot();
          paint(panel, reading.summary, reading.gate);
        }}>Reiniciar estadísticas</button>
      </section>
    </main>
  );
}
