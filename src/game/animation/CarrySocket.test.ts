import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CHARACTER_PALM_OFFSETS, composeCarryAnimations, createCarrySocketScratch, handPalmPoint, HARVEST_BASKET_GRIP_HALF_WIDTH, HARVEST_BASKET_GRIP_HEIGHT, HARVEST_BASKET_GRIP_REACH, mountedHarvestBasketHandle, placeCarrySocket, updateHarvestBasketHandle } from "./CarrySocket";

describe("agarre de la cesta de cosecha", () => {
  it("calibrates a finite visible-palm socket for every selectable body", () => {
    expect(Object.keys(CHARACTER_PALM_OFFSETS).toSorted()).toEqual(["adult-man", "adult-woman", "boy", "girl"]);
    for (const { left, right } of Object.values(CHARACTER_PALM_OFFSETS)) {
      expect(left.every(Number.isFinite)).toBe(true);
      expect(right.every(Number.isFinite)).toBe(true);
      expect(left[0]).toBeLessThan(0);
      expect(right[0]).toBeGreaterThan(0);
    }
  });

  it("targets the visible palm instead of stopping at the wrist bone origin", () => {
    const hand = new THREE.Object3D();
    hand.position.set(0.2, 0.8, 0.4);
    hand.rotation.set(0.35, -0.2, 0.1);
    hand.updateMatrixWorld(true);

    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const offset = [-0.285, -0.003, 0.009] as const;
    const palm = handPalmPoint(hand, offset, new THREE.Vector3());

    expect(palm.distanceTo(wrist)).toBeCloseTo(Math.hypot(...offset), 5);
    expect(palm.toArray().every(Number.isFinite)).toBe(true);
  });

  it("articulates the handle between fixed rim mounts and both palm grips", () => {
    const handle = new THREE.Object3D();
    for (const name of ["BasketGripBar", "BasketHandleStayLeft", "BasketHandleStayRight", "BasketGripLeft", "BasketGripRight"]) {
      const part = new THREE.Object3D();
      part.name = name;
      handle.add(part);
    }

    updateHarvestBasketHandle(handle, 1.8, createCarrySocketScratch());
    handle.updateMatrixWorld(true);
    const leftGrip = handle.getObjectByName("BasketGripLeft")!.position;
    const rightGrip = handle.getObjectByName("BasketGripRight")!.position;
    const bar = handle.getObjectByName("BasketGripBar")!;
    const barA = bar.localToWorld(new THREE.Vector3(0, -0.5, 0));
    const barB = bar.localToWorld(new THREE.Vector3(0, 0.5, 0));

    expect(Math.min(barA.distanceTo(leftGrip), barB.distanceTo(leftGrip))).toBeLessThan(1e-6);
    expect(Math.min(barA.distanceTo(rightGrip), barB.distanceTo(rightGrip))).toBeLessThan(1e-6);
    expect(handle.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("rebinds the mounted handle after a full-empty-full carry cycle", () => {
    const socket = new THREE.Object3D();
    const firstBasket = new THREE.Object3D();
    const firstHandle = new THREE.Object3D();
    firstHandle.name = "HarvestBasketAdaptiveHandle";
    firstBasket.add(firstHandle);
    socket.add(firstBasket);

    expect(mountedHarvestBasketHandle(socket)).toBe(firstHandle);
    socket.remove(firstBasket);
    expect(firstHandle.parent).toBe(firstBasket);
    expect(mountedHarvestBasketHandle(socket)).toBeNull();

    const secondBasket = new THREE.Object3D();
    const secondHandle = new THREE.Object3D();
    secondHandle.name = "HarvestBasketAdaptiveHandle";
    secondBasket.add(secondHandle);
    socket.add(secondBasket);

    expect(mountedHarvestBasketHandle(socket)).toBe(secondHandle);
    expect(mountedHarvestBasketHandle(socket)).not.toBe(firstHandle);
  });

  it("keeps both rear grips on asymmetrical animated hands while the basket stays in front", () => {
    const socket = new THREE.Object3D();
    const left = new THREE.Vector3(-0.253, 0.554, -0.021);
    const right = new THREE.Vector3(0.249, 0.554, 0.092);

    const handleScale = placeCarrySocket(socket, left, right, createCarrySocketScratch());
    socket.updateMatrixWorld(true);

    const leftGrip = socket.localToWorld(new THREE.Vector3(-HARVEST_BASKET_GRIP_HALF_WIDTH * handleScale, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH));
    const rightGrip = socket.localToWorld(new THREE.Vector3(HARVEST_BASKET_GRIP_HALF_WIDTH * handleScale, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH));
    expect(leftGrip.distanceTo(left)).toBeLessThan(1e-6);
    expect(rightGrip.distanceTo(right)).toBeLessThan(1e-6);
    expect(socket.position.z).toBeGreaterThan(Math.max(left.z, right.z) + 0.15);
    expect(socket.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("keeps an undeformed basket aligned across a strongly three-dimensional hand span", () => {
    const socket = new THREE.Object3D();
    const left = new THREE.Vector3(-0.31, 0.48, -0.13);
    const right = new THREE.Vector3(0.22, 0.61, 0.19);

    const handleScale = placeCarrySocket(socket, left, right, createCarrySocketScratch());
    socket.updateMatrixWorld(true);
    const leftGrip = socket.localToWorld(new THREE.Vector3(-HARVEST_BASKET_GRIP_HALF_WIDTH * handleScale, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH));
    const rightGrip = socket.localToWorld(new THREE.Vector3(HARVEST_BASKET_GRIP_HALF_WIDTH * handleScale, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH));

    expect(leftGrip.distanceTo(left)).toBeLessThan(1e-6);
    expect(rightGrip.distanceTo(right)).toBeLessThan(1e-6);
    expect(socket.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("does not produce an invalid transform when both hands briefly share a point", () => {
    const socket = new THREE.Object3D();
    const hand = new THREE.Vector3(0, 0.6, 0.08);

    const handleScale = placeCarrySocket(socket, hand, hand, createCarrySocketScratch());

    expect(socket.position.toArray().every(Number.isFinite)).toBe(true);
    expect(socket.quaternion.toArray().every(Number.isFinite)).toBe(true);
    expect(socket.scale.toArray().every(Number.isFinite)).toBe(true);
    expect(handleScale).toBe(1);
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
    const run = new THREE.AnimationClip("Run", 0.74, [
      new THREE.NumberKeyframeTrack("Rig_Leg_R.rotation[x]", [0, 0.74], [-0.7, 0.7]),
      new THREE.NumberKeyframeTrack("Rig_Arm_L.rotation[x]", [0, 0.74], [0.8, -0.8]),
    ]);

    const composed = composeCarryAnimations([carryWalk, carryIdle, carryBox, walk, run]);
    const nextWalk = composed.find((clip) => clip.name === "CarryWalk")!;
    const nextIdle = composed.find((clip) => clip.name === "CarryIdle")!;
    const carryRun = composed.find((clip) => clip.name === "CarryRun")!;

    expect(nextWalk.tracks.find((track) => track.name === "Rig_Leg_L.rotation[x]")?.values).toEqual(carryWalk.tracks[0].values);
    expect(Array.from(nextWalk.tracks.find((track) => track.name === "Rig_Arm_L.rotation[x]")!.values)).toEqual([expect.closeTo(1.2), expect.closeTo(1.2)]);
    expect(Array.from(nextIdle.tracks.find((track) => track.name === "Forearm_R.rotation[x]")!.values)).toEqual([expect.closeTo(-0.8), expect.closeTo(-0.8)]);
    expect(carryRun.duration).toBe(run.duration);
    expect(carryRun.tracks.find((track) => track.name === "Rig_Leg_R.rotation[x]")?.values).toEqual(run.tracks[0].values);
    expect(Array.from(carryRun.tracks.find((track) => track.name === "Rig_Arm_L.rotation[x]")!.values)).toEqual([expect.closeTo(1.2), expect.closeTo(1.2)]);
    expect(composed.find((clip) => clip.name === "Walk")).toBe(walk);
    expect(composed.find((clip) => clip.name === "Run")).toBe(run);
  });
});
