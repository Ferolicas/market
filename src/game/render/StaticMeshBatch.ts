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

/**
 * Subtrees whose content changes after mount. Everything that moves, toggles
 * or is re-created at runtime must live under one of these names (or set
 * `userData.disableStaticBatch`); the merge below assumes every other mesh
 * keeps its geometry, transform and material for the life of the batch.
 * Authoritative stock instances live under `retail-stock:`; the decorative
 * `retail-product:` props in bakery, mill and machine displays are static.
 */
const DYNAMIC_PREFIXES = [
  "dynamic:",
  "retail-stock:",
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

type BatchSource = THREE.Mesh | THREE.InstancedMesh;

/**
 * Merges visually equivalent opaque standard-material meshes in root-local
 * space. Original objects remain mounted (and named) for QA/landing lookups;
 * only their render visibility is replaced by exact transformed geometry.
 *
 * Two extensions keep draw calls low inside the store without changing a
 * single shaded pixel:
 * - the material colour is baked into a vertex colour attribute, so meshes
 *   that differ only by colour share one draw (`diffuse × vertexColor` is
 *   exactly what `material.color` already computes);
 * - static InstancedMesh content (fixture uprights, shelf levels, cart tubes,
 *   decor stacks) is expanded into the same batch instead of one draw per
 *   instanced mesh. Instanced meshes with per-instance colours, mirrored
 *   instances or matrices that were never uploaded are left untouched.
 */
export function createStaticMeshBatch(
  root: THREE.Group,
  options: StaticMeshBatchOptions = {},
): StaticMeshBatchHandle {
  const minGroupSize = Math.max(2, options.minGroupSize ?? 2);
  const excludeSubtree = options.excludeSubtree ?? isDefaultStaticBatchBoundary;
  const candidates = new Map<string, BatchSource[]>();
  const hidden: BatchSource[] = [];
  const restoreMatrixAutoUpdate = new Map<BatchSource, boolean>();
  const batchMaterials: THREE.Material[] = [];
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
  const localMatrix = new THREE.Matrix4();
  const instanceMatrix = new THREE.Matrix4();
  const instanceLocal = new THREE.Matrix4();
  for (const meshes of candidates.values()) {
    if (meshes.length < minGroupSize) continue;
    const transformed: THREE.BufferGeometry[] = [];
    for (const mesh of meshes) {
      const color = (mesh.material as THREE.MeshStandardMaterial).color;
      localMatrix.multiplyMatrices(inverseRootWorld, mesh.matrixWorld);
      if (mesh instanceof THREE.InstancedMesh) {
        for (let index = 0; index < mesh.count; index += 1) {
          mesh.getMatrixAt(index, instanceMatrix);
          instanceLocal.multiplyMatrices(localMatrix, instanceMatrix);
          transformed.push(paintedGeometry(mesh.geometry, instanceLocal, color));
        }
      } else {
        transformed.push(paintedGeometry(mesh.geometry, localMatrix, color));
      }
    }
    const merged = mergeGeometries(transformed, false);
    transformed.forEach((geometry) => geometry.dispose());
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const source = meshes[0];
    const material = (source.material as THREE.MeshStandardMaterial).clone();
    material.color.setRGB(1, 1, 1);
    material.vertexColors = true;
    material.needsUpdate = true;
    batchMaterials.push(material);
    const batch = new THREE.Mesh(merged, material);
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
      // The source stays mounted for name lookups but never moves again, so
      // the scene graph need not recompose its local matrix every frame.
      // Its world matrix was resolved above and remains valid for lookups.
      restoreMatrixAutoUpdate.set(mesh, mesh.matrixAutoUpdate);
      mesh.matrixAutoUpdate = false;
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
      hidden.forEach((mesh) => {
        mesh.visible = true;
        mesh.matrixAutoUpdate = restoreMatrixAutoUpdate.get(mesh) ?? true;
      });
      batchGroup.removeFromParent();
      batchGroup.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      batchMaterials.forEach((material) => material.dispose());
    },
  };
}

/** Root-local copy of a source geometry carrying the material colour per
 * vertex (linear working-space values, exactly what the shader multiplies). */
function paintedGeometry(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color) {
  const painted = geometry.clone().applyMatrix4(matrix);
  const count = painted.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let offset = 0; offset < colors.length; offset += 3) {
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }
  painted.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return painted;
}

function isBatchCandidate(object: THREE.Object3D): object is BatchSource {
  if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return false;
  if (Array.isArray(object.material) || object.material.type !== "MeshStandardMaterial") return false;
  const material = object.material as THREE.MeshStandardMaterial;
  if (material.transparent || material.opacity !== 1 || material.visible === false || material.wireframe || material.vertexColors) return false;
  if (object.customDepthMaterial || object.customDistanceMaterial || Object.keys(object.morphTargetInfluences ?? {}).length > 0) return false;
  if (object.geometry.drawRange.start !== 0 || object.geometry.drawRange.count !== Infinity) return false;
  if (Object.keys(object.geometry.morphAttributes).length > 0 || object.geometry.getAttribute("color")) return false;
  if (object.matrixWorld.determinant() <= 0) return false;
  if (object instanceof THREE.InstancedMesh) return isBakeableInstancedMesh(object);
  return true;
}

function isBakeableInstancedMesh(mesh: THREE.InstancedMesh) {
  // Per-instance colours would need a second paint pass, and a matrix buffer
  // that was never uploaded means the instances have not been placed yet.
  if (mesh.count <= 0 || mesh.instanceColor || mesh.instanceMatrix.version === 0) return false;
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < mesh.count; index += 1) {
    mesh.getMatrixAt(index, matrix);
    if (matrix.determinant() <= 0) return false;
  }
  return true;
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

/** Everything that changes the shading except `color`, which is baked per
 * vertex so differently coloured pieces share one draw. */
function standardMaterialKey(material: THREE.MeshStandardMaterial) {
  const texture = (value: THREE.Texture | null) => value?.uuid ?? "none";
  return [
    material.type,
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
    material.toneMapped ? 1 : 0,
    material.polygonOffset ? 1 : 0,
    material.polygonOffsetFactor,
    material.polygonOffsetUnits,
    material.customProgramCacheKey(),
  ].join("/");
}
