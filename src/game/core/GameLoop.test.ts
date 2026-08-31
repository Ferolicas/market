import { describe, expect, it, vi } from "vitest";
import { FixedStepLoop } from "./GameLoop";

describe("FixedStepLoop", () => {
  it("ticks at 60 Hz independently of render cadence", () => {
    const loop = new FixedStepLoop(1 / 60, 5);
    const tick = vi.fn();
    loop.advance(0, tick);
    loop.advance(1 / 30, tick);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(tick).toHaveBeenNthCalledWith(1, 1 / 60);
  });

  it("caps substeps after a stalled frame", () => {
    const loop = new FixedStepLoop(1 / 60, 4);
    const tick = vi.fn();
    loop.advance(0, tick);
    const stats = loop.advance(2, tick);
    expect(stats.steps).toBe(4);
    expect(stats.droppedSeconds).toBeGreaterThan(1.9);
  });
});
