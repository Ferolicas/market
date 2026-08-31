export interface RendererMetrics {
  fps: number;
  p95FrameMs: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  programs: number;
}

export class PerformanceMonitor {
  private frames: number[] = [];
  private elapsedMs = 0;

  sample(deltaMs: number, renderer: Omit<RendererMetrics, "fps" | "p95FrameMs">): RendererMetrics | null {
    const frame = Math.max(0, Math.min(250, deltaMs));
    this.frames.push(frame);
    this.elapsedMs += frame;
    if (this.elapsedMs < 500) return null;
    const ordered = [...this.frames].sort((a, b) => a - b);
    const p95FrameMs = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))] ?? 0;
    const average = this.frames.reduce((sum, value) => sum + value, 0) / Math.max(1, this.frames.length);
    const metrics = { ...renderer, fps: average > 0 ? Math.round(1_000 / average) : 0, p95FrameMs: Math.round(p95FrameMs * 100) / 100 };
    this.frames = [];
    this.elapsedMs = 0;
    return metrics;
  }
}
