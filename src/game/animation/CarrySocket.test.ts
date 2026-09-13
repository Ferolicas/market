import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CHARACTER_PALM_OFFSETS, composeCarryAnimations, composeRuntimeAnimationAliases, createCarrySocketScratch, handPalmPoint, HARVEST_BASKET_GRIP_HALF_WIDTH, HARVEST_BASKET_GRIP_HEIGHT, HARVEST_BASKET_GRIP_REACH, mountedHarvestBasketHandle, placeCarrySocket, updateHarvestBasketHandle } from "./CarrySocket";

describe("agarre de la cesta de cosecha", () => {
  it("calibrates a finite visible-palm socket for every selectable body", () => {
    expect(Object.keys(CHARACTER_PALM_OFFSETS).toSorted()).toEqual(["adult-man", "adult-woman", "boy", "girl"]);
    for (const { left, right } of Object.values(CHARACTER_PALM_OFFSETS)) {
      expect(left.every(Number.isFinite)).toBe(true);
      expect(right.every(Number.isFinite)).toBe(true);
      // Inside the hand: the palm runs along the bone's +Y for about 0.03 and
      // the fingers reach 0.10, so a grip point lies between them.
      for (const offset of [left, right]) {
        expect(offset[1]).toBeGreaterThan(0.02);
        expect(offset[1]).toBeLessThan(0.08);
        expect(Math.hypot(offset[0], offset[2])).toBeLessThan(0.02);
      }
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

  it("puts the bar at the palms' height and reach with the basket centred, level and in front", () => {
    const socket = new THREE.Object3D();
    const left = new THREE.Vector3(-0.253, 0.554, -0.021);
    const right = new THREE.Vector3(0.249, 0.554, 0.092);

    const handleScale = placeCarrySocket(socket, left, right, createCarrySocketScratch());
    socket.updateMatrixWorld(true);

    const bar = socket.localToWorld(new THREE.Vector3(0, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH));
    expect(bar.x).toBeCloseTo(0, 6);
    expect(bar.y).toBeCloseTo(0.554, 6);
    expect(bar.z).toBeCloseTo((left.z + right.z) / 2, 6);
    expect(socket.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    expect(socket.position.z).toBeGreaterThan(Math.max(left.z, right.z) + 0.15);
    expect(handleScale).toBeCloseTo(left.distanceTo(right) / (HARVEST_BASKET_GRIP_HALF_WIDTH * 2), 6);
    expect(socket.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("faces the rig's front whichever hand comes first, so the basket never swings behind the body", () => {
    // The delivered rigs face +Z with Hand_L on +X; the avatar passes the left
    // palm first, which used to flip the basket through the torso.
    const socket = new THREE.Object3D();
    const leftPalm = new THREE.Vector3(0.166, 0.368, 0.195);
    const rightPalm = new THREE.Vector3(-0.06, 0.371, 0.233);

    placeCarrySocket(socket, leftPalm, rightPalm, createCarrySocketScratch());
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(socket.quaternion);
    expect(front.z).toBeGreaterThan(0.99);
    expect(socket.position.z).toBeGreaterThan(Math.max(leftPalm.z, rightPalm.z) + 0.15);
    const mirrored = new THREE.Object3D();
    placeCarrySocket(mirrored, rightPalm, leftPalm, createCarrySocketScratch());
    expect(mirrored.quaternion.angleTo(socket.quaternion)).toBeLessThan(1e-6);
    expect(mirrored.position.distanceTo(socket.position)).toBeLessThan(1e-6);
  });

  it("stays level and square however the hands twist, so the basket never rocks with the step", () => {
    const socket = new THREE.Object3D();
    const left = new THREE.Vector3(-0.31, 0.48, -0.13);
    const right = new THREE.Vector3(0.22, 0.61, 0.19);

    placeCarrySocket(socket, left, right, createCarrySocketScratch());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(socket.quaternion);
    const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(socket.quaternion);
    expect(up.y).toBeCloseTo(1, 6);
    expect(rightAxis.x).toBeCloseTo(1, 6);
    expect(socket.position.x).toBe(0);
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

  it("freezes the clavicles with the arms so the walk cannot sway the carried hands", () => {
    const carryWalk = new THREE.AnimationClip("CarryWalk", 1, [
      new THREE.NumberKeyframeTrack("Clavicle_L.rotation[x]", [0, 1], [-0.2, 0.2]),
      new THREE.NumberKeyframeTrack("Rig_Leg_L.rotation[x]", [0, 1], [-0.4, 0.4]),
    ]);
    const checkoutBag = new THREE.AnimationClip("CheckoutBag", 20, [
      new THREE.NumberKeyframeTrack("Clavicle_L.rotation[x]", [0, 13.8, 20], [0, 0.35, 0]),
      new THREE.NumberKeyframeTrack("Rig_Arm_L.rotation[x]", [0, 13.8, 20], [0, 0.9, 0]),
    ]);
    const carryBox = new THREE.AnimationClip("CarryBox", 1, [
      new THREE.NumberKeyframeTrack("Rig_Arm_L.rotation[x]", [0, 0.5, 1], [0, 1.2, 0]),
    ]);

    const composed = composeCarryAnimations([carryWalk, checkoutBag, carryBox]);
    const nextWalk = composed.find((clip) => clip.name === "CarryWalk")!;

    // CheckoutBag at 13.8 s wins over CarryBox, and the clavicle now follows it too.
    expect(Array.from(nextWalk.tracks.find((track) => track.name === "Clavicle_L.rotation[x]")!.values)).toEqual([expect.closeTo(0.35), expect.closeTo(0.35)]);
    expect(Array.from(nextWalk.tracks.find((track) => track.name === "Rig_Arm_L.rotation[x]")!.values)).toEqual([expect.closeTo(0.9), expect.closeTo(0.9)]);
    expect(nextWalk.tracks.find((track) => track.name === "Rig_Leg_L.rotation[x]")?.values).toEqual(carryWalk.tracks[1].values);
  });

  it("combines carry leg motion with a stable two-handed arm pose", () => {
    const carryWalk = new THREE.AnimationClip("CarryWalk", 1, [
      new THREE.NumberKeyframeTrack("Rig_Leg_L.rotation[x]", [0, 1], [-0.4, 0.4]),
      new THREE.NumberKeyframeTrack("Rig_Arm_L.rotation[x]", [0, 1], [0, 0]),
    ]);
    const carryIdle = new THREE.AnimationClip("CarryIdle", 3, [
      new THREE.NumberKeyframeTrack("Rig_Arm_L.rotation[x]", [0, 3], [0, 0]),
    ]);
    // No CheckoutBag in this pack: the composer falls back to CarryBox.
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

  it("fills only the gameplay names absent from the delivered animation pack", () => {
    const walk = new THREE.AnimationClip("Walk", 1, []);
    const wait = new THREE.AnimationClip("Wait", 2, []);
    const authoredTurn = new THREE.AnimationClip("TurnLeft", 0.7, []);

    const composed = composeRuntimeAnimationAliases([walk, wait, authoredTurn]);

    expect(composed.find((clip) => clip.name === "TurnLeft")).toBe(authoredTurn);
    expect(composed.find((clip) => clip.name === "TurnRight")?.duration).toBe(1);
    expect(composed.find((clip) => clip.name === "Phone")?.duration).toBe(2);
  });
});
