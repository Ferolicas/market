import { RUNTIME_CONTRACT, summarizeFrames, type FrameSample, type RuntimeFrameSummary } from "./contract";

/** Collects work time and the gap between animation callbacks. */
export class FrameMetrics {
  private readonly samples: FrameSample[] = [];
  loadMs: number | null = null;
  drawCalls = 0;
  triangles = 0;

  markLoad(loadMs: number) {
    if (this.loadMs === null) this.loadMs = loadMs;
  }

  get frameCount() {
    return this.samples.length;
  }

  addFrame(workMs: number, gapMs: number, drawCalls: number, triangles: number) {
    if (!Number.isFinite(workMs) || !Number.isFinite(gapMs) || gapMs <= 0) return;
    this.samples.push({ workMs: Math.max(0, workMs), gapMs: Math.min(250, gapMs) });
    this.drawCalls = drawCalls;
    this.triangles = triangles;
  }

  /** Steady-state sample. The first frames include compile and are reported apart. */
  summary(): RuntimeFrameSummary {
    const steady = this.samples.slice(RUNTIME_CONTRACT.warmupFrames);
    return summarizeFrames(steady, {
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      loadMs: this.loadMs ?? 0,
    });
  }
}
