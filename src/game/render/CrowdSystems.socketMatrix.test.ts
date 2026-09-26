import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { socketMatrix } from "./CrowdSystems";
import type { CrowdAnimationSet } from "./CrowdSkinning";
import { CROWD_TEXELS_PER_BONE, type CrowdAnimationManifest } from "./CrowdAnimation";

/**
 * A one-bone rig with two baked rows: row 0 sits at x=0, row 1 at x=2. Every
 * `socketMatrix` caller reads its socket this way, so this fixture proves the
 * fade math against the exact bytes the renderer bakes, not a mock.
 */
function boneRow(tx: number) {
  // Column-major skin matrix, identity rotation/scale, translation (tx,0,0),
  // laid out the way `readCrowdBoneMatrix` expects: texel r holds row r.
  return [1, 0, 0, tx, 0, 1, 0, 0, 0, 0, 1, 0];
}

function makeAnimationSet(): CrowdAnimationSet {
  const width = CROWD_TEXELS_PER_BONE; // one bone
  const frames = 2;
  const values = [...boneRow(0), ...boneRow(2)];
  const data = new Uint16Array(values.length);
  values.forEach((value, index) => { data[index] = THREE.DataUtils.toHalfFloat(value); });
  const manifest = {
    body: "test", format: "half", fps: 15, width, frames, texelsPerBone: CROWD_TEXELS_PER_BONE,
    bones: ["Head"], clips: {}, joints: { Head: 0 },
    socketBind: { Head: new THREE.Matrix4().identity().toArray() },
  } as unknown as CrowdAnimationManifest;
  const texture = new THREE.DataTexture(data, width, frames);
  return { manifest, texture, data };
}

describe("socketMatrix cross-fade", () => {
  it("reads only the current clip's row when no fade is given (unchanged default for existing callers)", () => {
    const set = makeAnimationSet();
    const target = new THREE.Matrix4();
    socketMatrix(set, "Head", 0, target);
    expect(new THREE.Vector3().setFromMatrixPosition(target).x).toBeCloseTo(0);
    socketMatrix(set, "Head", 1, target);
    expect(new THREE.Vector3().setFromMatrixPosition(target).x).toBeCloseTo(2);
  });

  it("blends towards the fading-out clip's row exactly as the vertex shader's crowdPose() does", () => {
    const set = makeAnimationSet();
    const target = new THREE.Matrix4();
    // current = row 0 (x=0), previous (fading out) = row 1 (x=2), 50% blend
    // towards it: shader computes current + (previous - current) * blend.
    socketMatrix(set, "Head", 0, target, 1, 0.5);
    expect(new THREE.Vector3().setFromMatrixPosition(target).x).toBeCloseTo(1);
  });

  it("ignores the fade row once its weight is zero, matching the shader's blend<=0 fast path", () => {
    const set = makeAnimationSet();
    const target = new THREE.Matrix4();
    socketMatrix(set, "Head", 0, target, 1, 0);
    expect(new THREE.Vector3().setFromMatrixPosition(target).x).toBeCloseTo(0);
  });
});
