// Bakes every crowd clip of each body into a bone-matrix texture, so the
// crowd renderer can skin a whole crowd in the vertex shader from one texture
// per body instead of running an AnimationMixer per character on the main
// thread. Derived from the delivered GLBs, never edits them.
//
//   node --import tsx scripts/build-crowd-animations.mts [bodyKey ...]
//
// Output, per body, in public/models/market/crowd/:
//   <body>.anim.bin   half-float rows: frame → bone*3 texels of RGBA (3×4
//                     matrix rows), width padded to CROWD_TEXTURE_WIDTH texels;
//                     clips with identical frames share rows
//   <body>.anim.json  manifest: fps, width, frames, bones, clips, joints
//
// The matrix per bone is boneWorld × inverseBind in rig-root space, i.e. the
// same skin matrix three.js computes in Skeleton.update(); the mesh node sits
// at the identity under the rig root in every delivered body.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeIO, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import * as THREE from "three";
import { createHash } from "node:crypto";
import { composeCarryAnimations } from "../src/game/animation/CarrySocket";
import { CROWD_CLIP_NAMES, CROWD_FPS, CROWD_TEXELS_PER_BONE, CROWD_TEXTURE_WIDTH, crowdAnimationPaths, type CrowdAnimationManifest } from "../src/game/render/CrowdAnimation";

const root = process.cwd();
const modelRoot = join(root, "public", "models", "market");
const BODIES: Record<string, string> = {
  customer_01_man_young: "customers/lod1/customer_01_man_young.glb",
  customer_02_man_senior: "customers/lod1/customer_02_man_senior.glb",
  customer_03_woman_young: "customers/lod1/customer_03_woman_young.glb",
  customer_04_woman_adult: "customers/lod1/customer_04_woman_adult.glb",
  customer_05_woman_mature: "customers/lod1/customer_05_woman_mature.glb",
  customer_06_woman_senior: "customers/lod1/customer_06_woman_senior.glb",
  // Employees wear the two adult owner bodies; the owner keeps the full rig.
  owner_man: "characters/lod1/owner_man.glb",
  owner_woman: "characters/lod1/owner_woman.glb",
};

function accessorValues(accessor: { getCount(): number; getElement(index: number, target: number[]): number[] }) {
  const values: number[] = [];
  for (let index = 0; index < accessor.getCount(); index += 1) values.push(...accessor.getElement(index, []));
  return values;
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const requested = new Set(process.argv.slice(2));
await mkdir(join(modelRoot, "crowd"), { recursive: true });
const summary: Record<string, unknown>[] = [];

for (const [bodyKey, relative] of Object.entries(BODIES)) {
  if (requested.size && !requested.has(bodyKey)) continue;
  const document = await io.read(join(modelRoot, relative));
  const gltfRoot = document.getRoot();
  const skin = gltfRoot.listSkins()[0];
  if (!skin) throw new Error(`${bodyKey}: no skin`);
  const joints = skin.listJoints();
  const inverseBind = skin.getInverseBindMatrices();
  if (!inverseBind) throw new Error(`${bodyKey}: no inverse bind matrices`);

  // Mirror the node tree in three.js so the very same AnimationMixer and the
  // same runtime clip composition drive the bake.
  const objects = new Map<GltfNode, THREE.Object3D>();
  const build = (node: GltfNode): THREE.Object3D => {
    const object = joints.includes(node) ? new THREE.Bone() : new THREE.Object3D();
    object.name = THREE.PropertyBinding.sanitizeNodeName(node.getName());
    object.position.fromArray(node.getTranslation());
    object.quaternion.fromArray(node.getRotation());
    object.scale.fromArray(node.getScale());
    for (const child of node.listChildren()) object.add(build(child));
    objects.set(node, object);
    return object;
  };
  const scene = new THREE.Group();
  for (const node of gltfRoot.listScenes()[0].listChildren()) scene.add(build(node));

  const clips = gltfRoot.listAnimations().map((animation) => {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode();
      const sampler = channel.getSampler();
      if (!target || !sampler) continue;
      const path = channel.getTargetPath();
      // Read through the accessor, never the raw array: the LOD files keep
      // rotations (and some vectors) quantised to normalised integers.
      const times = accessorValues(sampler.getInput()!);
      const values = accessorValues(sampler.getOutput()!);
      const name = THREE.PropertyBinding.sanitizeNodeName(target.getName());
      const interpolation = sampler.getInterpolation() === "STEP" ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
      if (path === "rotation") tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values, interpolation));
      else if (path === "translation") tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, times, values, interpolation));
      else if (path === "scale") tracks.push(new THREE.VectorKeyframeTrack(`${name}.scale`, times, values, interpolation));
    }
    return new THREE.AnimationClip(animation.getName(), -1, tracks);
  });
  const composed = composeCarryAnimations(clips);
  const byName = new Map(composed.map((clip) => [clip.name, clip]));
  const selected = CROWD_CLIP_NAMES.filter((name) => byName.has(name));
  const missing = CROWD_CLIP_NAMES.filter((name) => !byName.has(name));

  const boneObjects = joints.map((joint) => objects.get(joint)!);
  const inverses = joints.map((_, index) => new THREE.Matrix4().fromArray(inverseBind.getElement(index, [])));
  const width = Math.ceil(joints.length * CROWD_TEXELS_PER_BONE / 4) * 4;
  if (width > CROWD_TEXTURE_WIDTH) throw new Error(`${bodyKey}: ${joints.length} bones do not fit ${CROWD_TEXTURE_WIDTH} texels`);
  const rows: Float32Array[] = [];
  const sharedRows = new Map<string, { start: number; frames: number }>();
  const manifest: CrowdAnimationManifest = {
    body: bodyKey, format: "half", fps: CROWD_FPS, width, frames: 0, texelsPerBone: CROWD_TEXELS_PER_BONE,
    bones: boneObjects.map((bone) => bone.name), clips: {}, joints: {}, socketBind: {},
  };
  for (const key of ["Head", "Hand_L", "Hand_R", "Hips"] as const) {
    const index = manifest.bones.indexOf(key);
    if (index < 0) continue;
    manifest.joints[key] = index;
    manifest.socketBind[key] = Array.from(new THREE.Matrix4().fromArray(inverseBind.getElement(index, [])).invert().toArray());
  }

  const mixer = new THREE.AnimationMixer(scene);
  const skinMatrix = new THREE.Matrix4();
  let shared = 0;
  for (const name of selected) {
    const clip = byName.get(name)!;
    const frames = Math.ceil(clip.duration * CROWD_FPS) + 1;
    const action = mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY).setEffectiveWeight(1).play();
    const clipRows = new Float32Array(frames * width * 4);
    for (let frame = 0; frame < frames; frame += 1) {
      mixer.setTime(Math.min(clip.duration, frame / CROWD_FPS));
      scene.updateMatrixWorld(true);
      for (let bone = 0; bone < boneObjects.length; bone += 1) {
        skinMatrix.multiplyMatrices(boneObjects[bone].matrixWorld, inverses[bone]);
        const e = skinMatrix.elements;
        const base = (frame * width + bone * CROWD_TEXELS_PER_BONE) * 4;
        // Row-major 3×4: texel r holds row r of the matrix (column-major elements).
        clipRows[base + 0] = e[0]; clipRows[base + 1] = e[4]; clipRows[base + 2] = e[8]; clipRows[base + 3] = e[12];
        clipRows[base + 4] = e[1]; clipRows[base + 5] = e[5]; clipRows[base + 6] = e[9]; clipRows[base + 7] = e[13];
        clipRows[base + 8] = e[2]; clipRows[base + 9] = e[6]; clipRows[base + 10] = e[10]; clipRows[base + 11] = e[14];
      }
    }
    action.stop();
    mixer.uncacheClip(clip);
    // The delivered pack repeats one performance under several names (the
    // checkout gestures, the idle variants): identical frames share rows.
    const digest = createHash("sha1").update(Buffer.from(clipRows.buffer)).digest("hex");
    const existing = sharedRows.get(digest);
    if (existing) {
      manifest.clips[name] = { start: existing.start, frames: existing.frames, duration: clip.duration };
      shared += 1;
      continue;
    }
    const start = rows.reduce((sum, block) => sum + block.length / (width * 4), 0);
    sharedRows.set(digest, { start, frames });
    manifest.clips[name] = { start, frames, duration: clip.duration };
    rows.push(clipRows);
  }
  manifest.frames = rows.reduce((sum, block) => sum + block.length / (width * 4), 0);
  const half = new Uint16Array(manifest.frames * width * 4);
  let offset = 0;
  for (const block of rows) {
    for (let index = 0; index < block.length; index += 1) half[offset + index] = THREE.DataUtils.toHalfFloat(block[index]);
    offset += block.length;
  }

  const paths = crowdAnimationPaths(bodyKey);
  await writeFile(join(root, "public", paths.data), Buffer.from(half.buffer));
  await writeFile(join(root, "public", paths.manifest), JSON.stringify(manifest));
  summary.push({ body: bodyKey, bones: joints.length, clips: selected.length, shared, missing, frames: manifest.frames, bytes: half.byteLength });
}

console.log(JSON.stringify({ generated: summary.length, summary }, null, 2));
