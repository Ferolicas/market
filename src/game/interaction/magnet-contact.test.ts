import { describe, expect, it } from "vitest";
import { CONTACT_MAGNET_REACH, interactionZonePlanarDistance } from "./InteractionZone";
import { farmAnimalMagnet } from "../stations/farm-layout";
import { productionMachineMagnet, PRODUCTION_WORKSTATION_IDS } from "../stations/production-layout";
import { retailStockingMagnet, RETAIL_DEPARTMENT_IDS } from "../stations/retail-layout";
import { WAREHOUSE_RETURN_STATION } from "../stations/warehouse-layout";
import { STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE, STORE_OBSTACLES } from "../world-scale";

/** The owner's capsule radius in scaled simulation units. */
const PLAYER_BODY_RADIUS = 0.24;

function solidObstacle(id: string) {
  const obstacle = STORE_OBSTACLES.find((candidate) => candidate.id === id);
  expect(obstacle, id).toBeDefined();
  return obstacle!;
}

describe("magnets are the element itself", () => {
  it("reaches only as far as a body brushing the fixture", () => {
    expect(CONTACT_MAGNET_REACH.enter).toBeGreaterThan(PLAYER_BODY_RADIUS);
    expect(CONTACT_MAGNET_REACH.enter).toBeLessThan(PLAYER_BODY_RADIUS * 2);
    expect(CONTACT_MAGNET_REACH.exit).toBeGreaterThan(CONTACT_MAGNET_REACH.enter);
  });

  it.each([["chicken", "fixture:chicken-coop"], ["chicken2", "fixture:chicken-coop-2"], ["cow", "fixture:cow-station"]] as const)("wraps the %s pen exactly on its solid collider", (kind, obstacleId) => {
    const magnet = farmAnimalMagnet(kind, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE);
    const solid = solidObstacle(obstacleId);
    expect(magnet.x).toBeCloseTo(solid.x);
    expect(magnet.z).toBeCloseTo(solid.z);
    expect(magnet.halfExtents[0]).toBeCloseTo(solid.halfX);
    expect(magnet.halfExtents[1]).toBeCloseTo(solid.halfZ);
    // Walking past, one full body width clear of the timbers: nothing.
    const clear = magnet.halfExtents[0] + PLAYER_BODY_RADIUS * 2 + 0.05;
    expect(interactionZonePlanarDistance(magnet, magnet.x + clear, magnet.z)).toBeGreaterThan(magnet.enterRadius);
    // Pressed against the pen (the collider keeps the centre one radius out): active.
    const touching = magnet.halfExtents[1] + PLAYER_BODY_RADIUS + 0.02;
    expect(interactionZonePlanarDistance(magnet, magnet.x, magnet.z + touching)).toBeLessThanOrEqual(magnet.enterRadius);
  });

  it("uses the same contact reach for machines, shelves and the return crate", () => {
    for (const id of PRODUCTION_WORKSTATION_IDS) {
      expect(productionMachineMagnet(id, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE).enterRadius).toBe(CONTACT_MAGNET_REACH.enter);
    }
    for (const id of RETAIL_DEPARTMENT_IDS) {
      expect(retailStockingMagnet(id, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE).enterRadius).toBe(CONTACT_MAGNET_REACH.enter);
    }
    expect(WAREHOUSE_RETURN_STATION.enterRadius).toBe(CONTACT_MAGNET_REACH.enter);
    const crate = solidObstacle(WAREHOUSE_RETURN_STATION.obstacleId);
    expect(WAREHOUSE_RETURN_STATION.footprint.halfX * STORE_ELEMENT_SCALE).toBeCloseTo(crate.halfX);
  });
});
