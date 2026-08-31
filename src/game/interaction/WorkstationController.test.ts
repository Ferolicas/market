import { describe, expect, it } from "vitest";
import { WorkstationController } from "./WorkstationController";

describe("WorkstationController", () => {
  it("stops the held approach input until it returns to neutral", () => {
    const controller = new WorkstationController();
    controller.sync("farm", 1);

    expect(controller.updateInput(1)).toBe(true);
    expect(controller.snapshot()).toMatchObject({ zoneId: "farm", locked: true, waitingForNeutral: true });
    expect(controller.updateInput(0)).toBe(true);
    expect(controller.snapshot().waitingForNeutral).toBe(false);
  });

  it("uses a new deliberate input to leave without triggering more work", () => {
    const controller = new WorkstationController();
    controller.sync("shelf", 0);

    expect(controller.canPerform("shelf")).toBe(true);
    expect(controller.updateInput(0.7)).toBe(false);
    expect(controller.canPerform("shelf")).toBe(false);
    expect(controller.snapshot()).toMatchObject({ locked: false, cancelledUntilExit: true });
  });

  it("rearms only after leaving the previous rectangle", () => {
    const controller = new WorkstationController();
    controller.sync("farm", 0);
    controller.updateInput(1);
    controller.sync("farm", 0);
    expect(controller.canPerform("farm")).toBe(false);

    controller.sync(null, 0);
    controller.sync("farm", 0);
    expect(controller.canPerform("farm")).toBe(true);
  });
});
