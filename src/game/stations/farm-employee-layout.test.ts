import { describe, expect, it } from "vitest";
import { advanceWorld, createInitialGame, normalizeGameState, type WorldPathfinder } from "../engine";
import type { Employee, GameState } from "../types";
import { FARM_ACCESS_WAYPOINTS, FARM_ANIMAL_STATIONS, FARM_FIELD, FARM_PLOTS, FARM_WORKER_HOME, farmInteriorRouteBetween, isRetiredFrontFarmPoint } from "./farm-layout";

function employee(role: Employee["role"]): Employee {
  return { id: `${role}-farm-layout`, name: "Luna", role, level: 1, salaryMinor: 3_000, energy: 100, hat: "frog" };
}

function assignAfterRuntimeCreation(state: GameState, pathfinder: WorldPathfinder) {
  state = advanceWorld(state, 400, pathfinder).state;
  return advanceWorld(state, 400, pathfinder).state;
}

describe("farm employee destinations", () => {
  it("uses the shared interior corridor for all crop and animal assignments when the pathfinder is undefined", () => {
    const gate = [FARM_FIELD.entrance[0], FARM_FIELD.entrance[2]] as const;

    FARM_PLOTS.forEach((targetPlot) => {
      const state = createInitialGame();
      const franchise = state.franchises[0];
      franchise.crops = FARM_PLOTS.map((plot) => ({
        id: plot.id,
        productId: plot.productId,
        status: plot.id === targetPlot.id ? "READY" : "GROWING",
        plantedAt: 0,
        readyAt: plot.id === targetPlot.id ? 0 : 999_999,
        available: plot.id === targetPlot.id ? 1 : 0,
        tier: 1,
      }));
      franchise.employees = [{
        ...employee("farmer"),
        runtime: {
          state: "IDLE", assignedProduct: null, assignedStationId: null, carry: { capacity: 2, items: {} },
          x: gate[0], z: gate[1], targetX: gate[0], targetZ: gate[1], path: [], pathIndex: 0,
          speed: 1.5, currentSpeed: 0, stateSince: 0,
        },
      }];

      const runtime = advanceWorld(state, 400).state.franchises[0].employees[0].runtime!;
      const destination = [targetPlot.position[0], targetPlot.position[2]] as const;
      expect(runtime.path, targetPlot.id).toEqual(farmInteriorRouteBetween(gate, destination));
    });

    Object.entries(FARM_ANIMAL_STATIONS).forEach(([kind, station]) => {
      const state = createInitialGame();
      const franchise = state.franchises[0];
      const machineId = kind === "chicken" ? "chicken-coop-1" : "cow-station-1";
      franchise.productionMachines.forEach((machine) => {
        machine.output = machine.id === machineId ? 1 : 0;
        if (machine.id === machineId) machine.status = "OUTPUT_READY";
      });
      franchise.employees = [{
        ...employee("operator"),
        runtime: {
          state: "IDLE", assignedProduct: null, assignedStationId: null, carry: { capacity: 2, items: {} },
          x: gate[0], z: gate[1], targetX: gate[0], targetZ: gate[1], path: [], pathIndex: 0,
          speed: 1.5, currentSpeed: 0, stateSince: 0,
        },
      }];

      const runtime = advanceWorld(state, 400).state.franchises[0].employees[0].runtime!;
      const destination = [station.workPosition[0], station.workPosition[2]] as const;
      expect(runtime.path, machineId).toEqual(farmInteriorRouteBetween(gate, destination));
    });
  });

  it("creates the farmer at the rear estate and routes ready crops by shared layout", () => {
    let state = createInitialGame();
    const franchise = state.franchises[0];
    franchise.employees = [employee("farmer")];
    Object.assign(franchise.crops[0], { status: "READY", available: 1, readyAt: 0 });
    const requestedTargets: [number, number][] = [];
    const pathfinder: WorldPathfinder = (_start, target) => {
      requestedTargets.push([...target]);
      return [[...target]];
    };

    state = advanceWorld(state, 400, pathfinder).state;
    expect([state.franchises[0].employees[0].runtime!.x, state.franchises[0].employees[0].runtime!.z]).toEqual([...FARM_WORKER_HOME]);
    state = advanceWorld(state, 400, pathfinder).state;

    const plot = FARM_PLOTS[0];
    expect(requestedTargets).toContainEqual([plot.position[0], plot.position[2]]);
    expect(state.franchises[0].employees[0].runtime).toMatchObject({ state: "NAVIGATE_PICKUP", assignedStationId: plot.id });
  });

  it.each([
    ["chicken-coop-1", FARM_ANIMAL_STATIONS.chicken.workPosition],
    ["cow-station-1", FARM_ANIMAL_STATIONS.cow.workPosition],
  ] as const)("routes animal output %s to its visible rear work point", (machineId, workPosition) => {
    const state = createInitialGame();
    const franchise = state.franchises[0];
    franchise.employees = [employee("operator")];
    const machine = franchise.productionMachines.find((candidate) => candidate.id === machineId)!;
    Object.assign(machine, { status: "OUTPUT_READY" as const, output: 1 });
    const requestedTargets: [number, number][] = [];
    const pathfinder: WorldPathfinder = (_start, target) => {
      requestedTargets.push([...target]);
      return [[...target]];
    };

    const next = assignAfterRuntimeCreation(state, pathfinder);

    expect(requestedTargets).toContainEqual([workPosition[0], workPosition[2]]);
    expect(next.franchises[0].employees[0].runtime).toMatchObject({ state: "NAVIGATE_PICKUP", assignedStationId: machineId });
  });

  it("uses the door and exterior service lane when Recast is not ready yet", () => {
    const state = createInitialGame();
    const franchise = state.franchises[0];
    Object.assign(franchise.crops[0], { status: "READY", available: 1, readyAt: 0 });
    franchise.employees = [{
      ...employee("farmer"),
      runtime: {
        state: "IDLE", assignedProduct: null, assignedStationId: null, carry: { capacity: 2, items: {} },
        x: -5.3, z: 3.6, targetX: -5.3, targetZ: 3.6, path: [], pathIndex: 0, speed: 1.5, currentSpeed: 0, stateSince: 0,
      },
    }];

    const next = advanceWorld(state, 400).state;
    const runtime = next.franchises[0].employees[0].runtime!;
    const plot = FARM_PLOTS[0];

    expect(runtime.path).toContainEqual([0, 7.25]);
    expect(runtime.path).toContainEqual([0, 8.35]);
    FARM_ACCESS_WAYPOINTS.forEach((waypoint) => expect(runtime.path).toContainEqual([...waypoint]));
    expect(runtime.path.at(-1)).toEqual([plot.position[0], plot.position[2]]);
    expect(runtime.path.some(([x, z]) => Math.abs(x) < 11.4 && z < -8.2 && z > -8.72)).toBe(false);
  });

  it("opens the automatic door for a farm employee and never crosses a closed leaf", () => {
    let state = createInitialGame();
    const franchise = state.franchises[0];
    franchise.doorState = "CLOSED";
    franchise.doorProgress = 0;
    franchise.doorPlayerPresent = false;
    franchise.customers = [];
    franchise.employees = [{
      ...employee("farmer"),
      runtime: {
        state: "NAVIGATE_DROPOFF", assignedProduct: "tomatoes", assignedStationId: FARM_PLOTS[0].id,
        carry: { capacity: 3, items: { tomatoes: 1 } },
        x: 0, z: 8.35, targetX: 0, targetZ: 7.25, path: [[0, 7.25], [7.35, -5.2]], pathIndex: 0,
        speed: 1.5, currentSpeed: 0, stateSince: 0,
      },
    }];

    for (let tick = 0; tick < 4; tick += 1) {
      state = advanceWorld(state, 100).state;
      const runtime = state.franchises[0].employees[0].runtime!;
      expect(state.franchises[0].doorProgress).toBeLessThan(1);
      expect(runtime.z, `closed-door tick ${tick + 1}`).toBeGreaterThanOrEqual(8.35);
    }

    state = advanceWorld(state, 100).state;
    expect(state.franchises[0]).toMatchObject({ doorState: "OPEN", doorProgress: 1 });
    expect(state.franchises[0].employees[0].runtime!.z).toBeLessThan(8.35);
  });

  it("uses an interior aisle before the door instead of cutting fixtures from the stockroom", () => {
    const state = createInitialGame();
    const franchise = state.franchises[0];
    Object.assign(franchise.crops[0], { status: "READY", available: 1, readyAt: 0 });
    franchise.employees = [{
      ...employee("farmer"),
      runtime: {
        state: "IDLE", assignedProduct: null, assignedStationId: null, carry: { capacity: 2, items: {} },
        x: 7.35, z: -5.2, targetX: 7.35, targetZ: -5.2, path: [], pathIndex: 0, speed: 1.5, currentSpeed: 0, stateSince: 0,
      },
    }];

    const next = advanceWorld(state, 400).state;
    const path = next.franchises[0].employees[0].runtime!.path;

    expect(path.slice(0, 3)).toEqual([[2.15, 0.45], [2.15, 7.25], [0, 7.25]]);
    expect(path).toContainEqual([0, 8.35]);
    FARM_ACCESS_WAYPOINTS.forEach((waypoint) => expect(path).toContainEqual([...waypoint]));
  });

  it("keeps a new farmer entirely inside the estate for farm-to-farm fallback", () => {
    let state = createInitialGame();
    const franchise = state.franchises[0];
    Object.assign(franchise.crops[0], { status: "READY", available: 1, readyAt: 0 });
    franchise.employees = [employee("farmer")];

    state = advanceWorld(state, 400).state;
    state = advanceWorld(state, 400).state;
    const runtime = state.franchises[0].employees[0].runtime!;

    expect(runtime.path.at(-1)).toEqual([FARM_PLOTS[0].position[0], FARM_PLOTS[0].position[2]]);
    expect(runtime.path.every(([, z]) => z < -10)).toBe(true);
    expect(runtime.path).not.toContainEqual([expect.any(Number), 0.45]);
  });

  it("repaths a persisted farmer route that still points to the retired facade plots", () => {
    const legacy = createInitialGame();
    const plot = FARM_PLOTS[0];
    legacy.franchises[0].employees = [{
      ...employee("farmer"),
      runtime: {
        state: "NAVIGATE_PICKUP", assignedProduct: plot.productId, assignedStationId: plot.id, carry: { capacity: 2, items: {} },
        x: -5.3, z: 3.6, targetX: -9.45, targetZ: 10.1, path: [[-7, 7], [-9.45, 10.1]], pathIndex: 0,
        speed: 1.5, currentSpeed: 0, stateSince: 0,
      },
    }];

    const migrated = normalizeGameState(legacy);
    const runtime = migrated.franchises[0].employees[0].runtime!;

    expect(runtime.state).toBe("NAVIGATE_PICKUP");
    expect(runtime.path.at(-1)).toEqual([plot.position[0], plot.position[2]]);
    FARM_ACCESS_WAYPOINTS.forEach((waypoint) => expect(runtime.path).toContainEqual([...waypoint]));
    expect(runtime.path).not.toContainEqual([-9.45, 10.1]);
  });

  it.each([
    ["chicken-coop-1", "eggs", [-3.45, 9.65], FARM_ANIMAL_STATIONS.chicken.workPosition],
    ["cow-station-1", "milk", [-1.5, 9.65], FARM_ANIMAL_STATIONS.cow.workPosition],
  ] as const)("repaths persisted operator route %s from the retired facade station", (machineId, productId, retiredPoint, workPosition) => {
    const legacy = createInitialGame();
    legacy.franchises[0].employees = [{
      ...employee("operator"),
      runtime: {
        state: "NAVIGATE_PICKUP", assignedProduct: productId, assignedStationId: machineId, carry: { capacity: 2, items: {} },
        x: -4.8, z: -1.5, targetX: retiredPoint[0], targetZ: retiredPoint[1], path: [[...retiredPoint]], pathIndex: 0,
        speed: 1.5, currentSpeed: 0, stateSince: 0,
      },
    }];

    const migrated = normalizeGameState(legacy);
    const runtime = migrated.franchises[0].employees[0].runtime!;

    expect(runtime.path.at(-1)).toEqual([workPosition[0], workPosition[2]]);
    FARM_ACCESS_WAYPOINTS.forEach((waypoint) => expect(runtime.path).toContainEqual([...waypoint]));
    expect(runtime.path).not.toContainEqual([...retiredPoint]);
  });

  it.each([
    ["farmer", "crop-tomato-1", "tomatoes", [-9.45, 10.1], [FARM_PLOTS[0].position[0], FARM_PLOTS[0].position[2]]],
    ["operator", "chicken-coop-1", "eggs", [-3.45, 9.65], [FARM_ANIMAL_STATIONS.chicken.workPosition[0], FARM_ANIMAL_STATIONS.chicken.workPosition[2]]],
    ["operator", "cow-station-1", "milk", [-1.5, 9.65], [FARM_ANIMAL_STATIONS.cow.workPosition[0], FARM_ANIMAL_STATIONS.cow.workPosition[2]]],
  ] as const)("rebases persisted %s dropoff from retired station %s and preserves its carry", (role, stationId, productId, retiredPoint, currentSource) => {
    const legacy = createInitialGame();
    legacy.franchises[0].employees = [{
      ...employee(role),
      runtime: {
        state: "NAVIGATE_DROPOFF", assignedProduct: productId, assignedStationId: stationId,
        carry: { capacity: 2, items: { [productId]: 1 } },
        x: retiredPoint[0], z: retiredPoint[1], targetX: 7.35, targetZ: -5.2,
        path: [[-7, 7], [0, 4], [7.35, -5.2]], pathIndex: 0,
        speed: 1.5, currentSpeed: 1.2, stateSince: 0,
      },
    }];

    const migrated = normalizeGameState(legacy);
    const runtime = migrated.franchises[0].employees[0].runtime!;

    expect(runtime.state).toBe("NAVIGATE_DROPOFF");
    expect([runtime.x, runtime.z]).toEqual([...currentSource]);
    expect(runtime.currentSpeed).toBe(0);
    expect(runtime.carry).toEqual({ capacity: 2, items: { [productId]: 1 } });
    FARM_ACCESS_WAYPOINTS.forEach((waypoint) => expect(runtime.path).toContainEqual([...waypoint]));
    expect(runtime.path.at(-1)).toEqual([7.35, -5.2]);
    expect(runtime.path.some((point) => isRetiredFrontFarmPoint(point))).toBe(false);
  });

  it("removes a retired farm waypoint even after the carrying farmer has already left its footprint", () => {
    const legacy = createInitialGame();
    legacy.franchises[0].employees = [{
      ...employee("farmer"),
      runtime: {
        state: "NAVIGATE_DROPOFF", assignedProduct: "tomatoes", assignedStationId: "crop-tomato-1",
        carry: { capacity: 2, items: { tomatoes: 1 } },
        x: -7, z: 7, targetX: 0, targetZ: 4,
        path: [[-9.45, 10.1], [0, 4], [7.35, -5.2]], pathIndex: 1,
        speed: 1.5, currentSpeed: 1.2, stateSince: 0,
      },
    }];

    const runtime = normalizeGameState(legacy).franchises[0].employees[0].runtime!;

    expect([runtime.x, runtime.z]).toEqual([-7, 7]);
    expect(runtime.carry.items).toEqual({ tomatoes: 1 });
    expect(runtime.path.some((point) => isRetiredFrontFarmPoint(point))).toBe(false);
    expect(runtime.path.at(-1)).toEqual([7.35, -5.2]);
  });

  it("repaths a persisted animal operator paused on the exterior service lane", () => {
    const legacy = createInitialGame();
    legacy.franchises[0].employees = [{
      ...employee("operator"),
      runtime: {
        state: "NAVIGATE_DROPOFF", assignedProduct: "eggs", assignedStationId: "chicken-coop-1", carry: { capacity: 2, items: { eggs: 1 } },
        x: 12.15, z: 0, targetX: 7.35, targetZ: -5.2, path: [[7.35, -5.2]], pathIndex: 0,
        speed: 1.5, currentSpeed: 0, stateSince: 0,
      },
    }];

    const migrated = normalizeGameState(legacy);
    const path = migrated.franchises[0].employees[0].runtime!.path;

    expect(path[0]).toEqual([...FARM_ACCESS_WAYPOINTS[0]]);
    expect(path).toContainEqual([0, 8.35]);
    expect(path).toContainEqual([0, 7.25]);
    expect(path.at(-1)).toEqual([7.35, -5.2]);
  });
});
