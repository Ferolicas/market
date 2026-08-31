import { describe, expect, it } from "vitest";
import { GazeController } from "./GazeController";

describe("gaze controller", () => {
  it("is deterministic, asynchronous by seed and anatomically bounded", () => {
    const first = new GazeController(3).sample(8, "queue");
    expect(first).toEqual(new GazeController(3).sample(8, "queue"));
    expect(first).not.toEqual(new GazeController(4).sample(8, "queue"));
    expect(Math.abs(first.yaw)).toBeLessThanOrEqual(0.35);
    expect(first.pitch).toBeGreaterThanOrEqual(-0.18);
    expect(first.pitch).toBeLessThanOrEqual(0.28);
  });
});
