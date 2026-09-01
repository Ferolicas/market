import { describe, expect, it } from "vitest";
import { cropVisualSlotIndices } from "./crop-visual";

describe("cropVisualSlotIndices", () => {
  it("reduces a tier-ten bed deterministically from 7 to 2 to 0 remaining units", () => {
    const full = cropVisualSlotIndices(7, 7, 28);
    const partial = cropVisualSlotIndices(2, 7, 28);
    const empty = cropVisualSlotIndices(0, 7, 28);

    expect(full).toEqual(Array.from({ length: 28 }, (_, index) => index));
    expect(partial).toEqual([1, 5, 8, 12, 15, 19, 22, 26]);
    expect(cropVisualSlotIndices(2, 7, 28)).toEqual(partial);
    expect(empty).toEqual([]);
  });

  it("clamps malformed and over-capacity snapshots without duplicate slots", () => {
    expect(cropVisualSlotIndices(Number.NaN, 7, 28)).toEqual([]);
    expect(cropVisualSlotIndices(-2, 7, 28)).toEqual([]);
    expect(cropVisualSlotIndices(9, 7, 4)).toEqual([0, 1, 2, 3]);
  });
});
