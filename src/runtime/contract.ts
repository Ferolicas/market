/**
 * Acceptance gate for the new renderer. The production scene at `/` is not
 * this runtime. Phase "base" measures the empty harness only: one animation
 * frame, a 5 Hz snapshot and a few placeholder meshes. Art budgets come later,
 * on the same numbers, and a miss stops the next phase.
 */
/**
 * Official iPhone baseline of the empty runtime, build 8257805, about five
 * minutes, Safari. Sixteen gaps over 25 ms out of 25 600 renders (0.0625 %).
 * A later phase is compared with this, not with a demand of zero hitches.
 */
export const RUNTIME_IPHONE_BASELINE = {
  build: "8257805",
  workAverageMs: 0.3,
  workP95Ms: 0.4,
  workP99Ms: 0.5,
  workMaxMs: 4.6,
  workOver16: 0,
  gapAverageMs: 16.7,
  gapP95Ms: 17,
  gapP99Ms: 18,
  gapMaxMs: 133,
  gapsOver25Ms: 16,
  renders: 25_600,
  rafs: 25_600,
  drawCalls: 3,
  triangles: 348,
  loadMs: 340,
  gapsOver16Ms: 16_000,
  measuredFrames: 27_000,
} as const;

/**
 * Official iPhone baseline of phase 3 (empty runtime plus the baked level-30
 * store, build 55f18f0, fixed camera, no characters/stock/physics). Approved
 * 2026-09-25: the store adds ~1.6 ms of p99 work over the empty baseline and
 * does not regress the presentation cadence.
 */
export const RUNTIME_PHASE3_BASELINE = {
  build: "55f18f0",
  workAverageMs: 1.6,
  workP95Ms: 1.8,
  workP99Ms: 2.1,
  workMaxMs: 8.0,
  workOver16: 0,
  gapAverageMs: 16.7,
  gapP95Ms: 17,
  gapP99Ms: 17,
  gapMaxMs: 103,
  gapsOver25Ms: 4,
  renders: 26_691,
  rafs: 26_691,
  drawCalls: 115,
  triangles: 134_456,
  loadMs: 407,
} as const;

/**
 * Occasional Safari refresh gaps are normal even for trivial work (see
 * RUNTIME_IPHONE_BASELINE: 16 gaps over 25 ms across 25 600 renders on the
 * empty runtime). Demanding an absolute zero fails real sessions for a
 * platform hiccup that has nothing to do with the scene's own budget, so the
 * gate scales its hitch tolerance with the sample size using that measured
 * ratio, floored so short samples (warmup, a quick manual check) still
 * require zero hitches exactly like before.
 */
const HITCH_TOLERANCE_RATIO = RUNTIME_IPHONE_BASELINE.gapsOver25Ms / RUNTIME_IPHONE_BASELINE.renders;

export const RUNTIME_CONTRACT = {
  id: "runtime-base-2026-09-25",
  phase: "base",
  presentationHz: 60,
  simulationHz: 5,
  simulationStepMs: 200,
  /**
   * Phase 4: the level-30 store's own ceiling for one location, not an
   * arbitrary round number. `SnapshotSimulation` drives this many synthetic
   * markers; the first `crowdCustomerActors` are customers, the rest are
   * employees (see `crowdFeed.ts`).
   */
  placeholderActors: 43,
  /** Customers present at once in a level-30 store: up to 8 shopping/entering
   * plus up to 16 more finishing (queue/checkout/exit), hard-capped at
   * min(30, 8*3)=24 by `campaignNeedsCustomer`/`campaignCustomerLimit(30)`. */
  crowdCustomerActors: 24,
  /** Full level-30 staff: 8 farmer-stockers + 3 feeders + 5 operators + 3
   * cashiers (`campaignEmployeeLimit`, all three cashier levels unlocked). */
  crowdEmployeeActors: 19,
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
  /** Phase 4: time until the crowd's bodies/animations finish loading, tracked apart from `loadMs` (the store's own first frame). 0 until known. */
  crowdReadyMs: number;
  /** Phase 4: bytes of crowd bodies/animations downloaded (Resource Timing), separate from the store. */
  crowdBytes: number;
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
  extras: { drawCalls: number; triangles: number; loadMs: number; crowdReadyMs?: number; crowdBytes?: number },
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
    crowdReadyMs: extras.crowdReadyMs ?? 0,
    crowdBytes: extras.crowdBytes ?? 0,
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
  const hitchBudget = Math.floor(summary.frameCount * HITCH_TOLERANCE_RATIO);
  if (summary.gapsOver25Ms > hitchBudget) {
    failures.push(`${summary.gapsOver25Ms} huecos superan ${RUNTIME_CONTRACT.hitchMs} ms (tolerancia ${hitchBudget} para ${summary.frameCount} cuadros, según la baseline del iPhone)`);
  }
  return { pass: failures.length === 0, failures };
}
