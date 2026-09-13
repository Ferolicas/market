import { describe, expect, it } from "vitest";
import {
  ADULT_CHARACTER_SCENE_SCALE,
  adultCustomerSceneScale,
  characterSceneScale,
  CHILD_CHARACTER_SCENE_SCALE,
} from "./CharacterScale";

describe("shared character scale", () => {
  it("keeps the currently approved child scale as the minimum", () => {
    expect(characterSceneScale("boy")).toBe(CHILD_CHARACTER_SCENE_SCALE);
    expect(characterSceneScale("girl")).toBe(CHILD_CHARACTER_SCENE_SCALE);
    expect(characterSceneScale("adult-man")).toBe(ADULT_CHARACTER_SCENE_SCALE);
    expect(characterSceneScale("adult-woman")).toBe(ADULT_CHARACTER_SCENE_SCALE);
    expect(CHILD_CHARACTER_SCENE_SCALE / ADULT_CHARACTER_SCENE_SCALE).toBeCloseTo(0.9);
  });

  it("preserves each customer model calibration while matching the adult cast", () => {
    expect(adultCustomerSceneScale(1.236) / adultCustomerSceneScale(1.226)).toBeCloseTo(1.236 / 1.226);
    expect(adultCustomerSceneScale(1.1)).toBeCloseTo(ADULT_CHARACTER_SCENE_SCALE);
  });
});
