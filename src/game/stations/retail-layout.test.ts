import { describe, expect, it } from "vitest";
import { stationTierModifiers } from "../progression/levels";
import { InteractionZoneState } from "../interaction/InteractionZone";
import { overlapsStoreObstacle, scaleStorePoint, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE } from "../world-scale";
import type { ProductId } from "../types";
import { distributedFixtureQuantity, isStockingInteractionId, PRODUCE_BIN_COLUMNS, PRODUCE_DECK, PRODUCE_DISPLAY_POSITIONS, produceBinColumn, PRODUCT_RETAIL_DEPARTMENT, retailDepartmentFromStockingInteraction, retailFixtureDisplayPositions, retailShelfCapacity, retailStockFixtureSlot, retailStockingMagnet, retailStockLandingLocalPosition, RETAIL_DEPARTMENTS, RETAIL_DEPARTMENT_IDS, RETAIL_FRONT_CAPACITY, RETAIL_SHELF_GRIDS, RETAIL_VISUAL_CAPACITY, stockingInteractionId } from "./retail-layout";

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
    expect(retailStockLandingLocalPosition("coffee", 0, 1)).toEqual([0, 0.38, 0.45]);
    expect(retailStockLandingLocalPosition("eggs", 0, 1)[1]).toBeCloseTo(0.485);
    expect(retailStockLandingLocalPosition("milk", 0, 1)).toEqual([-0.55, 0.46, 0.24]);
    expect(retailStockLandingLocalPosition("cheese", 0, 1)).toEqual([0.55, 0.46, 0.24]);
    expect(retailStockLandingLocalPosition("juice", 0, 1)).toEqual([0, 0.44, 0.24]);
  });

  it("spreads units over every level of the front row before using deeper rows", () => {
    // Second unit climbs to the next shelf; the front row of every level is
    // complete before any unit moves one depth row back.
    expect(retailStockLandingLocalPosition("bread", 1, 2)[1]).toBeCloseTo(0.77);
    expect(retailStockLandingLocalPosition("bread", 2, 3)[1]).toBeCloseTo(1.82);
    expect(retailStockLandingLocalPosition("bread", 23, 24)[2]).toBeCloseTo(0.16);
    expect(retailStockLandingLocalPosition("bread", 24, 25)[2]).toBeCloseTo(0);
    expect(retailStockLandingLocalPosition("flour", 12, 13)[2]).toBeCloseTo(0.04);
    expect(retailStockLandingLocalPosition("flour", 24, 25)[2]).toBeCloseTo(-0.1);
    expect(retailStockLandingLocalPosition("coffee", 1, 2)[1]).toBeCloseTo(0.74);
    expect(retailStockLandingLocalPosition("coffee", 40, 41)[2]).toBeCloseTo(0.31);
    expect(retailStockLandingLocalPosition("eggs", 1, 2)[1]).toBeCloseTo(0.885);
    expect(retailStockLandingLocalPosition("milk", 1, 2)[1]).toBeCloseTo(0.86);
    expect(retailStockLandingLocalPosition("juice", 1, 2)[1]).toBeCloseTo(0.84);
    // A partial front row stays centred on its shelf.
    expect(retailStockLandingLocalPosition("juice", 0, 1)[0]).toBeCloseTo(0);
    expect(retailStockLandingLocalPosition("juice", 0, 10)[0]).toBeCloseTo(-0.1);
    expect(retailStockLandingLocalPosition("juice", 5, 10)[0]).toBeCloseTo(0.1);
    // Produce fills its bin back to front; the second layer only starts once
    // the deck is covered, and stays above the first layer.
    expect(retailStockLandingLocalPosition("tomatoes", 3, 4)[2]).toBeGreaterThan(retailStockLandingLocalPosition("tomatoes", 0, 1)[2]);
    expect(retailStockLandingLocalPosition("tomatoes", 15, 16)[1]).toBeGreaterThan(retailStockLandingLocalPosition("tomatoes", 14, 15)[1] + 0.1);
  });

  it("keeps every produce unit inside the bin owned by its SKU", () => {
    const halfBin = PRODUCE_DECK.width / 2;
    RETAIL_DEPARTMENTS.produce.products.forEach((productId, index) => {
      expect(produceBinColumn(productId)).toBe(PRODUCE_BIN_COLUMNS[index]);
      for (let ordinal = 0; ordinal < RETAIL_VISUAL_CAPACITY[productId]; ordinal += 1) {
        const [x, y, z] = retailStockLandingLocalPosition(productId, ordinal, RETAIL_VISUAL_CAPACITY[productId]);
        expect(Math.abs(x - PRODUCE_BIN_COLUMNS[index]), `${productId}:${ordinal} x`).toBeLessThan(halfBin);
        expect(Math.abs(z - PRODUCE_DECK.center[2]), `${productId}:${ordinal} z`).toBeLessThan(PRODUCE_DECK.depth / 2);
        expect(y, `${productId}:${ordinal} y`).toBeGreaterThan(PRODUCE_DECK.center[1] - PRODUCE_DECK.depth / 2 * Math.sin(PRODUCE_DECK.tilt));
      }
    });
    expect(new Set(PRODUCE_BIN_COLUMNS).size).toBe(RETAIL_DEPARTMENTS.produce.products.length);
  });

  it("deals units and capacity round-robin across the fixtures of a department", () => {
    expect(retailFixtureDisplayPositions("produce")).toBe(PRODUCE_DISPLAY_POSITIONS);
    expect(retailFixtureDisplayPositions("dairy")).toEqual([RETAIL_DEPARTMENTS.dairy.display]);
    expect([0, 1].map((fixture) => distributedFixtureQuantity(7, fixture, 2))).toEqual([4, 3]);
    expect([0, 1].map((fixture) => distributedFixtureQuantity(12, fixture, 2))).toEqual([6, 6]);
    expect([0, 1, 2].map((fixture) => distributedFixtureQuantity(0, fixture, 3))).toEqual([0, 0, 0]);

    // The seventh unit of a produce SKU is the fourth unit of the first table.
    expect(retailStockFixtureSlot("produce", 6, 7)).toEqual({ fixtureIndex: 0, localOrdinal: 3, localEnd: 4 });
    expect(retailStockFixtureSlot("produce", 7, 8)).toEqual({ fixtureIndex: 1, localOrdinal: 3, localEnd: 4 });
    expect(retailStockFixtureSlot("dairy", 5, 6)).toEqual({ fixtureIndex: 0, localOrdinal: 5, localEnd: 6 });
    for (let total = 0; total <= 26; total += 1) {
      const perFixture = [0, 0];
      for (let ordinal = 0; ordinal < total; ordinal += 1) perFixture[retailStockFixtureSlot("produce", ordinal, total).fixtureIndex] += 1;
      expect(perFixture).toEqual([distributedFixtureQuantity(total, 0, 2), distributedFixtureQuantity(total, 1, 2)]);
    }
  });

  it("makes tier-one capacity exactly the physical front slots of every fixture", () => {
    expect(RETAIL_FRONT_CAPACITY.bread).toBe(24);
    expect(RETAIL_FRONT_CAPACITY.coffee).toBe(40);
    expect(RETAIL_FRONT_CAPACITY.tomatoes).toBe(15);
    expect(retailShelfCapacity("tomatoes")).toBe(30);
    expect(retailShelfCapacity("coffee")).toBe(120);
    expect(retailShelfCapacity("bread")).toBe(24);
    (Object.keys(RETAIL_SHELF_GRIDS) as (keyof typeof RETAIL_SHELF_GRIDS)[]).forEach((productId) => {
      const grid = RETAIL_SHELF_GRIDS[productId];
      const seen = new Set<string>();
      for (let ordinal = 0; ordinal < RETAIL_FRONT_CAPACITY[productId]; ordinal += 1) {
        const [, y, z] = retailStockLandingLocalPosition(productId, ordinal, RETAIL_FRONT_CAPACITY[productId]);
        expect(z, `${productId}:${ordinal} stays on the front row at tier 1`).toBeCloseTo(grid.frontZ);
        seen.add(`${y.toFixed(4)}:${z.toFixed(4)}:${retailStockLandingLocalPosition(productId, ordinal, RETAIL_FRONT_CAPACITY[productId])[0].toFixed(4)}`);
      }
      expect(seen.size, `${productId} front slots are distinct`).toBe(RETAIL_FRONT_CAPACITY[productId]);
    });
  });

  it("provides a finite visible slot for every possible tier-ten unit of one fixture", () => {
    const maximumMultiplier = stationTierModifiers(10).capacity;
    (Object.keys(PRODUCT_RETAIL_DEPARTMENT) as ProductId[]).forEach((productId) => {
      const fixtureCount = retailFixtureDisplayPositions(PRODUCT_RETAIL_DEPARTMENT[productId]).length;
      const maximum = distributedFixtureQuantity(Math.round(retailShelfCapacity(productId) * maximumMultiplier), 0, fixtureCount);
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
