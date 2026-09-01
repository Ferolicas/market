import * as THREE from "three";
import type { CharacterId } from "@/game/types";

export const HARVEST_BASKET_GRIP_HEIGHT = 0.18;
export const HARVEST_BASKET_GRIP_REACH = 0.24;
export const HARVEST_BASKET_GRIP_HALF_WIDTH = 0.25;

// Measured on the four final reconstructed GLBs in their stable CarryBox pose.
// SkinTokens' predicted Hand nodes are inset from the actual palm geometry, so
// a generic wrist offset cannot produce visible contact on every body.
export const CHARACTER_PALM_OFFSETS: Readonly<Record<CharacterId, { left: readonly [number, number, number]; right: readonly [number, number, number] }>> = Object.freeze({
  "adult-man": { left: [-0.285, -0.003, 0.009], right: [0.278, -0.003, 0.009] },
  "adult-woman": { left: [-0.195, -0.023, 0.008], right: [0.189, -0.015, -0.007] },
  boy: { left: [-0.203, 0.004, 0.005], right: [0.199, 0.006, 0.005] },
  girl: { left: [-0.191, 0.025, -0.012], right: [0.187, 0.025, -0.015] },
});

/** The authored hand mesh starts at the wrist bone and its visible palm lies
 * along the bone's local +Y axis. Bone.getWorldPosition() therefore measures
 * the wrist, not the place where a handle should touch the hand. */
export function handPalmPoint(hand: THREE.Object3D, palmOffset: readonly [number, number, number], target: THREE.Vector3) {
  target.fromArray(palmOffset);
  return hand.localToWorld(target);
}

const CARRY_LOCOMOTION_CLIPS = new Set(["CarryIdle", "CarryWalk"]);
const CARRY_ARM_BONES = new Set(["Rig_Arm_L", "Forearm_L", "Hand_L", "Rig_Arm_R", "Forearm_R", "Hand_R"]);

export interface CarrySocketScratch {
  midpoint: THREE.Vector3;
  handSpan: THREE.Vector3;
  rightAxis: THREE.Vector3;
  upAxis: THREE.Vector3;
  forwardAxis: THREE.Vector3;
  gripOffset: THREE.Vector3;
  segmentStart: THREE.Vector3;
  segmentEnd: THREE.Vector3;
  segmentMidpoint: THREE.Vector3;
  segmentDirection: THREE.Vector3;
  segmentRotation: THREE.Quaternion;
  basis: THREE.Matrix4;
}

export function createCarrySocketScratch(): CarrySocketScratch {
  return {
    midpoint: new THREE.Vector3(),
    handSpan: new THREE.Vector3(),
    rightAxis: new THREE.Vector3(),
    upAxis: new THREE.Vector3(),
    forwardAxis: new THREE.Vector3(),
    gripOffset: new THREE.Vector3(),
    segmentStart: new THREE.Vector3(),
    segmentEnd: new THREE.Vector3(),
    segmentMidpoint: new THREE.Vector3(),
    segmentDirection: new THREE.Vector3(),
    segmentRotation: new THREE.Quaternion(),
    basis: new THREE.Matrix4(),
  };
}

/** Resolves only a handle that is currently mounted below this socket. A
 * previously detached basket keeps its own internal parent links, so checking
 * the cached handle's `parent` cannot distinguish it from the new instance. */
export function mountedHarvestBasketHandle(socket: THREE.Object3D) {
  return socket.getObjectByName("HarvestBasketAdaptiveHandle") ?? null;
}

const CYLINDER_UP = new THREE.Vector3(0, 1, 0);
const BASKET_HANDLE_ATTACHMENT_HALF_WIDTH = 0.27;
const BASKET_HANDLE_ATTACHMENT_HEIGHT = 0.13;
const BASKET_HANDLE_ATTACHMENT_REACH = 0.13;

/** Articulates only the handle around a rigid basket body. Its rear bar follows
 * the palm span, while two diagonal stays remain visibly connected to the
 * basket rim instead of stretching the container itself. */
export function updateHarvestBasketHandle(handle: THREE.Object3D, handleScale: number, scratch: CarrySocketScratch) {
  const halfWidth = HARVEST_BASKET_GRIP_HALF_WIDTH * handleScale;
  const leftGrip = scratch.segmentStart.set(-halfWidth, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH);
  const rightGrip = scratch.segmentEnd.set(halfWidth, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH);
  placeCylinder(handle.getObjectByName("BasketGripBar"), leftGrip, rightGrip, scratch);
  handle.getObjectByName("BasketGripLeft")?.position.copy(leftGrip);
  handle.getObjectByName("BasketGripRight")?.position.copy(rightGrip);

  const leftStay = handle.getObjectByName("BasketHandleStayLeft");
  const rightStay = handle.getObjectByName("BasketHandleStayRight");
  placeCylinder(
    leftStay,
    scratch.segmentStart.set(-BASKET_HANDLE_ATTACHMENT_HALF_WIDTH, BASKET_HANDLE_ATTACHMENT_HEIGHT, -BASKET_HANDLE_ATTACHMENT_REACH),
    scratch.segmentEnd.set(-halfWidth, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH),
    scratch,
  );
  placeCylinder(
    rightStay,
    scratch.segmentStart.set(BASKET_HANDLE_ATTACHMENT_HALF_WIDTH, BASKET_HANDLE_ATTACHMENT_HEIGHT, -BASKET_HANDLE_ATTACHMENT_REACH),
    scratch.segmentEnd.set(halfWidth, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH),
    scratch,
  );
}

function placeCylinder(object: THREE.Object3D | undefined, start: THREE.Vector3, end: THREE.Vector3, scratch: CarrySocketScratch) {
  if (!object) return;
  const length = scratch.segmentDirection.copy(end).sub(start).length();
  scratch.segmentMidpoint.copy(start).add(end).multiplyScalar(0.5);
  object.position.copy(scratch.segmentMidpoint);
  if (length > 1e-5) {
    scratch.segmentDirection.multiplyScalar(1 / length);
    scratch.segmentRotation.setFromUnitVectors(CYLINDER_UP, scratch.segmentDirection);
    object.quaternion.copy(scratch.segmentRotation);
  }
  object.scale.set(1, Math.max(1e-5, length), 1);
}

/** Builds carry locomotion with the real leg motion from CarryIdle/CarryWalk
 * and a stable two-handed upper-body pose sampled from CarryBox. The source GLB
 * currently leaves both carry locomotion hands at the hips, so attaching an
 * object to those bones alone still looks like a floating prop. */
export function composeCarryAnimations(animations: readonly THREE.AnimationClip[]) {
  const carryPose = animations.find((clip) => clip.name === "CarryBox");
  if (!carryPose) return [...animations];
  const armPoseTracks = carryPose.tracks.filter(isCarryArmTrack);
  const composed = animations.map((clip) => {
    if (!CARRY_LOCOMOTION_CLIPS.has(clip.name)) return clip;
    return new THREE.AnimationClip(clip.name, clip.duration, [
      ...clip.tracks.filter((track) => !isCarryArmTrack(track)),
      ...armPoseTracks.map((track) => constantTrackAt(track, 0.5, clip.duration)),
    ], clip.blendMode);
  });
  const run = animations.find((clip) => clip.name === "Run");
  if (run && !animations.some((clip) => clip.name === "CarryRun")) {
    composed.push(new THREE.AnimationClip("CarryRun", run.duration, [
      ...run.tracks.filter((track) => !isCarryArmTrack(track)),
      ...armPoseTracks.map((track) => constantTrackAt(track, 0.5, run.duration)),
    ], run.blendMode));
  }
  return composed;
}

function isCarryArmTrack(track: THREE.KeyframeTrack) {
  const target = track.name.slice(0, track.name.lastIndexOf("."));
  return CARRY_ARM_BONES.has(target);
}

function constantTrackAt(track: THREE.KeyframeTrack, time: number, duration: number) {
  const sampled = sampleTrack(track, time);
  const clone = track.clone();
  clone.times = new Float32Array([0, duration]);
  clone.values = new Float32Array([...sampled, ...sampled]);
  return clone;
}

function sampleTrack(track: THREE.KeyframeTrack, time: number) {
  const size = track.getValueSize();
  const times = track.times;
  let left = 0;
  while (left < times.length - 2 && times[left + 1] <= time) left += 1;
  const right = Math.min(left + 1, times.length - 1);
  const span = times[right] - times[left];
  const alpha = span > 0 ? THREE.MathUtils.clamp((time - times[left]) / span, 0, 1) : 0;
  if (track instanceof THREE.QuaternionKeyframeTrack) {
    const quaternion = new THREE.Quaternion().fromArray(track.values, left * size);
    quaternion.slerp(new THREE.Quaternion().fromArray(track.values, right * size), alpha);
    return quaternion.toArray();
  }
  return Array.from({ length: size }, (_, component) => THREE.MathUtils.lerp(
    track.values[left * size + component],
    track.values[right * size + component],
    alpha,
  ));
}

/**
 * Rigidly places the basket in front of the torso and returns the independent
 * handle-width scale needed to put both grip ends on the animated palms. The
 * basket body itself is never scaled or deformed. Scratch values are owned per
 * avatar so the frame loop does not allocate or share mutable state.
 */
export function placeCarrySocket(
  socket: THREE.Object3D,
  leftHand: THREE.Vector3,
  rightHand: THREE.Vector3,
  scratch: CarrySocketScratch,
) {
  const { midpoint, handSpan, rightAxis, upAxis, forwardAxis, gripOffset, basis } = scratch;
  midpoint.copy(leftHand).add(rightHand).multiplyScalar(0.5);
  handSpan.copy(rightHand).sub(leftHand);
  const handDistance = handSpan.length();
  rightAxis.copy(handSpan);
  if (handDistance < 1e-5) rightAxis.set(1, 0, 0);
  else rightAxis.multiplyScalar(1 / handDistance);

  // Preserve the character's local +Z as the front of the basket, projected
  // perpendicular to the live line between the palms. This produces a proper
  // orthonormal basis even when one hand is higher or farther forward.
  forwardAxis.set(0, 0, 1).addScaledVector(rightAxis, -rightAxis.z);
  if (forwardAxis.lengthSq() < 1e-5) {
    forwardAxis.set(1, 0, 0).addScaledVector(rightAxis, -rightAxis.x);
  }
  forwardAxis.normalize();
  upAxis.crossVectors(forwardAxis, rightAxis).normalize();
  if (upAxis.y < 0) {
    forwardAxis.multiplyScalar(-1);
    upAxis.multiplyScalar(-1);
  }

  basis.makeBasis(rightAxis, upAxis, forwardAxis);
  socket.quaternion.setFromRotationMatrix(basis);
  socket.scale.set(1, 1, 1);
  gripOffset.set(0, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH).applyQuaternion(socket.quaternion);
  socket.position.copy(midpoint).sub(gripOffset);
  return handDistance < 1e-5 ? 1 : handDistance / (HARVEST_BASKET_GRIP_HALF_WIDTH * 2);
}
