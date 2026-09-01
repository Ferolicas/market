import type { CropState } from "../types";
import { STORE_REAR_DOOR } from "./storefront-layout";

export type FarmPlotId = "crop-tomato-1" | "crop-tomato-2" | "crop-wheat-1" | "crop-corn-1";
export type FarmInteractionId = `farm:${FarmPlotId}`;

export interface FarmPlotLayout {
  id: FarmPlotId;
  productId: CropState["productId"];
  position: readonly [number, number, number];
  accent: string;
}

export interface FarmFacilityLayout {
  position: readonly [number, number, number];
}

export interface FarmAnimalStationLayout extends FarmFacilityLayout {
  workPosition: readonly [number, number, number];
  facing: number;
}

export interface FarmObstacleLayout {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

/**
 * The storefront sits on positive Z. The estate is intentionally beyond the
 * rear wall on negative Z, reached directly through the rear service door.
 * All values use the same unscaled layout coordinates consumed by navigation.
 */
const FARM_SERVICE_LANE_X = 12.15;
const FARM_ELEMENT_TO_LAYOUT_RATIO = 0.8;
const FARM_FRONT_FENCE_Z = -10.575;
const FARM_SIDE_FENCE_X = 10.6;
const REAR_DOOR_CLEAR_HALF_WIDTH = STORE_REAR_DOOR.door.outerPostOffset - STORE_REAR_DOOR.door.postWidth / 2;
const FARM_GATE_LEFT_POST_X = STORE_REAR_DOOR.x - REAR_DOOR_CLEAR_HALF_WIDTH;
const FARM_GATE_RIGHT_POST_X = STORE_REAR_DOOR.x + REAR_DOOR_CLEAR_HALF_WIDTH;
const STORE_REAR_DOOR_FARM_FACE_Z = STORE_REAR_DOOR.z - STORE_REAR_DOOR.door.frameDepth / 2;
const STORE_REAR_WALL_OUTER_Z = STORE_REAR_DOOR.wallCenterZ - STORE_REAR_DOOR.wallDepth / 2;
const ACCESS_CORRIDOR_FENCE_CENTER_Z = (FARM_FRONT_FENCE_Z + STORE_REAR_DOOR_FARM_FACE_Z) / 2;
const ACCESS_CORRIDOR_FENCE_HALF_Z = Math.abs(FARM_FRONT_FENCE_Z - STORE_REAR_DOOR_FARM_FACE_Z)
  / 2 / FARM_ELEMENT_TO_LAYOUT_RATIO;
const PERIMETER_WALL_FENCE_CENTER_Z = (FARM_FRONT_FENCE_Z + STORE_REAR_WALL_OUTER_Z) / 2;
const PERIMETER_WALL_FENCE_HALF_Z = Math.abs(FARM_FRONT_FENCE_Z - STORE_REAR_WALL_OUTER_Z)
  / 2 / FARM_ELEMENT_TO_LAYOUT_RATIO;

/** One source for the visible gate, its physical solids and both approaches. */
export const FARM_GATE = {
  center: [STORE_REAR_DOOR.x, 0, FARM_FRONT_FENCE_Z] as const,
  frontPost: [FARM_GATE_LEFT_POST_X, 0, FARM_FRONT_FENCE_Z] as const,
  innerPost: [FARM_GATE_RIGHT_POST_X, 0, FARM_FRONT_FENCE_Z] as const,
  // The open leaf has the same rendered length as the 2.6-layout-unit gate
  // opening and starts flush behind the inner hinge post.
  openLeaf: { center: [8.8, 0, -11.875] as const, halfX: 0.07, halfZ: 1.625, terminalPostDepth: 0.09 },
  rightFence: { center: [FARM_SIDE_FENCE_X, 0, -14.15] as const, halfX: 0.07, halfZ: 4.46875 },
  leftFrontFence: { center: [-2.2, 0, FARM_FRONT_FENCE_Z] as const, halfX: 10.5, halfZ: 0.07 },
  rightFrontFence: { center: [9.7, 0, FARM_FRONT_FENCE_Z] as const, halfX: 1.125, halfZ: 0.07 },
  // These two rails form a direct chute from the clear edges of the rear door
  // to the matching gate posts. They prevent turning into either transverse
  // passage before entering the estate. Authored half extents account for
  // StoreElement's 1.6 render scale versus the 2.0 navigation layout scale.
  accessCorridorFences: [
    { side: -1, center: [FARM_GATE_LEFT_POST_X, 0, ACCESS_CORRIDOR_FENCE_CENTER_Z] as const, halfX: 0.07, halfZ: ACCESS_CORRIDOR_FENCE_HALF_Z },
    { side: 1, center: [FARM_GATE_RIGHT_POST_X, 0, ACCESS_CORRIDOR_FENCE_CENTER_Z] as const, halfX: 0.07, halfZ: ACCESS_CORRIDOR_FENCE_HALF_Z },
  ] as const,
  // Keep the transverse pockets closed at their outer ends as a secondary
  // safeguard. The access fences above are the ones that stop a turn made
  // immediately after leaving the rear door.
  perimeterWallFences: [
    { side: -1, center: [-FARM_SIDE_FENCE_X, 0, PERIMETER_WALL_FENCE_CENTER_Z] as const, halfX: 0.07, halfZ: PERIMETER_WALL_FENCE_HALF_Z },
    { side: 1, center: [FARM_SIDE_FENCE_X, 0, PERIMETER_WALL_FENCE_CENTER_Z] as const, halfX: 0.07, halfZ: PERIMETER_WALL_FENCE_HALF_Z },
  ] as const,
  exteriorApproach: [STORE_REAR_DOOR.outsideApproach[0], -9.35] as const,
  // Recast's first complete cell beyond the posts. Using the geometric fence
  // line itself makes a capsule chase an unreachable projection after entry.
  interiorApproach: [7.5, -11.55] as const,
  postHalfSize: 0.11,
} as const;

/** Center of the visible terminal post, kept fully inside the leaf collider. */
export function farmGateOpenLeafTerminalPost(layoutScale: number, elementScale: number) {
  const safeLayoutScale = Math.max(Number.EPSILON, layoutScale);
  const elementToLayout = Math.max(0, elementScale) / safeLayoutScale;
  const directionZ = Math.sign(FARM_GATE.openLeaf.center[2] - FARM_GATE.innerPost[2]) || -1;
  return [
    FARM_GATE.openLeaf.center[0],
    FARM_GATE.openLeaf.center[2] + directionZ * (FARM_GATE.openLeaf.halfZ - FARM_GATE.openLeaf.terminalPostDepth / 2) * elementToLayout,
  ] as const;
}

export const FARM_FIELD = {
  center: [0, 0, -14.15] as const,
  size: [21.2, 0, 7.15] as const,
  // Interior arrival remains aligned with the centre of the visible opening.
  entrance: [FARM_GATE.interiorApproach[0], 0, FARM_GATE.interiorApproach[1]] as const,
  serviceLaneX: FARM_SERVICE_LANE_X,
} as const;

export const FARM_WORKER_HOME = [-1.7, -11.7] as const;

/** Footprint occupied by the retired facade farm in schema-v4 saves created
 * before the estate moved behind the building. It covers all four old beds,
 * both animal stations and their immediate work apron, but not the storefront
 * entrance itself. Persisted workers and remaining route points use this only
 * as a migration marker; it never participates in current navigation. */
export const RETIRED_FRONT_FARM_BOUNDS = {
  minX: -10.8,
  maxX: -0.6,
  minZ: 8.8,
  maxZ: 13,
} as const;

export function isRetiredFrontFarmPoint(point: readonly [number, number]) {
  return point[0] >= RETIRED_FRONT_FARM_BOUNDS.minX
    && point[0] <= RETIRED_FRONT_FARM_BOUNDS.maxX
    && point[1] >= RETIRED_FRONT_FARM_BOUNDS.minZ
    && point[1] <= RETIRED_FRONT_FARM_BOUNDS.maxZ;
}

/** Values are local element units; the 3D scene applies STORE_ELEMENT_SCALE. */
export const FARM_HARVEST_SENSOR = {
  enterRadius: 1.28,
  exitRadius: 1.42,
  dwellMs: 35,
  repeatEveryMs: 220,
  exitGraceMs: 90,
} as const;

export function scaledFarmHarvestSensor(elementScale: number) {
  return {
    ...FARM_HARVEST_SENSOR,
    enterRadius: FARM_HARVEST_SENSOR.enterRadius * elementScale,
    exitRadius: FARM_HARVEST_SENSOR.exitRadius * elementScale,
  };
}

export const FARM_PLOTS: readonly FarmPlotLayout[] = [
  { id: "crop-tomato-1", productId: "tomatoes", position: [-6.3, 0, -12.72], accent: "#e34f3f" },
  { id: "crop-tomato-2", productId: "tomatoes", position: [-3.55, 0, -12.72], accent: "#ef6a4b" },
  { id: "crop-wheat-1", productId: "wheat", position: [-6.3, 0, -15.45], accent: "#e9b83f" },
  { id: "crop-corn-1", productId: "corn", position: [-3.55, 0, -15.45], accent: "#f0c438" },
] as const;

export const FARM_FACILITIES = {
  tools: { position: [-9.05, 0, -11.72] },
  compost: { position: [-9.35, 0, -16.55] },
  greenhouse: { position: [8.4, 0, -16.25] },
  scarecrow: { position: [-8.9, 0, -14.15] },
  waterTank: { position: [-0.7, 0, -16.55] },
} as const satisfies Record<string, FarmFacilityLayout>;

export const FARM_ANIMAL_STATIONS = {
  chicken: { position: [1.2, 0, -14.15], workPosition: [1.2, 0, -12.45], facing: Math.PI },
  cow: { position: [5.35, 0, -14.45], workPosition: [5.35, 0, -12.45], facing: Math.PI },
} as const satisfies Record<"chicken" | "cow", FarmAnimalStationLayout>;

export const FARM_ACCESS_WAYPOINTS = [
  [...STORE_REAR_DOOR.insideApproach],
  [...STORE_REAR_DOOR.outsideApproach],
  [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]],
] as const satisfies readonly (readonly [number, number])[];

/**
 * A shared, obstacle-free spine inside the estate. Fallback employee routes
 * use this corridor in both directions while Recast is still warming up, so
 * a diagonal from the gate can never cut through a reserved animal paddock.
 */
export const FARM_INTERIOR_WAYPOINTS = {
  entranceApron: [7.7, -11.65],
  cropJunction: [-2, -11.65],
  southCropJunction: [-2, -15.45],
} as const satisfies Record<string, readonly [number, number]>;

type FarmPoint = readonly [number, number];

function sameFarmPoint(a: FarmPoint, b: FarmPoint) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.08;
}

function compactFarmRoute(start: FarmPoint, route: readonly FarmPoint[]) {
  let previous = start;
  return route.reduce<[number, number][]>((points, point) => {
    if (sameFarmPoint(previous, point)) return points;
    const next: [number, number] = [point[0], point[1]];
    points.push(next);
    previous = next;
    return points;
  }, []);
}

// Navigation obstacles are rendered at STORE_ELEMENT_SCALE (1.6) while route
// coordinates are consumed at STORE_LAYOUT_SCALE (2). Keep the same 31 cm
// actor clearance as the navmesh fallback checks before accepting a shortcut.
function farmSegmentIsObstacleFree(start: FarmPoint, destination: FarmPoint) {
  return !FARM_OBSTACLES.some((obstacle) => {
    const halfX = obstacle.halfX * FARM_ELEMENT_TO_LAYOUT_RATIO + 0.31;
    const halfZ = obstacle.halfZ * FARM_ELEMENT_TO_LAYOUT_RATIO + 0.31;
    const deltaX = destination[0] - start[0];
    const deltaZ = destination[1] - start[1];
    let minimum = 0;
    let maximum = 1;

    for (const [origin, delta, center, half] of [
      [start[0], deltaX, obstacle.x, halfX],
      [start[1], deltaZ, obstacle.z, halfZ],
    ] as const) {
      const lower = center - half;
      const upper = center + half;
      if (Math.abs(delta) < 1e-8) {
        if (origin < lower || origin > upper) return false;
        continue;
      }
      const first = (lower - origin) / delta;
      const second = (upper - origin) / delta;
      minimum = Math.max(minimum, Math.min(first, second));
      maximum = Math.min(maximum, Math.max(first, second));
      if (minimum > maximum) return false;
    }
    return true;
  });
}

function farmCorridorFromApron(destination: FarmPoint) {
  const entrance: FarmPoint = [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]];
  if (sameFarmPoint(destination, entrance)) return [];

  const route: [number, number][] = [[...FARM_INTERIOR_WAYPOINTS.entranceApron]];
  if (destination[0] <= 0) {
    route.push([...FARM_INTERIOR_WAYPOINTS.cropJunction]);
    if (destination[1] < -14) route.push([...FARM_INTERIOR_WAYPOINTS.southCropJunction]);
  }
  route.push([destination[0], destination[1]]);
  return route;
}

/** Route after reaching the open farm gate; the gate itself is not repeated. */
export function farmInteriorRouteFromEntrance(destination: FarmPoint) {
  const entrance: FarmPoint = [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]];
  return compactFarmRoute(entrance, farmCorridorFromApron(destination));
}

/** Route from an estate destination back through the open farm gate. */
export function farmInteriorRouteToEntrance(start: FarmPoint) {
  const entrance: FarmPoint = [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]];
  if (sameFarmPoint(start, entrance)) return [];
  return compactFarmRoute(start, [
    ...farmCorridorFromApron(start).reverse(),
    entrance,
  ]);
}

/** Obstacle-safe fallback between two destinations already inside the farm. */
export function farmInteriorRouteBetween(start: FarmPoint, destination: FarmPoint) {
  if (sameFarmPoint(start, destination)) return [];
  const entrance: FarmPoint = [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]];
  const nodes = [
    start,
    destination,
    entrance,
    ...Object.values(FARM_INTERIOR_WAYPOINTS),
  ].reduce<FarmPoint[]>((unique, point) => {
    if (!unique.some((candidate) => sameFarmPoint(candidate, point))) unique.push(point);
    return unique;
  }, []);
  const destinationIndex = nodes.findIndex((point) => sameFarmPoint(point, destination));
  const distances = nodes.map(() => Number.POSITIVE_INFINITY);
  const previous = nodes.map(() => -1);
  const visited = nodes.map(() => false);
  distances[0] = 0;

  for (let step = 0; step < nodes.length; step += 1) {
    let current = -1;
    nodes.forEach((_, index) => {
      if (!visited[index] && (current < 0 || distances[index] < distances[current])) current = index;
    });
    if (current < 0 || !Number.isFinite(distances[current])) break;
    if (current === destinationIndex) break;
    visited[current] = true;

    nodes.forEach((candidate, index) => {
      if (visited[index] || index === current || !farmSegmentIsObstacleFree(nodes[current], candidate)) return;
      const distance = distances[current]
        + Math.hypot(nodes[current][0] - candidate[0], nodes[current][1] - candidate[1]);
      if (distance + 1e-8 < distances[index]) {
        distances[index] = distance;
        previous[index] = current;
      }
    });
  }

  if (destinationIndex >= 0 && Number.isFinite(distances[destinationIndex])) {
    const shortest: FarmPoint[] = [];
    for (let index = destinationIndex; index > 0; index = previous[index]) {
      shortest.push(nodes[index]);
      if (previous[index] < 0) break;
    }
    shortest.reverse();
    if (shortest.at(-1) && sameFarmPoint(shortest.at(-1)!, destination)) {
      return compactFarmRoute(start, shortest);
    }
  }

  // Defensive fallback for an unforeseen saved position outside the visibility
  // graph. Normal farm stations always resolve through the path above.
  return compactFarmRoute(start, [entrance, ...farmInteriorRouteFromEntrance(destination)]);
}

// Permanent props, reserved paddocks and the perimeter fence participate in
// both navigation and physics. Crop beds deliberately stay traversable: the
// harvest loop is a walk-through magnet, not a stop-at-the-edge interaction.
export const FARM_OBSTACLES = [
  { x: FARM_FACILITIES.tools.position[0], z: FARM_FACILITIES.tools.position[2], halfX: 0.74, halfZ: 0.46 },
  { x: FARM_FACILITIES.compost.position[0], z: FARM_FACILITIES.compost.position[2], halfX: 0.48, halfZ: 0.48 },
  { x: FARM_FACILITIES.greenhouse.position[0], z: FARM_FACILITIES.greenhouse.position[2], halfX: 0.68, halfZ: 0.58 },
  { x: FARM_FACILITIES.scarecrow.position[0], z: FARM_FACILITIES.scarecrow.position[2], halfX: 0.38, halfZ: 0.38 },
  { x: FARM_FACILITIES.waterTank.position[0], z: FARM_FACILITIES.waterTank.position[2], halfX: 0.52, halfZ: 0.52 },
  { x: FARM_FACILITIES.waterTank.position[0] + 0.9, z: FARM_FACILITIES.waterTank.position[2], halfX: 0.4, halfZ: 0.26 },
  { x: FARM_ANIMAL_STATIONS.chicken.position[0], z: FARM_ANIMAL_STATIONS.chicken.position[2], halfX: 1.49, halfZ: 1.09 },
  { x: FARM_ANIMAL_STATIONS.cow.position[0], z: FARM_ANIMAL_STATIONS.cow.position[2], halfX: 1.79, halfZ: 1.24 },
  { x: 0, z: -17.725, halfX: 13.25, halfZ: 0.07 },
  { x: FARM_GATE.leftFrontFence.center[0], z: FARM_GATE.leftFrontFence.center[2], halfX: FARM_GATE.leftFrontFence.halfX, halfZ: FARM_GATE.leftFrontFence.halfZ },
  { x: FARM_GATE.rightFrontFence.center[0], z: FARM_GATE.rightFrontFence.center[2], halfX: FARM_GATE.rightFrontFence.halfX, halfZ: FARM_GATE.rightFrontFence.halfZ },
  { x: -FARM_SIDE_FENCE_X, z: FARM_FIELD.center[2], halfX: 0.07, halfZ: 4.47 },
  { x: FARM_GATE.rightFence.center[0], z: FARM_GATE.rightFence.center[2], halfX: FARM_GATE.rightFence.halfX, halfZ: FARM_GATE.rightFence.halfZ },
  ...FARM_GATE.accessCorridorFences.map((fence) => ({
    x: fence.center[0],
    z: fence.center[2],
    halfX: fence.halfX,
    halfZ: fence.halfZ,
  })),
  ...FARM_GATE.perimeterWallFences.map((fence) => ({
    x: fence.center[0],
    z: fence.center[2],
    halfX: fence.halfX,
    halfZ: fence.halfZ,
  })),
  { x: FARM_GATE.frontPost[0], z: FARM_GATE.frontPost[2], halfX: FARM_GATE.postHalfSize, halfZ: FARM_GATE.postHalfSize },
  { x: FARM_GATE.innerPost[0], z: FARM_GATE.innerPost[2], halfX: FARM_GATE.postHalfSize, halfZ: FARM_GATE.postHalfSize },
  // The open gate leaf is folded against this east-perimeter section.
  { x: FARM_GATE.openLeaf.center[0], z: FARM_GATE.openLeaf.center[2], halfX: FARM_GATE.openLeaf.halfX, halfZ: FARM_GATE.openLeaf.halfZ },
] as const satisfies readonly FarmObstacleLayout[];

const FARM_PLOT_BY_ID = new Map<string, FarmPlotLayout>(FARM_PLOTS.map((plot) => [plot.id, plot]));

export function farmPlotById(id: string) {
  return FARM_PLOT_BY_ID.get(id);
}

export function farmInteractionId(cropId: string): FarmInteractionId | null {
  return FARM_PLOT_BY_ID.has(cropId) ? `farm:${cropId as FarmPlotId}` : null;
}

export function cropIdFromFarmInteraction(id: string): FarmPlotId | null {
  if (!id.startsWith("farm:")) return null;
  const cropId = id.slice(5);
  return FARM_PLOT_BY_ID.has(cropId) ? cropId as FarmPlotId : null;
}

export function isFarmInteractionId(id: string): id is FarmInteractionId {
  return cropIdFromFarmInteraction(id) !== null;
}
