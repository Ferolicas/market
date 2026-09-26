import * as THREE from "three";
import { REGISTER_INTERACTION_IDS, registerLane, registerPickupPosition, type RegisterInteractionId } from "@/game/stations/register-layout";
import type { CheckoutLane } from "@/game/stations/checkout-layout";
import { CASH_BUNDLE_RENDER_CAP, cashBundleCount } from "@/game/economy/cash-bundles";
import { scaleStorePosition, STORE_ELEMENT_SCALE } from "@/game/world-scale";
import { applyInstanceTransforms, makeInstances, makeText, type InstanceTransform, type Position } from "./primitives";

/**
 * Imperative port of `RegisterCashMarkers`/`CashBundleStack`
 * (`MarketScene.tsx`, ~lines 1736-1785): stacked green cash bundles at each
 * open checkout register, sized by how much money is waiting to be
 * collected there. `CashBundle` (the singular bundle used by the flying
 * `PayMagnetBurst`/`RegisterMagnetBurst` animations) is out of scope here —
 * only the stacked, instanced register pile.
 */

const CASH_BUNDLE_SIZE: Position = [0.2, 0.05, 0.1];
const CASH_STACK_PER_LAYER = 9;

// Shared across every lane: the box and the ring never differ in size or
// colour from one register to another.
const bundleGeometry = new THREE.BoxGeometry(...CASH_BUNDLE_SIZE);
const bundleMaterial = new THREE.MeshStandardMaterial({ color: "#79b063", roughness: 0.85 });
const ringGeometry = new THREE.RingGeometry(0.42, 0.48, 32);
const ringMaterial = new THREE.MeshBasicMaterial({ color: "#e8ca6b" });

function bundleTransforms(count: number): InstanceTransform[] {
  return Array.from({ length: count }, (_, index) => {
    const layer = Math.floor(index / CASH_STACK_PER_LAYER);
    const slot = index % CASH_STACK_PER_LAYER;
    return {
      position: [
        (slot % 3 - 1) * (CASH_BUNDLE_SIZE[0] + 0.02),
        CASH_BUNDLE_SIZE[1] / 2 + layer * (CASH_BUNDLE_SIZE[1] + 0.004),
        (Math.floor(slot / 3) - 1) * (CASH_BUNDLE_SIZE[2] + 0.02),
      ] as Position,
    };
  });
}

function stackHeightFor(bundles: number) {
  return Math.ceil(bundles / CASH_STACK_PER_LAYER) * (CASH_BUNDLE_SIZE[1] + 0.004);
}

interface LaneEntry {
  group: THREE.Group;
  bundleMesh: THREE.InstancedMesh;
  label: ReturnType<typeof makeText>;
  bundles: number;
}

function buildLaneEntry(lane: CheckoutLane, bundles: number): LaneEntry {
  const group = new THREE.Group();
  group.name = `register-cash:${lane}`;
  const [x, y, z] = scaleStorePosition(registerPickupPosition(lane));
  group.position.set(x, y, z);
  group.scale.setScalar(STORE_ELEMENT_SCALE);

  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.set(-Math.PI / 2, 0, 0);
  group.add(ring);

  const bundleMesh = makeInstances(bundleTransforms(bundles), bundleGeometry, bundleMaterial, { capacity: CASH_BUNDLE_RENDER_CAP });
  group.add(bundleMesh);

  // Source omits `anchorY` here, which falls back to drei's own Text
  // default of "middle" — NOT `makeText()`'s default of "top" — so it must
  // be set explicitly to match what the source actually renders.
  const label = makeText({ text: "RECOGER", position: [0, stackHeightFor(bundles) + 0.3, 0], fontSize: 0.13, color: "#28483e", anchorX: "center", anchorY: "middle" });
  label.outlineColor = "#fff1bf";
  label.outlineWidth = 0.01;
  label.sync();
  group.add(label);

  return { group, bundleMesh, label, bundles };
}

/**
 * Builds the register-cash layer. `update()` mirrors the source's
 * `if (bundles <= 0) return null`: a lane with money waiting gets a group
 * added (or its instance count and label height refreshed if it already has
 * one), and a lane that drops to zero has its group torn down.
 */
export function buildRegisterCashMarkers(): { group: THREE.Group; update(amounts: readonly [number, number, number], bundleMinor: number): void } {
  const group = new THREE.Group();
  group.name = "dynamic:register-cash";
  const lanes = new Map<CheckoutLane, LaneEntry>();

  function update(amounts: readonly [number, number, number], bundleMinor: number) {
    for (const id of REGISTER_INTERACTION_IDS as readonly RegisterInteractionId[]) {
      const lane = registerLane(id);
      const bundles = Math.min(CASH_BUNDLE_RENDER_CAP, cashBundleCount(amounts[lane], bundleMinor));
      const entry = lanes.get(lane);
      if (bundles <= 0) {
        if (entry) {
          group.remove(entry.group);
          entry.label.dispose();
          entry.bundleMesh.dispose();
          lanes.delete(lane);
        }
        continue;
      }
      if (!entry) {
        const created = buildLaneEntry(lane, bundles);
        lanes.set(lane, created);
        group.add(created.group);
        continue;
      }
      if (entry.bundles !== bundles) {
        entry.bundles = bundles;
        applyInstanceTransforms(entry.bundleMesh, bundleTransforms(bundles));
        entry.label.position.y = stackHeightFor(bundles) + 0.3;
        entry.label.sync();
      }
    }
  }

  return { group, update };
}
