import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createInitialGame } from "../engine";
import { machineInputCapacity } from "./StationSystem";

const directPathfinder = (_start: [number, number], target: [number, number]) => [target];

function millStore() {
  const state = createInitialGame("ES");
  const franchise = state.franchises[0];
  franchise.lastCustomerSpawnAt = 999_999;
  // Only the mill works, so its flour is not carried on into the oven.
  for (const machine of franchise.productionMachines) machine.status = "LOCKED";
  const mill = franchise.productionMachines.find((machine) => machine.id === "flour-mill-1")!;
  Object.assign(mill, { status: "WAITING_INPUT", input: {}, output: 0, startedAt: null, completesAt: null });
  return { state, franchise, mill };
}

describe("machine input queue", () => {
  it("lets the owner drop a whole basket of wheat and collect the flour later", () => {
    const { state, franchise, mill } = millStore();
    franchise.carry = { capacity: 8, items: { wheat: 8 } };
    const loaded = applyGameAction(state, { type: "OPERATE_MACHINE", machineId: mill.id });
    expect(loaded.ok, loaded.message).toBe(true);
    expect(loaded.message).toContain("Cargaste 8 × trigo");
    expect(loaded.state.franchises[0].carry.items.wheat ?? 0).toBe(0);
    const queued = loaded.state.franchises[0].productionMachines.find((machine) => machine.id === mill.id)!;
    expect(queued).toMatchObject({ status: "PROCESSING", input: { wheat: 6 } });

    let next = loaded.state;
    for (let second = 0; second < 17; second += 1) next = advanceWorld(next, 1_000).state;
    const worked = next.franchises[0].productionMachines.find((machine) => machine.id === mill.id)!;
    expect(worked).toMatchObject({ status: "OUTPUT_READY", output: 4, input: {} });
    expect(next.progression.counters["production:flour"]).toBe(4);

    const collected = applyGameAction(next, { type: "OPERATE_MACHINE", machineId: mill.id });
    expect(collected.ok).toBe(true);
    expect(collected.state.franchises[0].carry.items.flour).toBe(4);
  });

  it("refuses more wheat than the queue holds and says so", () => {
    const { state, franchise, mill } = millStore();
    Object.assign(mill, { status: "PROCESSING", input: { wheat: machineInputCapacity(mill, "wheat") }, startedAt: 0, completesAt: 99_000 });
    franchise.carry = { capacity: 4, items: { wheat: 2 } };
    const refused = applyGameAction(state, { type: "OPERATE_MACHINE", machineId: mill.id });
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("cola");
  });

  it("has the operator bring baskets to the queue and collect flour in batches", () => {
    const { state, franchise, mill } = millStore();
    franchise.warehouse.wheat = 20;
    franchise.crops = [];
    franchise.shelves.tomatoes = 30;
    franchise.employees = [{
      id: "queue-operator", name: "Luna", role: "operator", level: 1, salaryMinor: 3_000, energy: 100, hat: "frog",
      runtime: {
        state: "IDLE", assignedProduct: null, assignedStationId: null,
        carry: { capacity: 3, items: {} }, x: 0.9, z: -5.2, targetX: 0.9, targetZ: -5.2,
        path: [], pathIndex: 0, speed: 1.5, currentSpeed: 0, stateSince: -10_000,
      },
    }];
    let next = state;
    let biggestBasket = 0;
    for (let second = 0; second < 90; second += 1) {
      next = advanceWorld(next, 1_000, directPathfinder).state;
      biggestBasket = Math.max(biggestBasket, next.franchises[0].employees[0].runtime!.carry.items.wheat ?? 0);
    }
    const store = next.franchises[0];
    const current = store.productionMachines.find((machine) => machine.id === mill.id)!;
    // A full basket per trip (more than one recipe), several cycles ran, and
    // the flour came back to the warehouse in batches, not one unit per trip.
    expect(biggestBasket).toBe(3);
    expect(next.progression.counters["production:flour"]).toBeGreaterThanOrEqual(4);
    expect(store.warehouse.flour + (store.employees[0].runtime!.carry.items.flour ?? 0) + current.output).toBeGreaterThanOrEqual(4);
    expect(store.warehouse.wheat + (current.input.wheat ?? 0) + (store.employees[0].runtime!.carry.items.wheat ?? 0)).toBeLessThan(20);
  });
});
