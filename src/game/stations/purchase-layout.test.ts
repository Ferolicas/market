import { describe, expect, it } from "vitest";
import { ensureStoreNavigation, isStoreNavigationPoint } from "../navigation/NavMeshService";
import { overlapsStoreObstacle, scaleStorePoint, STORE_LAYOUT_SCALE } from "../world-scale";
import { OPENING_PURCHASES } from "../progression/MartCampaign";
import { PURCHASE_MARKER_CLEARANCE, PURCHASE_MARKER_PLACEMENTS, PURCHASE_POSITIONS, PURCHASE_WORK_SOCKETS } from "./purchase-layout";
import { PURCHASE_MARKER } from "./purchase-marker";
import { ALL_PURCHASED_AREAS } from "./fixture-availability";
import { FARM_VISIBLE_FRONT_Z } from "./farm-layout";

/** Two squares must not overlap: their diagonal in layout units. */
const SQUARE_SEPARATION = PURCHASE_MARKER.halfSize * 2 * Math.SQRT2 * 0.8;

describe("purchase marker layout", () => {
  it("places every marker on a walkable cell of the fullest store, clear of obstacles", async () => {
    expect(await ensureStoreNavigation(ALL_PURCHASED_AREAS)).toBe(true);
    for (const purchase of OPENING_PURCHASES) {
      const position = PURCHASE_POSITIONS[purchase.id];
      const point: [number, number] = [position[0], position[2]];
      expect(isStoreNavigationPoint(point, ALL_PURCHASED_AREAS), `${purchase.id} is not reachable`).toBe(true);
      expect(overlapsStoreObstacle(scaleStorePoint(point), 0.32 * STORE_LAYOUT_SCALE, ALL_PURCHASED_AREAS), `${purchase.id} overlaps a fixture`).toBe(false);
    }
  });

  it("keeps every marker off the sockets the owner works from", () => {
    for (const purchase of OPENING_PURCHASES) {
      const position = PURCHASE_POSITIONS[purchase.id];
      for (const socket of PURCHASE_WORK_SOCKETS) {
        const distance = Math.hypot(socket.point[0] - position[0], socket.point[1] - position[2]);
        expect(distance, `${purchase.id} sits on ${socket.id}`).toBeGreaterThanOrEqual(PURCHASE_MARKER_CLEARANCE);
      }
    }
  });

  it("puts each element's marker at a corner of the element, lower-left first", () => {
    const cornered = OPENING_PURCHASES.filter((purchase) => PURCHASE_MARKER_PLACEMENTS[purchase.id].corner !== "authored");
    // Every pen, bed, display and machine gets a corner; only the farmers,
    // the owner's own upgrade and the expansion stand on their own.
    expect(OPENING_PURCHASES.filter((purchase) => PURCHASE_MARKER_PLACEMENTS[purchase.id].corner === "authored").map((purchase) => purchase.id).sort())
      .toEqual(["expansion-1", "farmer-1", "farmer-2", "farmer-3", "player-2"]);
    expect(cornered.filter((purchase) => PURCHASE_MARKER_PLACEMENTS[purchase.id].corner === "lower-left").length).toBeGreaterThanOrEqual(cornered.length / 2);
  });

  it("keeps farm markers in front of the wall's shadow", () => {
    for (const purchase of OPENING_PURCHASES) {
      const position = PURCHASE_POSITIONS[purchase.id];
      if (position[2] > -9) continue;
      expect(position[2], `${purchase.id} hides behind the wall`).toBeLessThanOrEqual(FARM_VISIBLE_FRONT_Z - 0.3);
    }
  });

  it("never overlaps two markers that can be pending at the same time", () => {
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
        expect(dependsOnSibling, `${id} shares a marker with an unrelated purchase`).toBe(true);
      }
    }
    for (const purchase of OPENING_PURCHASES) {
      for (const other of OPENING_PURCHASES) {
        if (other.id === purchase.id) continue;
        const a = PURCHASE_POSITIONS[purchase.id];
        const b = PURCHASE_POSITIONS[other.id];
        const distance = Math.hypot(a[0] - b[0], a[2] - b[2]);
        if (distance === 0) continue;
        expect(distance, `${purchase.id} and ${other.id} overlap`).toBeGreaterThan(SQUARE_SEPARATION);
      }
    }
  });
});
