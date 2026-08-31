import { describe, expect, it } from "vitest";
import { FacialController } from "./FacialController";

describe("FacialController", () => {
  it("compone expresiones y parpadeos deterministas", () => {
    const a = new FacialController(4).weights(3.2, "Confused");
    const b = new FacialController(4).weights(3.2, "Confused");
    expect(a).toEqual(b);
    expect(a.MouthNarrow).toBe(0.25);
  });
});
