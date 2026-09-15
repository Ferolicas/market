import { CHECKOUT_LANES } from "./stations/checkout-layout";
import { fixtureAvailable } from "./stations/fixture-availability";
import { FARM_OBSTACLES } from "./stations/farm-layout";
import { PANTRY_DISPLAY_POSITIONS, PRODUCE_DISPLAY_POSITIONS, RETAIL_DEPARTMENT_IDS, RETAIL_DEPARTMENTS } from "./stations/retail-layout";
import { STORE_SERVICE_FIXTURE_IDS, STORE_SERVICE_FIXTURES } from "./stations/store-service-layout";
import { PRODUCTION_CUBICLE, STORE_PRODUCTION_FIXTURES } from "./stations/production-layout";
import { WAREHOUSE_RETURN_STATION } from "./stations/warehouse-layout";

export { STORE_PRODUCTION_FIXTURES } from "./stations/production-layout";

export type WorldPosition = [number, number, number];

// WORLD_SCALE preserves the current rendered size of every character.
export const WORLD_SCALE = 3;
export const STORE_LAYOUT_SCALE = 2;
export const STORE_ELEMENT_SCALE = 1.6;

export interface StoreObstacle {
  id?: string;
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

const productionObstacles: StoreObstacle[] = Object.values(STORE_PRODUCTION_FIXTURES).map((fixture) => ({
  id: fixture.obstacleId,
  x: fixture.position[0] + fixture.localFootprint.centerX * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE,
  z: fixture.position[2] + fixture.localFootprint.centerZ * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE,
  halfX: fixture.localFootprint.halfX,
  halfZ: fixture.localFootprint.halfZ,
}));

const productionCubicleObstacles: StoreObstacle[] = PRODUCTION_CUBICLE.walls.map((wall) => ({
  id: wall.id,
  x: wall.position[0],
  z: wall.position[2],
  // BASE_STORE_OBSTACLES multiplies extents by the element scale. Convert
  // authored layout dimensions first so walls land on their visible panes.
  halfX: wall.halfX * STORE_LAYOUT_SCALE / STORE_ELEMENT_SCALE,
  halfZ: wall.halfZ * STORE_LAYOUT_SCALE / STORE_ELEMENT_SCALE,
}));

const retailObstacles: StoreObstacle[] = RETAIL_DEPARTMENT_IDS.flatMap((departmentId) => {
  const department = RETAIL_DEPARTMENTS[departmentId];
  const quarterTurn = Math.abs(department.yaw ?? 0) % 180 === 90;
  const displays = departmentId === "pantry"
    ? PANTRY_DISPLAY_POSITIONS
    : departmentId === "produce"
      ? PRODUCE_DISPLAY_POSITIONS
      : [department.display] as const;
  return displays.map((display, index) => ({
    id: `fixture:retail-${departmentId}-${index + 1}`,
    x: display[0],
    z: display[2],
    halfX: department.fixtureHalfExtents[quarterTurn ? 1 : 0],
    halfZ: department.fixtureHalfExtents[quarterTurn ? 0 : 1],
  }));
});

const BASE_STORE_OBSTACLES: StoreObstacle[] = [
  ...retailObstacles,
  { x: CHECKOUT_LANES[0].counter[0], z: CHECKOUT_LANES[0].counter[2], halfX: 2.25, halfZ: 0.65 },
  { id: "fixture:checkout-2", x: CHECKOUT_LANES[1].counter[0], z: CHECKOUT_LANES[1].counter[2], halfX: 2.25, halfZ: 0.65 },
  ...productionObstacles,
  ...productionCubicleObstacles,
  {
    id: WAREHOUSE_RETURN_STATION.obstacleId,
    x: WAREHOUSE_RETURN_STATION.position[0],
    z: WAREHOUSE_RETURN_STATION.position[2],
    halfX: WAREHOUSE_RETURN_STATION.footprint.halfX,
    halfZ: WAREHOUSE_RETURN_STATION.footprint.halfZ,
  },
  ...STORE_SERVICE_FIXTURE_IDS.map((fixtureId) => {
    const fixture = STORE_SERVICE_FIXTURES[fixtureId];
    return {
      id: fixture.obstacleId,
      x: fixture.position[0],
      z: fixture.position[2],
      halfX: fixture.footprint.halfX,
      halfZ: fixture.footprint.halfZ,
    };
  }),
  ...FARM_OBSTACLES,
];

export const STORE_OBSTACLES = BASE_STORE_OBSTACLES.map((obstacle) => ({
  id: obstacle.id,
  x: obstacle.x * STORE_LAYOUT_SCALE,
  z: obstacle.z * STORE_LAYOUT_SCALE,
  halfX: obstacle.halfX * STORE_ELEMENT_SCALE,
  halfZ: obstacle.halfZ * STORE_ELEMENT_SCALE,
}));

export function scaleStorePosition(position: WorldPosition): WorldPosition {
  return [position[0] * STORE_LAYOUT_SCALE, position[1], position[2] * STORE_LAYOUT_SCALE];
}

export function scaleStorePoint(point: [number, number]): [number, number] {
  return [point[0] * STORE_LAYOUT_SCALE, point[1] * STORE_LAYOUT_SCALE];
}

/** True when a straight walk between two layout points stays outside every
 * padded fixture. Sampled every 0.2 layout units, which is finer than any
 * fixture footprint or the navigation padding. */
export function storeSegmentIsClear(start: readonly [number, number], end: readonly [number, number], paddingLayout = 0.31) {
  const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const steps = Math.max(1, Math.ceil(distance / 0.2));
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const point: [number, number] = [start[0] + (end[0] - start[0]) * progress, start[1] + (end[1] - start[1]) * progress];
    if (overlapsStoreObstacle(scaleStorePoint(point), paddingLayout * STORE_LAYOUT_SCALE)) return false;
  }
  return true;
}

export function storeObstaclesForAreas(areas: readonly string[] = []) {
  return STORE_OBSTACLES.filter((obstacle) => fixtureAvailable(obstacle.id, areas));
}

export function overlapsStoreObstacle(point: [number, number], radius: number, areas: readonly string[] = []) {
  return STORE_OBSTACLES.some((obstacle) => fixtureAvailable(obstacle.id, areas) && (
    Math.abs(point[0] - obstacle.x) < obstacle.halfX + radius
    && Math.abs(point[1] - obstacle.z) < obstacle.halfZ + radius
  ));
}
