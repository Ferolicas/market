"use client";

import { useEffect, useState } from "react";
import type { IntegralMetrics, IntegralSummary } from "@/runtime/integralMetrics";
import { getNavRebuildCount } from "@/game/navigation/NavMeshService";
import { readUsedJsHeapMb } from "@/runtime/integralMetrics";
import styles from "./integral.module.css";

/**
 * A small, collapsible overlay on top of the real HUD — the phase harness's
 * telemetry panel would occupy too much of the screen during actual
 * gameplay, so this defaults to collapsed (one 30x30 corner button) and only
 * expands on request. Values come from `IntegralMetrics`, fed once per frame
 * by `ClientRuntime`'s `onFrameSample` hook (see `IntegralClient.tsx`).
 */
export function IntegralPanel({ metrics }: { metrics: IntegralMetrics }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<IntegralSummary | null>(null);

  useEffect(() => {
    const publish = () => setSummary(metrics.summary(getNavRebuildCount(), readUsedJsHeapMb()));
    publish();
    const timer = window.setInterval(publish, 1_000);
    return () => window.clearInterval(timer);
  }, [metrics]);

  return (
    <>
      <button type="button" className={styles.toggle} onClick={() => setOpen((value) => !value)} aria-label="Telemetría de la prueba integral">📊</button>
      {open && summary && (
        <section className={styles.panel}>
          <div className={styles.rows}>
            <span>Trab. medio<strong>{summary.workAverageMs.toFixed(1)} ms</strong></span>
            <span>Trab. p95<strong>{summary.workP95Ms.toFixed(1)} ms</strong></span>
            <span>Trab. p99<strong>{summary.workP99Ms.toFixed(1)} ms</strong></span>
            <span>Trab. máx<strong>{summary.workMaxMs.toFixed(1)} ms</strong></span>
            <span>Trab. &gt;16,7ms<strong>{summary.framesOver16Ms}</strong></span>
            <span>Cuadros<strong>{summary.frameCount}</strong></span>
            <span>Hueco medio<strong>{summary.gapAverageMs.toFixed(1)} ms</strong></span>
            <span>Hueco p95<strong>{summary.gapP95Ms.toFixed(1)} ms</strong></span>
            <span>Hueco p99<strong>{summary.gapP99Ms.toFixed(1)} ms</strong></span>
            <span>Hueco máx<strong>{summary.gapMaxMs.toFixed(1)} ms</strong></span>
            <span>Huecos &gt;25ms<strong>{summary.gapsOver25Ms}</strong></span>
            <span>Cadencia<strong>{summary.gapAverageMs > 0 ? (1000 / summary.gapAverageMs).toFixed(0) : "—"} fps</strong></span>
            <span>Draw calls<strong>{summary.drawCalls}</strong></span>
            <span>Triángulos<strong>{summary.triangles}</strong></span>
            <span>1er cuadro<strong>{summary.loadMs.toFixed(0)} ms</strong></span>
            <span>Interactivo*<strong>{summary.interactiveMs.toFixed(0)} ms</strong></span>
            <span>Descarga fría<strong>{(summary.coldBytes / (1024 * 1024)).toFixed(2)} MB</strong></span>
            <span>Rebuilds navmesh<strong>{summary.navRebuilds}</strong></span>
            <span>Heap JS<strong>{summary.usedJsHeapMb === null ? "n/d (Safari)" : `${summary.usedJsHeapMb.toFixed(0)} MB`}</strong></span>
            <span>Minutos<strong>{summary.elapsedMinutes.toFixed(1)}</strong></span>
          </div>
          {summary.minutes.length > 0 && (
            <div className={styles.minutes}>
              <table>
                <thead>
                  <tr><th>Min</th><th>p99</th><th>máx</th><th>hueco máx</th><th>&gt;25ms</th><th>navmesh</th></tr>
                </thead>
                <tbody>
                  {summary.minutes.map((minute) => (
                    <tr key={minute.minute}>
                      <td>{minute.minute}</td>
                      <td>{minute.workP99Ms.toFixed(1)}</td>
                      <td>{minute.workMaxMs.toFixed(1)}</td>
                      <td>{minute.gapMaxMs.toFixed(1)}</td>
                      <td>{minute.gapsOver25Ms}</td>
                      <td>{minute.navRebuilds}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ margin: "4px 0 0", fontSize: 8, color: "#5d756e" }}>*Interactivo = mismo instante que 1er cuadro aquí: no se calcula un TTI tipo Lighthouse por separado.</p>
        </section>
      )}
    </>
  );
}
