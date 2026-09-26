import * as THREE from "three";
import { toCreasedNormals } from "three-stdlib";
import { Text as TroikaText } from "troika-three-text";

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
  return mesh;
}
const boxGeometryCache = new Map<string, THREE.ExtrudeGeometry>();

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
  mesh.sync();
  return mesh;
}

/** Call after mutating a `makeText()` mesh's properties (e.g. a stock
 * counter's text) — troika only regenerates glyph geometry inside `sync()`. */
export function updateText(mesh: InstanceType<typeof TroikaText>, patch: Partial<{ text: string; color: string; fontSize: number }>) {
  Object.assign(mesh, patch);
  mesh.sync();
}
