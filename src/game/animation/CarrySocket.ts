import * as THREE from "three";

export const HARVEST_BASKET_GRIP_HEIGHT = 0.14;
export const HARVEST_BASKET_GRIP_REACH = 0.3;
export const HARVEST_BASKET_GRIP_HALF_WIDTH = 0.25;

const CARRY_LOCOMOTION_CLIPS = new Set(["CarryIdle", "CarryWalk"]);
const CARRY_ARM_BONES = new Set(["Rig_Arm_L", "Forearm_L", "Hand_L", "Rig_Arm_R", "Forearm_R", "Hand_R"]);

/** Builds carry locomotion with the real leg motion from CarryIdle/CarryWalk
 * and a stable two-handed upper-body pose sampled from CarryBox. The source GLB
 * currently leaves both carry locomotion hands at the hips, so attaching an
 * object to those bones alone still looks like a floating prop. */
export function composeCarryAnimations(animations: readonly THREE.AnimationClip[]) {
  const carryPose = animations.find((clip) => clip.name === "CarryBox");
  if (!carryPose) return [...animations];
  const armPoseTracks = carryPose.tracks.filter(isCarryArmTrack);
  return animations.map((clip) => {
    if (!CARRY_LOCOMOTION_CLIPS.has(clip.name)) return clip;
    return new THREE.AnimationClip(clip.name, clip.duration, [
      ...clip.tracks.filter((track) => !isCarryArmTrack(track)),
      ...armPoseTracks.map((track) => constantTrackAt(track, 0.5, clip.duration)),
    ], clip.blendMode);
  });
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
 * Places the basket body in front of the torso while keeping the ends of its
 * two rear grips on the animated hands. Scratch vectors are owned per avatar so
 * the frame loop does not allocate or share mutable state between characters.
 */
export function placeCarrySocket(
  socket: THREE.Object3D,
  leftHand: THREE.Vector3,
  rightHand: THREE.Vector3,
  midpoint: THREE.Vector3,
  handSpan: THREE.Vector3,
) {
  midpoint.copy(leftHand).add(rightHand).multiplyScalar(0.5);
  handSpan.copy(rightHand).sub(leftHand);
  const horizontalSpan = Math.hypot(handSpan.x, handSpan.z);
  const yaw = Math.atan2(-handSpan.z, handSpan.x);
  midpoint.x += Math.sin(yaw) * HARVEST_BASKET_GRIP_REACH;
  midpoint.y -= HARVEST_BASKET_GRIP_HEIGHT;
  midpoint.z += Math.cos(yaw) * HARVEST_BASKET_GRIP_REACH;
  socket.position.copy(midpoint);
  socket.rotation.set(0, yaw, Math.atan2(handSpan.y, Math.max(0.001, horizontalSpan)));
  socket.scale.set(THREE.MathUtils.clamp(handSpan.length() / (HARVEST_BASKET_GRIP_HALF_WIDTH * 2), 0.72, 1.28), 1, 1);
}
