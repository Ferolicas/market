import { RUNTIME_CONTRACT, evaluateBaseGate, type RuntimeFrameSummary, type RuntimeGate } from "./contract";

/** Work histogram resolution. One bucket is small enough that p99 stays comparable to a full sort. */
const WORK_BUCKET_MS = 0.1;
const WORK_BUCKETS = 500;
/** Gap histogram covers the recorded range. The exact maximum is kept apart from the buckets. */
const GAP_BUCKET_MS = 0.1;
const GAP_BUCKETS = 2_500;
/** Phase 10: `storeMoveAlongSurface()` cost per frame is expected sub-millisecond; same resolution as the work histogram. */
const PLAYER_MOVE_BUCKET_MS = 0.1;
const PLAYER_MOVE_BUCKETS = 500;
/** Phase 11A: `InputManager.sample()` cost per frame — same resolution, expected even smaller than playerMove. */
const INPUT_SAMPLE_BUCKET_MS = 0.1;
const INPUT_SAMPLE_BUCKETS = 500;
/** Phase 11A: `navigator.getGamepads()` cost per frame — same resolution. */
const GAMEPAD_POLL_BUCKET_MS = 0.1;
const GAMEPAD_POLL_BUCKETS = 500;
/** Phase 11A: the full poll→normalize→sample pipeline cost per frame — same resolution. */
const INPUT_TOTAL_BUCKET_MS = 0.1;
const INPUT_TOTAL_BUCKETS = 500;

function bucket(value: number, width: number, count: number) {
  const index = Math.round(value / width);
  if (index <= 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

/** Same rank as `percentile` on a sorted sample, read from a fixed histogram. */
function histPercentile(hist: Uint32Array, width: number, total: number, p: number) {
  if (total <= 0) return 0;
  const rank = Math.min(total - 1, Math.max(0, Math.ceil((p / 100) * total) - 1));
  let seen = 0;
  for (let index = 0; index < hist.length; index += 1) {
    seen += hist[index];
    if (seen > rank) return index * width;
  }
  return (hist.length - 1) * width;
}

/**
 * Frame statistics with a fixed memory cost. `addFrame` only increments
 * counters. Percentiles are scanned when the panel asks, never inside the
 * animation callback.
 */
export class FrameMetrics {
  private readonly workHist = new Uint32Array(WORK_BUCKETS);
  private readonly gapHist = new Uint32Array(GAP_BUCKETS);
  private warmupLeft: number = RUNTIME_CONTRACT.warmupFrames;
  private workCount = 0;
  private workSum = 0;
  private workMax = 0;
  private workOver16 = 0;
  private gapCount = 0;
  private gapSum = 0;
  private gapMax = 0;
  private gapOver16 = 0;
  private gapOver25 = 0;
  private renders = 0;
  private rafs = 0;
  loadMs: number | null = null;
  drawCalls = 0;
  triangles = 0;
  private crowdReadyMs: number | null = null;
  private crowdBytes = 0;
  private navReadyMs: number | null = null;
  private navMaxStallMs = 0;
  private navBytes = 0;
  private readonly playerMoveHist = new Uint32Array(PLAYER_MOVE_BUCKETS);
  private playerMoveCount = 0;
  private playerMoveSum = 0;
  private playerMoveMax = 0;
  private playerMoveFirstAtMs: number | null = null;
  private readonly inputSampleHist = new Uint32Array(INPUT_SAMPLE_BUCKETS);
  private inputSampleCount = 0;
  private inputSampleSum = 0;
  private inputSampleMax = 0;
  private inputSampleFirstAtMs: number | null = null;
  private readonly gamepadPollHist = new Uint32Array(GAMEPAD_POLL_BUCKETS);
  private gamepadPollCount = 0;
  private gamepadPollSum = 0;
  private gamepadPollMax = 0;
  private readonly inputTotalHist = new Uint32Array(INPUT_TOTAL_BUCKETS);
  private inputTotalCount = 0;
  private inputTotalSum = 0;
  private inputTotalMax = 0;

  markLoad(loadMs: number) {
    if (this.loadMs === null) this.loadMs = loadMs;
  }

  /** Phase 4: when the crowd's bodies/animations finish loading, independent of the store's own first frame. */
  markCrowdReady(crowdReadyMs: number) {
    if (this.crowdReadyMs === null) this.crowdReadyMs = crowdReadyMs;
  }

  setCrowdBytes(bytes: number) {
    this.crowdBytes = bytes;
  }

  /** Phase 8: when `ensureStoreNavigation()` resolves, independent of the store/crowd. */
  markNavReady(navReadyMs: number) {
    if (this.navReadyMs === null) this.navReadyMs = navReadyMs;
  }

  /**
   * Phase 8: largest single main-thread stall seen while the *first*
   * `ensureStoreNavigation()` promise was pending — exclusively the cost of
   * `init()` compiling/instantiating the recast-navigation WASM module once
   * per page load (confirmed as a real `PerformanceObserver("longtask")`
   * entry, not just a scheduling delay, on 26-09-2026). Every later rebuild
   * runs off-thread in `navmesh.worker.ts` and never touches this heartbeat.
   * It is not reflected in `gapMaxMs`/`gapsOver25Ms`: those only start
   * counting after `RUNTIME_CONTRACT.warmupFrames` (60) frames, and this
   * stall happens inside that deliberately-excluded warmup window — it is
   * not missing due to a measurement bug, it is outside the stable sample by
   * design, same as GPU/JIT warmup.
   */
  markNavStall(stallMs: number) {
    if (stallMs > this.navMaxStallMs) this.navMaxStallMs = stallMs;
  }

  setNavBytes(bytes: number) {
    this.navBytes = bytes;
  }

  /**
   * Phase 10: one sample per rendered frame, straight from
   * `PlaceholderScene.updatePlayer`'s own `performance.now()` wrap around
   * `storeMoveAlongSurface()` — not gated by `warmupFrames` (unlike
   * `addFrame`'s work/gap histograms): the goal here is the query's isolated
   * cost from the very first call, including its cheap no-op before the
   * navmesh is ready, not a steady-state-only sample.
   */
  addPlayerMove(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (this.playerMoveFirstAtMs === null) this.playerMoveFirstAtMs = performance.now();
    this.playerMoveHist[bucket(ms, PLAYER_MOVE_BUCKET_MS, PLAYER_MOVE_BUCKETS)] += 1;
    this.playerMoveCount += 1;
    this.playerMoveSum += ms;
    if (ms > this.playerMoveMax) this.playerMoveMax = ms;
  }

  /**
   * Phase 11A: one sample per rendered frame, from `PlaceholderScene`'s own
   * timing around `InputManager.sample()` alone — exclusive of
   * `navigator.getGamepads()` (see `addGamepadPoll`) and of the full pipeline
   * (see `addInputTotal`). Not gated by `warmupFrames`, same reasoning as
   * `addPlayerMove`: this measures the call's isolated cost from the first
   * frame, whether or not an input device is actually connected. Also drives
   * `inputSamplesPerSecond`, since all three input timings are sampled
   * together, once per frame.
   */
  addInputSample(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (this.inputSampleFirstAtMs === null) this.inputSampleFirstAtMs = performance.now();
    this.inputSampleHist[bucket(ms, INPUT_SAMPLE_BUCKET_MS, INPUT_SAMPLE_BUCKETS)] += 1;
    this.inputSampleCount += 1;
    this.inputSampleSum += ms;
    if (ms > this.inputSampleMax) this.inputSampleMax = ms;
  }

  /**
   * Phase 11A, corrected 26-09-2026: exclusive cost of `navigator.getGamepads()`
   * alone, polled every frame regardless of whether a gamepad is connected
   * (matching `PlayerActor.step()`'s real production behaviour) — previously
   * this ran outside any timed window at all, understating the real per-frame
   * input cost.
   */
  addGamepadPoll(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.gamepadPollHist[bucket(ms, GAMEPAD_POLL_BUCKET_MS, GAMEPAD_POLL_BUCKETS)] += 1;
    this.gamepadPollCount += 1;
    this.gamepadPollSum += ms;
    if (ms > this.gamepadPollMax) this.gamepadPollMax = ms;
  }

  /**
   * Phase 11A: one continuous timer spanning poll → normalize → `sample()` —
   * the real total per-frame input pipeline cost, not just
   * `gamepadPollMs + inputSampleMs` (it also covers `setGamepad()`'s own
   * glue cost in between the two).
   */
  addInputTotal(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.inputTotalHist[bucket(ms, INPUT_TOTAL_BUCKET_MS, INPUT_TOTAL_BUCKETS)] += 1;
    this.inputTotalCount += 1;
    this.inputTotalSum += ms;
    if (ms > this.inputTotalMax) this.inputTotalMax = ms;
  }

  markRaf() {
    this.rafs += 1;
  }

  markRender() {
    this.renders += 1;
  }

  get frameCount() {
    return this.workCount;
  }

  /** One recorded frame. No allocation and no copy of the history. */
  addFrame(workMs: number, gapMs: number, drawCalls: number, triangles: number) {
    if (!Number.isFinite(workMs) || !Number.isFinite(gapMs) || gapMs <= 0) return;
    this.drawCalls = drawCalls;
    this.triangles = triangles;
    if (this.warmupLeft > 0) {
      this.warmupLeft -= 1;
      return;
    }
    const work = Math.max(0, workMs);
    const gap = gapMs;
    this.workHist[bucket(work, WORK_BUCKET_MS, WORK_BUCKETS)] += 1;
    this.gapHist[bucket(gap, GAP_BUCKET_MS, GAP_BUCKETS)] += 1;
    this.workCount += 1;
    this.workSum += work;
    if (work > this.workMax) this.workMax = work;
    if (work > RUNTIME_CONTRACT.stutterMs) this.workOver16 += 1;
    this.gapCount += 1;
    this.gapSum += gap;
    if (gap > this.gapMax) this.gapMax = gap;
    if (gap > RUNTIME_CONTRACT.stutterMs) this.gapOver16 += 1;
    if (gap > RUNTIME_CONTRACT.hitchMs) this.gapOver25 += 1;
  }

  /** Clears the running sample. The first-frame load time stays. */
  reset() {
    this.workHist.fill(0);
    this.gapHist.fill(0);
    this.warmupLeft = 0;
    this.workCount = 0;
    this.workSum = 0;
    this.workMax = 0;
    this.workOver16 = 0;
    this.gapCount = 0;
    this.gapSum = 0;
    this.gapMax = 0;
    this.gapOver16 = 0;
    this.gapOver25 = 0;
    this.renders = 0;
    this.rafs = 0;
  }

  summary(): RuntimeFrameSummary {
    return {
      frameCount: this.workCount,
      averageMs: this.workCount ? this.workSum / this.workCount : 0,
      p95Ms: histPercentile(this.workHist, WORK_BUCKET_MS, this.workCount, 95),
      p99Ms: histPercentile(this.workHist, WORK_BUCKET_MS, this.workCount, 99),
      framesOver16Ms: this.workOver16,
      maxMs: this.workMax,
      gapAverageMs: this.gapCount ? this.gapSum / this.gapCount : 0,
      gapP95Ms: histPercentile(this.gapHist, GAP_BUCKET_MS, this.gapCount, 95),
      gapP99Ms: histPercentile(this.gapHist, GAP_BUCKET_MS, this.gapCount, 99),
      gapsOver16Ms: this.gapOver16,
      gapsOver25Ms: this.gapOver25,
      gapMaxMs: this.gapMax,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      loadMs: this.loadMs ?? 0,
      renderCount: this.renders,
      rafCount: this.rafs,
      crowdReadyMs: this.crowdReadyMs ?? 0,
      crowdBytes: this.crowdBytes,
      navReadyMs: this.navReadyMs ?? 0,
      navMaxStallMs: this.navMaxStallMs,
      navBytes: this.navBytes,
      playerMoveAverageMs: this.playerMoveCount ? this.playerMoveSum / this.playerMoveCount : 0,
      playerMoveP95Ms: histPercentile(this.playerMoveHist, PLAYER_MOVE_BUCKET_MS, this.playerMoveCount, 95),
      playerMoveP99Ms: histPercentile(this.playerMoveHist, PLAYER_MOVE_BUCKET_MS, this.playerMoveCount, 99),
      playerMoveMaxMs: this.playerMoveMax,
      playerMoveCallsPerSecond: this.playerMoveFirstAtMs !== null && this.playerMoveCount > 0
        ? this.playerMoveCount / Math.max(0.001, (performance.now() - this.playerMoveFirstAtMs) / 1_000)
        : 0,
      inputSampleAverageMs: this.inputSampleCount ? this.inputSampleSum / this.inputSampleCount : 0,
      inputSampleP95Ms: histPercentile(this.inputSampleHist, INPUT_SAMPLE_BUCKET_MS, this.inputSampleCount, 95),
      inputSampleP99Ms: histPercentile(this.inputSampleHist, INPUT_SAMPLE_BUCKET_MS, this.inputSampleCount, 99),
      inputSampleMaxMs: this.inputSampleMax,
      gamepadPollAverageMs: this.gamepadPollCount ? this.gamepadPollSum / this.gamepadPollCount : 0,
      gamepadPollP95Ms: histPercentile(this.gamepadPollHist, GAMEPAD_POLL_BUCKET_MS, this.gamepadPollCount, 95),
      gamepadPollP99Ms: histPercentile(this.gamepadPollHist, GAMEPAD_POLL_BUCKET_MS, this.gamepadPollCount, 99),
      gamepadPollMaxMs: this.gamepadPollMax,
      inputTotalAverageMs: this.inputTotalCount ? this.inputTotalSum / this.inputTotalCount : 0,
      inputTotalP95Ms: histPercentile(this.inputTotalHist, INPUT_TOTAL_BUCKET_MS, this.inputTotalCount, 95),
      inputTotalP99Ms: histPercentile(this.inputTotalHist, INPUT_TOTAL_BUCKET_MS, this.inputTotalCount, 99),
      inputTotalMaxMs: this.inputTotalMax,
      inputSamplesPerSecond: this.inputSampleFirstAtMs !== null && this.inputSampleCount > 0
        ? this.inputSampleCount / Math.max(0.001, (performance.now() - this.inputSampleFirstAtMs) / 1_000)
        : 0,
    };
  }

  publish(): { summary: RuntimeFrameSummary; gate: RuntimeGate } {
    const summary = this.summary();
    return { summary, gate: evaluateBaseGate(summary) };
  }
}
