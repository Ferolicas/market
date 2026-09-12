import { describe, expect, it } from "vitest";
import { PerformanceMonitor } from "./PerformanceMonitor";

describe("performance monitor", () => {
  it("publishes stable half-second windows and a p95", () => {
    const monitor = new PerformanceMonitor(); let result = null;
    for (let index = 0; index < 31; index += 1) result ??= monitor.sample(index === 30 ? 20 : 16.67, {
      drawCalls: 80,
      triangles: 120_000,
      points: 0,
      lines: 4,
      geometries: 42,
      textures: 12,
      programs: 5,
    });
    expect(result).toMatchObject({ fps: 60, averageFrameMs: 16.67, p95FrameMs: 16.67, drawCalls: 80, triangles: 120_000, lines: 4 });
  });
});
