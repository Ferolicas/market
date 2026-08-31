import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, CHECKOUT_SCAN_UNIT_MS, createInitialGame, normalizeGameState } from "./engine";
import type { CheckoutTransaction, CustomerRuntimeState, GameState, PaymentMethod } from "./types";
import { CHECKOUT_LANES } from "./stations/checkout-layout";

function addReadyCheckout(state: GameState, id: string, paymentMethod: PaymentMethod) {
  const customer = {
    id, identity: 1, state: "WAIT_CHECKOUT", shoppingList: [{ productId: "apples", requested: 1, picked: 1 }], currentLine: 1,
    basket: { apples: 1 }, patienceMs: 10_000, checkoutPatienceMs: 300_000, waitingSince: null, queueSlot: 0, transactionId: `${id}-tx`, hasCart: true, hasBag: false, angry: false,
    x: 5.45, z: 3.95, targetX: 5.45, targetZ: 3.95, path: [], pathIndex: 0, speed: 1.4, stateSince: state.simulationTimeMs, reservedSocketId: null, blockedSince: null, routeFailures: 0,
  } satisfies CustomerRuntimeState;
  const transaction = {
    id: `${id}-tx`, customerId: id, pendingItems: [{ productId: "apples", quantity: 1, loaded: 1, scanned: 0, bagged: 0 }], paymentMethod,
    state: "SCANNING", nextUnitIndex: 0, paymentCommitted: false, updatedAt: state.simulationTimeMs,
    lastLoadedAt: state.simulationTimeMs, lastScannedAt: state.simulationTimeMs - CHECKOUT_SCAN_UNIT_MS, lastBaggedAt: state.simulationTimeMs,
  } satisfies CheckoutTransaction;
  state.franchises[0].customers.push(customer);
  state.franchises[0].checkoutTransactions.push(transaction);
}

describe("motor económico", () => {
  it("integra la distancia del jugador dentro del tick mundial sin una acción global adicional", () => {
    const state = createInitialGame("ES");
    const next = advanceWorld(state, 100, undefined, { playerDistanceMeters: 1.25 }).state;

    expect(next.progression.counters["distance:player"]).toBe(1.25);
    expect(next.revision).toBe(state.revision + 1);
    expect(state.progression.counters["distance:player"]).toBeUndefined();
  });

  it("agrupa las interacciones de proximidad en una sola revisión inmutable del mundo", () => {
    const state = createInitialGame("ES");
    const franchise = state.franchises[0];
    franchise.carry = { capacity: 3, item: { productId: "tomatoes", quantity: 2 } };
    franchise.shelves.tomatoes = 0;

    const result = advanceWorld(state, 100, undefined, {
      interactions: [
        { type: "STOCK", productId: "tomatoes", quantity: 1, source: "carry" },
        { type: "STOCK", productId: "tomatoes", quantity: 1, source: "carry" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.state.franchises[0].shelves.tomatoes).toBe(2);
    expect(result.state.franchises[0].carry.item).toBeNull();
    expect(result.state.progression.counters["stock:tomatoes"]).toBe(2);
    expect(result.state.revision).toBe(state.revision + 1);
    expect(state.franchises[0].shelves.tomatoes).toBe(0);
    expect(state.franchises[0].carry.item?.quantity).toBe(2);
  });

  it("recorre waypoints cortos sin detenerse en cada tick", () => {
    const state = createInitialGame("ES");
    state.franchises[0].customers = [{
      id: "dense-path", identity: 1, state: "ENTER_STORE", shoppingList: [], currentLine: 0, basket: {}, patienceMs: 10_000, checkoutPatienceMs: 300_000,
      waitingSince: null, queueSlot: null, transactionId: null, hasCart: false, hasBag: false, angry: false, x: 0, z: 0, targetX: 0.04, targetZ: 0,
      path: [[0.04, 0], [0.08, 0], [0.2, 0], [1, 0]], pathIndex: 0, speed: 2, currentSpeed: 2,
      stateSince: 0, reservedSocketId: null, blockedSince: null, routeFailures: 0,
    }];

    const next = advanceWorld(state, 100).state.franchises[0].customers[0];

    expect(next.x).toBeCloseTo(0.2);
    expect(next.pathIndex).toBe(3);
    expect(next.targetX).toBe(1);
  });

  it("mantiene la velocidad por nivel del trabajador sin frenar en waypoints cortos", () => {
    const state = createInitialGame("ES");
    state.franchises[0].employees = [{
      id: "dense-worker", name: "Luna", role: "stocker", level: 3, salaryMinor: 3_000, energy: 100, hat: "frog",
      runtime: {
        state: "NAVIGATE_PICKUP", assignedProduct: "tomatoes", assignedStationId: "stockroom",
        carry: { capacity: 4, item: null }, x: 0, z: 0, targetX: 0.04, targetZ: 0,
        path: [[0.04, 0], [0.08, 0], [0.2, 0], [1, 0]], pathIndex: 0, speed: 1.66, currentSpeed: 1.66, stateSince: 0,
      },
    }];

    const next = advanceWorld(state, 100).state.franchises[0].employees[0].runtime!;

    expect(next.speed).toBeCloseTo(1.66);
    expect(next.x).toBeCloseTo(0.166);
    expect(next.pathIndex).toBe(2);
    expect(next.targetX).toBe(0.2);
  });

  it("mantiene una caja global al viajar entre franquicias", () => {
    const state = createInitialGame("ES");
    state.level = 10;
    state.balanceMinor = 2_000_000;
    const bought = applyGameAction(state, { type: "BUY_FRANCHISE", franchiseId: "estacion" });
    const balance = bought.state.balanceMinor;
    const travelled = applyGameAction(bought.state, { type: "TRAVEL", franchiseId: "estacion" });
    expect(travelled.ok).toBe(true);
    expect(travelled.state.balanceMinor).toBe(balance);
  });

  it("un reponedor delega el abastecimiento", () => {
    let state = createInitialGame("ES");
    state.level = 5;
    state.franchises[0].employees.push({ id: "e1", name: "Luna", role: "stocker", level: 1, salaryMinor: 3000, energy: 100, hat: "frog" });
    state.franchises[0].open = true;
    for (const productId of Object.keys(state.franchises[0].warehouse) as (keyof typeof state.franchises[0]["warehouse"])[]) state.franchises[0].warehouse[productId] = 0;
    state.franchises[0].shelves.apples = 0;
    state.franchises[0].warehouse.apples = 3;
    for (let tick = 0; tick < 60; tick++) state = advanceWorld(state, 1_000).state;
    expect(state.franchises[0].shelves.apples).toBeGreaterThan(0);
    expect(state.franchises[0].warehouse.apples + state.franchises[0].shelves.apples + (state.franchises[0].employees[0].runtime?.carry.item?.quantity ?? 0)).toBe(3);
  });

  it("no permite gastar más caja de la disponible", () => {
    const state = createInitialGame("ES");
    state.balanceMinor = 0;
    expect(applyGameAction(state, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 20 }).ok).toBe(false);
  });

  it("registra cobros manuales por efectivo y tarjeta", () => {
    const state = createInitialGame("ES");
    state.franchises[0].open = true;
    addReadyCheckout(state, "cash-customer", "cash");
    const cashScan = applyGameAction(state, { type: "CHECKOUT", paymentMethod: "cash" });
    const cashBagging = advanceWorld(cashScan.state, 1_000);
    const cashPayment = advanceWorld(cashBagging.state, 1_000);
    const cashCommitted = advanceWorld(cashPayment.state, 1_000);
    expect(cashCommitted.events[0].description).toContain("efectivo");
    addReadyCheckout(cashCommitted.state, "card-customer", "card");
    const cardScan = applyGameAction(cashCommitted.state, { type: "CHECKOUT", paymentMethod: "card" });
    const cardBagging = advanceWorld(cardScan.state, 1_000);
    const cardPayment = advanceWorld(cardBagging.state, 1_000);
    const cardCommitted = advanceWorld(cardPayment.state, 1_000);
    expect(cardCommitted.events[0].description).toContain("tarjeta");
  });

  it("mantiene descarga, escaneo, embolsado y pago como fases visibles", () => {
    let state = createInitialGame("ES");
    const franchise = state.franchises[0];
    franchise.open = true;
    franchise.lastCustomerSpawnAt = 999_999;
    addReadyCheckout(state, "paced-customer", "card");
    const transaction = franchise.checkoutTransactions[0];
    transaction.pendingItems[0].loaded = 0;
    transaction.state = "CUSTOMER_LOADING";
    transaction.lastLoadedAt = 0;
    const balanceBefore = state.balanceMinor;

    state = applyGameAction(state, { type: "CHECKOUT", paymentMethod: "card" }).state;
    expect(state.franchises[0].checkoutTransactions[0].pendingItems[0].scanned).toBe(0);
    state = advanceWorld(state, 800).state;
    expect(state.franchises[0].checkoutTransactions[0].pendingItems[0].loaded).toBe(0);
    state = advanceWorld(state, 100).state;
    expect(state.franchises[0].checkoutTransactions[0].pendingItems[0].loaded).toBe(1);

    state = applyGameAction(state, { type: "CHECKOUT", paymentMethod: "card" }).state;
    state = advanceWorld(state, 600).state;
    expect(state.franchises[0].customers[0].state).toBe("WAIT_CHECKOUT");
    expect(state.balanceMinor).toBe(balanceBefore);
    state = advanceWorld(state, 100).state;
    expect(state.franchises[0].customers[0]).toMatchObject({ state: "PAY", queueSlot: 0 });
    expect(state.balanceMinor).toBe(balanceBefore);

    state = advanceWorld(state, 1_000).state;
    state = advanceWorld(state, 700).state;
    expect(state.franchises[0].customers[0].state).toBe("PAY");
    const committed = advanceWorld(state, 100);
    expect(committed.events.filter((event) => event.category === "sales")).toHaveLength(1);
    expect(committed.state.franchises[0].customers[0].state).toBe("NAVIGATE_TO_BAG");
  });

  it("reubica un cajero guardado en el lado antiguo antes de permitirle escanear", () => {
    const state = createInitialGame("ES");
    const franchise = state.franchises[0];
    franchise.open = true;
    addReadyCheckout(state, "relocated-cashier-customer", "card");
    franchise.employees = [{
      id: "relocated-cashier",
      name: "Luna",
      role: "cashier",
      level: 1,
      salaryMinor: 3_000,
      energy: 100,
      hat: "frog",
      runtime: {
        state: "OPERATE_CHECKOUT",
        assignedProduct: null,
        assignedStationId: "checkout-1",
        carry: { capacity: 2, item: null },
        x: 6.35,
        z: 2.78,
        targetX: 6.35,
        targetZ: 2.78,
        path: [],
        pathIndex: 0,
        speed: 1.5,
        currentSpeed: 0,
        stateSince: 0,
      },
    }];

    const next = advanceWorld(state, 100).state;
    const runtime = next.franchises[0].employees[0].runtime!;

    expect(runtime.state).toBe("NAVIGATE_CHECKOUT");
    expect(runtime.path.at(-1)).toEqual([CHECKOUT_LANES[0].cashierWork[0], CHECKOUT_LANES[0].cashierWork[2]]);
    expect(next.franchises[0].checkoutTransactions[0].pendingItems[0].scanned).toBe(0);
  });

  it("no cobra solo y envía la compra a devoluciones al agotar cinco minutos", () => {
    let state = createInitialGame("ES");
    state.franchises[0].open = true;
    addReadyCheckout(state, "waiting-customer", "card");
    state.simulationTimeMs = 299_500;
    const customer = state.franchises[0].customers[0];
    customer.queueJoinedAt = 0;
    customer.stateSince = 0;
    const balanceBefore = state.balanceMinor;

    state = advanceWorld(state, 1_000).state;
    expect(state.balanceMinor).toBe(balanceBefore);
    expect(state.franchises[0].customers[0]).toMatchObject({ angry: true, state: "NAVIGATE_TO_RETURNS" });
    expect(state.franchises[0].checkoutTransactions[0].state).toBe("ABANDONED");

    for (let second = 0; second < 20; second += 1) state = advanceWorld(state, 1_000).state;
    expect(state.franchises[0].returnsBin.apples).toBe(1);
  });

  it("contabiliza impuestos solamente sobre beneficio positivo", () => {
    const state = createInitialGame("CO");
    state.franchises[0].revenueTodayMinor = state.balanceMinor * 3;
    const result = applyGameAction(state, { type: "CLOSE_DAY" });
    expect(result.state.finances.taxesMinor).toBeGreaterThan(0);
    expect(result.state.day).toBe(2);
  });

  it("escala toda la economía a la moneda del país", () => {
    const spain = createInitialGame("ES");
    const colombia = createInitialGame("CO");
    expect(colombia.balanceMinor).toBeGreaterThan(spain.balanceMinor * 1000);
    expect(colombia.franchises[1].purchaseCostMinor).toBeGreaterThan(spain.franchises[1].purchaseCostMinor * 1000);
    expect(colombia.missions[0].rewardMinor).toBeGreaterThan(spain.missions[0].rewardMinor * 1000);
  });

  it("migra partidas antiguas y permite cambiar por completo el personaje", () => {
    const legacy = createInitialGame("ES") as unknown as { schemaVersion: number; avatar: Record<string, unknown> };
    legacy.schemaVersion = 1;
    delete legacy.avatar.body;
    delete legacy.avatar.hair;
    delete legacy.avatar.hairColor;
    const migrated = normalizeGameState(legacy);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.avatar.body).toBe("adult-man");
    const changed = applyGameAction(migrated, { type: "SET_AVATAR", body: "adult-woman", hair: "long-wavy", hairColor: "#7a3f22", hat: "none" });
    expect(changed.state.avatar).toMatchObject({ body: "adult-woman", hair: "long-wavy", hairColor: "#7a3f22", hat: "none" });
  });

  it("replaces hats from retired non-kit assets during recovery", () => {
    const legacy = createInitialGame("ES") as unknown as { avatar: Record<string, unknown>; franchises: { employees: Record<string, unknown>[] }[] };
    legacy.avatar.hat = "axolotl";
    legacy.franchises[0].employees.push({ id: "legacy", name: "Luna", role: "cashier", level: 1, salaryMinor: 3000, energy: 100, hat: "mouse" });

    const migrated = normalizeGameState(legacy);

    expect(migrated.avatar.hat).toBe("none");
    expect(migrated.franchises[0].employees[0].hat).toBe("red-panda");
  });
});
