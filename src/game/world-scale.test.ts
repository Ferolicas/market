import { describe, expect, it } from "vitest";
import { CART_RETURN_POINT, RETURNS_POINT, RETURNS_TO_CART_FALLBACK, STORE_SERVICE_FIXTURE_IDS, STORE_SERVICE_FIXTURES } from "./stations/store-service-layout";
import { FARM_GATE } from "./stations/farm-layout";
import { PRODUCTION_CUBICLE } from "./stations/production-layout";
import { overlapsStoreObstacle, scaleStorePoint, scaleStorePosition, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE, STORE_OBSTACLES, STORE_PRODUCTION_FIXTURES, WORLD_SCALE } from "./world-scale";

describe("store scale system", () => {
  it("expands the layout without changing vertical placement", () => {
    expect(scaleStorePosition([3, 1.25, -4])).toEqual([6, 1.25, -8]);
    expect(scaleStorePoint([-2, 5])).toEqual([-4, 10]);
  });

  it("keeps character, layout and element scales independent", () => {
    expect(WORLD_SCALE).toBe(3);
    expect(STORE_LAYOUT_SCALE).toBe(2);
    expect(STORE_ELEMENT_SCALE).toBe(1.6);
  });

  it("detects enlarged furniture footprints", () => {
    expect(overlapsStoreObstacle(scaleStorePoint([0, -2.2]), 0.4)).toBe(true);
    expect(overlapsStoreObstacle(scaleStorePoint([2.2, 0.45]), 0.4)).toBe(false);
  });

  it("shares both rear-door corridor fences with physics and navigation", () => {
    FARM_GATE.accessCorridorFences.forEach((fence, index) => {
      const center = scaleStorePoint([fence.center[0], fence.center[2]]);
      expect(overlapsStoreObstacle(center, 0)).toBe(true);
      expect(STORE_OBSTACLES.some((obstacle) => (
        obstacle.x === center[0]
        && obstacle.z === center[1]
        && obstacle.halfZ === fence.halfZ * STORE_ELEMENT_SCALE
      ))).toBe(true);
      expect(fence.center[0]).toBe(index === 0 ? FARM_GATE.frontPost[0] : FARM_GATE.innerPost[0]);
    });
  });

  it("keeps the lateral pockets sealed at their perimeter ends", () => {
    FARM_GATE.perimeterWallFences.forEach((fence) => {
      const center = scaleStorePoint([fence.center[0], fence.center[2]]);
      expect(overlapsStoreObstacle(center, 0)).toBe(true);
      expect(STORE_OBSTACLES.some((obstacle) => (
        obstacle.x === center[0]
        && obstacle.z === center[1]
        && obstacle.halfZ === fence.halfZ * STORE_ELEMENT_SCALE
      ))).toBe(true);
    });
  });

  it("shares solid service-fixture footprints while keeping their front sockets walkable", () => {
    const navigationPadding = 0.31 * STORE_LAYOUT_SCALE;
    for (const fixtureId of STORE_SERVICE_FIXTURE_IDS) {
      const fixture = STORE_SERVICE_FIXTURES[fixtureId];
      const center = scaleStorePoint([fixture.position[0], fixture.position[2]]);
      const obstacle = STORE_OBSTACLES.find((candidate) => candidate.id === fixture.obstacleId);
      expect(obstacle, fixtureId).toBeDefined();
      expect(overlapsStoreObstacle(center, 0), `${fixtureId} center`).toBe(true);
      expect(obstacle?.halfX).toBeCloseTo(fixture.footprint.halfX * STORE_ELEMENT_SCALE);
      expect(obstacle?.halfZ).toBeCloseTo(fixture.footprint.halfZ * STORE_ELEMENT_SCALE);
    }

    expect(overlapsStoreObstacle(scaleStorePoint([...RETURNS_POINT]), navigationPadding)).toBe(false);
    expect(overlapsStoreObstacle(scaleStorePoint([...CART_RETURN_POINT]), navigationPadding)).toBe(false);
    expect(overlapsStoreObstacle(scaleStorePoint([9.75, 5.55]), navigationPadding)).toBe(true);
    expect(overlapsStoreObstacle(scaleStorePoint([2.65, 6.35]), navigationPadding)).toBe(true);
  });

  it("shares every visible production-machine footprint with physics and navigation", () => {
    for (const fixture of Object.values(STORE_PRODUCTION_FIXTURES)) {
      const obstacle = STORE_OBSTACLES.find((candidate) => candidate.id === fixture.obstacleId);
      const expectedX = fixture.position[0] * STORE_LAYOUT_SCALE + fixture.localFootprint.centerX * STORE_ELEMENT_SCALE;
      const expectedZ = fixture.position[2] * STORE_LAYOUT_SCALE + fixture.localFootprint.centerZ * STORE_ELEMENT_SCALE;

      expect(obstacle, fixture.obstacleId).toBeDefined();
      expect(obstacle?.x).toBeCloseTo(expectedX);
      expect(obstacle?.z).toBeCloseTo(expectedZ);
      expect(obstacle?.halfX).toBeCloseTo(fixture.localFootprint.halfX * STORE_ELEMENT_SCALE);
      expect(obstacle?.halfZ).toBeCloseTo(fixture.localFootprint.halfZ * STORE_ELEMENT_SCALE);
      expect(overlapsStoreObstacle([expectedX, expectedZ], 0), fixture.obstacleId).toBe(true);
    }
  });

  it("shares every glass production-room wall with physics and navigation", () => {
    for (const wall of PRODUCTION_CUBICLE.walls) {
      const obstacle = STORE_OBSTACLES.find((candidate) => candidate.id === wall.id);
      expect(obstacle, wall.id).toBeDefined();
      expect(obstacle?.x).toBeCloseTo(wall.position[0] * STORE_LAYOUT_SCALE);
      expect(obstacle?.z).toBeCloseTo(wall.position[2] * STORE_LAYOUT_SCALE);
      expect(obstacle?.halfX).toBeCloseTo(wall.halfX * STORE_LAYOUT_SCALE);
      expect(obstacle?.halfZ).toBeCloseTo(wall.halfZ * STORE_LAYOUT_SCALE);
      expect(overlapsStoreObstacle(scaleStorePoint([wall.position[0], wall.position[2]]), 0)).toBe(true);
    }
  });

  it("keeps the pre-Recast returns route outside every padded fixture", () => {
    const navigationPadding = 0.31 * STORE_LAYOUT_SCALE;
    const route = [RETURNS_POINT, ...RETURNS_TO_CART_FALLBACK];
    for (let index = 1; index < route.length; index += 1) {
      const start = route[index - 1];
      const end = route[index];
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const steps = Math.max(1, Math.ceil(distance / 0.04));
      for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps;
        const point: [number, number] = [
          start[0] + (end[0] - start[0]) * progress,
          start[1] + (end[1] - start[1]) * progress,
        ];
        expect(overlapsStoreObstacle(scaleStorePoint(point), navigationPadding), `segment ${index} at ${point.join(",")}`).toBe(false);
      }
    }
  });
});
