import { RUNTIME_CONTRACT, evaluateBaseGate, type RuntimeFrameSummary, type RuntimeGate } from "./contract";

/** Work histogram resolution. One bucket is small enough that p99 stays comparable to a full sort. */
const WORK_BUCKET_MS = 0.1;
const WORK_BUCKETS = 500;
/** Gap histogram covers the recorded range. The exact maximum is kept apart from the buckets. */
const GAP_BUCKET_MS = 0.1;
const GAP_BUCKETS = 2_500;

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

  /** Phase 8: largest single main-thread stall seen while the navmesh promise was pending. */
  markNavStall(stallMs: number) {
    if (stallMs > this.navMaxStallMs) this.navMaxStallMs = stallMs;
  }

  setNavBytes(bytes: number) {
    this.navBytes = bytes;
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
    };
  }

  publish(): { summary: RuntimeFrameSummary; gate: RuntimeGate } {
    const summary = this.summary();
    return { summary, gate: evaluateBaseGate(summary) };
  }
}
