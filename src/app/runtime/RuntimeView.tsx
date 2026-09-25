"use client";

import { useEffect, useRef } from "react";
import { RUNTIME_CONTRACT, type RuntimeFrameSummary, type RuntimeGate } from "@/runtime/contract";
import { RuntimeLoop } from "@/runtime/loop";
import styles from "./runtime.module.css";

const PANEL_ROWS = [
  ["averageMs", "Trabajo medio", "ms"],
  ["p95Ms", "Trabajo p95", "ms"],
  ["p99Ms", "Trabajo p99", "ms"],
  ["framesOver16Ms", "Trabajo > 16,7 ms", "count"],
  ["maxMs", "Trabajo máximo", "ms"],
  ["gapAverageMs", "Hueco medio", "ms"],
  ["gapP95Ms", "Hueco p95", "ms"],
  ["gapP99Ms", "Hueco p99", "ms"],
  ["gapMaxMs", "Hueco máximo", "ms"],
  ["gapsOver16Ms", "Huecos > 16,7 ms", "count"],
  ["gapsOver25Ms", "Huecos > 25 ms", "count"],
  ["drawCalls", "Draw calls", "count"],
  ["triangles", "Triángulos", "count"],
  ["renderCount", "Renders reales", "count"],
  ["rafCount", "Callbacks rAF", "count"],
  ["loadMs", "Tiempo hasta el primer cuadro", "ms"],
  ["frameCount", "Cuadros medidos", "count"],
] as const;

function formatValue(summary: RuntimeFrameSummary, key: (typeof PANEL_ROWS)[number][0], unit: "ms" | "count") {
  const value = summary[key];
  return unit === "ms" ? `${value.toFixed(1)} ms` : String(value);
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
        <p className={styles.note}>El mismo bucle y la misma medición. Solo el local estático de nivel 30, sin personajes, stock ni físicas.</p>
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
