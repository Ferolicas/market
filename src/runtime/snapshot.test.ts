import { describe, expect, it } from "vitest";
import { RUNTIME_CONTRACT } from "./contract";
import { createPoseBuffer, interpolatePoses, POSE_STRIDE, SnapshotSimulation, writePlaceholderPose } from "./snapshot";

describe("snapshot interpolation", () => {
  it("lands halfway between two poses", () => {
    const from = createPoseBuffer(1);
    const to = createPoseBuffer(1);
    const out = createPoseBuffer(1);
    from.set([0, 10, 0]);
    to.set([10, 20, 1]);
    interpolatePoses(from, to, 0.5, out);
    expect(out[0]).toBe(5);
    expect(out[1]).toBe(15);
    expect(out[2]).toBeCloseTo(0.5);
  });

  it("holds the latest pose until the next 200 ms step, then moves", () => {
    const simulation = new SnapshotSimulation();
    const before = simulation.sample(199);
    const startX = before[0];
    const held = simulation.sample(0);
    expect(held[0]).toBeCloseTo(startX);

    const stepped = simulation.sample(1);
    const expected = createPoseBuffer();
    writePlaceholderPose(expected, 1);
    const previous = createPoseBuffer();
    writePlaceholderPose(previous, 0);
    expect(simulation.currentTimeMs).toBe(RUNTIME_CONTRACT.simulationStepMs);
    expect(stepped[0]).toBeCloseTo(previous[0]);
    expect(stepped[0]).not.toBeCloseTo(expected[0]);

    const mid = simulation.sample(100);
    expect(mid[0]).toBeCloseTo(previous[0] * 0.5 + expected[0] * 0.5);
    expect(mid.length).toBe(RUNTIME_CONTRACT.placeholderActors * POSE_STRIDE);
  });
});
