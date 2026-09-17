import { describe, expect, it } from "vitest";
import { advanceWorld, createInitialGame, normalizeGameState, storeSupplyPlan } from "../engine";
import { createCrop, createMachine } from "../stations/StationSystem";
import { createEmptyInventory } from "../economy/ProductRegistry";
import type { Employee } from "../types";

function fixture() {
  const state = createInitialGame();
  const shop = state.franchises[0];
  shop.open = false;
  shop.crops = [createCrop("crop-wheat-1", "wheat", 0), createCrop("crop-orange-1", "oranges", 0), createCrop("crop-tomato-1", "tomatoes", 0)];
  shop.productionMachines = [createMachine("flour-mill-1", "flour"), createMachine("bread-oven-1", "bread"), createMachine("juice-machine-1", "juice")];
  shop.warehouse = { ...createEmptyInventory(), flour: 2, juice: 6, bread: 200, tomatoes: 300, wheat: 2, oranges: 200 };
  shop.shelves = Object.fromEntries(Object.keys(shop.warehouse).map(id => [id, 100])) as typeof shop.shelves;
  return state;
}

describe("shared store demand", () => {
  it("rebuilds flour to the original maximum, then recomputes the least stocked product", () => {
    const shop = fixture().franchises[0];
    shop.warehouse.wheat = 301;
    expect(storeSupplyPlan(shop)).toEqual(["flour", "wheat"]);
    expect(shop.supplyFocus).toEqual({ productId: "flour", target: 301 });
    shop.warehouse.flour = 100;
    expect(storeSupplyPlan(shop)[0]).toBe("flour");
    shop.warehouse.flour = 301;
    expect(storeSupplyPlan(shop)).toEqual(["juice", "oranges"]);
    shop.warehouse.juice = 301;
    shop.warehouse.tomatoes = 50;
    expect(storeSupplyPlan(shop)).toEqual(["tomatoes"]);
  });
  it("interrupts warehouse rebuilding for a product missing from both shelf and warehouse", () => {
    const shop = fixture().franchises[0];
    shop.warehouse.wheat = 200;
    storeSupplyPlan(shop);
    shop.warehouse.juice = 0; shop.shelves.juice = 0;
    expect(storeSupplyPlan(shop)).toEqual(["juice", "oranges"]);
  });
  it("protects flour from an old bread delivery after demand changes", () => {
    const state = fixture(), shop = state.franchises[0];
    shop.warehouse.wheat = 200;
    shop.employees = [{ id: "old-baker", role: "operator", name: "Test", level: 1, energy: 100, salaryMinor: 0, hat: "frog", runtime: {
      state: "DROPOFF", assignedProduct: "flour", assignedStationId: "bread-oven-1", carry: { capacity: 3, items: { flour: 2 } },
      x: 0, z: 0, targetX: 0, targetZ: 0, path: [], pathIndex: 0, speed: 1.5, currentSpeed: 0, stateSince: 0,
    } }];
    const next = advanceWorld(state, 500).state.franchises[0];
    expect(next.warehouse.flour).toBe(4);
    expect(next.productionMachines.find(m => m.productId === "bread")!.input.flour ?? 0).toBe(0);
  });
  it.each(["farmer", "operator", "feeder", "stocker"] as const)("lets a %s serve any demanded machine", role => {
    const state = fixture(), shop = state.franchises[0];
    shop.warehouse.wheat = 200;
    shop.employees = [{ id: role, role, name: "Test", level: 1, energy: 100, salaryMinor: 0, hat: "frog" } as Employee];
    const tick = advanceWorld(advanceWorld(state, 500).state, 500).state;
    expect(tick.franchises[0].employees[0].runtime).toMatchObject({ assignedStationId: "flour-mill-1", assignedProduct: "wheat" });
  });
  it("preserves the focused batch on reload", () => {
    const state = fixture(); state.franchises[0].warehouse.wheat = 200;
    storeSupplyPlan(state.franchises[0]);
    state.franchises[0].warehouse.flour = 150;
    const restored = normalizeGameState(JSON.parse(JSON.stringify(state)));
    expect(storeSupplyPlan(restored.franchises[0])[0]).toBe("flour");
    expect(restored.franchises[0].supplyFocus?.target).toBe(300);
  });
  it("keeps the whole team on flour and its ingredients until the reserve is rebuilt, never baking surplus bread", () => {
    let state = fixture();
    state.franchises[0].employees = Array.from({ length: 8 }, (_, i) => ({ id: `worker-${i}`, name: "Team", role: i < 4 ? "farmer" : "operator", level: 5, energy: 100, salaryMinor: 0, hat: "frog" }));
    let reached = false;
    for (let second = 0; second < 4_000; second++) {
      state = advanceWorld(state, 1_000, (_start, end) => [end]).state;
      const shop = state.franchises[0];
      expect(shop.warehouse.bread).toBe(200);
      expect(shop.productionMachines.find(m => m.productId === "bread")!.output).toBe(0);
      if (shop.warehouse.flour >= 300) { reached = true; break; }
      if (second === 200) state = normalizeGameState(JSON.parse(JSON.stringify(state)));
    }
    expect(reached).toBe(true);
    expect(storeSupplyPlan(state.franchises[0])[0]).toBe("wheat");
  });

});
