import { useSyncExternalStore } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

export type CharacterBuild = "adult" | "child";

export type CharacterSoleProfile = Readonly<{
  width: number;
  thickness: number;
  length: number;
  centerZ: number;
  bevel: number;
}>;

interface CharacterPresentationOptions {
  build?: CharacterBuild;
  crowd?: boolean;
  reducedDetail?: boolean;
  /** Legacy repair path for third-party GLBs whose shoe bottom is open. The
   * current market cast already contains a rigged outsole baked by Blender. */
  repairOpenSoles?: boolean;
}

export type CharacterModelTier = 0 | 1 | 2;

export type CharacterDeviceCapabilities = Readonly<{
  width: number;
  height: number;
  coarsePointer: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  devicePixelRatio?: number;
}>;

export type CharacterVisibilityScratch = Readonly<{
  projection: THREE.Matrix4;
  frustum: THREE.Frustum;
  sphere: THREE.Sphere;
  scale: THREE.Vector3;
}>;

const CHARACTER_CULL_RADIUS = 2.45;
export const CHARACTER_FACE_UPDATE_INTERVAL = 1 / 24;
const scheduledCharacterPreloads = new Set<string>();
const PRIORITY_CUSTOMER_MODEL_PATHS = [
  "/models/market/customers/customer_01_man_young.glb",
  "/models/market/customers/customer_02_man_senior.glb",
  "/models/market/customers/customer_03_woman_young.glb",
] as const;

/**
 * The reconstructed GLBs already contain the visible shoe upper. This shared
 * insert only seals the underside, so it must stay inside that silhouette.
 * In particular it is centred on the Foot bone: offsetting it towards the toe
 * turns the insert into a detached, flipper-like slab during a step.
 */
export const CHARACTER_SOLE_PROFILES: Readonly<Record<CharacterBuild, CharacterSoleProfile>> = {
  adult: Object.freeze({ width: 0.154, thickness: 0.024, length: 0.242, centerZ: 0, bevel: 0.011 }),
  child: Object.freeze({ width: 0.12, thickness: 0.02, length: 0.188, centerZ: 0, bevel: 0.009 }),
};

/** Pure policy shared by browser selection and unit tests. A coarse pointer is
 * the strongest phone/tablet signal; CPU/RAM and the live viewport cover
 * low-end laptops, split-screen and orientation changes. */
export function characterModelTierForCapabilities(capabilities: CharacterDeviceCapabilities): CharacterModelTier {
  const shortEdge = Math.min(capabilities.width, capabilities.height);
  const cores = capabilities.hardwareConcurrency ?? 8;
  const memory = capabilities.deviceMemory ?? 8;
  const pixelRatio = capabilities.devicePixelRatio ?? 1;
  if (cores <= 2 || memory <= 2 || (capabilities.coarsePointer && shortEdge <= 430 && pixelRatio >= 3 && cores <= 4)) return 2;
  if (capabilities.coarsePointer || cores <= 4 || memory <= 4 || shortEdge <= 700) return 1;
  return 0;
}

export function useCharacterModelTier(): CharacterModelTier {
  return useSyncExternalStore(subscribeCharacterCapabilities, browserCharacterModelTier, serverCharacterModelTier);
}

export function characterModelPathForTier(path: string, tier: CharacterModelTier) {
  if (tier === 0) return path;
  const family = path.includes("/customers/") ? "/customers/" : "/characters/";
  return path.replace(family, `${family}lod${tier}/`);
}

/** Level one admits at most three simultaneous customers and the authoritative
 * sequence starts with identities 01–03. Preloading only that first wave keeps
 * later GLB decode out of live play without warming unused owner variants. */
export function priorityCustomerModelPathsForTier(tier: CharacterModelTier) {
  return PRIORITY_CUSTOMER_MODEL_PATHS.map((path) => characterModelPathForTier(path, tier));
}

/** Starts each decoder during a separate idle slice. This warms the Suspense
 * cache before customer spawn without turning ten concurrent GLB decodes into
 * one long main-thread stall. URLs are global because every Avatar shares the
 * same loader cache. */
export function scheduleCharacterModelPreload(paths: readonly string[], preload: (path: string) => void) {
  if (typeof window === "undefined") return;
  const queue = [...new Set(paths)].filter((path) => {
    if (scheduledCharacterPreloads.has(path)) return false;
    scheduledCharacterPreloads.add(path);
    return true;
  });
  let index = 0;
  const scheduleNext = () => {
    if (index >= queue.length) return;
    const run = () => {
      preload(queue[index]);
      index += 1;
      window.setTimeout(scheduleNext, 420);
    };
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 1_200 });
    else window.setTimeout(run, 120);
  };
  scheduleNext();
}

export function createCharacterVisibilityScratch(): CharacterVisibilityScratch {
  return {
    projection: new THREE.Matrix4(),
    frustum: new THREE.Frustum(),
    sphere: new THREE.Sphere(new THREE.Vector3(), CHARACTER_CULL_RADIUS),
    scale: new THREE.Vector3(1, 1, 1),
  };
}

/** Tests one conservative actor-sized sphere. Render meshes keep native
 * frustum culling too; this probe additionally lets React frame callbacks skip
 * facial, carry and IK work while the complete actor is safely off camera. */
export function characterIsInView(camera: THREE.Camera, actor: THREE.Object3D, scratch: CharacterVisibilityScratch) {
  actor.updateWorldMatrix(true, false);
  actor.getWorldPosition(scratch.sphere.center);
  actor.getWorldScale(scratch.scale);
  scratch.sphere.radius = CHARACTER_CULL_RADIUS * Math.max(Math.abs(scratch.scale.x), Math.abs(scratch.scale.y), Math.abs(scratch.scale.z));
  scratch.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  scratch.frustum.setFromProjectionMatrix(scratch.projection);
  return scratch.frustum.intersectsSphere(scratch.sphere);
}

const soleGeometries: Record<CharacterBuild, RoundedBoxGeometry> = {
  adult: soleGeometry(CHARACTER_SOLE_PROFILES.adult),
  child: soleGeometry(CHARACTER_SOLE_PROFILES.child),
};

const soleMaterial = new THREE.MeshStandardMaterial({
  color: "#1d211f",
  roughness: 0.82,
  metalness: 0,
  envMapIntensity: 0.42,
});
soleMaterial.name = "RuntimePremiumSole";
soleMaterial.userData.characterSharedResource = true;

const preparedCharacterMaps = new WeakSet<THREE.Texture>();
const CHARACTER_MAP_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "alphaMap",
  "aoMap",
] as const;

function soleGeometry(profile: CharacterSoleProfile) {
  const geometry = new RoundedBoxGeometry(profile.width, profile.thickness, profile.length, 2, profile.bevel);
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Creates an instance-local skeleton and material set while keeping the heavy
 * geometry and textures shared by GLTFLoader. The final material pass is
 * deliberately subtle: it removes the dry scan look without turning cloth or
 * skin into chrome. The closed body shell uses normal back-face culling, while
 * only genuinely paper-thin facial cards opt into two-sided rendering.
 */
export function prepareCharacterModel(source: THREE.Group, options: CharacterPresentationOptions = {}) {
  const model = clone(source) as THREE.Group;
  const crowd = options.crowd ?? false;
  const reducedDetail = options.reducedDetail ?? false;

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = !(crowd || reducedDetail);
    object.receiveShadow = true;
    object.frustumCulled = true;
    applyConservativeCharacterBounds(object);
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => premiumMaterial(material, crowd))
      : premiumMaterial(object.material, crowd);
  });

  if (options.repairOpenSoles) attachClosedSoles(model, options.build ?? "adult", crowd);
  return model;
}

/** Dispose only the instance-local materials; GLB geometry/textures and the
 * shared sole resources remain owned by their caches. */
export function disposeCharacterMaterials(model: THREE.Group) {
  const materials = new Set<THREE.Material>();
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const values = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of values) {
      if (!material.userData.characterSharedResource) materials.add(material);
    }
  });
  materials.forEach((material) => material.dispose());
}

function premiumMaterial(source: THREE.Material, crowd: boolean) {
  const material = source.clone();
  prepareSharedCharacterMaps(material);
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;

  const name = material.name.toLowerCase();
  const facialOverlay = name.includes("eyelid") || name.includes("eyelash") || name.includes("mouthinterior") || name.includes("teeth") || name.includes("tongue");
  // The reconstructed body shell and outsole are closed. Only the paper-thin
  // eyelash cards genuinely need two-sided rendering.
  material.side = name.includes("eyelash") ? THREE.DoubleSide : THREE.FrontSide;
  material.metalness = 0;
  material.roughness = facialOverlay
    ? THREE.MathUtils.clamp(material.roughness, 0.5, 0.82)
    : THREE.MathUtils.clamp(material.roughness * 0.72, 0.54, 0.68);
  material.envMapIntensity = crowd ? 0.68 : 0.82;

  // The atlas contains intentionally soft studio shading. A restrained fill
  // retains facial readability in the deep supermarket shadows while still
  // responding to the scene lights and contact shadows.
  if (material.map && !facialOverlay) {
    material.emissiveMap = material.map;
    material.emissive.set("#ffffff");
    material.emissiveIntensity = crowd ? 0.075 : 0.055;
  }
  if (material instanceof THREE.MeshPhysicalMaterial && !facialOverlay) {
    material.clearcoat = 0.1;
    material.clearcoatRoughness = 0.62;
    material.sheen = 0.08;
    material.sheenColor.set("#fff4e9");
    material.sheenRoughness = 0.82;
    material.specularIntensity = 0.34;
  }
  material.needsUpdate = true;
  return material;
}

function applyConservativeCharacterBounds(mesh: THREE.Mesh) {
  const radius = CHARACTER_CULL_RADIUS;
  if (mesh instanceof THREE.SkinnedMesh) {
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius);
    mesh.boundingBox = new THREE.Box3(
      new THREE.Vector3(-radius, -radius, -radius),
      new THREE.Vector3(radius, radius, radius),
    );
    return;
  }
  mesh.geometry.computeBoundingSphere();
  if (mesh.geometry.boundingSphere) mesh.geometry.boundingSphere.radius = Math.max(mesh.geometry.boundingSphere.radius, radius);
}

function serverCharacterModelTier(): CharacterModelTier {
  return 1;
}

function browserCharacterModelTier(): CharacterModelTier {
  if (typeof window === "undefined") return serverCharacterModelTier();
  const browserNavigator = window.navigator as Navigator & { deviceMemory?: number };
  return characterModelTierForCapabilities({
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: window.matchMedia("(any-pointer: coarse)").matches,
    hardwareConcurrency: browserNavigator.hardwareConcurrency,
    deviceMemory: browserNavigator.deviceMemory,
    devicePixelRatio: window.devicePixelRatio,
  });
}

function subscribeCharacterCapabilities(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const pointerQuery = window.matchMedia("(any-pointer: coarse)");
  pointerQuery.addEventListener("change", onStoreChange);
  window.addEventListener("resize", onStoreChange, { passive: true });
  window.addEventListener("orientationchange", onStoreChange, { passive: true });
  return () => {
    pointerQuery.removeEventListener("change", onStoreChange);
    window.removeEventListener("resize", onStoreChange);
    window.removeEventListener("orientationchange", onStoreChange);
  };
}

function prepareSharedCharacterMaps(material: THREE.Material) {
  const mappedMaterial = material as THREE.Material & Partial<Record<(typeof CHARACTER_MAP_SLOTS)[number], THREE.Texture | null>>;
  for (const slot of CHARACTER_MAP_SLOTS) {
    const texture = mappedMaterial[slot];
    if (!(texture instanceof THREE.Texture) || preparedCharacterMaps.has(texture)) continue;
    texture.anisotropy = Math.max(8, texture.anisotropy);
    texture.magFilter = THREE.LinearFilter;
    const canGenerateMipmaps = !(texture instanceof THREE.CompressedTexture)
      && !(texture instanceof THREE.VideoTexture)
      && !(texture instanceof THREE.Data3DTexture)
      && !(texture instanceof THREE.DataArrayTexture);
    if (canGenerateMipmaps) {
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
    } else {
      texture.minFilter = texture.mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    }
    texture.needsUpdate = true;
    preparedCharacterMaps.add(texture);
  }
}

function attachClosedSoles(model: THREE.Group, build: CharacterBuild, crowd: boolean) {
  const profile = CHARACTER_SOLE_PROFILES[build];
  const geometry = soleGeometries[build];
  model.updateWorldMatrix(true, true);
  const groundY = new THREE.Box3().setFromObject(model).min.y;
  const origin = new THREE.Vector3();
  const localYAxis = new THREE.Vector3();
  const localZAxis = new THREE.Vector3();
  for (const side of ["L", "R"] as const) {
    const foot = model.getObjectByName(`Foot_${side}`);
    if (!foot || foot.getObjectByName(`PremiumSole_${side}`)) continue;
    foot.getWorldPosition(origin);
    localYAxis.set(0, 1, 0).transformDirection(foot.matrixWorld);
    localZAxis.set(0, 0, 1).transformDirection(foot.matrixWorld);
    // Solve the bone-local Y position from the actual rest-pose ground. This
    // keeps every adult, senior and child outsole flush even though their
    // ankle heights differ by more than four centimetres.
    const targetCenterY = groundY + profile.thickness * 0.5 + 0.0015;
    const centerY = Math.abs(localYAxis.y) > 0.4
      ? (targetCenterY - origin.y - profile.centerZ * localZAxis.y) / localYAxis.y
      : build === "child" ? 0.063 : 0.096;
    const sole = new THREE.Mesh(geometry, soleMaterial);
    sole.name = `PremiumSole_${side}`;
    sole.position.set(0, centerY, profile.centerZ);
    sole.castShadow = !crowd;
    sole.receiveShadow = true;
    sole.userData.characterSharedResource = true;
    sole.userData.characterSoleBuild = build;
    foot.add(sole);
  }
}
