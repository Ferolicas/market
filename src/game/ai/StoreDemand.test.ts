import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createInitialGame, normalizeGameState, shelfCapacityForTier, storeSupplyPlan, SURPLUS_PRODUCTION_BATCH, WAREHOUSE_PRODUCT_CAP } from "../engine";
import { createCrop, createMachine } from "../stations/StationSystem";
import { createEmptyInventory } from "../economy/ProductRegistry";
import type { Employee, GameState } from "../types";

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


  it("levels every reserve at 2000 at most, whatever an old silo holds", () => {
    const state = fixture(), shop = state.franchises[0];
    shop.warehouse.wheat = 32_754;
    expect(storeSupplyPlan(shop)[0]).toBe("flour");
    expect(shop.supplyFocus).toEqual({ productId: "flour", target: WAREHOUSE_PRODUCT_CAP });
    shop.supplyFocus = { productId: "flour", target: 32_754 };
    const restored = normalizeGameState(JSON.parse(JSON.stringify(state))).franchises[0];
    expect(restored.warehouse.wheat).toBe(32_754);
    expect(restored.supplyFocus?.target).toBe(WAREHOUSE_PRODUCT_CAP);
    expect(storeSupplyPlan(restored)).toEqual(["flour", "wheat"]);
  });
  it("moves on at the threshold and, with everything above it, keeps levelling the scarcest product by batches", () => {
    const shop = fixture().franchises[0];
    for (const id of ["flour", "wheat", "juice", "oranges", "bread"] as const) shop.warehouse[id] = WAREHOUSE_PRODUCT_CAP;
    shop.warehouse.tomatoes = WAREHOUSE_PRODUCT_CAP - 1;
    expect(storeSupplyPlan(shop)).toEqual(["tomatoes"]);
    expect(shop.supplyFocus).toEqual({ productId: "tomatoes", target: WAREHOUSE_PRODUCT_CAP });
    shop.warehouse.tomatoes = WAREHOUSE_PRODUCT_CAP;
    shop.warehouse.juice = WAREHOUSE_PRODUCT_CAP + 5_000;
    expect(storeSupplyPlan(shop)[0]).not.toBe("juice");
    expect(shop.supplyFocus?.target).toBe(WAREHOUSE_PRODUCT_CAP + SURPLUS_PRODUCTION_BATCH);
  });
  it("leaves a product at the threshold alone while another is still short, even as a crop ingredient bound for the stockroom", () => {
    let state = fixture();
    const shop = state.franchises[0];
    state.level = 30;
    shop.warehouse = { ...shop.warehouse, tomatoes: WAREHOUSE_PRODUCT_CAP, wheat: WAREHOUSE_PRODUCT_CAP, bread: WAREHOUSE_PRODUCT_CAP, juice: WAREHOUSE_PRODUCT_CAP, oranges: WAREHOUSE_PRODUCT_CAP, flour: 2 };
    shop.shelves = Object.fromEntries(Object.keys(shop.shelves).map(id => [id, shelfCapacityForTier(1, id as keyof typeof shop.shelves, shop.unlockedAreas)])) as typeof shop.shelves;
    shop.crops.forEach(crop => Object.assign(crop, { status: "READY", available: 8 }));
    shop.employees = [{ id: "farmer", role: "farmer", name: "Test", level: 1, energy: 100, salaryMinor: 0, hat: "frog" } as Employee];
    expect(storeSupplyPlan(shop)).toEqual(["flour", "wheat"]);
    for (let second = 0; second < 40; second++) state = advanceWorld(state, 1_000, (_start, end) => [end]).state;
    const after = state.franchises[0];
    expect(after.warehouse.tomatoes).toBe(WAREHOUSE_PRODUCT_CAP);
    expect(after.crops.find(crop => crop.productId === "tomatoes")!.available).toBe(8);
    // Wheat only travels to the mill (from the bed or the stockroom): the stockroom never grows past the threshold.
    expect(after.warehouse.wheat).toBeLessThanOrEqual(WAREHOUSE_PRODUCT_CAP);
    expect((after.productionMachines.find(m => m.productId === "flour")!.input.wheat ?? 0) + after.productionMachines.find(m => m.productId === "flour")!.output + after.warehouse.flour).toBeGreaterThan(2);
  });

  function juiceShortage(orangeShelf: number) {
    const state = fixture(), shop = state.franchises[0];
    state.level = 30;
    shop.warehouse = { ...shop.warehouse, juice: 0, oranges: 0, bread: 300, flour: 300, wheat: 300, tomatoes: 300 };
    shop.shelves = Object.fromEntries(Object.keys(shop.shelves).map(id => [id, shelfCapacityForTier(1, id as keyof typeof shop.shelves, shop.unlockedAreas)])) as typeof shop.shelves;
    shop.shelves.juice = 0;
    shop.shelves.oranges = orangeShelf;
    shop.crops.forEach(crop => Object.assign(crop, crop.productId === "oranges" ? { status: "READY", available: 40 } : { status: "GROWING", available: 0, readyAt: 9_000_000 }));
    shop.employees = [0, 1].map(i => ({ id: `farmer-${i}`, role: "farmer", name: "Test", level: 5, energy: 100, salaryMinor: 0, hat: "frog" } as Employee));
    return state;
  }
  function runUntil(state: GameState, seconds: number, done: (shop: GameState["franchises"][0]) => boolean) {
    for (let tick = 0; tick < seconds * 4 && !done(state.franchises[0]); tick++) state = advanceWorld(state, 250, (_start, end) => [end]).state;
    return state;
  }
  it("takes harvested oranges to the juice machine, not to the half-full orange shelf, while the juice shelf is empty", () => {
    const capacity = shelfCapacityForTier(1, "oranges", []);
    let state = juiceShortage(Math.ceil(capacity / 2));
    expect(storeSupplyPlan(state.franchises[0])).toEqual(["juice", "oranges"]);
    state = runUntil(state, 120, shop => shop.employees.some(e => (e.runtime?.carry.items.oranges ?? 0) > 0));
    const carrier = state.franchises[0].employees.find(e => (e.runtime?.carry.items.oranges ?? 0) > 0)!;
    expect(carrier.runtime).toMatchObject({ state: "NAVIGATE_DROPOFF", assignedStationId: "juice-machine-1" });
    state = runUntil(state, 240, shop => shop.shelves.juice > 0);
    expect(state.franchises[0].shelves.juice).toBeGreaterThan(0);
    expect(state.franchises[0].shelves.oranges).toBe(Math.ceil(capacity / 2));
  });
  it("fills an empty orange shelf with the first basket, then feeds the juice machine", () => {
    let state = juiceShortage(0);
    state = runUntil(state, 120, shop => shop.employees.some(e => (e.runtime?.carry.items.oranges ?? 0) > 0));
    const carrier = state.franchises[0].employees.find(e => (e.runtime?.carry.items.oranges ?? 0) > 0)!;
    expect(carrier.runtime?.assignedStationId).toBe("retail:oranges");
    state = runUntil(state, 240, shop => shop.shelves.juice > 0);
    expect(state.franchises[0].shelves.oranges).toBeGreaterThan(0);
    expect(state.franchises[0].shelves.juice).toBeGreaterThan(0);
  });
  it("lets the owner order past the threshold: it only steers the team", () => {
    const state = createInitialGame();
    state.balanceMinor = 100_000_000;
    state.franchises[0].warehouse.wheat = WAREHOUSE_PRODUCT_CAP + 500;
    const booked = applyGameAction(state, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 100 });
    expect(booked.ok).toBe(true);
    expect(booked.state.pendingOrders[0].quantity).toBe(100);
  });
  it("always empties the owner's basket into the stockroom, even at the cap", () => {
    const state = createInitialGame();
    state.franchises[0].warehouse.wheat = WAREHOUSE_PRODUCT_CAP;
    state.franchises[0].carry = { capacity: 4, items: { wheat: 4 } };
    const returned = applyGameAction(state, { type: "RETURN_TO_WAREHOUSE" });
    expect(returned.ok).toBe(true);
    expect(returned.state.franchises[0].warehouse.wheat).toBe(WAREHOUSE_PRODUCT_CAP + 4);
    expect(returned.state.franchises[0].carry.items).toEqual({});
  });

});
