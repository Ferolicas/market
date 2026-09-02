import { describe, expect, it } from "vitest";
import { buildFundingQuote, LEVELS, stationTierModifiers } from "./levels";

describe("progression", () => {
  it("defines every level from 1 through 30", () => {
    expect(LEVELS).toHaveLength(30);
    expect(LEVELS.map((level) => level.level)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    expect(LEVELS[29].costMinor).toBe(7_500_000);
    expect(LEVELS.every((level) => Number.isSafeInteger(level.costMinor) && level.costMinor >= 0)).toBe(true);
    expect(LEVELS.slice(1).every((level, index) => level.costMinor > LEVELS[index].costMinor)).toBe(true);
  });

  it("separates money earned from money explicitly assigned to construction", () => {
    expect(buildFundingQuote(142_431, { costMinor: 14_000, contributedMinor: 6_500, completed: false })).toEqual({
      costMinor: 14_000,
      contributedMinor: 6_500,
      remainingMinor: 7_500,
      contributionMinor: 7_500,
      completed: false,
    });
    expect(buildFundingQuote(2_000, { costMinor: 14_000, contributedMinor: 6_500, completed: false }).contributionMinor).toBe(2_000);
  });

  it("calculates tier bonuses from base without accumulating floats", () => {
    expect(stationTierModifiers(1)).toEqual({ capacity: 1, speed: 1, value: 1 });
    expect(stationTierModifiers(10)).toEqual({ capacity: 2.2, speed: 1.7, value: 1.18 });
  });
});
