import { describe, expect, it } from "vitest";
import { FootGroundingController } from "./FootGroundingController";

describe("foot grounding", () => {
  it("calibrates the sole and limits IK correction to three centimetres", () => {
    const controller = new FootGroundingController();
    controller.calibrate(0.08, 0);
    expect(controller.solve(0.06, 0, 1)).toBeCloseTo(0.02);
    expect(controller.solve(0.5, 0, 1)).toBe(-0.03);
    expect(controller.solve(-0.5, 0, 1)).toBe(0.03);
    expect(controller.solve(0.06, 0, 0)).toBe(0);
  });
});
