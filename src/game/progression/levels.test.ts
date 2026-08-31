import { describe, expect, it } from "vitest";
import { LEVELS, stationTierModifiers } from "./levels";

describe("progression", () => {
  it("defines every level from 1 through 30", () => {
    expect(LEVELS).toHaveLength(30);
    expect(LEVELS.map((level) => level.level)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    expect(LEVELS[29].costMinor).toBe(7_500_000);
  });

  it("calculates tier bonuses from base without accumulating floats", () => {
    expect(stationTierModifiers(1)).toEqual({ capacity: 1, speed: 1, value: 1 });
    expect(stationTierModifiers(10)).toEqual({ capacity: 2.2, speed: 1.7, value: 1.18 });
  });
});
