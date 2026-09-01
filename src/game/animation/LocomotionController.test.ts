import { describe, expect, it } from "vitest";
import { AnimationClip, AnimationMixer, Object3D } from "three";
import { GAIT_FOOT_CONTACT_PHASES, LocomotionController } from "./LocomotionController";

describe("LocomotionController", () => {
  it("aplica histéresis, carga y giro sobre pies", () => {
    const controller = new LocomotionController();
    expect(controller.select(0.1, 0, false)).toBe("Idle");
    expect(controller.select(0.13, 0, false)).toBe("Walk");
    expect(controller.select(0.08, 0, true)).toBe("CarryWalk");
    expect(controller.select(0.06, Math.PI, false)).toBe("TurnRight");
  });

  it("conserva la fase del paso al pasar de marcha libre a carga", () => {
    const controller = new LocomotionController();
    const mixer = new AnimationMixer(new Object3D());
    const walk = mixer.clipAction(new AnimationClip("Walk", 1, []));
    const carryWalk = mixer.clipAction(new AnimationClip("CarryWalk", 2, []));
    const actions = { Walk: walk, CarryWalk: carryWalk };

    controller.transition(actions, "Walk", 1);
    walk.time = 0.42;
    controller.transition(actions, "CarryWalk", 1.1);

    expect(carryWalk.time / carryWalk.getClip().duration).toBeCloseTo(0.42);
    expect(carryWalk.isRunning()).toBe(true);
  });

  it("usa histéresis para no alternar entre marcha y carrera cerca del umbral", () => {
    const controller = new LocomotionController();
    expect(controller.select(3.2, 0, false)).toBe("Run");
    expect(controller.select(2.9, 0, false)).toBe("Run");
    expect(controller.select(2.7, 0, false)).toBe("Walk");
  });

  it("emite apoyos alternos y simétricos en la fase anatómica del paso", () => {
    const controller = new LocomotionController();
    const mixer = new AnimationMixer(new Object3D());
    const walk = mixer.clipAction(new AnimationClip("Walk", 1, []));
    controller.transition({ Walk: walk }, "Walk", 1);

    walk.time = 0.13;
    expect(controller.footEvents(walk)).toEqual(["LeftFootDown"]);
    walk.time = 0.63;
    expect(controller.footEvents(walk)).toEqual(["RightFootDown"]);
    walk.time = 0.13;
    expect(controller.footEvents(walk)).toEqual(["LeftFootDown"]);
    expect(GAIT_FOOT_CONTACT_PHASES.right - GAIT_FOOT_CONTACT_PHASES.left).toBe(0.5);
  });
});
