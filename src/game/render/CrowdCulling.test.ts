import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { crowdCharacterInView, updateCrowdFrustum } from "./CrowdCulling";

/** The game camera: orthographic, above and behind the owner, looking at them. */
function cameraOver(worldX: number, worldZ: number) {
  const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 200);
  camera.position.set(worldX + 8, 30, worldZ + 12);
  camera.lookAt(worldX, 0, worldZ);
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  camera.updateProjectionMatrix();
  return camera;
}

describe("crowd culling", () => {
  it("tests the character where the scaled crowd group puts it, not at its raw coordinates", () => {
    const group = new THREE.Group();
    group.scale.setScalar(3);
    group.updateMatrixWorld(true);
    // Owner and customer side by side at local (10, 10): world (30, 0, 30).
    updateCrowdFrustum(cameraOver(30, 30));
    expect(crowdCharacterInView(group, 10, 10)).toBe(true);
    expect(crowdCharacterInView(group, 10.6, 9.5)).toBe(true);
    // The raw local point (10, 10) lies 20 world units off screen; it must not count.
    expect(crowdCharacterInView(null, 10, 10)).toBe(false);
  });

  it("drops a character that is really off screen", () => {
    const group = new THREE.Group();
    group.scale.setScalar(3);
    group.updateMatrixWorld(true);
    updateCrowdFrustum(cameraOver(30, 30));
    expect(crowdCharacterInView(group, -10, -10)).toBe(false);
    expect(crowdCharacterInView(group, 10, 30)).toBe(false);
  });
});
