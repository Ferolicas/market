import * as THREE from "three";
import type { PurchaseMarker } from "@/components/game/MarketScene";
import { PURCHASE_MARKER } from "@/game/stations/purchase-marker";
import { PURCHASE_POSITIONS } from "@/game/stations/purchase-layout";
import { OVERVIEW_CAMERA_OFFSET } from "@/game/render/overview-camera";
import { scaleStorePosition, STORE_ELEMENT_SCALE } from "@/game/world-scale";
import { makeText, updateText } from "./primitives";

/**
 * Imperative port of `PurchaseMarkers`/`PurchaseSquare` (`MarketScene.tsx`,
 * ~lines 1684-1734): a pulsing golden square on the floor beside anything the
 * owner can currently afford to buy next, filling green as it is funded,
 * with a standing sign showing the name and what is left. Every geometry
 * arg, color and offset below is copied verbatim from the source.
 */

/** Yaw that squares a floor label with the fixed isometric camera — copied
 * from `MarketScene.tsx`'s own (unexported) `FLOOR_LABEL_YAW` constant. */
const FLOOR_LABEL_YAW = Math.atan2(OVERVIEW_CAMERA_OFFSET.x, OVERVIEW_CAMERA_OFFSET.z);

const SIZE = PURCHASE_MARKER.halfSize * 2;
const INNER_SIZE = SIZE - 0.1;

const HIGHLIGHT_COLOR = "#ffd75e";
const NORMAL_COLOR = "#e8ca6b";

// Shared, long-lived geometry/materials: every marker's floor square, sign
// post and sign board are the same size and colour as every other marker's,
// so one instance of each is reused across every `MarkerEntry` (mirrors the
// sharing already used for e.g. `retailProducts.ts`'s per-SKU geometries).
const topGeometry = new THREE.PlaneGeometry(SIZE, SIZE);
const innerGeometry = new THREE.PlaneGeometry(INNER_SIZE, INNER_SIZE);
const boardGeometry = new THREE.BoxGeometry(1.76, 0.84, 0.06);
const faceGeometry = new THREE.PlaneGeometry(1.64, 0.72);
const postGeometry = new THREE.BoxGeometry(0.06, PURCHASE_MARKER.signHeight, 0.06);

const baseMaterial = new THREE.MeshBasicMaterial({ color: "#2e4a3f", transparent: true, opacity: 0.85 });
const fillMaterial = new THREE.MeshBasicMaterial({ color: "#7fba63", transparent: true, opacity: 0.9 });
const postMaterial = new THREE.MeshStandardMaterial({ color: "#4b5b56", metalness: 0.3 });
const boardMaterial = new THREE.MeshStandardMaterial({ color: "#f4e4ad", roughness: 0.6 });
const faceMaterial = new THREE.MeshBasicMaterial({ color: "#fff8e1" });

interface MarkerEntry {
  group: THREE.Group;
  /** Wraps only the three floor meshes, matching the source's `pulse` ref
   * group — the sign is a sibling, never scaled by the breathing pulse. */
  pulse: THREE.Group;
  topMaterial: THREE.MeshBasicMaterial;
  fillMesh: THREE.Mesh;
  labelText: ReturnType<typeof makeText>;
  remainingText: ReturnType<typeof makeText>;
  label: string;
  remainingLabel: string;
  highlighted: boolean;
}

function applyFunded(entry: MarkerEntry, funded: number) {
  const clamped = Math.max(0, Math.min(1, funded));
  // Source conditionally mounts the fill plane only when `funded > 0` and
  // sizes its geometry to `(size - 0.1) * funded`; scaling a fixed,
  // shared, origin-centred plane by the same factor produces an identical
  // footprint and lets the geometry stay shared across every marker.
  entry.fillMesh.visible = clamped > 0;
  entry.fillMesh.scale.set(clamped, 1, clamped);
}

function buildMarkerEntry(marker: PurchaseMarker): MarkerEntry {
  const group = new THREE.Group();
  group.name = `purchase-marker:${marker.id}`;
  const [x, y, z] = scaleStorePosition(PURCHASE_POSITIONS[marker.id]);
  group.position.set(x, y, z);
  group.scale.setScalar(STORE_ELEMENT_SCALE);

  const pulse = new THREE.Group();
  group.add(pulse);

  const topMaterial = new THREE.MeshBasicMaterial({ color: marker.highlighted ? HIGHLIGHT_COLOR : NORMAL_COLOR, transparent: true, opacity: 0.95 });
  const topMesh = new THREE.Mesh(topGeometry, topMaterial);
  topMesh.rotation.set(-Math.PI / 2, 0, 0);
  topMesh.position.set(0, 0.012, 0);
  pulse.add(topMesh);

  const baseMesh = new THREE.Mesh(innerGeometry, baseMaterial);
  baseMesh.rotation.set(-Math.PI / 2, 0, 0);
  baseMesh.position.set(0, 0.018, 0);
  pulse.add(baseMesh);

  const fillMesh = new THREE.Mesh(innerGeometry, fillMaterial);
  fillMesh.rotation.set(-Math.PI / 2, 0, 0);
  fillMesh.position.set(0, 0.024, 0);
  pulse.add(fillMesh);

  const signRoot = new THREE.Group();
  signRoot.position.set(0, 0, PURCHASE_MARKER.signOffsetZ);
  signRoot.rotation.set(0, FLOOR_LABEL_YAW, 0);
  group.add(signRoot);

  const post = new THREE.Mesh(postGeometry, postMaterial);
  post.position.set(0, PURCHASE_MARKER.signHeight / 2, 0);
  signRoot.add(post);

  const sign = new THREE.Group();
  sign.position.set(0, PURCHASE_MARKER.signHeight + 0.34, 0);
  sign.rotation.set(-0.2, 0, 0);
  signRoot.add(sign);

  const board = new THREE.Mesh(boardGeometry, boardMaterial);
  sign.add(board);

  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.position.set(0, 0, 0.031);
  sign.add(face);

  const labelText = makeText({
    text: marker.label,
    position: [0, 0.2, 0.036],
    fontSize: 0.15,
    color: "#2a4a3e",
    anchorX: "center",
    anchorY: "middle",
    fontWeight: 800,
  });
  labelText.maxWidth = 1.56;
  labelText.textAlign = "center";
  labelText.sync();
  sign.add(labelText);

  const remainingText = makeText({
    text: marker.remainingLabel,
    position: [0, -0.18, 0.036],
    fontSize: 0.27,
    color: "#1f5c3b",
    anchorX: "center",
    anchorY: "middle",
    fontWeight: 900,
  });
  remainingText.maxWidth = 1.56;
  remainingText.textAlign = "center";
  remainingText.sync();
  sign.add(remainingText);

  const entry: MarkerEntry = {
    group,
    pulse,
    topMaterial,
    fillMesh,
    labelText,
    remainingText,
    label: marker.label,
    remainingLabel: marker.remainingLabel,
    highlighted: marker.highlighted,
  };
  applyFunded(entry, marker.funded);
  return entry;
}

/**
 * Builds the purchase-markers layer. `update()` reconciles by `marker.id`
 * the same way React's `key={marker.id}` does: an id that is still present
 * gets its fill/label/highlight patched in place, a new id gets a freshly
 * built marker, and a dropped id gets torn down — no marker whose id is
 * unchanged is ever rebuilt. `animate()` must be called once per rendered
 * frame with the frame's delta seconds; it drives the same breathing pulse
 * formula as the source's `useFrame`, keyed off an internally accumulated
 * clock so it does not depend on any global clock.
 */
export function buildPurchaseMarkers(): { group: THREE.Group; update(markers: readonly PurchaseMarker[]): void; animate(deltaSeconds: number): void } {
  const group = new THREE.Group();
  group.name = "dynamic:purchase-markers";
  const entries = new Map<string, MarkerEntry>();
  let elapsedSeconds = 0;

  function update(markers: readonly PurchaseMarker[]) {
    const seen = new Set<string>();
    for (const marker of markers) {
      seen.add(marker.id);
      const entry = entries.get(marker.id);
      if (!entry) {
        const created = buildMarkerEntry(marker);
        entries.set(marker.id, created);
        group.add(created.group);
        continue;
      }
      if (entry.highlighted !== marker.highlighted) {
        entry.highlighted = marker.highlighted;
        entry.topMaterial.color.set(marker.highlighted ? HIGHLIGHT_COLOR : NORMAL_COLOR);
      }
      applyFunded(entry, marker.funded);
      if (entry.label !== marker.label) {
        entry.label = marker.label;
        updateText(entry.labelText, { text: marker.label });
      }
      if (entry.remainingLabel !== marker.remainingLabel) {
        entry.remainingLabel = marker.remainingLabel;
        updateText(entry.remainingText, { text: marker.remainingLabel });
      }
    }
    for (const [id, entry] of entries) {
      if (seen.has(id)) continue;
      group.remove(entry.group);
      entry.labelText.dispose();
      entry.remainingText.dispose();
      entry.topMaterial.dispose();
      entries.delete(id);
    }
  }

  function animate(deltaSeconds: number) {
    elapsedSeconds += deltaSeconds;
    for (const entry of entries.values()) {
      const breath = 1 + Math.sin(elapsedSeconds * 3.1) * (entry.highlighted ? 0.12 : 0.07);
      entry.pulse.scale.set(breath, 1, breath);
    }
  }

  return { group, update, animate };
}
