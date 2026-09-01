import { describe, expect, it } from "vitest";
import { advanceSimulation, advanceWorld, applyGameAction, createInitialGame, normalizeGameState } from "./engine";
import type { CustomerRuntimeState, GameAction, GameState, ProductId } from "./types";
import { STOREFRONT_LAYOUT } from "./stations/storefront-layout";

function act(state: GameState, action: GameAction) {
  const result = applyGameAction(state, action);
  expect(result.ok, result.message).toBe(true);
  return result.state;
}

function tick(state: GameState, seconds: number) {
  for (let index = 0; index < seconds; index++) state = advanceWorld(state, 1_000).state;
  return state;
}

function shopper(id: string, productId: ProductId, socket: number): CustomerRuntimeState {
  return { id, identity: socket % 2 ? 2 : 1, state: "WAIT_FOR_ACCESS", shoppingList: [{ productId, requested: 1, picked: 0 }], currentLine: 0, basket: {}, patienceMs: 10_000, checkoutPatienceMs: 300_000, waitingSince: null, queueSlot: null, transactionId: null, hasCart: true, hasBag: false, angry: false, x: -4.1 + socket * 0.18, z: -0.9, targetX: -4.1, targetZ: -0.9, path: [], pathIndex: 0, speed: 1.45, stateSince: 0, reservedSocketId: `${productId}:${socket}`, blockedSince: null, routeFailures: 0 };
}

describe("real supermarket loop", () => {
  it("starts level one growing and automatically replants after the exact plot is harvested", () => {
    let state = createInitialGame();
    expect(state.level).toBe(1);
    expect(state.franchises[0].crops[0].status).toBe("GROWING");
    state = tick(state, 4);
    expect(state.franchises[0].crops[0]).toMatchObject({ status: "READY", available: 3 });
    state = act(state, { type: "HARVEST", cropId: "crop-tomato-1", productId: "tomatoes" });
    state = act(state, { type: "HARVEST", cropId: "crop-tomato-1", productId: "tomatoes" });
    state = act(state, { type: "HARVEST", cropId: "crop-tomato-1", productId: "tomatoes" });

    expect(state.franchises[0].crops[0]).toMatchObject({ id: "crop-tomato-1", status: "GROWING", available: 0 });
    expect(state.franchises[0].crops[0].readyAt).toBeGreaterThan(state.simulationTimeMs);
    expect(state.franchises[0].carry.items).toEqual({ tomatoes: 3 });
  });

  it("harvests only the requested cropId when two plots contain the same vegetable", () => {
    let state = createInitialGame();
    const first = state.franchises[0].crops[0];
    Object.assign(first, { status: "READY", available: 1, plantedAt: 0, readyAt: 0 });
    state.franchises[0].crops.push({ ...first, id: "crop-tomato-2" });

    state = act(state, { type: "HARVEST", cropId: "crop-tomato-2", productId: "tomatoes" });

    expect(state.franchises[0].crops.find((crop) => crop.id === "crop-tomato-1")).toMatchObject({ status: "READY", available: 1 });
    expect(state.franchises[0].crops.find((crop) => crop.id === "crop-tomato-2")).toMatchObject({ status: "GROWING", available: 0 });
    expect(state.franchises[0].carry.items).toEqual({ tomatoes: 1 });
  });

  it("keeps different vegetables together and enforces capacity across the whole basket", () => {
    let state = createInitialGame();
    const franchise = state.franchises[0];
    franchise.carry.capacity = 2;
    const tomato = franchise.crops.find((crop) => crop.productId === "tomatoes")!;
    const wheat = franchise.crops.find((crop) => crop.productId === "wheat")!;
    const corn = franchise.crops.find((crop) => crop.productId === "corn")!;
    for (const crop of [tomato, wheat, corn]) Object.assign(crop, { status: "READY", available: 1, plantedAt: 0, readyAt: 0 });

    state = act(state, { type: "HARVEST", cropId: tomato.id, productId: tomato.productId });
    state = act(state, { type: "HARVEST", cropId: wheat.id, productId: wheat.productId });
    const fullBasket = applyGameAction(state, { type: "HARVEST", cropId: corn.id, productId: corn.productId });

    expect(state.franchises[0].carry.items).toEqual({ tomatoes: 1, wheat: 1 });
    expect(fullBasket.ok).toBe(false);
    expect(fullBasket.message).toContain("llena");
    expect(fullBasket.state.franchises[0].carry.items).toEqual({ tomatoes: 1, wheat: 1 });
    expect(fullBasket.state.franchises[0].crops.find((crop) => crop.id === corn.id)).toMatchObject({ status: "READY", available: 1 });
  });

  it("orders, receives, picks up and magnet-stocks a real supplier batch without seeded carry", () => {
    const initial = createInitialGame("ES");
    const balanceBefore = initial.balanceMinor;
    const ordered = applyGameAction(initial, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 10 });

    expect(ordered.ok, ordered.message).toBe(true);
    expect(Number.isSafeInteger(ordered.state.balanceMinor)).toBe(true);
    expect(balanceBefore - ordered.state.balanceMinor).toBe(700);
    expect(ordered.events).toHaveLength(1);
    expect(ordered.events[0].amountMinor).toBe(-700);
    expect(ordered.state.franchises[0].warehouse.wheat).toBe(0);

    const delivered = advanceSimulation(ordered.state, 80);
    expect(delivered.state.pendingOrders).toHaveLength(0);
    expect(delivered.state.franchises[0].warehouse.wheat).toBe(10);

    const pickedUp = applyGameAction(delivered.state, { type: "PICKUP_WAREHOUSE" });
    expect(pickedUp.ok, pickedUp.message).toBe(true);
    expect(pickedUp.state.franchises[0].carry).toEqual({ capacity: 3, items: { wheat: 3 } });
    expect(pickedUp.state.franchises[0].warehouse.wheat).toBe(7);
    expect(pickedUp.state.balanceMinor).toBe(ordered.state.balanceMinor);

    const stocked = applyGameAction(pickedUp.state, { type: "STOCK", productId: "wheat", quantity: 3, source: "carry" });
    expect(stocked.ok, stocked.message).toBe(true);
    expect(stocked.state.franchises[0].carry.items).toEqual({});
    expect(stocked.state.franchises[0].shelves.wheat).toBe(3);
    expect(stocked.state.franchises[0].warehouse.wheat).toBe(7);
    expect(stocked.state.franchises[0].warehouse.wheat + stocked.state.franchises[0].shelves.wheat).toBe(10);
  });

  it("harvests tomatoes, stocks visible inventory, queues a real customer and commits one payment", () => {
    let state = createInitialGame();
    state = act(state, { type: "TOGGLE_STORE" });
    const crop = state.franchises[0].crops.find((candidate) => candidate.productId === "tomatoes")!;
    Object.assign(crop, { status: "READY", available: 3, tier: 9 });
    state = act(state, { type: "HARVEST", cropId: crop.id, productId: "tomatoes" });
    state = act(state, { type: "HARVEST", cropId: crop.id, productId: "tomatoes" });
    state = act(state, { type: "HARVEST", cropId: crop.id, productId: "tomatoes" });
    state = act(state, { type: "STOCK", productId: "tomatoes", quantity: 3, source: "carry" });
    const balanceBefore = state.balanceMinor;
    state = tick(state, 65);
    expect(state.franchises[0].checkoutTransactions.some((transaction) => transaction.state !== "COMPLETE")).toBe(true);
    expect(state.franchises[0].shelves.tomatoes).toBeLessThan(3);
    expect(state.balanceMinor).toBe(balanceBefore);
    const transactionId = state.franchises[0].checkoutTransactions.find((transaction) => transaction.state !== "COMPLETE")!.id;
    let saleEvents = 0;
    for (let unit = 0; unit < 8; unit++) {
      const result = applyGameAction(state, { type: "CHECKOUT", paymentMethod: "cash" });
      if (!result.ok) break;
      saleEvents += result.events.filter((event) => event.category === "sales" && event.payload?.transactionId === transactionId).length;
      const progressed = advanceWorld(result.state, 1_000);
      saleEvents += progressed.events.filter((event) => event.category === "sales" && event.payload?.transactionId === transactionId).length;
      state = progressed.state;
      if (state.franchises[0].checkoutTransactions.find((transaction) => transaction.id === transactionId)?.state === "COMPLETE") break;
    }
    expect(saleEvents).toBe(1);
    expect(state.balanceMinor).toBeGreaterThan(balanceBefore);
  });

  it("runs wheat -> flour -> bread without frame-rate dependent shortcuts", () => {
    let state = createInitialGame(); const franchise = state.franchises[0];
    const wheat = franchise.crops.find((crop) => crop.productId === "wheat")!;
    Object.assign(wheat, { status: "READY", available: 2, tier: 6 });
    const mill = franchise.productionMachines.find((machine) => machine.id === "flour-mill-1")!; mill.status = "WAITING_INPUT";
    const oven = franchise.productionMachines.find((machine) => machine.id === "bread-oven-1")!; oven.status = "WAITING_INPUT";
    state = act(state, { type: "HARVEST", cropId: wheat.id, productId: "wheat" }); state = act(state, { type: "HARVEST", cropId: wheat.id, productId: "wheat" });
    state = act(state, { type: "LOAD_FLOUR_MILL" }); state = tick(state, 4);
    state = act(state, { type: "OPERATE_MACHINE", machineId: "flour-mill-1" });
    state = act(state, { type: "BAKE_BREAD" }); state = tick(state, 6);
    state = act(state, { type: "OPERATE_MACHINE", machineId: "bread-oven-1" });
    state = act(state, { type: "STOCK", productId: "bread", source: "carry" });
    expect(state.franchises[0].shelves.bread).toBe(1);
    expect(state.progression.counters["production:flour"]).toBe(1);
    expect(state.progression.counters["production:bread"]).toBe(1);
  });

  it("does not duplicate the last product when two customers reach it", () => {
    let state = createInitialGame(); state.franchises[0].open = true; state.franchises[0].lastCustomerSpawnAt = 999_999;
    state.franchises[0].shelves.tomatoes = 1;
    state.franchises[0].customers = [shopper("first", "tomatoes", 0), shopper("second", "tomatoes", 1)];
    state = advanceWorld(state, 1_000).state;
    state = advanceWorld(state, 1_000).state;
    expect(state.franchises[0].shelves.tomatoes).toBe(0);
    expect(state.franchises[0].customers.reduce((sum, customer) => sum + (customer.basket.tomatoes ?? 0), 0)).toBe(1);
  });

  it("keeps an empty cart away from checkout instead of faking an instant payment", () => {
    let state = createInitialGame();
    state.franchises[0].open = true;
    state.franchises[0].lastCustomerSpawnAt = 999_999;
    state.franchises[0].customers = [{
      ...shopper("empty-shopper", "tomatoes", 0),
      state: "NAVIGATE_TO_QUEUE",
      currentLine: 1,
      basket: {},
      queueSlot: 0,
      queueJoinedAt: 0,
      path: [[5.25, 2.85]],
    }];

    state = advanceWorld(state, 100).state;

    expect(state.franchises[0].customers[0]).toMatchObject({
      state: "NAVIGATE_TO_CART_RETURN",
      queueSlot: null,
      queueJoinedAt: null,
      transactionId: null,
    });
    expect(state.franchises[0].queueCustomerIds).not.toContain("empty-shopper");
    expect(state.franchises[0].checkoutTransactions).toHaveLength(0);
  });

  it("rebases legacy wall-clock production so stocked customers can reach checkout", () => {
    const wallNow = 1_788_318_403_841;
    let state = createInitialGame();
    state.simulationTimeMs = 8_591_000;
    state.lastServerTime = wallNow;
    state.level = 4;
    const franchise = state.franchises[0];
    franchise.open = true;
    franchise.shelves.tomatoes = 0;
    franchise.warehouse.tomatoes = 0;
    Object.assign(franchise.crops[0], {
      status: "GROWING",
      plantedAt: wallNow - 300_000,
      readyAt: wallNow - 296_000,
      available: 0,
    });

    state = normalizeGameState(JSON.parse(JSON.stringify(state)));

    expect(state.franchises[0].crops[0]).toMatchObject({ status: "READY", available: 3 });
    state = act(state, { type: "HARVEST", cropId: franchise.crops[0].id, productId: "tomatoes" });
    state = act(state, { type: "STOCK", productId: "tomatoes", quantity: 1, source: "carry" });
    state = tick(state, 65);
    expect(state.franchises[0].customers.some((customer) => customerBasketUnitsForTest(customer) > 0)).toBe(true);
    expect(state.franchises[0].checkoutTransactions.some((transaction) => transaction.state !== "COMPLETE")).toBe(true);
  });

  it("reverses the automatic door and restores partial construction", () => {
    let state = createInitialGame();
    state = act(state, { type: "DOOR_SENSOR", active: true }); state = advanceWorld(state, 500).state;
    expect(state.franchises[0].doorState).toBe("OPEN");
    state = act(state, { type: "DOOR_SENSOR", active: false }); state = advanceWorld(state, 500).state;
    expect(state.franchises[0].doorState).toBe("OPEN");
    state = act(state, { type: "DOOR_SENSOR", active: true }); state = advanceWorld(state, 250).state;
    expect(["OPEN", "OPENING"]).toContain(state.franchises[0].doorState);
    state = act(state, { type: "CONTRIBUTE_BUILD", amountMinor: 700 });
    const restored = normalizeGameState(JSON.parse(JSON.stringify(state)));
    expect(restored.franchises[0].buildProjects[0].contributedMinor).toBe(700);
  });

  it("opens for customers and staff at either edge regardless of their current task", () => {
    const sensor = STOREFRONT_LAYOUT.sensor;
    const customerState = createInitialGame();
    customerState.franchises[0].customers = [{
      ...shopper("door-edge-customer", "tomatoes", 0),
      state: "WAIT_CHECKOUT",
      x: sensor.centerX - sensor.actorHalfWidth + 0.01,
      z: sensor.centerZ,
    }];

    const customerTick = advanceWorld(customerState, 100).state;
    expect(customerTick.franchises[0].doorState).toBe("OPENING");
    expect(customerTick.franchises[0].doorProgress).toBeGreaterThan(0);

    const employeeState = createInitialGame();
    employeeState.franchises[0].employees = [{
      id: "door-edge-stocker",
      name: "Luna",
      role: "stocker",
      level: 1,
      salaryMinor: 3_000,
      energy: 100,
      hat: "frog",
      runtime: {
        state: "IDLE",
        assignedProduct: null,
        assignedStationId: null,
        carry: { capacity: 2, items: {} },
        x: sensor.centerX + sensor.actorHalfWidth - 0.01,
        z: sensor.centerZ,
        targetX: sensor.centerX + sensor.actorHalfWidth - 0.01,
        targetZ: sensor.centerZ,
        path: [],
        pathIndex: 0,
        speed: 1.5,
        currentSpeed: 0,
        stateSince: 0,
      },
    }];

    const employeeTick = advanceWorld(employeeState, 100).state;
    expect(employeeTick.franchises[0].doorState).toBe("OPENING");
    expect(employeeTick.franchises[0].doorProgress).toBeGreaterThan(0);
  });

  it("keeps customers on the correct side of the threshold until the doors are fully open", () => {
    let state = createInitialGame();
    const franchise = state.franchises[0];
    franchise.open = true;
    franchise.lastCustomerSpawnAt = 999_999;
    franchise.customers = [{
      ...shopper("door-exit", "tomatoes", 0),
      state: "EXIT_STORE",
      hasCart: false,
      x: 0,
      z: 7.2,
      targetX: 0,
      targetZ: 15.4,
      path: [[0, 15.4]],
      currentSpeed: 1.45,
    }];

    for (let tickIndex = 0; tickIndex < 4; tickIndex += 1) state = advanceWorld(state, 100).state;
    expect(state.franchises[0].doorProgress).toBeLessThan(1);
    expect(state.franchises[0].customers[0].z).toBeLessThanOrEqual(7.25);

    state = advanceWorld(state, 100).state;
    expect(state.franchises[0].doorState).toBe("OPEN");
    expect(state.franchises[0].doorProgress).toBe(1);
    expect(state.franchises[0].customers[0].z).toBeGreaterThan(7.25);
  });

  it("persists a checkout in progress and commits its payment only once after reload", () => {
    let state = createInitialGame();
    state.franchises[0].open = true;
    state.franchises[0].customers = [{ ...shopper("resume-customer", "tomatoes", 0), state: "WAIT_CHECKOUT", basket: { tomatoes: 2 }, transactionId: "resume-transaction", queueSlot: 0, queueJoinedAt: 0 }];
    state.franchises[0].checkoutTransactions = [{ id: "resume-transaction", customerId: "resume-customer", pendingItems: [{ productId: "tomatoes", quantity: 2, loaded: 2, scanned: 2, bagged: 2 }], paymentMethod: "card", state: "PAYMENT", nextUnitIndex: 2, paymentCommitted: false, updatedAt: 0, lastLoadedAt: 0, lastScannedAt: 0, lastBaggedAt: 0, checkoutLane: 0 }];
    state = normalizeGameState(JSON.parse(JSON.stringify(state)));
    const before = state.balanceMinor;
    const paymentStarted = advanceWorld(state, 1_000);
    expect(paymentStarted.events.filter((event) => event.category === "sales")).toHaveLength(0);
    const paymentInProgress = advanceWorld(paymentStarted.state, 1_000);
    expect(paymentInProgress.events.filter((event) => event.category === "sales")).toHaveLength(0);
    const payment = advanceWorld(paymentInProgress.state, 1_000);
    expect(payment.events.filter((event) => event.category === "sales")).toHaveLength(1);
    const idempotent = advanceWorld(payment.state, 1_000);
    expect(idempotent.events.filter((event) => event.category === "sales")).toHaveLength(0);
    expect(idempotent.state.balanceMinor).toBeGreaterThan(before);
  });

  it("processes milk into cheese and sells the exact picked unit", () => {
    let state = createInitialGame();
    const franchise = state.franchises[0];
    const cheese = franchise.productionMachines.find((machine) => machine.id === "cheese-maker-1")!;
    cheese.status = "WAITING_INPUT";
    franchise.carry.items = { milk: 2 };
    state = act(state, { type: "OPERATE_MACHINE", machineId: cheese.id });
    state = tick(state, 8);
    state = act(state, { type: "OPERATE_MACHINE", machineId: cheese.id });
    state = act(state, { type: "STOCK", productId: "cheese", source: "carry" });
    expect(state.franchises[0].shelves.cheese).toBe(1);
    state.franchises[0].open = true;
    state.franchises[0].lastCustomerSpawnAt = 999_999;
    state.franchises[0].customers = [shopper("cheese-shopper", "cheese", 0)];
    state = tick(state, 2);
    expect(state.franchises[0].shelves.cheese).toBe(0);
    expect(state.franchises[0].customers[0].basket.cheese).toBe(1);
  });

  it("keeps two unlocked checkout lanes balanced", () => {
    let state = createInitialGame();
    state.franchises[0].open = true;
    state.franchises[0].lastCustomerSpawnAt = 999_999;
    state.franchises[0].unlockedAreas.push("checkout-2");
    state.franchises[0].customers = Array.from({ length: 8 }, (_, index) => ({ ...shopper(`queue-${index}`, "tomatoes", index), state: "NAVIGATE_TO_QUEUE" as const, path: [] }));
    state = advanceWorld(state, 250).state;
    const lane0 = state.franchises[0].customers.filter((customer) => customer.queueLane === 0).length;
    const lane1 = state.franchises[0].customers.filter((customer) => customer.queueLane === 1).length;
    expect(Math.abs(lane0 - lane1)).toBeLessThanOrEqual(1);
  });

  it("preserves partial automatic upgrades and applies a station tier exactly once", () => {
    let state = createInitialGame();
    const partial = applyGameAction(state, { type: "CONTRIBUTE_UPGRADE", upgrade: "station", amountMinor: 2_000 });
    expect(partial.ok).toBe(true);
    state = normalizeGameState(JSON.parse(JSON.stringify(partial.state)));
    expect(Object.values(state.franchises[0].upgradeContributions)[0]).toBe(2_000);
    const complete = applyGameAction(state, { type: "CONTRIBUTE_UPGRADE", upgrade: "station", amountMinor: 10_000 });
    expect(complete.ok).toBe(true);
    expect(Math.max(...Object.values(complete.state.franchises[0].stationTiers))).toBe(2);
  });

  it("runs a level-30 crowd for three simulated minutes without invalid stock or duplicate payments", () => {
    let state = createInitialGame();
    state.level = 30;
    state.franchises[0].open = true;
    state.franchises[0].unlockedAreas.push("checkout-2");
    for (const id of ["tomatoes", "bread", "eggs", "corn", "milk", "cheese", "juice"] as ProductId[]) state.franchises[0].shelves[id] = 200;
    state = act(state, { type: "HIRE", role: "cashier" });
    const saleIds = new Set<string>();
    for (let second = 0; second < 180; second += 1) {
      const result = advanceWorld(state, 1_000);
      for (const event of result.events.filter((candidate) => candidate.category === "sales")) {
        const transactionId = String(event.payload?.transactionId);
        expect(saleIds.has(transactionId)).toBe(false);
        saleIds.add(transactionId);
      }
      state = result.state;
    }
    expect(state.franchises[0].customers.filter((customer) => customer.state !== "DESPAWN").length).toBeLessThanOrEqual(30);
    expect(Object.values(state.franchises[0].shelves).every((quantity) => quantity >= 0)).toBe(true);
    expect([...saleIds].length).toBeGreaterThan(0);
  });
});

function customerBasketUnitsForTest(customer: CustomerRuntimeState) {
  return Object.values(customer.basket).reduce((sum, quantity) => sum + (quantity ?? 0), 0);
}
