import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CROWD_CLIP_NAMES, CROWD_FPS, CROWD_TEXELS_PER_BONE, CROWD_TEXTURE_WIDTH, crowdAnimationPaths, crowdFrameRow, type CrowdAnimationManifest } from "./CrowdAnimation";

const BODIES = ["customer_01_man_young", "customer_02_man_senior", "customer_03_woman_young", "customer_04_woman_adult", "customer_05_woman_mature", "customer_06_woman_senior", "owner_man", "owner_woman"];

describe("crowd animation bake", () => {
  it("ships every crowd clip and socket for every crowd body, sized as the manifest says", () => {
    for (const body of BODIES) {
      const paths = crowdAnimationPaths(body);
      const manifest = JSON.parse(readFileSync(`public${paths.manifest}`, "utf8")) as CrowdAnimationManifest;
      expect(manifest.body).toBe(body);
      expect(manifest.format).toBe("half");
      expect(manifest.fps).toBe(CROWD_FPS);
      expect(manifest.texelsPerBone).toBe(CROWD_TEXELS_PER_BONE);
      expect(manifest.width).toBeLessThanOrEqual(CROWD_TEXTURE_WIDTH);
      expect(manifest.width).toBeGreaterThanOrEqual(manifest.bones.length * CROWD_TEXELS_PER_BONE);
      for (const clip of CROWD_CLIP_NAMES) {
        const range = manifest.clips[clip];
        expect(range, `${body} ${clip}`).toBeDefined();
        expect(range!.start + range!.frames).toBeLessThanOrEqual(manifest.frames);
        expect(range!.frames).toBe(Math.ceil(range!.duration * CROWD_FPS) + 1);
      }
      for (const joint of ["Head", "Hand_L", "Hand_R", "Hips"] as const) expect(manifest.joints[joint], `${body} ${joint}`).toBeTypeOf("number");
      // Two bytes per half float, RGBA per texel.
      expect(statSync(`public${paths.data}`).size).toBe(manifest.frames * manifest.width * 4 * 2);
      // Identical performances share rows; with the carry pose frozen into
      // CarryIdle/CarryWalk the widest body (49 bones) stays under 2.8 MB.
      expect(statSync(`public${paths.data}`).size).toBeLessThan(2_800_000);
    }
  });

  it("maps clip time to a looping fractional row", () => {
    const clip = { start: 100, frames: 31, duration: 2 };
    expect(crowdFrameRow(clip, 0)).toBe(100);
    expect(crowdFrameRow(clip, 1)).toBeCloseTo(115);
    expect(crowdFrameRow(clip, 1.5 / CROWD_FPS)).toBeCloseTo(101.5);
    expect(crowdFrameRow(clip, 2)).toBe(100);
    expect(crowdFrameRow(clip, 2.1)).toBeCloseTo(101.5);
    expect(crowdFrameRow(clip, -0.1)).toBeCloseTo(128.5);
    expect(crowdFrameRow(clip, 1.9999)).toBeLessThan(130);
  });
});
