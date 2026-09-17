import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, canOperateMachine, createInitialGame, normalizeGameState } from "./engine";
import { createEmptyInventory } from "./economy/ProductRegistry";
import { chickenFeedStatus, collectMachineOutputBatch, createMachine, loadMachine, updateMachine } from "./stations/StationSystem";
import type { Employee } from "./types";

function fixture(tomatoes = 3) {
  const state = createInitialGame();
  const franchise = state.franchises[0];
  franchise.productionMachines = [createMachine("chicken-coop-1", "eggs")];
  franchise.carry = { capacity: 3, items: { tomatoes } };
  franchise.unlockedAreas.push("chicken-coop");
  franchise.employees = [];
  franchise.customers = [];
  return state;
}

function elapse(state: ReturnType<typeof fixture>, milliseconds: number) {
  for (let remaining = milliseconds; remaining > 0; remaining -= 1_000) {
    state = advanceWorld(state, Math.min(1_000, remaining)).state;
  }
  return { state };
}

describe("fed chicken in the authoritative engine", () => {
  it("does not produce without tomatoes", () => {
    const initial = fixture(0);
    const result = elapse(initial, 10_000);
    expect(result.state.franchises[0].productionMachines[0].output).toBe(0);
    expect(canOperateMachine(initial.franchises[0], "chicken-coop-1", 0)).toBe(false);
  });

  it("feeds from a full basket, survives reload and collects without resetting the next egg", () => {
    const initial = fixture();
    expect(canOperateMachine(initial.franchises[0], "chicken-coop-1", 0)).toBe(true);
    const fed = applyGameAction(initial, { type: "OPERATE_MACHINE", machineId: "chicken-coop-1" });
    expect(fed.ok).toBe(true);
    expect(fed.state.franchises[0].carry.items.tomatoes ?? 0).toBe(0);
    expect(chickenFeedStatus(fed.state.franchises[0].productionMachines[0]).occupied).toBe(3);
    const restored = normalizeGameState(JSON.parse(JSON.stringify(fed.state)));
    const tick = elapse(restored, 2_000);
    const machine = tick.state.franchises[0].productionMachines[0];
    expect(machine.output).toBe(1);
    expect(machine.completesAt).toBe(4_000);
    const collected = applyGameAction(tick.state, { type: "OPERATE_MACHINE", machineId: "chicken-coop-1" });
    expect(collected.ok).toBe(true);
    expect(collected.state.franchises[0].carry.items.eggs).toBe(1);
    expect(collected.state.franchises[0].productionMachines[0].completesAt).toBe(4_000);
    expect(collected.state.progression.counters["production:eggs"]).toBe(1);
    const next = elapse(collected.state, 2_000);
    expect(next.state.franchises[0].productionMachines[0].output).toBe(1);
    expect(next.state.progression.counters["production:eggs"]).toBe(2);
  });

  it.each([1, 2, 3])("respects tier %s feed capacity and production rate with fractional frame time", (tier) => {
    const inventory = { ...createEmptyInventory(), tomatoes: 10 };
    const fed = loadMachine(createMachine("chicken-1", "eggs", tier), inventory, 0.75);
    const capacity = 4 + tier - 1;
    expect(fed.inventory.tomatoes).toBe(10 - capacity);
    expect(chickenFeedStatus(fed.machine)).toEqual({ occupied: capacity, capacity, free: 0 });
    const duplicate = loadMachine(fed.machine, fed.inventory, 0.8);
    expect(duplicate.loaded).toBe(false);
    expect(duplicate.inventory).toEqual(fed.inventory);
    const ready = updateMachine(fed.machine, capacity * Math.round(2_000 / (1 + (tier - 1) * 0.25)) + 0.9);
    expect(ready.output).toBe(capacity);
    expect(ready.completesAt).toBeNull();
    expect(collectMachineOutputBatch(ready, 10_000.5, 2).collected).toBe(2);
  });

  it("preserves an old in-flight egg but requires feed for subsequent eggs", () => {
    const legacy = { ...createMachine("chicken-1", "eggs"), status: "PROCESSING" as const, startedAt: 0, completesAt: 8_000 };
    expect(updateMachine(legacy, 2_000).completesAt).toBe(8_000);
    const ready = updateMachine(legacy, 20_000);
    expect(ready.output).toBe(1);
    expect(updateMachine(ready, 30_000).output).toBe(1);
  });

  it("counts a completed egg only once when a failed full-basket pulse precedes the world tick", () => {
    const initial = fixture(0);
    initial.franchises[0].carry.items = { wheat: 3 };
    initial.franchises[0].productionMachines[0] = {
      ...createMachine("chicken-coop-1", "eggs"), status: "PROCESSING", startedAt: 0, completesAt: 2_000,
    };
    initial.simulationTimeMs = 2_000;
    const result = advanceWorld(initial, 100, undefined, {
      interactions: [{ type: "OPERATE_MACHINE", machineId: "chicken-coop-1" }],
    });
    expect(result.state.franchises[0].productionMachines[0].output).toBe(1);
    expect(result.state.progression.counters["production:eggs"]).toBe(1);
    expect(result.state.franchises[0].carry.items).toEqual({ wheat: 3 });
  });

  it("keeps a hand-fed trough full while the team works on another product", () => {
    let state = fixture(0);
    const franchise = state.franchises[0];
    franchise.productionMachines = [createMachine("chicken-coop-1", "eggs", 3), createMachine("flour-mill-1", "flour")];
    franchise.warehouse = { ...createEmptyInventory(), eggs: 300, wheat: 300, flour: 2, tomatoes: 300 };
    franchise.employees = [{ id: "operator", role: "operator", name: "Test", level: 1, energy: 100, salaryMinor: 0, hat: "frog" } as Employee];
    franchise.carry = { capacity: 10, items: { tomatoes: 10 } };
    const fed = applyGameAction(state, { type: "OPERATE_MACHINE", machineId: "chicken-coop-1" });
    expect(fed.ok).toBe(true);
    expect(fed.message).toContain("Llevaste 6");
    expect(fed.state.franchises[0].carry.items).toEqual({ tomatoes: 4 });
    state = fed.state;
    const coop = () => state.franchises[0].productionMachines.find(machine => machine.id === "chicken-coop-1")!;
    expect(chickenFeedStatus(coop()).occupied).toBe(6);
    state = elapse(state, 1_000).state;
    expect(chickenFeedStatus(coop()).occupied).toBe(6);
    expect(state.franchises[0].warehouse.tomatoes).toBe(300);
    state = elapse(state, 10_000).state;
    expect(coop().output).toBe(6);
  });
});
