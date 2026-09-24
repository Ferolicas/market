import { describe, expect, it } from "vitest";
import { MOTION_CADENCE, MotionCadenceController, presentationDivisor } from "./AdaptiveQuality";

const HZ120 = 1_000 / 120;
const HZ60 = 1_000 / 60;

describe("motion cadence controller", () => {
  it("starts at the profile's motion rate on both panel refreshes", () => {
    const controller = new MotionCadenceController();
    expect(controller.divisor(HZ120, 60)).toBe(2);
    expect(controller.fps(HZ120, 60)).toBe(60);
    expect(controller.divisor(HZ60, 60)).toBe(1);
    expect(presentationDivisor(HZ120, 30)).toBe(4);
  });

  it("steps down to 40 then 30 fps on a 120 Hz panel when presentations keep missing their slot", () => {
    const controller = new MotionCadenceController();
    let now = 0;
    const slot = HZ120 * 2;
    for (let index = 0; index < MOTION_CADENCE.stepDownSamples; index += 1) controller.observe(slot * 2, slot, now += slot, HZ120, 60);
    expect(controller.level).toBe(1);
    expect(controller.fps(HZ120, 60)).toBe(40);
    const slot40 = HZ120 * 3;
    for (let index = 0; index < MOTION_CADENCE.stepDownSamples; index += 1) controller.observe(slot40 * 2, slot40, now += slot40, HZ120, 60);
    expect(controller.fps(HZ120, 60)).toBe(30);
    // Never below the floor, however bad it gets.
    for (let index = 0; index < 200; index += 1) controller.observe(200, HZ120 * 4, now += 200, HZ120, 60);
    expect(controller.fps(HZ120, 60)).toBe(30);
  });

  it("steps down to 30 fps on a 60 Hz panel and climbs back only after a quiet stretch", () => {
    const controller = new MotionCadenceController();
    let now = 0;
    for (let index = 0; index < MOTION_CADENCE.stepDownSamples; index += 1) controller.observe(HZ60 * 2, HZ60, now += HZ60, HZ60, 60);
    expect(controller.fps(HZ60, 60)).toBe(30);
    // Fitting frames, but not yet for long enough.
    for (let index = 0; index < MOTION_CADENCE.stepUpSamples; index += 1) controller.observe(HZ60 * 2, HZ60 * 2, now += HZ60 * 2, HZ60, 60);
    expect(controller.level).toBe(1);
    now += MOTION_CADENCE.stepUpAfterMs;
    for (let index = 0; index < MOTION_CADENCE.stepUpSamples; index += 1) controller.observe(HZ60 * 2, HZ60 * 2, now += HZ60 * 2, HZ60, 60);
    expect(controller.level).toBe(0);
    expect(controller.fps(HZ60, 60)).toBe(60);
  });

  it("ignores an occasional miss", () => {
    const controller = new MotionCadenceController();
    let now = 0;
    for (let index = 0; index < 300; index += 1) controller.observe(index % 20 === 0 ? HZ120 * 5 : HZ120 * 2, HZ120 * 2, now += HZ120 * 2, HZ120, 60);
    expect(controller.level).toBe(0);
  });
});
