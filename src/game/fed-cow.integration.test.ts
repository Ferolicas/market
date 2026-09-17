import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createInitialGame, normalizeGameState } from "./engine";
import { createEmptyInventory } from "./economy/ProductRegistry";
import { animalFeedStatus, collectMachineOutputBatch, createMachine, loadMachine, updateMachine } from "./stations/StationSystem";
import type { Employee } from "./types";

describe("fed cows", () => {
  it("requires wheat, not tomatoes, and does not generate free milk", () => {
    const cow = createMachine("cow-station-1", "milk");
    const empty = createEmptyInventory();
    expect(loadMachine(cow, { ...empty, tomatoes: 10 }, 0).loaded).toBe(false);
    expect(updateMachine(cow, 60_000).output).toBe(0);
  });

  it.each([[1, 6, 6_000], [2, 8, 4_800], [3, 9, 4_000], [5, 12, 3_000]])("tier %s buffers %s inputs and uses %s ms cycles", (tier, capacity, cycle) => {
    const fed = loadMachine(createMachine("cow-station-1", "milk", tier), { ...createEmptyInventory(), wheat: 20 }, 0);
    expect(fed.inventory.wheat).toBe(20 - capacity);
    expect(animalFeedStatus(fed.machine).occupied).toBe(capacity);
    const produced = updateMachine(fed.machine, cycle);
    expect(produced.output).toBe(1);
    const collected = collectMachineOutputBatch(produced, cycle, 3);
    expect(collected.collected).toBe(1);
    expect(collected.machine.completesAt).toBe(2 * cycle);
    expect(updateMachine(collected.machine, 100_000).output).toBe(capacity - 1);
  });

  it("feeds from the player basket and preserves the chain across save/load", () => {
    const initial = createInitialGame();
    initial.franchises[0].productionMachines = [createMachine("cow-station-1", "milk")];
    initial.franchises[0].carry = { capacity: 3, items: { wheat: 3 } };
    const fed = applyGameAction(initial, { type: "OPERATE_MACHINE", machineId: "cow-station-1" });
    expect(fed.ok).toBe(true);
    expect(fed.state.franchises[0].carry.items.wheat ?? 0).toBe(0);
    expect(fed.state.progression.counters["feed:cow"]).toBe(3);
    let state = normalizeGameState(JSON.parse(JSON.stringify(fed.state)));
    for (let i = 0; i < 6; i++) state = advanceWorld(state, 1_000).state;
    const collected = applyGameAction(state, { type: "OPERATE_MACHINE", machineId: "cow-station-1" });
    expect(collected.ok).toBe(true);
    expect(collected.state.franchises[0].carry.items.milk).toBe(1);
    expect(collected.state.franchises[0].productionMachines[0].completesAt).toBe(12_000);
  });

  it("preserves a legacy milk deadline without scheduling free follow-up production", () => {
    const old = { ...createMachine("cow-station-1", "milk"), status: "PROCESSING" as const, startedAt: 0, completesAt: 10_000 };
    expect(updateMachine(old, 6_000).completesAt).toBe(10_000);
    const done = updateMachine(old, 30_000);
    expect(done.output).toBe(1);
    expect(done.completesAt).toBeNull();
    expect(updateMachine(done, 60_000).output).toBe(1);
  });

  it("keeps a hand-fed trough full while the team works on another product", () => {
    let state = createInitialGame();
    const shop = state.franchises[0];
    shop.productionMachines = [createMachine("cow-station-1", "milk", 3), createMachine("flour-mill-1", "flour")];
    shop.warehouse = { ...createEmptyInventory(), milk: 300, wheat: 300, flour: 2, tomatoes: 300 };
    shop.employees = [{ id: "operator", role: "operator", name: "Test", level: 1, energy: 100, salaryMinor: 0, hat: "frog" } as Employee];
    shop.carry = { capacity: 10, items: { wheat: 10 } };
    const fed = applyGameAction(state, { type: "OPERATE_MACHINE", machineId: "cow-station-1" });
    expect(fed.ok).toBe(true);
    expect(fed.message).toContain("Llevaste 9");
    expect(fed.state.franchises[0].carry.items).toEqual({ wheat: 1 });
    state = fed.state;
    const cow = () => state.franchises[0].productionMachines.find(machine => machine.id === "cow-station-1")!;
    expect(animalFeedStatus(cow()).occupied).toBe(9);
    for (let tick = 0; tick < 4; tick++) state = advanceWorld(state, 250).state;
    expect(animalFeedStatus(cow()).occupied).toBe(9);
    expect(state.franchises[0].warehouse.wheat).toBe(300);
    for (let second = 0; second < 40; second++) state = advanceWorld(state, 1_000).state;
    expect(cow().output).toBe(9);
    expect(animalFeedStatus(cow()).occupied).toBe(0);
  });
});
