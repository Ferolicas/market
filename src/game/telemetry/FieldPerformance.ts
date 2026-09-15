export class FieldPerformanceSampler {
  private frames: number[] = [];
  private longTasks: number[] = [];

  addFrame(deltaMs: number) {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.frames.push(Math.min(250, deltaMs));
  }

  addLongTask(durationMs: number) {
    if (Number.isFinite(durationMs) && durationMs >= 50) this.longTasks.push(Math.min(10_000, durationMs));
  }

  take() {
    const ordered = [...this.frames].sort((left, right) => left - right);
    const average = this.frames.reduce((total, value) => total + value, 0) / Math.max(1, this.frames.length);
    const p95 = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))] ?? 0;
    const result = {
      frameCount: this.frames.length,
      averageFrameMs: rounded(average),
      p95FrameMs: rounded(p95),
      framesOver25: this.frames.filter((value) => value > 25).length,
      longTaskCount: this.longTasks.length,
      maxLongTaskMs: rounded(Math.max(0, ...this.longTasks)),
    };
    this.frames = [];
    this.longTasks = [];
    return result;
  }
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}
