/**
 * Telemetry for `/runtime`'s integral level-30 test — a real gameplay
 * session (real player, real crowd, real economy), not the isolated-variable
 * phase harness (`scene.ts`/`metrics.ts`/`contract.ts`) this replaces at the
 * `/runtime` route. Same fixed-histogram approach (cheap, bounded memory,
 * percentiles without sorting a growing array), but adds per-minute buckets:
 * a 10-15 minute session is long enough that thermal throttling would show
 * up as p99/gapMax drifting upward over time, which a single cumulative
 * summary would hide.
 */

const BUCKET_MS = 0.1;
const WORK_BUCKETS = 2_000; // up to 200 ms
const GAP_BUCKETS = 5_000; // up to 500 ms

function bucket(value: number, count: number) {
  const index = Math.round(value / BUCKET_MS);
  if (index <= 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

function percentile(hist: Uint32Array, total: number, p: number) {
  if (total <= 0) return 0;
  const rank = Math.min(total - 1, Math.max(0, Math.ceil((p / 100) * total) - 1));
  let seen = 0;
  for (let index = 0; index < hist.length; index += 1) {
    seen += hist[index];
    if (seen > rank) return index * BUCKET_MS;
  }
  return (hist.length - 1) * BUCKET_MS;
}

export interface MinuteSnapshot {
  minute: number;
  frameCount: number;
  workAverageMs: number;
  workP95Ms: number;
  workP99Ms: number;
  workMaxMs: number;
  framesOver16Ms: number;
  gapP95Ms: number;
  gapP99Ms: number;
  gapMaxMs: number;
  gapsOver25Ms: number;
  drawCalls: number;
  triangles: number;
  navRebuilds: number;
  usedJsHeapMb: number | null;
}

export interface IntegralSummary {
  frameCount: number;
  workAverageMs: number;
  workP95Ms: number;
  workP99Ms: number;
  workMaxMs: number;
  framesOver16Ms: number;
  gapAverageMs: number;
  gapP95Ms: number;
  gapP99Ms: number;
  gapMaxMs: number;
  gapsOver25Ms: number;
  drawCalls: number;
  triangles: number;
  loadMs: number;
  interactiveMs: number;
  coldBytes: number;
  navRebuilds: number;
  usedJsHeapMb: number | null;
  elapsedMinutes: number;
  minutes: MinuteSnapshot[];
}

const MINUTE_MS = 60_000;

export class IntegralMetrics {
  private readonly workHist = new Uint32Array(WORK_BUCKETS);
  private readonly gapHist = new Uint32Array(GAP_BUCKETS);
  private readonly minuteWorkHist = new Uint32Array(WORK_BUCKETS);
  private readonly minuteGapHist = new Uint32Array(GAP_BUCKETS);
  private frameCount = 0;
  private workSum = 0;
  private workMax = 0;
  private framesOver16 = 0;
  private gapSum = 0;
  private gapMax = 0;
  private gapsOver25 = 0;
  private drawCalls = 0;
  private triangles = 0;
  private minuteFrameCount = 0;
  private minuteWorkSum = 0;
  private minuteWorkMax = 0;
  private minuteFramesOver16 = 0;
  private minuteGapMax = 0;
  private minuteGapsOver25 = 0;
  private minuteStartAt = performance.now();
  private minuteIndex = 0;
  private navRebuildsAtMinuteStart = 0;
  private readonly minutes: MinuteSnapshot[] = [];
  loadMs: number | null = null;
  interactiveMs: number | null = null;
  coldBytes = 0;

  addFrame(workMs: number, gapMs: number, drawCalls: number, triangles: number, navRebuilds: number, getUsedJsHeapMb: () => number | null) {
    if (!Number.isFinite(workMs) || !Number.isFinite(gapMs) || gapMs <= 0) return;
    this.drawCalls = drawCalls;
    this.triangles = triangles;
    this.workHist[bucket(workMs, WORK_BUCKETS)] += 1;
    this.minuteWorkHist[bucket(workMs, WORK_BUCKETS)] += 1;
    this.gapHist[bucket(gapMs, GAP_BUCKETS)] += 1;
    this.minuteGapHist[bucket(gapMs, GAP_BUCKETS)] += 1;
    this.frameCount += 1;
    this.minuteFrameCount += 1;
    this.workSum += workMs;
    this.minuteWorkSum += workMs;
    if (workMs > this.workMax) this.workMax = workMs;
    if (workMs > this.minuteWorkMax) this.minuteWorkMax = workMs;
    if (workMs > 16.7) { this.framesOver16 += 1; this.minuteFramesOver16 += 1; }
    this.gapSum += gapMs;
    if (gapMs > this.gapMax) this.gapMax = gapMs;
    if (gapMs > this.minuteGapMax) this.minuteGapMax = gapMs;
    if (gapMs > 25) { this.gapsOver25 += 1; this.minuteGapsOver25 += 1; }

    const now = performance.now();
    if (now - this.minuteStartAt >= MINUTE_MS) {
      this.minuteIndex += 1;
      this.minutes.push({
        minute: this.minuteIndex,
        frameCount: this.minuteFrameCount,
        workAverageMs: this.minuteFrameCount ? this.minuteWorkSum / this.minuteFrameCount : 0,
        workP95Ms: percentile(this.minuteWorkHist, this.minuteFrameCount, 95),
        workP99Ms: percentile(this.minuteWorkHist, this.minuteFrameCount, 99),
        workMaxMs: this.minuteWorkMax,
        framesOver16Ms: this.minuteFramesOver16,
        gapP95Ms: percentile(this.minuteGapHist, this.minuteFrameCount, 95),
        gapP99Ms: percentile(this.minuteGapHist, this.minuteFrameCount, 99),
        gapMaxMs: this.minuteGapMax,
        gapsOver25Ms: this.minuteGapsOver25,
        drawCalls,
        triangles,
        navRebuilds: navRebuilds - this.navRebuildsAtMinuteStart,
        usedJsHeapMb: getUsedJsHeapMb(),
      });
      this.navRebuildsAtMinuteStart = navRebuilds;
      this.minuteWorkHist.fill(0);
      this.minuteGapHist.fill(0);
      this.minuteFrameCount = 0;
      this.minuteWorkSum = 0;
      this.minuteWorkMax = 0;
      this.minuteFramesOver16 = 0;
      this.minuteGapMax = 0;
      this.minuteGapsOver25 = 0;
      this.minuteStartAt = now;
    }
  }

  markLoad(ms: number) {
    if (this.loadMs === null) this.loadMs = ms;
  }

  markInteractive(ms: number) {
    if (this.interactiveMs === null) this.interactiveMs = ms;
  }

  setColdBytes(bytes: number) {
    this.coldBytes = bytes;
  }

  summary(navRebuilds: number, usedJsHeapMb: number | null): IntegralSummary {
    return {
      frameCount: this.frameCount,
      workAverageMs: this.frameCount ? this.workSum / this.frameCount : 0,
      workP95Ms: percentile(this.workHist, this.frameCount, 95),
      workP99Ms: percentile(this.workHist, this.frameCount, 99),
      workMaxMs: this.workMax,
      framesOver16Ms: this.framesOver16,
      gapAverageMs: this.frameCount ? this.gapSum / this.frameCount : 0,
      gapP95Ms: percentile(this.gapHist, this.frameCount, 95),
      gapP99Ms: percentile(this.gapHist, this.frameCount, 99),
      gapMaxMs: this.gapMax,
      gapsOver25Ms: this.gapsOver25,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      loadMs: this.loadMs ?? 0,
      interactiveMs: this.interactiveMs ?? 0,
      coldBytes: this.coldBytes,
      navRebuilds,
      usedJsHeapMb,
      elapsedMinutes: this.minuteIndex + this.minuteFrameCount / Math.max(1, this.frameCount || 1),
      minutes: this.minutes,
    };
  }
}

/** Chrome/Edge only — not exposed by Safari (iPhone), never inferred when absent. */
export function readUsedJsHeapMb(): number | null {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  if (!perf.memory) return null;
  return perf.memory.usedJSHeapSize / (1024 * 1024);
}
