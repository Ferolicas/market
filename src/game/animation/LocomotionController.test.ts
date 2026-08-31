import { describe, expect, it } from "vitest";
import { LocomotionController } from "./LocomotionController";

describe("LocomotionController", () => {
  it("aplica histéresis, carga y giro sobre pies", () => {
    const controller = new LocomotionController();
    expect(controller.select(0.1, 0, false)).toBe("Idle");
    expect(controller.select(0.13, 0, false)).toBe("Walk");
    expect(controller.select(0.08, 0, true)).toBe("CarryWalk");
    expect(controller.select(0.06, Math.PI, false)).toBe("TurnRight");
  });
});
