import { describe, expect, it } from "vitest";
import { cameraRelativeMovement, moveVelocity } from "./PlayerController";

describe("player controller", () => {
  it("maps screen input through camera forward", () => {
    expect(cameraRelativeMovement({ x: 0, y: -1, magnitude: 1 }, { x: 0, y: -1 })).toEqual({ x: 0, y: -1 });
    expect(cameraRelativeMovement({ x: 1, y: 0, magnitude: 1 }, { x: 0, y: -1 })).toEqual({ x: 1, y: 0 });
    expect(cameraRelativeMovement({ x: -1, y: 0, magnitude: 1 }, { x: 0, y: -1 })).toEqual({ x: -1, y: 0 });
  });

  it("accelerates and brakes in units per second", () => {
    const accelerated = moveVelocity({ x: 0, y: 0 }, { x: 1, y: 0 }, 1 / 60);
    expect(accelerated.x).toBeCloseTo(0.2);
    const stopped = moveVelocity({ x: 0.1, y: 0 }, { x: 0, y: 0 }, 1 / 60);
    expect(stopped).toEqual({ x: 0, y: 0 });
  });
});
