import { describe, expect, it } from "vitest";
import { interactionZonePlanarDistance, type InteractionZoneConfig } from "../interaction/InteractionZone";
import { ensureStoreNavigation, isStoreNavigationPoint, storePathfinder } from "../navigation/NavMeshService";
import { STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE } from "../world-scale";
import {
  productionFixtureForWorkstation,
  productionMachineMagnet,
  PRODUCTION_CUBICLE,
  PRODUCTION_WORKSTATION_IDS,
} from "./production-layout";

function zoneFor(id: (typeof PRODUCTION_WORKSTATION_IDS)[number]): InteractionZoneConfig {
  const magnet = productionMachineMagnet(id, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE);
  return {
    id,
    type: id,
    ...magnet,
    actorMask: ["player"],
    priority: 70,
    dwellMs: 0,
    repeatEveryMs: 180,
    channel: "transfer",
  };
}

describe("professional production room layout", () => {
  it.each(PRODUCTION_WORKSTATION_IDS)("wraps every side and corner of %s with one magnet", (id) => {
    const zone = zoneFor(id);
    const [halfX, halfZ] = zone.halfExtents!;
    const cornerOffset = zone.enterRadius * 0.68;
    const samples = [
      [zone.x - halfX - zone.enterRadius * 0.95, zone.z],
      [zone.x + halfX + zone.enterRadius * 0.95, zone.z],
      [zone.x, zone.z - halfZ - zone.enterRadius * 0.95],
      [zone.x, zone.z + halfZ + zone.enterRadius * 0.95],
      [zone.x - halfX - cornerOffset, zone.z - halfZ - cornerOffset],
      [zone.x + halfX + cornerOffset, zone.z - halfZ - cornerOffset],
      [zone.x - halfX - cornerOffset, zone.z + halfZ + cornerOffset],
      [zone.x + halfX + cornerOffset, zone.z + halfZ + cornerOffset],
    ];

    samples.forEach(([x, z]) => {
      expect(interactionZonePlanarDistance(zone, x, z), `${id} at ${x},${z}`).toBeLessThanOrEqual(zone.enterRadius);
    });
  });

  it("keeps every automated operator socket connected through the glass doorway", async () => {
    await ensureStoreNavigation(90_021);
    const start: [number, number] = [PRODUCTION_CUBICLE.doorway.centerX, PRODUCTION_CUBICLE.bounds.front + 0.9];
    PRODUCTION_WORKSTATION_IDS.forEach((id) => {
      const target = productionFixtureForWorkstation(id).operatorWorkPoint;
      const endpoint = storePathfinder(start, [...target]).at(-1);
      expect(isStoreNavigationPoint(target), id).toBe(true);
      expect(endpoint, id).toBeDefined();
      expect(Math.hypot((endpoint?.[0] ?? 0) - target[0], (endpoint?.[1] ?? 0) - target[1]), id).toBeLessThan(0.2);
    });
  });

  it("keeps the front glass doorway open while sealing its two sides", () => {
    const { centerX } = PRODUCTION_CUBICLE.doorway;
    const { front } = PRODUCTION_CUBICLE.bounds;
    expect(isStoreNavigationPoint([centerX, front])).toBe(true);
    expect(isStoreNavigationPoint([centerX, front - 0.55])).toBe(true);
    expect(isStoreNavigationPoint([PRODUCTION_CUBICLE.walls[3].position[0], front])).toBe(false);
    expect(isStoreNavigationPoint([PRODUCTION_CUBICLE.walls[4].position[0], front])).toBe(false);
  });

  it("leaves physical player clearance around all four sides of every machine", () => {
    const requiredCorridor = 2 * (0.24 / STORE_LAYOUT_SCALE);
    const { left, right, rear, front } = PRODUCTION_CUBICLE.bounds;
    PRODUCTION_WORKSTATION_IDS.forEach((id) => {
      const fixture = productionFixtureForWorkstation(id);
      const footprint = fixture.localFootprint;
      const centerX = fixture.position[0] + footprint.centerX * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE;
      const centerZ = fixture.position[2] + footprint.centerZ * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE;
      const halfX = footprint.halfX * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE;
      const halfZ = footprint.halfZ * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE;
      const clearances = [
        centerX - halfX - left,
        right - centerX - halfX,
        centerZ - halfZ - rear,
        front - centerZ - halfZ,
      ];
      clearances.forEach((clearance, side) => expect(clearance, `${id} side ${side}`).toBeGreaterThan(requiredCorridor));
    });
  });
});
