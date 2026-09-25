import { describe, expect, it } from "vitest";
import { CROWD_FADE_SECONDS, advanceCrowdPose, createCrowdPose, crowdGaitTimeScale, crowdPoseRows } from "./CrowdPose";
import type { CrowdAnimationManifest } from "./CrowdAnimation";

const manifest = {
  body: "test", format: "half", fps: 15, width: 124, frames: 200, texelsPerBone: 3, bones: [], joints: {},
  clips: {
    Idle: { start: 0, frames: 31, duration: 2 },
    Walk: { start: 40, frames: 31, duration: 2 },
    Run: { start: 80, frames: 16, duration: 1 },
    Browse: { start: 100, frames: 61, duration: 4 },
  },
} as unknown as CrowdAnimationManifest;

describe("crowd pose", () => {
  it("plays a clip forward and loops it without a fade partner", () => {
    let pose = createCrowdPose("Idle");
    expect(crowdPoseRows(pose, manifest)).toEqual({ rowA: 0, rowB: 0, blend: 0 });
    pose = advanceCrowdPose(pose, "Idle", 1, 1, manifest);
    expect(crowdPoseRows(pose, manifest).rowA).toBeCloseTo(15);
    pose = advanceCrowdPose(pose, "Idle", 1.5, 1, manifest);
    expect(crowdPoseRows(pose, manifest).rowA).toBeCloseTo(7.5);
  });

  it("cross-fades into a new clip over the fade time, then drops the old rows", () => {
    let pose = advanceCrowdPose(createCrowdPose("Idle"), "Idle", 0.5, 1, manifest);
    pose = advanceCrowdPose(pose, "Browse", 0, 1, manifest);
    let rows = crowdPoseRows(pose, manifest);
    expect(rows.rowA).toBe(100);
    expect(rows.rowB).toBeCloseTo(7.5);
    expect(rows.blend).toBe(1);
    pose = advanceCrowdPose(pose, "Browse", CROWD_FADE_SECONDS / 2, 1, manifest);
    rows = crowdPoseRows(pose, manifest);
    expect(rows.blend).toBeCloseTo(0.5);
    pose = advanceCrowdPose(pose, "Browse", CROWD_FADE_SECONDS, 1, manifest);
    rows = crowdPoseRows(pose, manifest);
    expect(rows.blend).toBe(0);
    expect(rows.rowB).toBe(rows.rowA);
  });

  it("keeps the stride phase when one gait becomes another", () => {
    let pose = advanceCrowdPose(createCrowdPose("Walk"), "Walk", 1.5, 1, manifest);
    pose = advanceCrowdPose(pose, "Run", 0, 1, manifest);
    // 75 % through the walk becomes 75 % through the run.
    expect(pose.time).toBeCloseTo(0.75);
    expect(crowdPoseRows(pose, manifest).rowA).toBeCloseTo(80 + 0.75 * 15);
  });

  it("ignores a clip the bake does not carry and clamps the gait speed like the mixers", () => {
    const pose = advanceCrowdPose(createCrowdPose("Idle"), "Harvest", 0.1, 1, manifest);
    expect(pose.clip).toBe("Idle");
    expect(crowdGaitTimeScale("Walk", 1.4, 0.35, 2)).toBeCloseTo(2);
    expect(crowdGaitTimeScale("Walk", 10, 0.35, 1)).toBe(2.8);
    expect(crowdGaitTimeScale("Walk", 0.01, 0.35, 1)).toBe(0.55);
    expect(crowdGaitTimeScale("Browse", 3, 0.35, 1)).toBe(1);
  });
});
