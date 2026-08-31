import { describe, expect, it } from "vitest";
import { overlapsStoreObstacle, scaleStorePoint, scaleStorePosition, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE, WORLD_SCALE } from "./world-scale";

describe("store scale system", () => {
  it("expands the layout without changing vertical placement", () => {
    expect(scaleStorePosition([3, 1.25, -4])).toEqual([6, 1.25, -8]);
    expect(scaleStorePoint([-2, 5])).toEqual([-4, 10]);
  });

  it("keeps character, layout and element scales independent", () => {
    expect(WORLD_SCALE).toBe(3);
    expect(STORE_LAYOUT_SCALE).toBe(2);
    expect(STORE_ELEMENT_SCALE).toBe(1.6);
  });

  it("detects enlarged furniture footprints", () => {
    expect(overlapsStoreObstacle(scaleStorePoint([0, -2.2]), 0.4)).toBe(true);
    expect(overlapsStoreObstacle(scaleStorePoint([2.2, 0.45]), 0.4)).toBe(false);
  });
});
