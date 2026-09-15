import * as THREE from "three";
import { describe, expect, it } from "vitest";
import masks from "./avatar-hair-masks.json";
import { maskedHairGeometry } from "./AvatarHairMask";

describe("avatar hair face masks", () => {
  it("covers all four bodies at all three detail levels with disjoint ranges", () => {
    expect(Object.keys(masks)).toHaveLength(12);
    for (const mask of Object.values(masks)) {
      let end = 0;
      for (const [start, count] of mask.runs) {
        expect(start).toBeGreaterThanOrEqual(end);
        expect(count).toBeGreaterThan(0);
        end = start + count;
        expect(end).toBeLessThanOrEqual(mask.triangles);
      }
    }
  });
  it("never mutates the geometry used by approved hats, and reuses its cache", () => {
    const key = "characters/lod2/owner_girl.glb";
    const mask = masks[key];
    const original = new THREE.BufferGeometry();
    original.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(mask.triangles * 3).map((_, i) => i), 1));
    const index = original.getIndex();
    const result = maskedHairGeometry(original, `/models/market/${key}`);
    expect(result).not.toBe(original);
    expect(original.getIndex()).toBe(index);
    expect(index?.count).toBe(mask.triangles * 3);
    expect(result.getIndex()?.count).toBe((mask.triangles - mask.runs.reduce((n, [, count]) => n + count, 0)) * 3);
    expect(maskedHairGeometry(original, `/models/market/${key}`)).toBe(result);
  });
  it("refuses an obsolete mask when an asset has different topology", () => {
    const geometry = new THREE.BoxGeometry();
    expect(maskedHairGeometry(geometry, "/models/market/characters/owner_man.glb")).toBe(geometry);
  });
});
