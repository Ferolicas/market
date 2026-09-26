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
 * Official iPhone baseline of phase 4 (phase 3's store plus the real level-30
 * crowd — 24 customers + 19 employees, bodies + skinning only, no props).
 * Approved 2026-09-25 from the second, undisturbed reading: touching Safari
 * chrome (rotation, control centre, screenshot, app switch) inflates
 * `gapsOver25Ms` on its own; a stationary phone barely shows any. The crowd
 * adds ~1.0 ms to p99 over RUNTIME_PHASE3_BASELINE and does not regress
 * frame pacing. Open question, not yet answered: `loadMs` rose 407 -> 1347 ms
 * even though `crowdReadyMs` (1480 ms) loads on its own promise — worth
 * checking later whether the parallel 18.43 MB crowd download contends with
 * the store's own network/decode time on the phone.
 */
export const RUNTIME_PHASE4_BASELINE = {
  build: "a6ac3cb",
  workAverageMs: 2.4,
  workP95Ms: 2.7,
  workP99Ms: 3.1,
  workMaxMs: 16.7,
  workOver16: 0,
  gapAverageMs: 16.7,
  gapP95Ms: 17,
  gapP99Ms: 17,
  gapMaxMs: 26,
  gapsOver25Ms: 1,
  renders: 20_349,
  rafs: 20_349,
  drawCalls: 123,
  triangles: 214_632,
  loadMs: 1_347,
  crowdReadyMs: 1_480,
  crowdBytes: 18_430_000,
} as const;

/**
 * Official iPhone baseline of phase 5 (phase 4's crowd plus a constant cart
 * for every customer and a constant basket for every employee — the rigid
 * transported props, no hats/bags/products yet). Approved 2026-09-26, clean
 * reading: +0.2 ms average, +0.2 ms p95, but **+2.1 ms p99** over
 * RUNTIME_PHASE4_BASELINE — the p99 grew noticeably more than the average.
 * Still zero frames over 16.7 ms and no pacing regression, so this is not a
 * failure, but the tail is worth watching as later layers (hats next, then
 * the player) add their own instancers on top. Draws/triangles/bodies are
 * not optimized: they pass with wide margin.
 */
export const RUNTIME_PHASE5_BASELINE = {
  build: "23fcc9c",
  workAverageMs: 2.6,
  workP95Ms: 2.9,
  workP99Ms: 5.2,
  workMaxMs: 10.2,
  workOver16: 0,
  gapAverageMs: 16.7,
  gapP95Ms: 17,
  gapP99Ms: 17,
  gapMaxMs: 27,
  gapsOver25Ms: 1,
  renders: 29_460,
  rafs: 29_460,
  drawCalls: 150,
  triangles: 369_104,
  loadMs: 771,
  crowdReadyMs: 894.4,
  crowdBytes: 18_430_000,
} as const;

/**
 * Official iPhone baseline of phase 6 (phase 5's rigid props plus one
 * constant hat kind for every employee — no diversity across the 12 kinds
 * yet). Approved 2026-09-26, clean reading: no measurable regression
 * attributable to the hat; the average/p99 wobble versus
 * RUNTIME_PHASE5_BASELINE is normal sample variance, not a real cost. No
 * perceptible heating, no perceived stutter on the phone.
 */
export const RUNTIME_PHASE6_BASELINE = {
  build: "098b142",
  workAverageMs: 2.5,
  workP95Ms: 2.9,
  workP99Ms: 4.8,
  workMaxMs: 14.6,
  workOver16: 0,
  gapAverageMs: 16.7,
  gapP95Ms: 17,
  gapP99Ms: 17,
  gapMaxMs: 24,
  gapsOver25Ms: 0,
  renders: 20_086,
  rafs: 20_086,
  drawCalls: 152,
  triangles: 374_790,
  loadMs: 1_007,
  crowdReadyMs: 1_268,
  crowdBytes: 18_460_000,
} as const;

/**
 * Official iPhone baseline of phase 7 (phase 6's crowd plus hat diversity —
 * all 12 kinds round-robin, 12 unique body:hat combinations / GLBs instead
 * of 1). Approved 2026-09-26, clean reading: +0.4 ms average/p95/p99 over
 * RUNTIME_PHASE6_BASELINE, +18 draws, +1,910 triangles — a small, real,
 * uniform cost (not a tail spike like phase 5's props), no pacing
 * regression, no heating.
 */
export const RUNTIME_PHASE7_BASELINE = {
  build: "9502440",
  workAverageMs: 2.9,
  workP95Ms: 3.3,
  workP99Ms: 5.2,
  workMaxMs: 16.5,
  workOver16: 0,
  gapAverageMs: 16.7,
  gapP95Ms: 17,
  gapP99Ms: 17,
  gapMaxMs: 25,
  gapsOver25Ms: 0,
  renders: 21_201,
  rafs: 21_201,
  drawCalls: 170,
  triangles: 376_700,
  loadMs: 1_103,
  crowdReadyMs: 1_238.2,
  crowdBytes: 18_610_000,
} as const;

/**
 * Official iPhone baseline of phase 10 (phase 7's crowd/hats plus the
 * synthetic kinematic capsule chasing a deterministic target via
 * `storeMoveAlongSurface()` every frame — no input, no camera follow, no real
 * player model, no NPC collisions/interaction/purchases/high-level
 * pathfinding yet). Approved 2026-09-26, clean reading: work/gap stats are
 * within noise of RUNTIME_PHASE7_BASELINE (0 frames over 16.7 ms, 0 gaps over
 * 25 ms), no perceptible stutter. `playerMoveCallsPerSecond` ran at ~59.9/s
 * (essentially the render rate) at `playerMoveAverageMs` 0.1 ms / p99 0.1 ms
 * / max 2.6 ms — conclusion: `storeMoveAlongSurface()` at near 60 Hz is not a
 * bottleneck and must not be optimized or throttled on this evidence.
 * `navMaxStallMs` (105.5 ms here vs 133.1 ms in the phase-8/9 iPhone reading)
 * is startup-only WASM init cost, not phase 10's own — see the doc comment on
 * `FrameMetrics.markNavStall`.
 *
 * The phone showed mild, subjective (~8%) heating versus fully cold,
 * localized mainly under the camera housing; no battery-consumption figure
 * exists and none should be inferred from it. `playerMove`'s measured cost is
 * far too small to attribute this heating to the player/navmesh layer by
 * itself — left as an open observation for a dedicated future
 * thermal/consumption phase that can compare identical conditions and
 * separate CPU, GPU, render, display and network contributions, not
 * concluded here.
 */
export const RUNTIME_PHASE10_BASELINE = {
  build: "84e96c5",
  workAverageMs: 2.9,
  workP95Ms: 3.2,
  workP99Ms: 5.1,
  workMaxMs: 6.8,
  workOver16: 0,
  gapAverageMs: 16.7,
  gapP95Ms: 17.0,
  gapP99Ms: 18.0,
  gapMaxMs: 21.0,
  gapsOver25Ms: 0,
  renders: 22_122,
  rafs: 22_122,
  drawCalls: 171,
  triangles: 376_844,
  loadMs: 212,
  crowdReadyMs: 212.3,
  navReadyMs: 317.5,
  navMaxStallMs: 105.5,
  playerMoveAverageMs: 0.1,
  playerMoveP95Ms: 0.1,
  playerMoveP99Ms: 0.1,
  playerMoveMaxMs: 2.6,
  playerMoveCallsPerSecond: 59.9,
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
  /** Phase 8: wall-clock time until `ensureStoreNavigation()` resolves — includes the async WASM fetch/init plus the synchronous Recast build. 0 until known. */
  navReadyMs: number;
  /**
   * Phase 8: the largest single main-thread stall observed (via a
   * `setTimeout(0)` heartbeat, not an internal timer) while the navmesh
   * promise was pending. Recast's actual build call is synchronous WASM with
   * no worker, so this is the best external proxy for its CPU cost without
   * instrumenting `src/game/navigation/` itself — a floor, not an exact
   * internal measurement.
   */
  navMaxStallMs: number;
  /** Phase 8: bytes of the Recast `.wasm` binary downloaded (Resource Timing) — separate from crowdBytes. */
  navBytes: number;
  /** Phase 10: `storeMoveAlongSurface()`'s own per-frame cost, sampled every rendered frame (not gated by `warmupFrames`). */
  playerMoveAverageMs: number;
  playerMoveP95Ms: number;
  playerMoveP99Ms: number;
  playerMoveMaxMs: number;
  /** Phase 10: how often the synthetic player's navmesh query actually runs — should track the render rate closely. */
  playerMoveCallsPerSecond: number;
  /** Phase 11A: `InputManager.sample()`'s own per-frame cost, sampled every rendered frame (not gated by `warmupFrames`), timed separately from gamepad polling. */
  inputSampleAverageMs: number;
  inputSampleP95Ms: number;
  inputSampleP99Ms: number;
  inputSampleMaxMs: number;
  /** Phase 11A: how often input is sampled per second — should track the render rate closely, same as `playerMoveCallsPerSecond`. */
  inputSampleCallsPerSecond: number;
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
  extras: {
    drawCalls: number; triangles: number; loadMs: number;
    crowdReadyMs?: number; crowdBytes?: number;
    navReadyMs?: number; navMaxStallMs?: number; navBytes?: number;
    playerMoveAverageMs?: number; playerMoveP95Ms?: number; playerMoveP99Ms?: number;
    playerMoveMaxMs?: number; playerMoveCallsPerSecond?: number;
    inputSampleAverageMs?: number; inputSampleP95Ms?: number; inputSampleP99Ms?: number;
    inputSampleMaxMs?: number; inputSampleCallsPerSecond?: number;
  },
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
    navReadyMs: extras.navReadyMs ?? 0,
    navMaxStallMs: extras.navMaxStallMs ?? 0,
    navBytes: extras.navBytes ?? 0,
    playerMoveAverageMs: extras.playerMoveAverageMs ?? 0,
    playerMoveP95Ms: extras.playerMoveP95Ms ?? 0,
    playerMoveP99Ms: extras.playerMoveP99Ms ?? 0,
    playerMoveMaxMs: extras.playerMoveMaxMs ?? 0,
    playerMoveCallsPerSecond: extras.playerMoveCallsPerSecond ?? 0,
    inputSampleAverageMs: extras.inputSampleAverageMs ?? 0,
    inputSampleP95Ms: extras.inputSampleP95Ms ?? 0,
    inputSampleP99Ms: extras.inputSampleP99Ms ?? 0,
    inputSampleMaxMs: extras.inputSampleMaxMs ?? 0,
    inputSampleCallsPerSecond: extras.inputSampleCallsPerSecond ?? 0,
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
