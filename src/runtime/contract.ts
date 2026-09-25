/**
 * Acceptance gate for the new renderer. The production scene at `/` is not
 * this runtime. Phase "base" measures the empty harness only: one animation
 * frame, a 5 Hz snapshot and a few placeholder meshes. Art budgets come later,
 * on the same numbers, and a miss stops the next phase.
 */
export const RUNTIME_CONTRACT = {
  id: "runtime-base-2026-09-25",
  phase: "base",
  presentationHz: 60,
  simulationHz: 5,
  simulationStepMs: 200,
  /** Placeholder actors in the base scene. Not the store's crowd. */
  placeholderActors: 24,
  maxFrameP99Ms: 12,
  /** Frames of shader compile and context setup stay out of the gate. */
  warmupFrames: 60,
  /** A presented frame later than one 60 Hz slot. */
  stutterMs: 16.7,
  /** A skipped refresh: the panel went a full extra frame without painting. */
  hitchMs: 25,
  coldLoadMs: 4_000,
  warmLoadMs: 2_000,
  finalSessionMs: 10 * 60 * 1_000,
} as const;

export interface RuntimeFrameSummary {
  frameCount: number;
  /** Time spent inside the frame callback, before yielding to the browser. */
  averageMs: number;
  p95Ms: number;
  p99Ms: number;
  framesOver16Ms: number;
  maxMs: number;
  /** Time from one animation callback to the next. On a 60 Hz panel this sits near 16.7 ms even when the callback itself returns immediately. */
  gapAverageMs: number;
  gapP95Ms: number;
  gapP99Ms: number;
  gapsOver16Ms: number;
  gapsOver25Ms: number;
  gapMaxMs: number;
  drawCalls: number;
  triangles: number;
  loadMs: number;
  /** Calls into the WebGL render. Independent of the rAF interval. */
  renderCount: number;
  /** Animation callbacks that reached the loop, including those that did not record a sample. */
  rafCount: number;
}

export interface RuntimeGate {
  pass: boolean;
  failures: string[];
}

/** Percentile of an unsorted sample. `p` is 0–100. An empty sample is 0. */
export function percentile(samples: readonly number[], p: number) {
  if (samples.length === 0) return 0;
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil((p / 100) * ordered.length) - 1));
  return ordered[index];
}

export interface FrameSample {
  workMs: number;
  gapMs: number;
}

function average(samples: readonly number[]) {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
}

export function summarizeFrames(
  samples: readonly FrameSample[],
  extras: { drawCalls: number; triangles: number; loadMs: number },
): RuntimeFrameSummary {
  const work = samples.map((sample) => sample.workMs);
  const gaps = samples.map((sample) => sample.gapMs);
  return {
    frameCount: samples.length,
    averageMs: average(work),
    p95Ms: percentile(work, 95),
    p99Ms: percentile(work, 99),
    framesOver16Ms: work.filter((sample) => sample > RUNTIME_CONTRACT.stutterMs).length,
    maxMs: work.reduce((max, sample) => Math.max(max, sample), 0),
    gapAverageMs: average(gaps),
    gapP95Ms: percentile(gaps, 95),
    gapP99Ms: percentile(gaps, 99),
    gapsOver16Ms: gaps.filter((sample) => sample > RUNTIME_CONTRACT.stutterMs).length,
    gapsOver25Ms: gaps.filter((sample) => sample > RUNTIME_CONTRACT.hitchMs).length,
    gapMaxMs: gaps.reduce((max, sample) => Math.max(max, sample), 0),
    drawCalls: extras.drawCalls,
    triangles: extras.triangles,
    loadMs: extras.loadMs,
    renderCount: samples.length,
    rafCount: samples.length,
  };
}

/**
 * Base-phase gate. Load targets belong to the finished game, so they are
 * reported and do not pass or fail this phase. A single missed 60 Hz slot
 * fails the gate: the harness has nothing else to spend the frame on.
 */
export function evaluateBaseGate(summary: RuntimeFrameSummary): RuntimeGate {
  const failures: string[] = [];
  if (summary.frameCount < 60) failures.push(`muestra corta: ${summary.frameCount} cuadros`);
  if (summary.p99Ms > RUNTIME_CONTRACT.maxFrameP99Ms) {
    failures.push(`p99 de trabajo ${summary.p99Ms.toFixed(2)} ms supera ${RUNTIME_CONTRACT.maxFrameP99Ms} ms`);
  }
  if (summary.framesOver16Ms > 0) {
    failures.push(`${summary.framesOver16Ms} cuadros trabajaron más de ${RUNTIME_CONTRACT.stutterMs} ms`);
  }
  if (summary.gapsOver25Ms > 0) {
    failures.push(`${summary.gapsOver25Ms} huecos superan ${RUNTIME_CONTRACT.hitchMs} ms`);
  }
  return { pass: failures.length === 0, failures };
}
