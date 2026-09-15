import { describe, expect, it } from "vitest";
import { FieldPerformanceSampler } from "./FieldPerformance";

describe("field performance sampler", () => {
  it("summarises frame cadence and long tasks without retaining old windows", () => {
    const sampler = new FieldPerformanceSampler();
    for (let index = 0; index < 95; index += 1) sampler.addFrame(16.7);
    for (let index = 0; index < 5; index += 1) sampler.addFrame(50);
    sampler.addLongTask(82);

    expect(sampler.take()).toMatchObject({ frameCount: 100, p95FrameMs: 50, framesOver25: 5, longTaskCount: 1, maxLongTaskMs: 82 });
    expect(sampler.take().frameCount).toBe(0);
  });
});
