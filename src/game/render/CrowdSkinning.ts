import * as THREE from "three";
import { CROWD_TEXELS_PER_BONE, crowdAnimationPaths, type CrowdAnimationManifest } from "./CrowdAnimation";

/**
 * Baked crowd animation on the GPU side: one half-float texture per body
 * holding every clip's skin matrices, a material that skins an InstancedMesh
 * from it, and a CPU reader for the few bones props hang from.
 */
export interface CrowdAnimationSet {
  manifest: CrowdAnimationManifest;
  texture: THREE.DataTexture;
  /** Raw half floats, kept for socket reads on the CPU. */
  data: Uint16Array;
}

const sets = new Map<string, Promise<CrowdAnimationSet>>();

export function loadCrowdAnimation(bodyKey: string): Promise<CrowdAnimationSet> {
  const cached = sets.get(bodyKey);
  if (cached) return cached;
  const paths = crowdAnimationPaths(bodyKey);
  const loading = Promise.all([
    fetch(paths.manifest).then((response) => { if (!response.ok) throw new Error(`crowd manifest ${bodyKey}: ${response.status}`); return response.json() as Promise<CrowdAnimationManifest>; }),
    fetch(paths.data).then((response) => { if (!response.ok) throw new Error(`crowd data ${bodyKey}: ${response.status}`); return response.arrayBuffer(); }),
  ]).then(([manifest, buffer]) => {
    const data = new Uint16Array(buffer);
    const texture = new THREE.DataTexture(data, manifest.width, manifest.frames, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return { manifest, texture, data };
  });
  sets.set(bodyKey, loading);
  loading.catch(() => sets.delete(bodyKey));
  return loading;
}

/** Reads one bone's skin matrix at a fractional row, blending the two rows
 * the shader would blend, into `target`. */
export function readCrowdBoneMatrix(set: CrowdAnimationSet, boneIndex: number, row: number, target: THREE.Matrix4) {
  const { width, frames } = set.manifest;
  const row0 = Math.min(frames - 1, Math.max(0, Math.floor(row)));
  const row1 = Math.min(frames - 1, row0 + 1);
  const t = Math.min(1, Math.max(0, row - row0));
  const base0 = (row0 * width + boneIndex * CROWD_TEXELS_PER_BONE) * 4;
  const base1 = (row1 * width + boneIndex * CROWD_TEXELS_PER_BONE) * 4;
  const e = target.elements;
  // Texel r holds matrix row r: elements[r + 4c] = texel r, component c.
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const a = THREE.DataUtils.fromHalfFloat(set.data[base0 + r * 4 + c]);
      const b = THREE.DataUtils.fromHalfFloat(set.data[base1 + r * 4 + c]);
      e[r + 4 * c] = a + (b - a) * t;
    }
  }
  e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
  return target;
}

/** Bone index of a named joint, or -1. */
export function crowdBoneIndex(set: CrowdAnimationSet, name: keyof CrowdAnimationManifest["joints"]) {
  return set.manifest.joints[name] ?? -1;
}

export const CROWD_INSTANCE_ATTRIBUTE = "aCrowdPose";

/**
 * Turns a body material into one that skins InstancedMesh vertices from the
 * baked texture. Per instance the geometry carries `aCrowdPose` (row A, row B,
 * blend of B); per vertex the glTF skinIndex/skinWeight. The blend happens on
 * matrices, which is what a mixer cross-fade converges to at these fade
 * lengths.
 */
export function createCrowdMaterial(source: THREE.MeshStandardMaterial, set: CrowdAnimationSet) {
  const material = source.clone();
  const { width, frames } = set.manifest;
  const texelsPerBone = set.manifest.texelsPerBone;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCrowdBones = { value: set.texture };
    shader.uniforms.uCrowdSize = { value: new THREE.Vector2(width, frames) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <skinning_pars_vertex>", /* glsl */`
        attribute vec4 skinIndex;
        attribute vec4 skinWeight;
        attribute vec3 ${CROWD_INSTANCE_ATTRIBUTE};
        uniform sampler2D uCrowdBones;
        uniform vec2 uCrowdSize;
        mat4 crowdBoneAt(float row, float bone) {
          float x0 = bone * ${texelsPerBone.toFixed(1)};
          float y = (row + 0.5) / uCrowdSize.y;
          vec4 r0 = texture2D(uCrowdBones, vec2((x0 + 0.5) / uCrowdSize.x, y));
          vec4 r1 = texture2D(uCrowdBones, vec2((x0 + 1.5) / uCrowdSize.x, y));
          vec4 r2 = texture2D(uCrowdBones, vec2((x0 + 2.5) / uCrowdSize.x, y));
          return mat4(
            r0.x, r1.x, r2.x, 0.0,
            r0.y, r1.y, r2.y, 0.0,
            r0.z, r1.z, r2.z, 0.0,
            r0.w, r1.w, r2.w, 1.0);
        }
        mat4 crowdBone(float row, float bone) {
          float base = floor(row);
          float t = row - base;
          mat4 a = crowdBoneAt(base, bone);
          mat4 b = crowdBoneAt(min(base + 1.0, uCrowdSize.y - 1.0), bone);
          return a + (b - a) * t;
        }
        mat4 crowdPose(float bone) {
          mat4 current = crowdBone(${CROWD_INSTANCE_ATTRIBUTE}.x, bone);
          float blend = ${CROWD_INSTANCE_ATTRIBUTE}.z;
          if (blend <= 0.0) return current;
          mat4 previous = crowdBone(${CROWD_INSTANCE_ATTRIBUTE}.y, bone);
          return current + (previous - current) * blend;
        }
      `)
      .replace("#include <skinbase_vertex>", /* glsl */`
        mat4 crowdSkin = skinWeight.x * crowdPose(skinIndex.x)
          + skinWeight.y * crowdPose(skinIndex.y)
          + skinWeight.z * crowdPose(skinIndex.z)
          + skinWeight.w * crowdPose(skinIndex.w);
      `)
      .replace("#include <skinnormal_vertex>", /* glsl */`
        objectNormal = (crowdSkin * vec4(objectNormal, 0.0)).xyz;
        #ifdef USE_TANGENT
          objectTangent = (crowdSkin * vec4(objectTangent, 0.0)).xyz;
        #endif
      `)
      .replace("#include <skinning_vertex>", /* glsl */`
        transformed = (crowdSkin * vec4(transformed, 1.0)).xyz;
      `);
  };
  material.customProgramCacheKey = () => `crowd:${set.manifest.body}`;
  return material;
}

/** Per-instance pose attribute for `count` instances, all at row 0. */
export function createCrowdPoseAttribute(count: number) {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  return attribute;
}
