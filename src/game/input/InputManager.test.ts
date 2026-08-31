import { describe, expect, it } from "vitest";
import { DragJoystick } from "./DragJoystick";
import { InputManager, radialInput, strongestInput } from "./InputManager";

describe("universal input", () => {
  it("applies the specified radial deadzone and magnitude", () => {
    expect(radialInput(4, 0, 80, 8).magnitude).toBe(0);
    expect(radialInput(44, 0, 80, 8)).toMatchObject({ x: 1, y: 0, magnitude: 0.5 });
    expect(radialInput(200, 0, 80, 8).magnitude).toBe(1);
  });

  it("chooses the strongest source instead of adding inputs", () => {
    const chosen = strongestInput([{ x: 1, y: 0, magnitude: 0.3 }, { x: 0, y: 1, magnitude: 0.8 }]);
    expect(chosen).toEqual({ x: 0, y: 1, magnitude: 0.8 });
    const manager = new InputManager();
    manager.setKeyboard(1, 0);
    manager.setPointer({ x: 0, y: 1, magnitude: 0.5 });
    expect(manager.sample()).toMatchObject({ x: 1, y: 0, magnitude: 1 });
  });

  it("keeps the first pointer and clamps only the visual thumb", () => {
    const drag = new DragJoystick();
    expect(drag.begin(3, 100, 120, 800, 600)).toBe(true);
    expect(drag.begin(4, 200, 220, 800, 600)).toBe(false);
    const sample = drag.move(3, 500, 120)!;
    expect(sample.input.magnitude).toBe(1);
    expect(sample.thumbX).toBe(drag.visualRadius);
    expect(drag.end(4)).toBe(false);
    expect(drag.end(3)).toBe(true);
  });
});
