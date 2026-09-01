import { describe, expect, it } from "vitest";
import { isStoreNavigationPoint } from "../navigation/NavMeshService";
import {
  cropIdFromFarmInteraction,
  FARM_ACCESS_WAYPOINTS,
  FARM_ANIMAL_STATIONS,
  FARM_FACILITIES,
  FARM_FIELD,
  FARM_GATE,
  FARM_INTERIOR_WAYPOINTS,
  FARM_OBSTACLES,
  FARM_PLOTS,
  FARM_WORKER_HOME,
  farmInteriorRouteBetween,
  farmInteriorRouteFromEntrance,
  farmInteriorRouteToEntrance,
  farmInteractionId,
  farmPlotById,
  isFarmInteractionId,
  isRetiredFrontFarmPoint,
} from "./farm-layout";

const STORE_REAR_WALL_Z = -8.55;
const STORE_LAYOUT_SCALE = 2;
const STORE_ELEMENT_SCALE = 1.6;
const EMPLOYEE_CLEARANCE = 0.31 * STORE_LAYOUT_SCALE;

function segmentIntersectsExpandedObstacle(
  start: readonly [number, number],
  end: readonly [number, number],
  obstacle: (typeof FARM_OBSTACLES)[number],
) {
  const a = [start[0] * STORE_LAYOUT_SCALE, start[1] * STORE_LAYOUT_SCALE] as const;
  const b = [end[0] * STORE_LAYOUT_SCALE, end[1] * STORE_LAYOUT_SCALE] as const;
  const center = [obstacle.x * STORE_LAYOUT_SCALE, obstacle.z * STORE_LAYOUT_SCALE] as const;
  const half = [
    obstacle.halfX * STORE_ELEMENT_SCALE + EMPLOYEE_CLEARANCE,
    obstacle.halfZ * STORE_ELEMENT_SCALE + EMPLOYEE_CLEARANCE,
  ] as const;
  let minimum = 0;
  let maximum = 1;

  for (const axis of [0, 1] as const) {
    const delta = b[axis] - a[axis];
    const lower = center[axis] - half[axis];
    const upper = center[axis] + half[axis];
    if (Math.abs(delta) < 1e-8) {
      if (a[axis] < lower || a[axis] > upper) return false;
      continue;
    }
    const first = (lower - a[axis]) / delta;
    const second = (upper - a[axis]) / delta;
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    if (minimum > maximum) return false;
  }
  return true;
}

function expectObstacleFreeRoute(label: string, points: readonly (readonly [number, number])[]) {
  points.slice(1).forEach((point, index) => {
    const start = points[index];
    const hits = FARM_OBSTACLES.filter((obstacle) => segmentIntersectsExpandedObstacle(start, point, obstacle));
    expect(hits, `${label}: unsafe segment ${start.join(",")} -> ${point.join(",")}`).toEqual([]);
  });
}

describe("rear farm layout", () => {
  it("keeps the complete estate behind the supermarket instead of on the facade", () => {
    const fieldFrontEdge = FARM_FIELD.center[2] + FARM_FIELD.size[2] / 2;
    expect(fieldFrontEdge).toBeLessThan(STORE_REAR_WALL_Z - 1.5);

    const estatePositions = [
      ...FARM_PLOTS.map((plot) => plot.position),
      ...Object.values(FARM_FACILITIES).map((facility) => facility.position),
      ...Object.values(FARM_ANIMAL_STATIONS).map((station) => station.position),
    ];
    const halfWidth = FARM_FIELD.size[0] / 2;
    const halfDepth = FARM_FIELD.size[2] / 2;
    estatePositions.forEach(([x, , z]) => {
      expect(Math.abs(x - FARM_FIELD.center[0])).toBeLessThanOrEqual(halfWidth);
      expect(Math.abs(z - FARM_FIELD.center[2])).toBeLessThanOrEqual(halfDepth);
      expect(z).toBeLessThan(STORE_REAR_WALL_Z);
    });
  });

  it("recognises every retired facade station without classifying the rear estate or main door", () => {
    const retired = [[-9.45, 10.1], [-7.05, 10.1], [-9.45, 11.75], [-7.05, 11.75], [-3.45, 9.65], [-1.5, 9.65]] as const;
    retired.forEach((point) => expect(isRetiredFrontFarmPoint(point), point.join(",")).toBe(true));
    FARM_PLOTS.forEach((plot) => expect(isRetiredFrontFarmPoint([plot.position[0], plot.position[2]])).toBe(false));
    Object.values(FARM_ANIMAL_STATIONS).forEach((station) => expect(isRetiredFrontFarmPoint([station.workPosition[0], station.workPosition[2]])).toBe(false));
    expect(isRetiredFrontFarmPoint([0, 8.35])).toBe(false);
  });

  it("leaves every crop, animal work point and service waypoint walkable", () => {
    const destinations = [
      ...FARM_PLOTS.map((plot) => [plot.position[0], plot.position[2]] as const),
      ...Object.values(FARM_ANIMAL_STATIONS).map((station) => [station.workPosition[0], station.workPosition[2]] as const),
      ...FARM_ACCESS_WAYPOINTS,
      ...Object.values(FARM_INTERIOR_WAYPOINTS),
    ];

    destinations.forEach((destination) => {
      expect(isStoreNavigationPoint(destination), `${destination.join(",")} must be walkable`).toBe(true);
    });
  });

  it("centres the logical entrance in the physically clear gap between its posts", () => {
    const frontPost = [FARM_GATE.frontPost[0], FARM_GATE.frontPost[2]] as const;
    const innerPost = [FARM_GATE.innerPost[0], FARM_GATE.innerPost[2]] as const;
    const entrance = [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]] as const;
    expect(FARM_GATE.center[2]).toBeCloseTo((frontPost[1] + innerPost[1]) / 2, 2);
    expect(entrance[1]).toBeCloseTo((frontPost[1] + innerPost[1]) / 2, 2);
    expect(entrance[0]).toBeLessThan(FARM_GATE.center[0]);
    expect(FARM_GATE.exteriorApproach[0]).toBeGreaterThan(FARM_GATE.center[0]);
    expect(FARM_GATE.exteriorApproach[1]).toBe(entrance[1]);
    expect(Math.hypot(entrance[0] - frontPost[0], entrance[1] - frontPost[1])).toBeGreaterThan(0.75);
    expect(Math.hypot(entrance[0] - innerPost[0], entrance[1] - innerPost[1])).toBeGreaterThan(0.75);
    const openLeafRear = FARM_GATE.openLeaf.center[2] - FARM_GATE.openLeaf.halfZ * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE);
    const rightFenceFront = FARM_GATE.rightFence.center[2] + FARM_GATE.rightFence.halfZ * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE);
    const rightFenceRear = FARM_GATE.rightFence.center[2] - FARM_GATE.rightFence.halfZ * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE);
    expect(rightFenceFront).toBeCloseTo(openLeafRear, 4);
    expect(rightFenceRear).toBeCloseTo(FARM_FIELD.center[2] - FARM_FIELD.size[2] / 2, 4);
    expect(isStoreNavigationPoint(entrance)).toBe(true);
    expectObstacleFreeRoute("service lane through gate", FARM_ACCESS_WAYPOINTS);
  });

  it("uses the same obstacle-free interior corridor in both directions without Recast", () => {
    const entrance = [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]] as const;
    const destinations = [
      ...FARM_PLOTS.map((plot) => [plot.id, [plot.position[0], plot.position[2]] as const] as const),
      ...Object.entries(FARM_ANIMAL_STATIONS).map(([id, station]) => [id, [station.workPosition[0], station.workPosition[2]] as const] as const),
    ];

    destinations.forEach(([id, destination]) => {
      const outbound = [entrance, ...farmInteriorRouteFromEntrance(destination)] as const;
      const inbound = [destination, ...farmInteriorRouteToEntrance(destination)] as const;
      expect(outbound.at(-1), `${id} outbound endpoint`).toEqual(destination);
      expect(inbound.at(-1), `${id} inbound endpoint`).toEqual(entrance);
      expectObstacleFreeRoute(`${id} gate to destination`, outbound);
      expectObstacleFreeRoute(`${id} destination to gate`, inbound);
    });
  });

  it("uses the shortest obstacle-safe visibility route between farm stations", () => {
    const destinations = [
      FARM_WORKER_HOME,
      ...FARM_PLOTS.map((plot) => [plot.position[0], plot.position[2]] as const),
      ...Object.values(FARM_ANIMAL_STATIONS).map((station) => [station.workPosition[0], station.workPosition[2]] as const),
    ];

    destinations.forEach((start) => destinations.forEach((destination) => {
      const route = farmInteriorRouteBetween(start, destination);
      const points = [start, ...route] as readonly (readonly [number, number])[];
      if (Math.hypot(start[0] - destination[0], start[1] - destination[1]) <= 0.08) expect(route).toEqual([]);
      else expect(route.at(-1)).toEqual([...destination]);
      expect(new Set(points.map((point) => `${point[0]}:${point[1]}`)).size, `${start.join(",")} → ${destination.join(",")}`).toBe(points.length);
      expectObstacleFreeRoute(`${start.join(",")} → ${destination.join(",")}`, points);
      const pathLength = points.slice(1).reduce((total, point, index) => total + Math.hypot(point[0] - points[index][0], point[1] - points[index][1]), 0);
      const directDistance = Math.hypot(start[0] - destination[0], start[1] - destination[1]);
      expect(pathLength, `${start.join(",")} → ${destination.join(",")} excessive detour`).toBeLessThanOrEqual(directDistance * 3 + 1);
    }));
  });

  it("spaces crop magnets so one pass targets one coherent bed at a time", () => {
    FARM_PLOTS.forEach((plot, index) => {
      FARM_PLOTS.slice(index + 1).forEach((other) => {
        const distance = Math.hypot(plot.position[0] - other.position[0], plot.position[2] - other.position[2]);
        expect(distance).toBeGreaterThan(2.6);
      });
    });
  });

  it("keeps farm interaction ids stable and reversible after relocation", () => {
    FARM_PLOTS.forEach((plot) => {
      const interactionId = farmInteractionId(plot.id);
      expect(interactionId).not.toBeNull();
      expect(isFarmInteractionId(interactionId!)).toBe(true);
      expect(cropIdFromFarmInteraction(interactionId!)).toBe(plot.id);
      expect(farmPlotById(plot.id)).toBe(plot);
    });
    expect(farmInteractionId("crop-unknown")).toBeNull();
    expect(cropIdFromFarmInteraction("farm:crop-unknown")).toBeNull();
  });
});
