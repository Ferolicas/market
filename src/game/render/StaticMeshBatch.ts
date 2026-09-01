import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface StaticMeshBatchStats {
  sourceMeshes: number;
  batches: number;
  savedDraws: number;
}

export interface StaticMeshBatchHandle {
  group: THREE.Group;
  stats: StaticMeshBatchStats;
  dispose: () => void;
}

export interface StaticMeshBatchOptions {
  minGroupSize?: number;
  excludeSubtree?: (object: THREE.Object3D) => boolean;
}

const DYNAMIC_PREFIXES = [
  "dynamic:",
  "retail-stock:",
  "retail-product:",
  "retail-cold-door:",
  "fixture:returns",
  "fixture:cart-bay",
  "fixture:promotional-endcap",
] as const;

/** Keep exact product/debug/landing anchors mounted while excluding their
 * changing contents from the one-time static merge. */
export function isDefaultStaticBatchBoundary(object: THREE.Object3D) {
  return object.userData.disableStaticBatch === true
    || DYNAMIC_PREFIXES.some((prefix) => object.name.startsWith(prefix));
}

/**
 * Merges visually equivalent opaque standard-material meshes in root-local
 * space. Original objects remain mounted (and named) for QA/landing lookups;
 * only their render visibility is replaced by exact transformed geometry.
 */
export function createStaticMeshBatch(
  root: THREE.Group,
  options: StaticMeshBatchOptions = {},
): StaticMeshBatchHandle {
  const minGroupSize = Math.max(2, options.minGroupSize ?? 2);
  const excludeSubtree = options.excludeSubtree ?? isDefaultStaticBatchBoundary;
  const candidates = new Map<string, THREE.Mesh[]>();
  const hidden: THREE.Mesh[] = [];
  const batchGroup = new THREE.Group();
  batchGroup.name = "perf-static-batches";
  batchGroup.userData.disableStaticBatch = true;

  root.updateWorldMatrix(true, true);
  const inverseRootWorld = root.matrixWorld.clone().invert();

  const visit = (object: THREE.Object3D, parentVisible: boolean) => {
    const visible = parentVisible && object.visible;
    if (object !== root && excludeSubtree(object)) return;
    if (visible && isBatchCandidate(object)) {
      const geometryKey = geometryCompatibilityKey(object.geometry);
      if (geometryKey) {
        const material = object.material as THREE.MeshStandardMaterial;
        const key = [
          geometryKey,
          standardMaterialKey(material),
          object.castShadow ? "cast" : "no-cast",
          object.receiveShadow ? "receive" : "no-receive",
          object.renderOrder,
          object.layers.mask,
        ].join("|");
        const group = candidates.get(key) ?? [];
        group.push(object);
        candidates.set(key, group);
      }
    }
    for (const child of object.children) visit(child, visible);
  };
  visit(root, true);

  let sourceMeshes = 0;
  let batches = 0;
  for (const meshes of candidates.values()) {
    if (meshes.length < minGroupSize) continue;
    const transformed = meshes.map((mesh) => {
      const matrix = new THREE.Matrix4().multiplyMatrices(inverseRootWorld, mesh.matrixWorld);
      return mesh.geometry.clone().applyMatrix4(matrix);
    });
    const merged = mergeGeometries(transformed, false);
    transformed.forEach((geometry) => geometry.dispose());
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const source = meshes[0];
    const batch = new THREE.Mesh(merged, source.material as THREE.MeshStandardMaterial);
    batch.name = `perf-static-batch:${batches}`;
    batch.castShadow = source.castShadow;
    batch.receiveShadow = source.receiveShadow;
    batch.renderOrder = source.renderOrder;
    batch.layers.mask = source.layers.mask;
    batch.matrixAutoUpdate = false;
    batch.matrix.identity();
    batch.frustumCulled = true;
    batch.userData.staticBatchSourceCount = meshes.length;
    batchGroup.add(batch);
    for (const mesh of meshes) {
      mesh.visible = false;
      hidden.push(mesh);
    }
    sourceMeshes += meshes.length;
    batches += 1;
  }

  const stats = { sourceMeshes, batches, savedDraws: Math.max(0, sourceMeshes - batches) };
  if (batches > 0) root.add(batchGroup);

  let disposed = false;
  return {
    group: batchGroup,
    stats,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      hidden.forEach((mesh) => { mesh.visible = true; });
      batchGroup.removeFromParent();
      batchGroup.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
  };
}

function isBatchCandidate(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object instanceof THREE.SkinnedMesh) return false;
  if (Array.isArray(object.material) || object.material.type !== "MeshStandardMaterial") return false;
  const material = object.material as THREE.MeshStandardMaterial;
  if (material.transparent || material.opacity !== 1 || material.visible === false || material.wireframe) return false;
  if (object.customDepthMaterial || object.customDistanceMaterial || Object.keys(object.morphTargetInfluences ?? {}).length > 0) return false;
  if (object.geometry.drawRange.start !== 0 || object.geometry.drawRange.count !== Infinity) return false;
  if (Object.keys(object.geometry.morphAttributes).length > 0) return false;
  return object.matrixWorld.determinant() > 0;
}

function geometryCompatibilityKey(geometry: THREE.BufferGeometry) {
  const attributes = Object.entries(geometry.attributes).sort(([left], [right]) => left.localeCompare(right));
  if (attributes.length === 0 || attributes.some(([, attribute]) => attribute instanceof THREE.InterleavedBufferAttribute)) return null;
  const attributeKey = attributes.map(([name, attribute]) => [
    name,
    attribute.array.constructor.name,
    attribute.itemSize,
    attribute.normalized ? 1 : 0,
  ].join(":"));
  const index = geometry.index;
  return `${index ? `indexed:${index.array.constructor.name}` : "non-indexed"}/${attributeKey.join(",")}`;
}

function standardMaterialKey(material: THREE.MeshStandardMaterial) {
  const texture = (value: THREE.Texture | null) => value?.uuid ?? "none";
  return [
    material.type,
    material.color.getHexString(),
    material.emissive.getHexString(),
    material.emissiveIntensity,
    material.roughness,
    material.metalness,
    texture(material.map),
    texture(material.lightMap),
    material.lightMapIntensity,
    texture(material.aoMap),
    material.aoMapIntensity,
    texture(material.emissiveMap),
    texture(material.bumpMap),
    material.bumpScale,
    texture(material.normalMap),
    material.normalMapType,
    material.normalScale.x,
    material.normalScale.y,
    texture(material.displacementMap),
    material.displacementScale,
    material.displacementBias,
    texture(material.roughnessMap),
    texture(material.metalnessMap),
    texture(material.alphaMap),
    texture(material.envMap),
    material.envMapRotation.x,
    material.envMapRotation.y,
    material.envMapRotation.z,
    material.envMapIntensity,
    material.side,
    material.shadowSide ?? "auto",
    material.alphaTest,
    material.depthTest ? 1 : 0,
    material.depthWrite ? 1 : 0,
    material.colorWrite ? 1 : 0,
    material.blending,
    material.blendSrc,
    material.blendDst,
    material.blendEquation,
    material.premultipliedAlpha ? 1 : 0,
    material.dithering ? 1 : 0,
    material.flatShading ? 1 : 0,
    material.fog ? 1 : 0,
    material.vertexColors ? 1 : 0,
    material.toneMapped ? 1 : 0,
    material.polygonOffset ? 1 : 0,
    material.polygonOffsetFactor,
    material.polygonOffsetUnits,
    material.customProgramCacheKey(),
  ].join("/");
}
