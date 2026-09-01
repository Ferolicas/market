import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { composeCarryAnimations, HARVEST_BASKET_GRIP_HALF_WIDTH, HARVEST_BASKET_GRIP_HEIGHT, HARVEST_BASKET_GRIP_REACH, placeCarrySocket } from "./CarrySocket";

describe("agarre de la cesta de cosecha", () => {
  it("keeps both rear grips on asymmetrical animated hands while the basket stays in front", () => {
    const socket = new THREE.Object3D();
    const left = new THREE.Vector3(-0.253, 0.554, -0.021);
    const right = new THREE.Vector3(0.249, 0.554, 0.092);

    placeCarrySocket(socket, left, right, new THREE.Vector3(), new THREE.Vector3());
    socket.updateMatrixWorld(true);

    const leftGrip = socket.localToWorld(new THREE.Vector3(-HARVEST_BASKET_GRIP_HALF_WIDTH, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH));
    const rightGrip = socket.localToWorld(new THREE.Vector3(HARVEST_BASKET_GRIP_HALF_WIDTH, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH));
    expect(leftGrip.distanceTo(left)).toBeLessThan(0.002);
    expect(rightGrip.distanceTo(right)).toBeLessThan(0.002);
    expect(socket.position.z).toBeGreaterThan(Math.max(left.z, right.z) + 0.2);
  });

  it("does not produce an invalid transform when both hands briefly share a point", () => {
    const socket = new THREE.Object3D();
    const hand = new THREE.Vector3(0, 0.6, 0.08);

    placeCarrySocket(socket, hand, hand, new THREE.Vector3(), new THREE.Vector3());

    expect(socket.position.toArray().every(Number.isFinite)).toBe(true);
    expect(socket.rotation.toArray().slice(0, 3).every(Number.isFinite)).toBe(true);
    expect(socket.scale.toArray().every(Number.isFinite)).toBe(true);
  });

  it("combines carry leg motion with a stable two-handed arm pose", () => {
    const carryWalk = new THREE.AnimationClip("CarryWalk", 1, [
      new THREE.NumberKeyframeTrack("Rig_Leg_L.rotation[x]", [0, 1], [-0.4, 0.4]),
      new THREE.NumberKeyframeTrack("Rig_Arm_L.rotation[x]", [0, 1], [0, 0]),
    ]);
    const carryIdle = new THREE.AnimationClip("CarryIdle", 3, [
      new THREE.NumberKeyframeTrack("Rig_Arm_L.rotation[x]", [0, 3], [0, 0]),
    ]);
    const carryBox = new THREE.AnimationClip("CarryBox", 1, [
      new THREE.NumberKeyframeTrack("Rig_Arm_L.rotation[x]", [0, 0.5, 1], [0, 1.2, 0]),
      new THREE.NumberKeyframeTrack("Forearm_R.rotation[x]", [0, 0.5, 1], [0, -0.8, 0]),
    ]);
    const walk = new THREE.AnimationClip("Walk", 1, []);

    const composed = composeCarryAnimations([carryWalk, carryIdle, carryBox, walk]);
    const nextWalk = composed.find((clip) => clip.name === "CarryWalk")!;
    const nextIdle = composed.find((clip) => clip.name === "CarryIdle")!;

    expect(nextWalk.tracks.find((track) => track.name === "Rig_Leg_L.rotation[x]")?.values).toEqual(carryWalk.tracks[0].values);
    expect(Array.from(nextWalk.tracks.find((track) => track.name === "Rig_Arm_L.rotation[x]")!.values)).toEqual([expect.closeTo(1.2), expect.closeTo(1.2)]);
    expect(Array.from(nextIdle.tracks.find((track) => track.name === "Forearm_R.rotation[x]")!.values)).toEqual([expect.closeTo(-0.8), expect.closeTo(-0.8)]);
    expect(composed.find((clip) => clip.name === "Walk")).toBe(walk);
  });
});
