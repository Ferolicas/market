import { CHECKOUT_LANES } from "./stations/checkout-layout";

export type WorldPosition = [number, number, number];

// WORLD_SCALE preserves the current rendered size of every character.
export const WORLD_SCALE = 3;
export const STORE_LAYOUT_SCALE = 2;
export const STORE_ELEMENT_SCALE = 1.6;

export interface StoreObstacle {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

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
  { x: -8.75, z: -4.05, halfX: 0.9, halfZ: 0.78 },
  { x: -8.75, z: -0.45, halfX: 1, halfZ: 1.45 },
  { x: -9, z: 2.05, halfX: 0.9, halfZ: 0.6 },
  { x: -7, z: 3.15, halfX: 1.05, halfZ: 0.7 },
  { x: 8.8, z: -2.65, halfX: 0.95, halfZ: 1.55 },
  { x: 8.8, z: -5.35, halfX: 0.95, halfZ: 0.7 },
];

export const STORE_OBSTACLES = BASE_STORE_OBSTACLES.map((obstacle) => ({
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
