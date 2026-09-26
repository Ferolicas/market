import * as THREE from "three";
import { mergeBufferGeometries, toCreasedNormals } from "three-stdlib";
import { Text as TroikaText } from "troika-three-text";
import { ablation } from "./ablation";

/**
 * Imperative, framework-free equivalents of `MarketKit.tsx`'s shared JSX
 * primitives (`Box`, `StaticInstances`, `SurfaceMaterial`, `DepartmentSign`,
 * `ScreenRail`, `FixtureUprights`, `CommercialShelfBank`,
 * `CommercialBackPanel`). Every port under `WorldKit/` builds on these so a
 * fixture's geometry/material numbers are the SAME numbers as the source —
 * copied, not re-derived or approximated. Every factory here returns a plain
 * `THREE.Object3D` with no React/R3F dependency, since this module runs
 * inside `ClientRuntime`'s single-rAF, no-reconciler render loop.
 */

export type Position = [number, number, number];

export const palette = {
  cream: "#eee8d8",
  light: "#faf6e9",
  frame: "#303a36",
  green: "#637b51",
  darkGreen: "#344c3e",
  wood: "#a46f3d",
  soil: "#765035",
  metal: "#87928e",
  fixtureSteel: "#222a2b",
  shelf: "#d9dcda",
  coldInterior: "#dcecef",
} as const;

export interface InstanceTransform {
  position: Position;
  rotation?: Position;
  quaternion?: [number, number, number, number];
  scale?: Position;
}

// ─── Shared surface textures (market-kit charcoal/cream/olive/wood) ────────

type KitSurface = "charcoal" | "cream" | "olive" | "wood";
const textureLoader = new THREE.TextureLoader();
const surfaceTextureCache = new Map<KitSurface, THREE.Texture>();

function surfaceTexture(surface: KitSurface): THREE.Texture {
  const cached = surfaceTextureCache.get(surface);
  if (cached) return cached;
  const texture = textureLoader.load(`/textures/market-kit/${surface}.webp`);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  surfaceTextureCache.set(surface, texture);
  return texture;
}

function surfaceForColor(color: string): KitSurface | null {
  if (color === palette.cream || color === palette.light) return "cream";
  if (color === palette.frame) return "charcoal";
  if (color === palette.green) return "olive";
  if (color === palette.wood) return "wood";
  return null;
}

/** One material per (surface|flat-color), reused across every box that asks
 * for it — mirrors `useTexture`'s built-in per-URL sharing in the source. */
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function surfaceMaterial(surface: KitSurface): THREE.MeshStandardMaterial {
  const key = `surface:${surface}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const texture = surfaceTexture(surface);
  const roughness = surface === "charcoal" ? 0.68 : surface === "wood" ? 0.78 : 0.82;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: texture,
    bumpScale: surface === "wood" ? 0.012 : 0.008,
    roughness,
    metalness: surface === "charcoal" ? 0.06 : 0.01,
  });
  materialCache.set(key, material);
  return material;
}

export function flatMaterial(color: string, roughness = 0.72): THREE.MeshStandardMaterial {
  const key = `flat:${color}:${roughness}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const material = new THREE.MeshStandardMaterial({ color, roughness: roughness });
  materialCache.set(key, material);
  return material;
}

/**
 * Faithful port of `@react-three/drei`'s `RoundedBoxGeometry` — NOT the
 * same thing as `three/examples/jsm/geometries/RoundedBoxGeometry.js` (a
 * different algorithm/look). Drei traces a sharp-cornered rectangle
 * `Shape` shrunk by `radius`, then lets `ExtrudeGeometry`'s bevel produce
 * the actual rounding, then calls `.center()` and `toCreasedNormals()` for
 * sharp-but-smooth edges. Copied exactly from
 * `@react-three/drei/core/RoundedBox.js` (`createShape` + extrude params)
 * so the geometry this produces is pixel-identical to `/`'s, not an
 * approximation.
 */
const ROUNDED_BOX_EPS = 0.00001;
function roundedBoxShape(width: number, height: number, radius0: number): THREE.Shape {
  const shape = new THREE.Shape();
  const radius = radius0 - ROUNDED_BOX_EPS;
  shape.absarc(ROUNDED_BOX_EPS, ROUNDED_BOX_EPS, ROUNDED_BOX_EPS, -Math.PI / 2, -Math.PI, true);
  shape.absarc(ROUNDED_BOX_EPS, height - radius * 2, ROUNDED_BOX_EPS, Math.PI, Math.PI / 2, true);
  shape.absarc(width - radius * 2, height - radius * 2, ROUNDED_BOX_EPS, Math.PI / 2, 0, true);
  shape.absarc(width - radius * 2, ROUNDED_BOX_EPS, ROUNDED_BOX_EPS, 0, -Math.PI / 2, true);
  return shape;
}

export function makeRoundedBoxGeometry(width: number, height: number, depth: number, radius: number, options: { steps?: number; smoothness?: number; bevelSegments?: number; creaseAngle?: number } = {}): THREE.ExtrudeGeometry {
  const { steps = 1, smoothness = 2, bevelSegments = 4, creaseAngle = 0.4 } = options;
  const shape = roundedBoxShape(width, height, radius);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - radius * 2,
    bevelEnabled: true,
    bevelSegments: bevelSegments * 2,
    steps,
    bevelSize: radius - ROUNDED_BOX_EPS,
    bevelThickness: radius,
    curveSegments: smoothness,
  });
  geometry.center();
  toCreasedNormals(geometry, creaseAngle);
  return geometry;
}

/** `Box` from MarketKit.tsx: a rounded box using the shared kit surface
 * texture when `color` matches one of the four palette surfaces, or a flat
 * standard material otherwise — identical branching to the source.
 * `smoothness` defaults to 2, matching `Box`'s own `smoothness={BAKE_LOWPOLY
 * ? 1 : 2}` (WorldKit is never a bake pass, so always 2). */
export function makeBox({ args, position, color, rotation, radius = 0.035, receiveShadow = true }: {
  args: Position; position?: Position; color: string; rotation?: Position; radius?: number; receiveShadow?: boolean;
}): THREE.Mesh {
  const surface = surfaceForColor(color);
  const geometryKey = `${args[0]}:${args[1]}:${args[2]}:${radius}`;
  let geometry = boxGeometryCache.get(geometryKey);
  if (!geometry) {
    geometry = makeRoundedBoxGeometry(args[0], args[1], args[2], radius);
    boxGeometryCache.set(geometryKey, geometry);
  }
  const material = surface ? surfaceMaterial(surface) : flatMaterial(color, 0.72);
  const mesh = new THREE.Mesh(geometry, material);
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.receiveShadow = receiveShadow;
  // Marks this mesh as eligible for `mergeStaticMeshes()`: every `makeBox()`
  // caller in WorldKit adds the returned mesh straight into a group and
  // never keeps a reference to it afterwards (verified: no
  // `= makeBox(` assignment exists anywhere in WorldKit), so it is never
  // individually repositioned, recolored or toggled once built — safe to
  // fold into a single merged draw call with its same-material siblings.
  mesh.userData.staticMerge = true;
  return mesh;
}
const boxGeometryCache = new Map<string, THREE.ExtrudeGeometry>();

// ─── Static geometry merging (fewer draw calls, zero visual change) ───────

/**
 * Folds every `makeBox()`-tagged mesh under `root` that shares the exact
 * same (already-deduped, see `surfaceMaterial`/`flatMaterial`) material
 * instance into one merged `THREE.Mesh` per material, baking each source
 * mesh's matrix relative to `root` into the merged geometry so the combined
 * result renders pixel-identical to the original many-mesh version — just
 * as one draw call instead of many.
 *
 * Safe by construction: only meshes carrying `userData.staticMerge` (set
 * exclusively by `makeBox()`) are ever touched, and those are never
 * mutated/toggled after creation (see the comment on `makeBox()`). The
 * newly created merged mesh is left untagged, so calling this again on an
 * ancestor after a descendant has already been merged is a no-op for that
 * descendant's content — safe to call bottom-up at every fixture's own
 * build function without double-merging or reaching across an unrelated
 * sibling's independent `.visible` toggle (which always lives on a group,
 * never on a tagged mesh itself).
 */
export function mergeStaticMeshes(root: THREE.Object3D): void {
  root.updateWorldMatrix(true, true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse((object) => {
    if (object === root) return;
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    if (!object.userData.staticMerge || Array.isArray(object.material)) return;
    const list = byMaterial.get(object.material) ?? [];
    list.push(object);
    byMaterial.set(object.material, list);
  });
  for (const [material, meshes] of byMaterial) {
    if (meshes.length < 2) continue;
    const baked: THREE.BufferGeometry[] = [];
    let receiveShadow = false;
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const local = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(local);
      baked.push(geometry);
      if (mesh.receiveShadow) receiveShadow = true;
      mesh.parent?.remove(mesh);
    }
    const merged = mergeBufferGeometries(baked, false);
    for (const geometry of baked) geometry.dispose();
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.receiveShadow = receiveShadow;
    mesh.name = "static-merged";
    root.add(mesh);
  }
}

// ─── Instancing (StaticInstances) ──────────────────────────────────────────

/**
 * `StaticInstances` from MarketKit.tsx: bakes each transform (plus an
 * optional shared `component` sub-transform, for e.g. a fruit's stem offset
 * applied identically to every instance) into one `InstancedMesh`. Building
 * once and mutating `count` on real updates (never rebuilding the geometry)
 * is exactly the instancing discipline already proven in
 * `src/game/render/CrowdParts.ts`.
 */
export function makeInstances(
  transforms: readonly InstanceTransform[],
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  options: { castShadow?: boolean; receiveShadow?: boolean; capacity?: number; component?: InstanceTransform } = {},
): THREE.InstancedMesh {
  const capacity = Math.max(1, options.capacity ?? transforms.length);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.castShadow = Boolean(options.castShadow);
  mesh.receiveShadow = Boolean(options.receiveShadow);
  applyInstanceTransforms(mesh, transforms, options.component);
  return mesh;
}

const dummy = new THREE.Object3D();
const componentObject = new THREE.Object3D();
const combinedMatrix = new THREE.Matrix4();

export function applyInstanceTransforms(mesh: THREE.InstancedMesh, transforms: readonly InstanceTransform[], component?: InstanceTransform) {
  if (component) {
    componentObject.position.set(...component.position);
    if (component.quaternion) componentObject.quaternion.set(...component.quaternion);
    else componentObject.rotation.set(...(component.rotation ?? [0, 0, 0]));
    componentObject.scale.set(...(component.scale ?? [1, 1, 1]));
    componentObject.updateMatrix();
  }
  transforms.forEach((transform, index) => {
    dummy.position.set(...transform.position);
    if (transform.quaternion) dummy.quaternion.set(...transform.quaternion);
    else dummy.rotation.set(...(transform.rotation ?? [0, 0, 0]));
    dummy.scale.set(...(transform.scale ?? [1, 1, 1]));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, component ? combinedMatrix.copy(dummy.matrix).multiply(componentObject.matrix) : dummy.matrix);
  });
  mesh.count = transforms.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

// ─── Text (MarketText replacement) ─────────────────────────────────────────
// MarketText wraps troika-three-text's own `Text` mesh class (already
// vanilla Three.js — MarketText.tsx only adapts it to R3F's JSX form and a
// memoized re-render guard). WorldKit uses the same `Text` class directly,
// same font, so glyph rendering is byte-identical.
const MARKET_FONT_URL = "/fonts/OpenSans-SemiBold.ttf";

export function makeText({ text, position, rotation, fontSize, color, anchorX = "center", anchorY = "middle", fontWeight = "normal" }: {
  text: string; position?: Position; rotation?: Position; fontSize: number; color: string;
  anchorX?: number | "left" | "center" | "right"; anchorY?: number | "top" | "top-baseline" | "middle" | "bottom-baseline" | "bottom";
  fontWeight?: number | "normal" | "bold";
}): InstanceType<typeof TroikaText> {
  const mesh = new TroikaText();
  mesh.text = text;
  mesh.font = MARKET_FONT_URL;
  mesh.fontSize = fontSize;
  mesh.color = color;
  mesh.anchorX = anchorX;
  mesh.anchorY = anchorY;
  mesh.fontWeight = fontWeight;
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  // `?ablate=text` diagnostic (see `ablation.ts`): skip SDF layout/upload and
  // hide the mesh entirely — Three.js's renderer skips invisible objects
  // before reaching troika's per-frame `onBeforeRender` bookkeeping.
  if (ablation.skipText) { mesh.visible = false; return mesh; }
  mesh.sync();
  return mesh;
}

/** Call after mutating a `makeText()` mesh's properties (e.g. a stock
 * counter's text) — troika only regenerates glyph geometry inside `sync()`. */
export function updateText(mesh: InstanceType<typeof TroikaText>, patch: Partial<{ text: string; color: string; fontSize: number }>) {
  Object.assign(mesh, patch);
  mesh.sync();
}
