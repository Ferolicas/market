"use client";

import { useEffect, useRef } from "react";
import { RUNTIME_CONTRACT, type RuntimeFrameSummary, type RuntimeGate } from "@/runtime/contract";
import { RuntimeLoop } from "@/runtime/loop";
import styles from "./runtime.module.css";

function formatMs(value: number) {
  return value.toFixed(1);
}

function paint(node: HTMLElement, summary: RuntimeFrameSummary, gate: RuntimeGate) {
  const verdict = node.querySelector("[data-verdict]");
  const rows = node.querySelector("[data-rows]");
  if (!verdict || !rows) return;
  const ready = summary.frameCount >= 60;
  verdict.textContent = ready ? (gate.pass ? "Base dentro del contrato" : "Base fuera del contrato") : "Midiendo el primer segundo…";
  verdict.setAttribute("data-state", ready ? (gate.pass ? "pass" : "fail") : "wait");
  const lines = [
    ["Trabajo medio", `${formatMs(summary.averageMs)} ms`],
    ["Trabajo p95", `${formatMs(summary.p95Ms)} ms`],
    ["Trabajo p99", `${formatMs(summary.p99Ms)} ms`],
    ["Trabajo > 16,7 ms", String(summary.framesOver16Ms)],
    ["Hueco medio", `${formatMs(summary.gapAverageMs)} ms`],
    ["Hueco p95", `${formatMs(summary.gapP95Ms)} ms`],
    ["Hueco p99", `${formatMs(summary.gapP99Ms)} ms`],
    ["Huecos > 16,7 ms", String(summary.gapsOver16Ms)],
    ["Huecos > 25 ms", String(summary.gapsOver25Ms)],
    ["Draw calls", String(summary.drawCalls)],
    ["Triángulos", String(summary.triangles)],
    ["Tiempo hasta el primer cuadro", `${formatMs(summary.loadMs)} ms`],
    ["Cuadros medidos", String(summary.frameCount)],
  ];
  rows.replaceChildren(...lines.map(([label, value]) => {
    const row = document.createElement("span");
    row.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    row.append(strong);
    return row;
  }));
}

/** Canvas plus a DOM readout. React renders this once; the loop writes the numbers. */
export function RuntimeView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const panel = panelRef.current;
    if (!canvas || !panel) return;
    let loop: RuntimeLoop;
    try {
      loop = new RuntimeLoop(canvas, (publish) => {
      paint(panel, publish.summary, publish.gate);
      const view = window as Window & { __RUNTIME_BASE__?: unknown };
      view.__RUNTIME_BASE__ = {
        contract: RUNTIME_CONTRACT.id,
        ...publish.summary,
        pass: publish.gate.pass,
        failures: publish.gate.failures,
      };
    });
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
    const onResize = () => loop.resize();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") loop.suspend();
      else loop.resume();
    };
    loop.start();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      loop.stop();
    };
  }, []);

  return (
    <main className={styles.stage}>
      <canvas ref={canvasRef} className={styles.canvas} />
      <section ref={panelRef} className={styles.panel} aria-live="polite">
        <p className={styles.kicker}>Runtime base · /runtime</p>
        <h1>Escena mínima</h1>
        <p className={styles.note}>Un bucle, simulación a 5 Hz, interpolación a la frecuencia de la pantalla. Sin la tienda y sin tocar la partida de producción.</p>
        <p data-verdict data-state="wait">Preparando el lienzo…</p>
        <div data-rows className={styles.rows} />
      </section>
    </main>
  );
}
