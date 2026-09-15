import { describe, expect, it } from "vitest";
import { animalMotion } from "./AnimalMotion";

describe("delivered animal motion", () => {
  for (const kind of ["chicken", "cow"] as const) {
    it(`${kind} stays inside its paddock with continuous translation`, () => {
      let previous = animalMotion(kind, 0, true);
      const clips = new Set<string>();
      for (let frame = 1; frame <= 44 * 60; frame++) {
        const current = animalMotion(kind, frame / 60, true);
        expect(Math.abs(current.x)).toBeLessThan(0.23);
        expect(Math.abs(current.x - previous.x)).toBeLessThanOrEqual(0.005);
        expect(current.yaw).toBeGreaterThanOrEqual(0);
        expect(current.yaw).toBeLessThanOrEqual(Math.PI);
        clips.add(current.clip);
        previous = current;
      }
      expect(clips).toEqual(new Set(["Idle", "Walk", kind === "cow" ? "Graze" : "Peck"]));
    });
    it(`${kind} keeps stride speed and does not feed without ingredients`, () => {
      expect(animalMotion(kind, 0.5, true).x).toBeCloseTo(animalMotion(kind, 0, true).x + animalMotion(kind, 0, true).speed * 0.5);
      expect(animalMotion(kind, 5, false).clip).toBe("Idle");
      expect(animalMotion(kind, 5, true)).toEqual(animalMotion(kind, 27, true));
    });
  }
});
