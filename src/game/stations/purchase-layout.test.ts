import { describe, expect, it } from "vitest";
import { ensureStoreNavigation, isStoreNavigationPoint } from "../navigation/NavMeshService";
import { overlapsStoreObstacle, scaleStorePoint, STORE_LAYOUT_SCALE } from "../world-scale";
import { OPENING_PURCHASES } from "../progression/MartCampaign";
import { PURCHASE_POSITIONS, PURCHASE_RING } from "./purchase-layout";
import { WORKSTATIONS } from "./workstation-layout";
import { RETAIL_DEPARTMENTS, RETAIL_DEPARTMENT_IDS } from "./retail-layout";
import { FARM_PLOTS } from "./farm-layout";
import { STORE_REAR_DOOR } from "./storefront-layout";

/** Sockets the owner has to stand on to work: a payment ring may never sit on
 * one, or crossing the farm to collect eggs would spend money by itself. */
const WORK_SOCKETS: { id: string; point: [number, number] }[] = [
  ...Object.values(WORKSTATIONS).map((station) => ({ id: `work:${station.id}`, point: [station.position[0], station.position[2]] as [number, number] })),
  ...RETAIL_DEPARTMENT_IDS.map((id) => ({ id: `service:${id}`, point: [...RETAIL_DEPARTMENTS[id].service] as [number, number] })),
  { id: "rear-door-inside", point: [...STORE_REAR_DOOR.insideApproach] as [number, number] },
  { id: "rear-door-outside", point: [...STORE_REAR_DOOR.outsideApproach] as [number, number] },
  // Only the opening bed exists from the start; the rest are bought.
  { id: "crop:crop-tomato-1", point: [FARM_PLOTS[0].position[0], FARM_PLOTS[0].position[2]] as [number, number] },
];

/** Ring reach plus the harvest pass radius, both converted to layout units. */
const MINIMUM_CLEARANCE = 1.6;

describe("purchase ring layout", () => {
  it("places every ring on a walkable cell, clear of obstacles", async () => {
    expect(await ensureStoreNavigation(4)).toBe(true);
    for (const purchase of OPENING_PURCHASES) {
      const position = PURCHASE_POSITIONS[purchase.id];
      const point: [number, number] = [position[0], position[2]];
      expect(isStoreNavigationPoint(point), `${purchase.id} is not reachable`).toBe(true);
      expect(overlapsStoreObstacle(scaleStorePoint(point), 0.32 * STORE_LAYOUT_SCALE), `${purchase.id} overlaps a fixture`).toBe(false);
    }
  });

  it("keeps every ring away from the sockets the owner works from", () => {
    for (const purchase of OPENING_PURCHASES) {
      const position = PURCHASE_POSITIONS[purchase.id];
      for (const socket of WORK_SOCKETS) {
        const distance = Math.hypot(socket.point[0] - position[0], socket.point[1] - position[2]);
        expect(distance, `${purchase.id} sits on ${socket.id}`).toBeGreaterThanOrEqual(MINIMUM_CLEARANCE);
      }
    }
  });

  it("never overlaps two rings that can be pending at the same time", () => {
    const shared = new Map<string, string[]>();
    for (const purchase of OPENING_PURCHASES) {
      const position = PURCHASE_POSITIONS[purchase.id];
      const key = `${position[0]}:${position[2]}`;
      shared.set(key, [...(shared.get(key) ?? []), purchase.id]);
    }
    for (const [, ids] of shared) {
      // Only chains that unlock one after another may share a spot.
      if (ids.length === 1) continue;
      for (const id of ids.slice(1)) {
        const definition = OPENING_PURCHASES.find((purchase) => purchase.id === id)!;
        const dependsOnSibling = definition.requires.some((required) => ids.includes(required));
        expect(dependsOnSibling, `${id} shares a ring with an unrelated purchase`).toBe(true);
      }
    }
    // Distinct rings stay at least their own diameter apart.
    for (const purchase of OPENING_PURCHASES) {
      for (const other of OPENING_PURCHASES) {
        if (other.id === purchase.id) continue;
        const a = PURCHASE_POSITIONS[purchase.id];
        const b = PURCHASE_POSITIONS[other.id];
        const distance = Math.hypot(a[0] - b[0], a[2] - b[2]);
        if (distance === 0) continue;
        expect(distance, `${purchase.id} and ${other.id} overlap`).toBeGreaterThan(PURCHASE_RING.radius * 2);
      }
    }
  });
});
