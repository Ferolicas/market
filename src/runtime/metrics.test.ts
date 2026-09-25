import { describe, expect, it } from "vitest";
import { RUNTIME_CONTRACT } from "./contract";
import { FrameMetrics } from "./metrics";

describe("incremental frame metrics", () => {
  it("ignores the warmup and then keeps an exact hitch count and maximum", () => {
    const metrics = new FrameMetrics();
    for (let frame = 0; frame < RUNTIME_CONTRACT.warmupFrames; frame += 1) metrics.addFrame(40, 40, 3, 10);
    for (let frame = 0; frame < 100; frame += 1) metrics.addFrame(0.34, 16.7, 3, 348);
    metrics.addFrame(0.4, 27, 3, 348);
    metrics.addFrame(0.4, 80, 3, 348);
    const summary = metrics.summary();
    expect(summary.frameCount).toBe(102);
    expect(summary.gapsOver25Ms).toBe(2);
    expect(summary.gapMaxMs).toBe(80);
    expect(summary.framesOver16Ms).toBe(0);
    expect(summary.averageMs).toBeGreaterThan(0.3);
    expect(summary.averageMs).toBeLessThan(0.5);
    expect(summary.p99Ms).toBeLessThan(1);
  });

  it("answers percentiles from the fixed histogram after tens of thousands of frames", () => {
    const metrics = new FrameMetrics();
    metrics.reset();
    for (let frame = 0; frame < 20_000; frame += 1) metrics.addFrame(0.7, frame === 19_999 ? 27 : 16.7, 3, 348);
    const summary = metrics.summary();
    expect(summary.frameCount).toBe(20_000);
    expect(summary.p99Ms).toBeCloseTo(0.7, 1);
    expect(summary.gapP95Ms).toBeCloseTo(16.7, 1);
    expect(summary.gapP99Ms).toBeCloseTo(16.7, 1);
    expect(summary.gapsOver25Ms).toBe(1);
    expect(summary.gapMaxMs).toBe(27);
  });

  it("resets the sample and keeps the load time", () => {
    const metrics = new FrameMetrics();
    metrics.markLoad(107);
    metrics.markRaf();
    metrics.markRender();
    metrics.reset();
    metrics.addFrame(1, 30, 3, 348);
    const summary = metrics.summary();
    expect(summary.loadMs).toBe(107);
    expect(summary.frameCount).toBe(1);
    expect(summary.gapsOver25Ms).toBe(1);
    expect(summary.renderCount).toBe(0);
    expect(summary.rafCount).toBe(0);
  });
});
