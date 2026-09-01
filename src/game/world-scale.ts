import { CHECKOUT_LANES } from "./stations/checkout-layout";
import { FARM_OBSTACLES } from "./stations/farm-layout";
import { STORE_SERVICE_FIXTURE_IDS, STORE_SERVICE_FIXTURES } from "./stations/store-service-layout";

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

/**
 * Authored production furniture. `position` is the StoreElement origin while
 * `localFootprint` follows the actual GLB bounds inside that scaled group.
 * Rendering, Rapier and Recast all consume this table, preventing invisible
 * blockers before unlock and walk-through machinery afterwards.
 */
export const STORE_PRODUCTION_FIXTURES = {
  flourMill: {
    obstacleId: "fixture:flour-mill",
    position: [-8.75, 0, -4.05] as WorldPosition,
    localFootprint: { centerX: 0, centerZ: -0.98, halfX: 0.65, halfZ: 0.98 },
  },
  breadOven: {
    obstacleId: "fixture:bread-oven",
    position: [-8.75, 0, -0.45] as WorldPosition,
    localFootprint: { centerX: 0.6725, centerZ: -0.95, halfX: 1.3975, halfZ: 0.95 },
  },
  cheeseMaker: {
    obstacleId: "fixture:cheese-maker",
    position: [-6.15, 0, -2.2] as WorldPosition,
    localFootprint: { centerX: 0, centerZ: -0.845, halfX: 0.6, halfZ: 0.845 },
  },
  juiceMachine: {
    obstacleId: "fixture:juice-machine",
    position: [-5.65, 0, 1.55] as WorldPosition,
    localFootprint: { centerX: 0, centerZ: -0.845, halfX: 0.6, halfZ: 0.845 },
  },
} as const;

const productionObstacles: StoreObstacle[] = Object.values(STORE_PRODUCTION_FIXTURES).map((fixture) => ({
  id: fixture.obstacleId,
  x: fixture.position[0] + fixture.localFootprint.centerX * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE,
  z: fixture.position[2] + fixture.localFootprint.centerZ * STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE,
  halfX: fixture.localFootprint.halfX,
  halfZ: fixture.localFootprint.halfZ,
}));

const BASE_STORE_OBSTACLES: StoreObstacle[] = [
  ...[-5.2, -2.8, -0.4, 2].map((x) => ({ x, z: -8.05, halfX: 1.12, halfZ: 0.5 })),
  { x: 5.25, z: -8, halfX: 1.2, halfZ: 0.5 },
  { x: 8.65, z: -7.85, halfX: 0.85, halfZ: 0.5 },
  ...[-4, 0, 4].map((x) => ({ x, z: -2.2, halfX: 1.2, halfZ: 0.78 })),
  { x: -4.1, z: 2.45, halfX: 1.25, halfZ: 0.83 },
  { x: 0, z: 2.45, halfX: 1.25, halfZ: 0.83 },
  { x: 4.05, z: 2.45, halfX: 1.18, halfZ: 0.8 },
  { x: CHECKOUT_LANES[0].counter[0], z: CHECKOUT_LANES[0].counter[2], halfX: 2.25, halfZ: 0.65 },
  { x: CHECKOUT_LANES[1].counter[0], z: CHECKOUT_LANES[1].counter[2], halfX: 2.25, halfZ: 0.65 },
  ...productionObstacles,
  { x: -9, z: 2.05, halfX: 0.9, halfZ: 0.6 },
  { x: -7, z: 3.15, halfX: 1.05, halfZ: 0.7 },
  { x: 8.8, z: -2.65, halfX: 0.95, halfZ: 1.55 },
  { x: 8.8, z: -5.35, halfX: 0.95, halfZ: 0.7 },
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

export function overlapsStoreObstacle(point: [number, number], radius: number) {
  return STORE_OBSTACLES.some((obstacle) => (
    Math.abs(point[0] - obstacle.x) < obstacle.halfX + radius
    && Math.abs(point[1] - obstacle.z) < obstacle.halfZ + radius
  ));
}
