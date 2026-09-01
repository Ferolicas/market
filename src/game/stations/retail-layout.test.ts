import { describe, expect, it } from "vitest";
import { PRODUCT_CONFIG } from "../economy/products";
import { stationTierModifiers } from "../progression/levels";
import { InteractionZoneState } from "../interaction/InteractionZone";
import { overlapsStoreObstacle, scaleStorePoint, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE } from "../world-scale";
import type { ProductId } from "../types";
import { isStockingInteractionId, PRODUCT_RETAIL_DEPARTMENT, retailDepartmentFromStockingInteraction, retailStockingMagnet, retailStockLandingLocalPosition, RETAIL_DEPARTMENTS, RETAIL_DEPARTMENT_IDS, RETAIL_VISUAL_CAPACITY, stockingInteractionId } from "./retail-layout";

const NAVMESH_FURNITURE_PADDING = 0.31 * STORE_LAYOUT_SCALE;

describe("retail service points", () => {
  it("keeps every stocking sensor on a walkable NavMesh lane", () => {
    Object.values(RETAIL_DEPARTMENTS).forEach((department) => {
      const servicePoint = scaleStorePoint([...department.service]);
      expect(
        overlapsStoreObstacle(servicePoint, NAVMESH_FURNITURE_PADDING),
        `${department.id} service point is excluded from the NavMesh`,
      ).toBe(false);
    });
  });

  it("gives every department one stable and reversible magnet id", () => {
    const ids = RETAIL_DEPARTMENT_IDS.map(stockingInteractionId);

    expect(new Set(ids).size).toBe(RETAIL_DEPARTMENT_IDS.length);
    RETAIL_DEPARTMENT_IDS.forEach((departmentId) => {
      const id = stockingInteractionId(departmentId);
      expect(isStockingInteractionId(id)).toBe(true);
      expect(retailDepartmentFromStockingInteraction(id)).toBe(departmentId);
    });
    expect(isStockingInteractionId("stock:unknown")).toBe(false);
    expect(retailDepartmentFromStockingInteraction("checkout")).toBeNull();
  });

  it("wraps every complete fixture and detects its four geometric sides", () => {
    RETAIL_DEPARTMENT_IDS.forEach((departmentId) => {
      const magnet = retailStockingMagnet(departmentId, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE);
      const points = [
        [magnet.x - magnet.halfExtents[0] - magnet.enterRadius + 0.01, magnet.z],
        [magnet.x + magnet.halfExtents[0] + magnet.enterRadius - 0.01, magnet.z],
        [magnet.x, magnet.z - magnet.halfExtents[1] - magnet.enterRadius + 0.01],
        [magnet.x, magnet.z + magnet.halfExtents[1] + magnet.enterRadius - 0.01],
      ];

      points.forEach(([x, z]) => {
        const zone = new InteractionZoneState({
          id: stockingInteractionId(departmentId),
          type: "stock",
          x: magnet.x,
          z: magnet.z,
          halfExtents: magnet.halfExtents,
          enterRadius: magnet.enterRadius,
          exitRadius: magnet.exitRadius,
          actorMask: ["player"],
          priority: 80,
          dwellMs: 0,
          repeatEveryMs: 180,
          channel: "transfer",
        });
        expect(zone.update("player", x, z, 0).map((event) => event.signal), `${departmentId}@${x},${z}`).toEqual(["enter", "tick"]);
      });
    });
  });

  it("keeps department magnets disjoint so proximity never chooses the wrong fixture", () => {
    const magnets = RETAIL_DEPARTMENT_IDS.map((departmentId) => ({
      departmentId,
      ...retailStockingMagnet(departmentId, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE),
    }));

    magnets.forEach((left, index) => magnets.slice(index + 1).forEach((right) => {
      const overlapsX = Math.abs(left.x - right.x)
        < left.halfExtents[0] + right.halfExtents[0] + left.enterRadius + right.enterRadius;
      const overlapsZ = Math.abs(left.z - right.z)
        < left.halfExtents[1] + right.halfExtents[1] + left.enterRadius + right.enterRadius;
      expect(overlapsX && overlapsZ, `${left.departmentId}/${right.departmentId}`).toBe(false);
    }));
  });

  it("lands each product on its real first rendered shelf instead of a generic height", () => {
    expect(retailStockLandingLocalPosition("bread", 0, 1)[1]).toBeCloseTo(0.42);
    expect(retailStockLandingLocalPosition("flour", 0, 1)[1]).toBeCloseTo(1.12);
    expect(retailStockLandingLocalPosition("wheat", 0, 1)[1]).toBeCloseTo(1.47);
    expect(retailStockLandingLocalPosition("coffee", 0, 1)).toEqual([0, 0.38, 0.26]);
    expect(retailStockLandingLocalPosition("eggs", 0, 1)[1]).toBeCloseTo(0.485);
    expect(retailStockLandingLocalPosition("milk", 0, 1)).toEqual([-0.55, 0.46, 0.2]);
    expect(retailStockLandingLocalPosition("cheese", 0, 1)).toEqual([0.55, 0.46, 0.2]);
    expect(retailStockLandingLocalPosition("juice", 0, 1)).toEqual([0, 0.44, 0.21]);
  });

  it("moves later ordinals to the same higher rows and depth lanes used by fixtures", () => {
    expect(retailStockLandingLocalPosition("bread", 8, 9)[1]).toBeCloseTo(0.77);
    expect(retailStockLandingLocalPosition("bread", 16, 17)[1]).toBeCloseTo(1.82);
    expect(retailStockLandingLocalPosition("flour", 12, 13)[2]).toBeCloseTo(0.07);
    expect(retailStockLandingLocalPosition("flour", 24, 25)[2]).toBeCloseTo(0.19);
    expect(retailStockLandingLocalPosition("coffee", 8, 9)[1]).toBeCloseTo(0.74);
    expect(retailStockLandingLocalPosition("eggs", 6, 7)[1]).toBeCloseTo(0.885);
    expect(retailStockLandingLocalPosition("milk", 5, 6)[1]).toBeCloseTo(0.86);
    expect(retailStockLandingLocalPosition("juice", 9, 10)[1]).toBeCloseTo(0.84);
    expect(retailStockLandingLocalPosition("tomatoes", 9, 10)[1]).toBeGreaterThan(1.27);
  });

  it("provides a finite visible slot for every possible tier-ten shelf unit", () => {
    const maximumMultiplier = stationTierModifiers(10).capacity;
    (Object.keys(PRODUCT_RETAIL_DEPARTMENT) as ProductId[]).forEach((productId) => {
      const maximum = Math.round((PRODUCT_CONFIG[productId]?.shelfCapacity ?? 12) * maximumMultiplier);
      expect(RETAIL_VISUAL_CAPACITY[productId], productId).toBeGreaterThanOrEqual(maximum);
      const slots = new Set<string>();
      for (let ordinal = 0; ordinal < maximum; ordinal += 1) {
        const landing = retailStockLandingLocalPosition(productId, ordinal, maximum);
        expect(landing.every(Number.isFinite), `${productId}:${ordinal}`).toBe(true);
        slots.add(landing.map((coordinate) => coordinate.toFixed(5)).join(":"));
      }
      expect(slots.size, `${productId} unique visual slots`).toBe(maximum);
    });
  });
});
