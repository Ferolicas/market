import * as THREE from "three";
import type { CharacterId } from "@/game/types";

export const HARVEST_BASKET_GRIP_HEIGHT = 0.18;
export const HARVEST_BASKET_GRIP_REACH = 0.24;
export const HARVEST_BASKET_GRIP_HALF_WIDTH = 0.25;

// Where a carried bar rests in each hand, in the Hand bone's local frame.
// Measured on the delivered Mixamo cast in the bind pose: vertices weighted to
// the Hand bone (the palm) span local Y 0–0.03 with the fingers continuing to
// Y ≈ 0.10, so the bar sits just past the palm centre towards the finger
// bases. The previous offsets (≈0.28 along −X) were calibrated on an older
// reconstruction and put the bar a forearm's length beyond the wrists.
export const CHARACTER_PALM_OFFSETS: Readonly<Record<CharacterId, { left: readonly [number, number, number]; right: readonly [number, number, number] }>> = Object.freeze({
  "adult-man": { left: [0.005, 0.04, 0.005], right: [-0.004, 0.04, 0.007] },
  "adult-woman": { left: [0.003, 0.038, 0.002], right: [0.007, 0.036, 0.001] },
  boy: { left: [0.001, 0.06, 0.001], right: [-0.001, 0.06, 0.001] },
  girl: { left: [0.003, 0.042, 0.003], right: [0.008, 0.042, 0.006] },
});

/** The authored hand mesh starts at the wrist bone and its visible palm lies
 * along the bone's local +Y axis. Bone.getWorldPosition() therefore measures
 * the wrist, not the place where a handle should touch the hand. */
export function handPalmPoint(hand: THREE.Object3D, palmOffset: readonly [number, number, number], target: THREE.Vector3) {
  target.fromArray(palmOffset);
  return hand.localToWorld(target);
}

const CARRY_LOCOMOTION_CLIPS = new Set(["CarryIdle", "CarryWalk"]);
// The clavicles belong to the frozen pose too: the walk cycle sways them,
// which moved both palms up to 5 cm per step and rocked the carried basket.
const CARRY_ARM_BONES = new Set(["Clavicle_L", "Rig_Arm_L", "Forearm_L", "Hand_L", "Clavicle_R", "Rig_Arm_R", "Forearm_R", "Hand_R"]);

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
/** The bar never shrinks below this half-length: hands closer together than
 * that simply hold it nearer its middle instead of at its ends. */
export const HARVEST_BASKET_BAR_MIN_HALF_LENGTH = 0.22;

export function updateHarvestBasketHandle(handle: THREE.Object3D, handleScale: number, scratch: CarrySocketScratch) {
  const halfWidth = HARVEST_BASKET_GRIP_HALF_WIDTH * handleScale;
  const barHalf = Math.max(halfWidth, HARVEST_BASKET_BAR_MIN_HALF_LENGTH);
  const leftGrip = scratch.segmentStart.set(-halfWidth, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH);
  const rightGrip = scratch.segmentEnd.set(halfWidth, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH);
  handle.getObjectByName("BasketGripLeft")?.position.copy(leftGrip);
  handle.getObjectByName("BasketGripRight")?.position.copy(rightGrip);
  placeCylinder(
    handle.getObjectByName("BasketGripBar"),
    scratch.segmentStart.set(-barHalf, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH),
    scratch.segmentEnd.set(barHalf, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH),
    scratch,
  );

  const leftStay = handle.getObjectByName("BasketHandleStayLeft");
  const rightStay = handle.getObjectByName("BasketHandleStayRight");
  placeCylinder(
    leftStay,
    scratch.segmentStart.set(-BASKET_HANDLE_ATTACHMENT_HALF_WIDTH, BASKET_HANDLE_ATTACHMENT_HEIGHT, -BASKET_HANDLE_ATTACHMENT_REACH),
    scratch.segmentEnd.set(-barHalf, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH),
    scratch,
  );
  placeCylinder(
    rightStay,
    scratch.segmentStart.set(BASKET_HANDLE_ATTACHMENT_HALF_WIDTH, BASKET_HANDLE_ATTACHMENT_HEIGHT, -BASKET_HANDLE_ATTACHMENT_REACH),
    scratch.segmentEnd.set(barHalf, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH),
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

/**
 * Two-handed hold sampled for every carry clip. Measured on the delivered
 * cast (grip points at Hand +0.04): CheckoutBag around 13.8 s holds both
 * hands 0.22 in front of the chest, level within 0.01 and 0.17–0.23 apart on
 * all four bodies, while CarryBox keeps one hand 0.12 higher than the other.
 * CarryBox stays as the fallback for packs without the checkout clip.
 */
export const CARRY_POSE_SOURCES: readonly { clip: string; time: number }[] = [
  { clip: "CheckoutBag", time: 13.8 },
  { clip: "CarryBox", time: 0.5 },
];

/** Builds carry locomotion with the real leg motion from CarryIdle/CarryWalk
 * and a stable two-handed upper-body pose sampled from the first available
 * CARRY_POSE_SOURCES clip. The source GLB leaves both carry locomotion hands
 * at the hips, so attaching an object to those bones alone still looks like
 * a floating prop. */
const composedCarryAnimations = new WeakMap<readonly THREE.AnimationClip[], THREE.AnimationClip[]>();
const composedRuntimeAliases = new WeakMap<readonly THREE.AnimationClip[], THREE.AnimationClip[]>();

/** Cached per loaded GLB: every body sharing the same source clips reuses one
 * composed set instead of rebuilding fifty clips on each spawn. */
export function composeCarryAnimations(animations: readonly THREE.AnimationClip[]) {
  const cached = composedCarryAnimations.get(animations);
  if (cached) return cached;
  const composed = buildCarryAnimations(animations);
  composedCarryAnimations.set(animations, composed);
  return composed;
}

function buildCarryAnimations(animations: readonly THREE.AnimationClip[]) {
  const runtimeAnimations = composeRuntimeAnimationAliases(animations);
  const source = CARRY_POSE_SOURCES
    .map((candidate) => ({ clip: runtimeAnimations.find((clip) => clip.name === candidate.clip), time: candidate.time }))
    .find((candidate): candidate is { clip: THREE.AnimationClip; time: number } => Boolean(candidate.clip));
  if (!source) return runtimeAnimations;
  const poseTime = Math.min(source.time, source.clip.duration);
  const armPoseTracks = source.clip.tracks.filter(isCarryArmTrack);
  const composed = runtimeAnimations.map((clip) => {
    if (!CARRY_LOCOMOTION_CLIPS.has(clip.name)) return clip;
    return new THREE.AnimationClip(clip.name, clip.duration, [
      ...clip.tracks.filter((track) => !isCarryArmTrack(track)),
      ...armPoseTracks.map((track) => constantTrackAt(track, poseTime, clip.duration)),
    ], clip.blendMode);
  });
  const run = runtimeAnimations.find((clip) => clip.name === "Run");
  if (run && !runtimeAnimations.some((clip) => clip.name === "CarryRun")) {
    composed.push(new THREE.AnimationClip("CarryRun", run.duration, [
      ...run.tracks.filter((track) => !isCarryArmTrack(track)),
      ...armPoseTracks.map((track) => constantTrackAt(track, poseTime, run.duration)),
    ], run.blendMode));
  }
  return composed;
}

const RUNTIME_ANIMATION_ALIASES = {
  TurnLeft: "Walk",
  TurnRight: "Walk",
  Phone: "Wait",
} as const;

/** Keeps the gameplay state machine compatible with the approved delivered
 * cast. The source pack has no dedicated stationary turns or phone gesture,
 * so those states reuse an existing delivered performance instead of falling
 * back to an unanimated pose. */
export function composeRuntimeAnimationAliases(animations: readonly THREE.AnimationClip[]) {
  const cached = composedRuntimeAliases.get(animations);
  if (cached) return cached;
  const composed = buildRuntimeAnimationAliases(animations);
  composedRuntimeAliases.set(animations, composed);
  return composed;
}

function buildRuntimeAnimationAliases(animations: readonly THREE.AnimationClip[]) {
  const composed = [...animations];
  const names = new Set(composed.map((clip) => clip.name));
  for (const [alias, sourceName] of Object.entries(RUNTIME_ANIMATION_ALIASES)) {
    if (names.has(alias)) continue;
    const source = composed.find((clip) => clip.name === sourceName);
    if (!source) continue;
    const clone = source.clone();
    clone.name = alias;
    composed.push(clone);
    names.add(alias);
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
 *
 * The basket keeps one posture: level, squarely facing the rig's +Z and
 * centred on the body axis. Its bar sits at the palms' height and reach, so
 * it rides the torso bob, while the small sideways swing of the hands as the
 * spine twists each step only slides them along the bar instead of rocking
 * or yawing the whole basket. With the arm chain frozen while carrying, the
 * palms are rigid to the torso and stay on the bar.
 */
export function placeCarrySocket(
  socket: THREE.Object3D,
  leftHand: THREE.Vector3,
  rightHand: THREE.Vector3,
  scratch: CarrySocketScratch,
) {
  const { midpoint, handSpan } = scratch;
  midpoint.copy(leftHand).add(rightHand).multiplyScalar(0.5);
  handSpan.copy(rightHand).sub(leftHand);
  const handDistance = handSpan.length();

  socket.quaternion.identity();
  socket.scale.set(1, 1, 1);
  socket.position.set(0, midpoint.y - HARVEST_BASKET_GRIP_HEIGHT, midpoint.z + HARVEST_BASKET_GRIP_REACH);
  return handDistance < 1e-5 ? 1 : handDistance / (HARVEST_BASKET_GRIP_HALF_WIDTH * 2);
}
