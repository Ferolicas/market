import { describe, expect, it } from "vitest";
import { STOREFRONT_LAYOUT, storefrontDoorClearWidth, storefrontDoorLeafCenter, storefrontDoorProgress } from "./storefront-layout";

describe("storefront layout", () => {
  it("uses double-height leaves and clears the complete framed opening", () => {
    const { door } = STOREFRONT_LAYOUT;

    expect(door.leafHeight).toBe(5.4);
    expect(storefrontDoorLeafCenter(-1, 0)).toBe(-door.closedCenterOffset);
    expect(storefrontDoorLeafCenter(1, 1)).toBe(door.closedCenterOffset + door.openTravel);
    expect(storefrontDoorClearWidth(1)).toBeGreaterThanOrEqual(door.outerPostX * 2);
  });

  it("clamps incomplete or invalid animation progress before placing colliders", () => {
    expect(storefrontDoorProgress(-1)).toBe(0);
    expect(storefrontDoorProgress(2)).toBe(1);
    expect(storefrontDoorProgress(Number.NaN)).toBe(0);
  });
});
