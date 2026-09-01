import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, canOperateMachine, canProcessCheckoutUnit, CHECKOUT_SCAN_UNIT_MS, createInitialGame, employeeHiringQuote, normalizeGameState, unlockedCustomerProducts, upgradeQuote } from "./engine";
import type { CheckoutTransaction, CustomerRuntimeState, GameState, PaymentMethod } from "./types";
import { CHECKOUT_LANES, checkoutQueueArrival } from "./stations/checkout-layout";
import { createCustomerMind } from "./ai/CustomerBrain";

function addReadyCheckout(state: GameState, id: string, paymentMethod: PaymentMethod) {
  const customer = {
    id, identity: 1, state: "WAIT_CHECKOUT", shoppingList: [{ productId: "apples", requested: 1, picked: 1 }], currentLine: 1,
    basket: { apples: 1 }, patienceMs: 10_000, checkoutPatienceMs: 300_000, waitingSince: null, queueSlot: 0, transactionId: `${id}-tx`, hasCart: true, hasBag: false, angry: false,
    x: CHECKOUT_LANES[0].customerFront[0], z: CHECKOUT_LANES[0].customerFront[1], targetX: CHECKOUT_LANES[0].customerFront[0], targetZ: CHECKOUT_LANES[0].customerFront[1], path: [], pathIndex: 0, speed: 1.4, stateSince: state.simulationTimeMs, reservedSocketId: null, blockedSince: null, routeFailures: 0,
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
    franchise.carry = { capacity: 3, items: { tomatoes: 2 } };
    franchise.shelves.tomatoes = 0;

    const result = advanceWorld(state, 100, undefined, {
      interactions: [
        { type: "STOCK", productId: "tomatoes", quantity: 1, source: "carry" },
        { type: "STOCK", productId: "tomatoes", quantity: 1, source: "carry" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.state.franchises[0].shelves.tomatoes).toBe(2);
    expect(result.state.franchises[0].carry.items).toEqual({});
    expect(result.state.progression.counters["stock:tomatoes"]).toBe(2);
    expect(result.state.revision).toBe(state.revision + 1);
    expect(state.franchises[0].shelves.tomatoes).toBe(0);
    expect(state.franchises[0].carry.items.tomatoes).toBe(2);
  });

  it("confirma surtido real por proximidad sin dejar una cesta fantasma al vaciar la última unidad", () => {
    const state = createInitialGame("ES");
    const franchise = state.franchises[0];
    franchise.carry = { capacity: 3, items: { tomatoes: 1 } };
    franchise.shelves.tomatoes = 0;

    const result = advanceWorld(state, 100, undefined, {
      interactions: [{ type: "STOCK", productId: "tomatoes", quantity: 1, source: "carry" }],
    });

    expect(result.ok).toBe(true);
    expect(result.state.franchises[0].shelves.tomatoes).toBe(1);
    expect(result.state.franchises[0].carry.items).toEqual({});
    expect(result.state.progression.counters["stock:tomatoes"]).toBe(1);
    expect(result.state.progression.counters["transport:all"]).toBe(1);
  });

  it("carga una cesta mixta desde almacén en un único tick autoritativo y acotado", () => {
    const state = createInitialGame("ES");
    const franchise = state.franchises[0];
    franchise.carry = { capacity: 5, items: { tomatoes: 1 } };
    franchise.warehouse = { ...franchise.warehouse, milk: 2, eggs: 2, apples: 2 };

    const result = advanceWorld(state, 100, undefined, {
      interactions: [{ type: "PICKUP_WAREHOUSE" }],
    });

    expect(result.ok).toBe(true);
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.state.franchises[0].carry).toEqual({ capacity: 5, items: { tomatoes: 1, milk: 2, eggs: 1, apples: 1 } });
    expect(result.state.franchises[0].warehouse).toMatchObject({ milk: 0, eggs: 1, apples: 1 });
    expect(result.state.progression.counters["pickup:warehouse"]).toBe(4);
    expect(result.state.progression.counters["pickup:milk"]).toBe(2);
    expect(state.franchises[0].carry).toEqual({ capacity: 5, items: { tomatoes: 1 } });
    expect(state.franchises[0].warehouse).toMatchObject({ milk: 2, eggs: 2, apples: 2 });
  });

  it("recorta una cesta persistida corrupta al máximo visual y operativo de veinte", () => {
    const state = createInitialGame("ES");
    state.franchises[0].carry = { capacity: 500_000, items: { tomatoes: 500_000 } };

    const normalized = normalizeGameState(state).franchises[0].carry;

    expect(normalized.capacity).toBe(20);
    expect(normalized.items).toEqual({ tomatoes: 20 });
  });

  it("mantiene una unidad como cosecha predeterminada para llamadas existentes", () => {
    const state = createInitialGame("ES");
    state.franchises[0].crops[0] = { ...state.franchises[0].crops[0], status: "READY", available: 3 };

    const result = applyGameAction(state, { type: "HARVEST", cropId: "crop-tomato-1", productId: "tomatoes" });

    expect(result.ok).toBe(true);
    expect(result.state.franchises[0].carry.items.tomatoes).toBe(1);
    expect(result.state.franchises[0].crops[0]).toMatchObject({ status: "READY", available: 2 });
    expect(result.state.progression.counters["harvest:tomatoes"]).toBe(1);
  });

  it("limita una cosecha por lote al espacio libre real de la cesta", () => {
    const state = createInitialGame("ES");
    state.franchises[0].carry = { capacity: 5, items: { eggs: 3 } };
    state.franchises[0].crops[0] = { ...state.franchises[0].crops[0], status: "READY", available: 7 };

    const result = applyGameAction(state, { type: "HARVEST", cropId: "crop-tomato-1", productId: "tomatoes", quantity: 7 });

    expect(result.ok).toBe(true);
    expect(result.state.franchises[0].carry.items).toEqual({ eggs: 3, tomatoes: 2 });
    expect(result.state.franchises[0].crops[0]).toMatchObject({ status: "READY", available: 5 });
    expect(result.state.progression.counters["harvest:tomatoes"]).toBe(2);
    expect(result.state.progression.counters["harvest:all"]).toBe(2);
  });

  it("vacía siete unidades en una sola cosecha y programa un único rebrote", () => {
    const state = createInitialGame("ES");
    state.level = 10;
    state.franchises[0].carry = { capacity: 20, items: {} };
    state.franchises[0].crops[0] = { ...state.franchises[0].crops[0], status: "READY", available: 7 };
    const previousXp = state.xp;

    const result = applyGameAction(state, { type: "HARVEST", cropId: "crop-tomato-1", productId: "tomatoes", quantity: 7 });

    expect(result.ok).toBe(true);
    expect(result.state.franchises[0].carry.items.tomatoes).toBe(7);
    expect(result.state.franchises[0].crops[0]).toMatchObject({ status: "GROWING", available: 0 });
    expect(result.state.franchises[0].crops[0].plantedAt).toBe(state.simulationTimeMs);
    expect(result.state.franchises[0].crops[0].readyAt).toBeGreaterThan(state.simulationTimeMs);
    expect(result.state.progression.counters["harvest:tomatoes"]).toBe(7);
    expect(result.state.progression.counters["harvest:all"]).toBe(7);
    expect(result.state.xp).toBe(previousXp + 18 * 7);
  });

  it("conserva exactamente una cesta multproducto durante pulsos unitarios de varios departamentos", () => {
    const state = createInitialGame("ES");
    const franchise = state.franchises[0];
    franchise.carry = { capacity: 7, items: { tomatoes: 2, eggs: 2, milk: 2, cheese: 1 } };
    franchise.shelves.tomatoes = 0;
    franchise.shelves.eggs = 0;
    franchise.shelves.milk = 0;
    franchise.shelves.cheese = 0;
    const beforeTotal = Object.values(franchise.carry.items).reduce((sum, quantity) => sum + (quantity ?? 0), 0);

    const result = advanceWorld(state, 100, undefined, {
      interactions: [
        { type: "STOCK", productId: "eggs", quantity: 1, source: "carry" },
        { type: "STOCK", productId: "milk", quantity: 1, source: "carry" },
        { type: "STOCK", productId: "tomatoes", quantity: 1, source: "carry" },
        { type: "STOCK", productId: "cheese", quantity: 1, source: "carry" },
        { type: "STOCK", productId: "eggs", quantity: 1, source: "carry" },
        { type: "STOCK", productId: "milk", quantity: 1, source: "carry" },
        { type: "STOCK", productId: "tomatoes", quantity: 1, source: "carry" },
      ],
    });
    const next = result.state.franchises[0];
    const afterTotal = Object.values(next.carry.items).reduce((sum, quantity) => sum + (quantity ?? 0), 0)
      + next.shelves.tomatoes + next.shelves.eggs + next.shelves.milk + next.shelves.cheese;

    expect(next.carry.items).toEqual({});
    expect({ tomatoes: next.shelves.tomatoes, eggs: next.shelves.eggs, milk: next.shelves.milk, cheese: next.shelves.cheese }).toEqual({ tomatoes: 2, eggs: 2, milk: 2, cheese: 1 });
    expect(afterTotal).toBe(beforeTotal);
    expect(result.state.progression.counters["stock:all"]).toBe(7);
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

  it("termina la ruta de caja de frente a la cinta", () => {
    const state = createInitialGame("ES");
    state.franchises[0].lastCustomerSpawnAt = 999_999;
    state.franchises[0].customers = [{
      id: "checkout-facing", identity: 1, state: "NAVIGATE_TO_QUEUE", shoppingList: [{ productId: "apples", requested: 1, picked: 1 }], currentLine: 1,
      basket: { apples: 1 }, patienceMs: 10_000, checkoutPatienceMs: 300_000, waitingSince: null, queueSlot: null, queueLane: 0,
      queueJoinedAt: 0, transactionId: null, hasCart: true, hasBag: false, angry: false, x: 2.2, z: 0.45, targetX: 2.2, targetZ: 0.45,
      path: [], pathIndex: 0, speed: 1.4, currentSpeed: 0, stateSince: 0, reservedSocketId: null, blockedSince: null, routeFailures: 0,
    }];
    const directPathfinder = (_start: [number, number], target: [number, number]) => [target];

    const customer = advanceWorld(state, 1, directPathfinder).state.franchises[0].customers[0];
    const [approach, destination] = checkoutQueueArrival(0, 0);

    expect(customer.path.slice(-2)).toEqual([approach, destination]);
    expect(destination[0] - approach[0]).toBe(0);
    expect(destination[1] - approach[1]).toBeGreaterThan(0);
  });

  it("mantiene la velocidad por nivel del trabajador sin frenar en waypoints cortos", () => {
    const state = createInitialGame("ES");
    state.franchises[0].employees = [{
      id: "dense-worker", name: "Luna", role: "stocker", level: 3, salaryMinor: 3_000, energy: 100, hat: "frog",
      runtime: {
        state: "NAVIGATE_PICKUP", assignedProduct: "tomatoes", assignedStationId: "stockroom",
        carry: { capacity: 4, items: {} }, x: 0, z: 0, targetX: 0.04, targetZ: 0,
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

  it("pone al día una franquicia comprada y propaga los niveles futuros a todas las tiendas", () => {
    const state = createInitialGame("ES");
    state.level = 5;
    state.balanceMinor = 2_000_000;

    const bought = applyGameAction(normalizeGameState(state), { type: "BUY_FRANCHISE", franchiseId: "estacion" });
    const station = bought.state.franchises.find((candidate) => candidate.id === "estacion")!;

    expect(bought.ok).toBe(true);
    expect(station.carry.capacity).toBe(5);
    expect(station.crops.some((crop) => crop.id === "crop-tomato-2")).toBe(true);
    expect(station.crops.find((crop) => crop.id === "crop-wheat-1")?.status).toBe("GROWING");
    expect(station.productionMachines.find((machine) => machine.id === "flour-mill-1")?.status).toBe("WAITING_INPUT");
    expect(station.buildProjects.some((project) => project.level === 6)).toBe(true);

    bought.state.progression.counters["harvest:wheat"] = 6;
    bought.state.franchises[0].buildProjects.find((project) => project.level === 6)!.completed = true;
    const levelSix = applyGameAction(bought.state, { type: "SET_AVATAR", shirt: bought.state.avatar.shirt });

    expect(levelSix.state.level).toBe(6);
    for (const franchise of levelSix.state.franchises.filter((candidate) => candidate.owned)) {
      expect(franchise.unlockedAreas).toContain("bread-oven");
      expect(franchise.productionMachines.find((machine) => machine.id === "bread-oven-1")?.status).toBe("WAITING_INPUT");
      expect(franchise.buildProjects.some((project) => project.level === 7)).toBe(true);
    }
  });

  it("mantiene mejoras superiores al reparar desbloqueos y hace alcanzable la megatienda en nivel 30", () => {
    const state = createInitialGame("ES");
    state.level = 24;
    state.franchises.find((candidate) => candidate.id === "megastore")!.unlockLevel = 32;
    state.franchises[0].carry.capacity = 20;
    state.franchises[0].stationTiers["checkout-1"] = 5;
    const once = normalizeGameState(state);
    const structureRevision = once.franchises[0].structureRevision;
    const twice = normalizeGameState(once);

    expect(twice.franchises[0].carry.capacity).toBe(20);
    expect(twice.franchises[0].stationTiers["checkout-1"]).toBe(5);
    expect(twice.franchises[0].structureRevision).toBe(structureRevision);
    expect(twice.franchises.find((candidate) => candidate.id === "megastore")?.unlockLevel).toBe(30);

    twice.level = 30;
    twice.balanceMinor = 50_000_000;
    const megastore = applyGameAction(twice, { type: "BUY_FRANCHISE", franchiseId: "megastore" });
    const target = megastore.state.franchises.find((candidate) => candidate.id === "megastore")!;
    expect(megastore.ok).toBe(true);
    expect(target.storeRank).toBe(4);
    expect(target.unlockedAreas).toContain("franchise-unlocked");
    expect(target.carry.capacity).toBeGreaterThanOrEqual(12);
  });

  it("reconcilia capacidad legacy y cada mejora pagada aumenta la cesta hasta veinte", () => {
    let state = createInitialGame("ES");
    state.level = 3;
    state.balanceMinor = 10_000_000;
    state.franchises[0].carry.capacity = 5;
    state.franchises[0].playerCapacityTier = 10;
    state = normalizeGameState(state);

    expect(state.franchises[0]).toMatchObject({ playerCapacityTier: 2, carry: { capacity: 5 } });

    for (const expectedCapacity of [8, 12, 16, 20]) {
      const quote = upgradeQuote(state, "player-capacity");
      expect(quote).not.toBeNull();
      const balanceBefore = state.balanceMinor;
      const result = applyGameAction(state, {
        type: "CONTRIBUTE_UPGRADE",
        upgrade: "player-capacity",
        amountMinor: quote!.remainingMinor,
      });

      expect(result.ok, result.message).toBe(true);
      expect(result.state.balanceMinor).toBe(balanceBefore - quote!.remainingMinor);
      expect(result.state.franchises[0].carry.capacity).toBe(expectedCapacity);
      expect(result.state.franchises[0].carry.capacity).toBeGreaterThan(state.franchises[0].carry.capacity);
      expect(result.state.franchises[0].playerCapacityTier).toBe(quote!.nextTier);
      state = result.state;
    }

    expect(upgradeQuote(state, "player-capacity")).toBeNull();
    const rejected = applyGameAction(state, { type: "CONTRIBUTE_UPGRADE", upgrade: "player-capacity", amountMinor: 100 });
    expect(rejected.ok).toBe(false);
    expect(rejected.state.balanceMinor).toBe(state.balanceMinor);
    expect(rejected.state.franchises[0].carry.capacity).toBe(20);
  });

  it("conserva los pisos gratuitos de capacidad de los niveles 3, 15 y 24", () => {
    for (const [level, capacity, tier] of [[3, 5, 2], [15, 8, 3], [24, 12, 4]] as const) {
      const legacy = createInitialGame("ES");
      legacy.level = level;
      legacy.franchises[0].carry.capacity = 3;
      legacy.franchises[0].playerCapacityTier = 10;

      const normalized = normalizeGameState(legacy).franchises[0];

      expect(normalized.carry.capacity).toBe(capacity);
      expect(normalized.playerCapacityTier).toBe(tier);
    }
  });

  it("un reponedor delega el abastecimiento", () => {
    let state = createInitialGame("ES");
    state.level = 5;
    state.franchises[0].employees.push({ id: "e1", name: "Luna", role: "stocker", level: 1, salaryMinor: 3000, energy: 100, hat: "frog" });
    state.franchises[0].open = true;
    state.franchises[0].lastCustomerSpawnAt = 999_999;
    for (const productId of Object.keys(state.franchises[0].warehouse) as (keyof typeof state.franchises[0]["warehouse"])[]) state.franchises[0].warehouse[productId] = 0;
    state.franchises[0].shelves.apples = 0;
    state.franchises[0].warehouse.apples = 3;
    for (let tick = 0; tick < 60; tick++) state = advanceWorld(state, 1_000).state;
    expect(state.franchises[0].shelves.apples).toBeGreaterThan(0);
    expect(state.franchises[0].warehouse.apples + state.franchises[0].shelves.apples + (state.franchises[0].employees[0].runtime?.carry.items.apples ?? 0)).toBe(3);
  });

  it("un agricultor llena el espacio restante en un solo viaje y conserva la cosecha parcial", () => {
    const state = createInitialGame("ES");
    const franchise = state.franchises[0];
    franchise.lastCustomerSpawnAt = 999_999;
    franchise.crops[0] = { ...franchise.crops[0], status: "READY", available: 7 };
    franchise.employees = [{
      id: "batch-farmer", name: "Luna", role: "farmer", level: 1, salaryMinor: 3_000, energy: 100, hat: "frog",
      runtime: {
        state: "PICKUP", assignedProduct: "tomatoes", assignedStationId: franchise.crops[0].id,
        carry: { capacity: 3, items: { tomatoes: 1 } }, x: -6.3, z: -12.72, targetX: -6.3, targetZ: -12.72,
        path: [], pathIndex: 0, speed: 1.5, currentSpeed: 0, stateSince: 0,
      },
    }];
    const directPathfinder = (_start: [number, number], target: [number, number]) => [target];

    const next = advanceWorld(state, 1_000, directPathfinder).state.franchises[0];
    const runtime = next.employees[0].runtime!;

    expect(runtime.carry).toEqual({ capacity: 3, items: { tomatoes: 3 } });
    expect(next.crops[0]).toMatchObject({ status: "READY", available: 5 });
    expect(runtime.state).toBe("NAVIGATE_DROPOFF");
    expect(runtime.path.at(-1)).toEqual([7.35, -5.2]);
  });

  it("el jugador recoge un lote de máquina hasta el hueco libre sin perder salida", () => {
    const state = createInitialGame("ES");
    const franchise = state.franchises[0];
    const machine = franchise.productionMachines.find((candidate) => candidate.id === "flour-mill-1")!;
    Object.assign(machine, { status: "OUTPUT_READY", output: 5 });
    franchise.carry = { capacity: 4, items: { eggs: 2 } };

    const result = applyGameAction(state, { type: "OPERATE_MACHINE", machineId: machine.id });
    const nextMachine = result.state.franchises[0].productionMachines.find((candidate) => candidate.id === machine.id)!;

    expect(result.ok).toBe(true);
    expect(result.state.franchises[0].carry).toEqual({ capacity: 4, items: { eggs: 2, flour: 2 } });
    expect(nextMachine).toMatchObject({ status: "OUTPUT_READY", output: 3 });
    expect((result.state.franchises[0].carry.items.flour ?? 0) + nextMachine.output).toBe(5);
  });

  it("solo habilita una estación cuando su pulso puede cargar o recoger producto", () => {
    const state = createInitialGame("ES");
    const franchise = state.franchises[0];
    const mill = franchise.productionMachines.find((candidate) => candidate.id === "flour-mill-1")!;

    expect(canOperateMachine(franchise, mill.id, state.simulationTimeMs)).toBe(false);
    mill.status = "WAITING_INPUT";
    franchise.carry.items.wheat = 2;
    expect(canOperateMachine(franchise, mill.id, state.simulationTimeMs)).toBe(true);
    Object.assign(mill, { status: "PROCESSING", output: 0, completesAt: state.simulationTimeMs + 1_000 });
    expect(canOperateMachine(franchise, mill.id, state.simulationTimeMs)).toBe(false);
    Object.assign(mill, { status: "OUTPUT_READY", output: 0, completesAt: null });
    expect(canOperateMachine(franchise, mill.id, state.simulationTimeMs)).toBe(false);
    Object.assign(mill, { status: "OUTPUT_READY", output: 2, completesAt: null });
    franchise.carry = { capacity: 3, items: { wheat: 3 } };
    expect(canOperateMachine(franchise, mill.id, state.simulationTimeMs)).toBe(false);
    franchise.carry = { capacity: 3, items: { wheat: 2 } };
    expect(canOperateMachine(franchise, mill.id, state.simulationTimeMs)).toBe(true);

    const coop = franchise.productionMachines.find((candidate) => candidate.id === "chicken-coop-1")!;
    Object.assign(coop, { status: "WAITING_INPUT", output: 0 });
    expect(canOperateMachine(franchise, coop.id, state.simulationTimeMs)).toBe(false);
    Object.assign(coop, { status: "OUTPUT_READY", output: 1 });
    expect(canOperateMachine(franchise, coop.id, state.simulationTimeMs)).toBe(true);
  });

  it("mantiene al operador inactivo ante máquinas bloqueadas o con la salida bloqueando la carga", () => {
    const state = createInitialGame("ES");
    const franchise = state.franchises[0];
    franchise.lastCustomerSpawnAt = 999_999;
    franchise.warehouse.wheat = 8;
    franchise.warehouse.flour = 8;
    Object.assign(franchise.productionMachines.find((machine) => machine.id === "flour-mill-1")!, {
      status: "LOCKED" as const,
      output: 1,
    });
    Object.assign(franchise.productionMachines.find((machine) => machine.id === "bread-oven-1")!, {
      status: "OUTPUT_READY" as const,
      output: 0,
    });
    franchise.employees = [{
      id: "guarded-operator", name: "Luna", role: "operator", level: 1, salaryMinor: 3_000, energy: 100, hat: "frog",
      runtime: {
        state: "IDLE", assignedProduct: null, assignedStationId: null,
        carry: { capacity: 3, items: {} }, x: 7.35, z: -5.2, targetX: 7.35, targetZ: -5.2,
        path: [], pathIndex: 0, speed: 1.5, currentSpeed: 0, stateSince: 0,
      },
    }];
    const machinesBefore = structuredClone(franchise.productionMachines);
    const warehouseBefore = structuredClone(franchise.warehouse);

    const next = advanceWorld(state, 1_000).state.franchises[0];

    expect(next.employees[0].runtime).toMatchObject({
      state: "IDLE",
      assignedProduct: null,
      assignedStationId: null,
      carry: { capacity: 3, items: {} },
    });
    expect(next.productionMachines).toEqual(machinesBefore);
    expect(next.warehouse).toEqual(warehouseBefore);
  });

  it("habilita la caja solo cuando una unidad cargada puede escanearse", () => {
    const state = createInitialGame("ES");
    const franchise = state.franchises[0];

    expect(canProcessCheckoutUnit(state, franchise)).toBe(false);
    addReadyCheckout(state, "guarded-checkout", "card");
    const transaction = franchise.checkoutTransactions[0];
    transaction.pendingItems[0].loaded = 0;
    expect(canProcessCheckoutUnit(state, franchise)).toBe(false);
    transaction.pendingItems[0].loaded = 1;
    transaction.lastScannedAt = state.simulationTimeMs;
    expect(canProcessCheckoutUnit(state, franchise)).toBe(false);
    transaction.lastScannedAt = state.simulationTimeMs - CHECKOUT_SCAN_UNIT_MS;
    expect(canProcessCheckoutUnit(state, franchise)).toBe(true);
    transaction.pendingItems[0].scanned = 1;
    expect(canProcessCheckoutUnit(state, franchise)).toBe(false);
  });

  it("actualiza la valoración con la experiencia real para que el nivel 23 sea alcanzable", () => {
    let state = createInitialGame("ES");
    state.level = 23;
    state.franchises[0].open = true;
    state.franchises[0].lastCustomerSpawnAt = 999_999;
    for (let customer = 0; customer < 7; customer += 1) {
      addReadyCheckout(state, `rating-customer-${customer}`, "card");
      state = applyGameAction(state, { type: "CHECKOUT", paymentMethod: "card" }).state;
      for (let second = 0; second < 4; second += 1) state = advanceWorld(state, 1_000).state;
    }

    expect(state.franchises[0].rating).toBeGreaterThanOrEqual(4.25);
    expect(state.franchises[0].rating).toBeLessThanOrEqual(5);
  });

  it("el operador llena su cesta en un viaje y deja el resto en la máquina", () => {
    const state = createInitialGame("ES");
    const franchise = state.franchises[0];
    franchise.lastCustomerSpawnAt = 999_999;
    const machine = franchise.productionMachines.find((candidate) => candidate.id === "flour-mill-1")!;
    Object.assign(machine, { status: "OUTPUT_READY", output: 5 });
    franchise.employees = [{
      id: "batch-operator", name: "Luna", role: "operator", level: 1, salaryMinor: 3_000, energy: 100, hat: "frog",
      runtime: {
        state: "PICKUP", assignedProduct: "flour", assignedStationId: machine.id,
        carry: { capacity: 3, items: { flour: 1 } }, x: -7.55, z: -4.05, targetX: -7.55, targetZ: -4.05,
        path: [], pathIndex: 0, speed: 1.5, currentSpeed: 0, stateSince: 0,
      },
    }];
    const directPathfinder = (_start: [number, number], target: [number, number]) => [target];

    const next = advanceWorld(state, 1_000, directPathfinder).state.franchises[0];
    const runtime = next.employees[0].runtime!;
    const nextMachine = next.productionMachines.find((candidate) => candidate.id === machine.id)!;

    expect(runtime.carry).toEqual({ capacity: 3, items: { flour: 3 } });
    expect(nextMachine).toMatchObject({ status: "OUTPUT_READY", output: 3 });
    expect((runtime.carry.items.flour ?? 0) + nextMachine.output).toBe(6);
    expect(runtime.state).toBe("NAVIGATE_DROPOFF");
    expect(runtime.path.at(-1)).toEqual([7.35, -5.2]);
  });

  it("no permite gastar más caja de la disponible", () => {
    const state = createInitialGame("ES");
    state.balanceMinor = 0;
    expect(applyGameAction(state, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 20 }).ok).toBe(false);
  });

  it("usa la misma cuantización entera para salario, alta y contratación", () => {
    const state = createInitialGame("US");
    state.level = 4;
    const quote = employeeHiringQuote("operator", state.countryCode);
    state.balanceMinor = quote.signingCostMinor;

    expect(quote).toEqual({ salaryMinor: 3_636, signingCostMinor: 7_272 });
    expect(Number.isInteger(quote.salaryMinor)).toBe(true);
    expect(Number.isInteger(quote.signingCostMinor)).toBe(true);

    const result = applyGameAction(state, { type: "HIRE", role: "operator" });
    expect(result.ok).toBe(true);
    expect(result.state.balanceMinor).toBe(0);
    expect(result.state.franchises[0].employees[0].salaryMinor).toBe(quote.salaryMinor);
    expect(result.events[0]?.amountMinor).toBe(-quote.signingCostMinor);
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

  it("atribuye una venta mundial a la sucursal que la generó aunque el jugador visite otra", () => {
    const state = createInitialGame("ES");
    const visited = state.franchises[0];
    const remote = state.franchises[1];
    remote.owned = true;
    remote.open = false;
    remote.lastCustomerSpawnAt = 999_999;
    addReadyCheckout(state, "remote-sale", "card");
    const customer = visited.customers.pop()!;
    const transaction = visited.checkoutTransactions.pop()!;
    customer.state = "PAY";
    customer.stateSince = state.simulationTimeMs - 2_000;
    transaction.state = "PAYMENT";
    transaction.pendingItems[0].scanned = 1;
    transaction.pendingItems[0].bagged = 1;
    remote.customers = [customer];
    remote.checkoutTransactions = [transaction];

    const result = advanceWorld(state, 100);
    const sale = result.events.find((event) => event.category === "sales");

    expect(state.currentFranchiseId).toBe(visited.id);
    expect(sale).toMatchObject({ franchiseId: remote.id, payload: { transactionId: transaction.id } });
    expect(sale?.franchiseId).not.toBe(visited.id);
    expect(result.state.franchises[1].revenueTodayMinor).toBeGreaterThan(0);
    expect(result.state.franchises[0].revenueTodayMinor).toBe(0);
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
        carry: { capacity: 2, items: {} },
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

  it("ofrece tareas diarias alcanzables en nivel 1 aunque pasen varias jornadas", () => {
    let state = createInitialGame("ES");
    for (let day = 1; day < 6; day += 1) state = applyGameAction(state, { type: "CLOSE_DAY" }).state;

    expect(state).toMatchObject({ level: 1, day: 6 });
    expect(state.missions).toHaveLength(3);
    expect(state.missions.map((mission) => mission.kind)).toEqual(["stock", "customers", "harvest"]);
    expect(state.missions.find((mission) => mission.kind === "harvest")).toMatchObject({
      id: "d6-harvest",
      label: "Cosecha 5 productos",
      target: 5,
    });
    expect(state.missions.some((mission) => mission.kind === "production")).toBe(false);
  });

  it("sube de nivel únicamente al completar la lista visible y su financiación", () => {
    let state = createInitialGame("ES");
    state.progression.counters = { "harvest:tomatoes": 3, "stock:tomatoes": 3, customers: 1 };

    state = applyGameAction(state, { type: "SET_AVATAR", shirt: state.avatar.shirt }).state;
    expect(state.level).toBe(1);
    expect(state.progression.objectiveComplete).toBe(true);

    const project = state.franchises[0].buildProjects.find((candidate) => candidate.level === 2)!;
    state = applyGameAction(state, { type: "CONTRIBUTE_BUILD", amountMinor: project.costMinor }).state;
    expect(state.level).toBe(2);
    expect(state.progression.completedLevels).toContain(1);
  });

  it("repara la producción imposible de una partida guardada sin perder su avance ni premio", () => {
    const legacy = createInitialGame("ES");
    legacy.day = 6;
    legacy.missions = [
      { id: "d6-stock", label: "Repón 11 productos", kind: "stock", target: 11, progress: 4, rewardMinor: 36_000, completed: false, claimed: false },
      { id: "d6-customers", label: "Atiende 6 clientes", kind: "customers", target: 6, progress: 6, rewardMinor: 48_000, completed: true, claimed: true },
      { id: "d6-produce", label: "Completa 5 ciclos de producción", kind: "production", target: 5, progress: 2, rewardMinor: 57_000, completed: false, claimed: false },
    ];

    const recovered = normalizeGameState(legacy);

    expect(recovered.missions).toEqual([
      { id: "d6-stock", label: "Repón 11 productos", kind: "stock", target: 11, progress: 4, rewardMinor: 36_000, completed: false, claimed: false },
      { id: "d6-customers", label: "Atiende 6 clientes", kind: "customers", target: 6, progress: 6, rewardMinor: 48_000, completed: true, claimed: true },
      { id: "d6-harvest", label: "Cosecha 5 productos", kind: "harvest", target: 5, progress: 2, rewardMinor: 57_000, completed: false, claimed: false },
    ]);
    expect(normalizeGameState(recovered).missions).toEqual(recovered.missions);
  });

  it("conserva una tarea de cosecha válida al subir a nivel 5 a mitad del día", () => {
    const state = createInitialGame("ES");
    state.level = 5;
    const harvest = state.missions.find((mission) => mission.kind === "harvest")!;
    harvest.progress = 2;

    const recovered = normalizeGameState(state);

    expect(recovered.missions.find((mission) => mission.kind === "harvest")).toMatchObject({ progress: 2, target: 3 });
    expect(recovered.missions.some((mission) => mission.kind === "production")).toBe(false);
    const nextDay = applyGameAction(recovered, { type: "CLOSE_DAY" }).state;
    expect(nextDay.missions.some((mission) => mission.kind === "production")).toBe(true);
  });

  it("habilita producción desde nivel 5 y cuenta solo ciclos realmente terminados", () => {
    let state = createInitialGame("ES");
    state.level = 5;
    state = applyGameAction(state, { type: "CLOSE_DAY" }).state;
    const franchise = state.franchises[0];
    const mill = franchise.productionMachines.find((machine) => machine.id === "flour-mill-1")!;
    Object.assign(mill, { status: "WAITING_INPUT" as const, input: {}, output: 0, startedAt: null, completesAt: null });
    franchise.carry = { capacity: 3, items: { wheat: 2 } };

    state = applyGameAction(state, { type: "OPERATE_MACHINE", machineId: mill.id }).state;
    expect(state.missions.find((mission) => mission.kind === "production")?.progress).toBe(0);
    expect(state.progression.counters["production:flour"]).toBeUndefined();

    for (let second = 0; second < 4; second += 1) state = advanceWorld(state, 1_000).state;
    expect(state.missions.find((mission) => mission.kind === "production")?.progress).toBe(1);
    expect(state.progression.counters["production:flour"]).toBe(1);
    expect(state.progression.counters["production:all"]).toBe(1);

    state = advanceWorld(state, 1_000).state;
    expect(state.missions.find((mission) => mission.kind === "production")?.progress).toBe(1);
    expect(state.progression.counters["production:all"]).toBe(1);
  });

  it("migra partidas antiguas y permite cambiar por completo el personaje", () => {
    const legacy = createInitialGame("ES") as unknown as { schemaVersion: number; avatar: Record<string, unknown> };
    legacy.schemaVersion = 1;
    delete legacy.avatar.body;
    delete legacy.avatar.hair;
    delete legacy.avatar.hairColor;
    const migrated = normalizeGameState(legacy);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.avatar.body).toBe("adult-man");
    const changed = applyGameAction(migrated, { type: "SET_AVATAR", body: "adult-woman", hair: "long-wavy", hairColor: "#7a3f22", hat: "none" });
    expect(changed.state.avatar).toMatchObject({ body: "adult-woman", hair: "long-wavy", hairColor: "#7a3f22", hat: "none" });
  });

  it("retires only the inherited red-panda default when migrating to snapshot v4", () => {
    const inherited = structuredClone(createInitialGame("ES"));
    inherited.schemaVersion = 3 as 4;
    inherited.avatar = { body: "adult-man", hair: "side-part", hairColor: "#332b27", skin: "#bd815f", shirt: "#76aee5", hat: "red-panda" };
    expect(normalizeGameState(inherited).avatar.hat).toBe("none");

    const personalizedLegacy = structuredClone(inherited);
    personalizedLegacy.avatar.shirt = "#c95f72";
    expect(normalizeGameState(personalizedLegacy).avatar.hat).toBe("red-panda");

    const explicitV4Choice = structuredClone(inherited);
    explicitV4Choice.schemaVersion = 4;
    expect(normalizeGameState(explicitV4Choice).avatar.hat).toBe("red-panda");
  });

  it("clears a persisted player door sensor and lets the empty entrance close after reload", () => {
    const persisted = structuredClone(createInitialGame("ES"));
    Object.assign(persisted.franchises[0], {
      doorState: "OPEN" as const,
      doorProgress: 1,
      doorPlayerPresent: true,
      doorEmptySince: -50_000,
    });

    let recovered = normalizeGameState(persisted);
    expect(recovered.franchises[0]).toMatchObject({ doorPlayerPresent: false, doorEmptySince: null });

    recovered = advanceWorld(recovered, 1_000).state;
    expect(recovered.franchises[0].doorState).toBe("OPEN");
    recovered = advanceWorld(recovered, 1_000).state;
    expect(recovered.franchises[0]).toMatchObject({ doorState: "CLOSED", doorProgress: 0 });
  });

  it("adds apples and coffee to real customer demand only at their unlock levels", () => {
    expect(unlockedCustomerProducts(1)).not.toContain("apples");
    expect(unlockedCustomerProducts(2)).toContain("apples");
    expect(unlockedCustomerProducts(8)).not.toContain("coffee");
    expect(unlockedCustomerProducts(9)).toContain("coffee");

    const canBeDemanded = (level: number, productId: "apples" | "coffee") => Array.from({ length: 128 }, (_, seed) => (
      createCustomerMind(`demand-${level}-${seed}`, unlockedCustomerProducts(level), seed + 1, level)
        .shoppingList.some((line) => line.productId === productId)
    )).some(Boolean);
    expect(canBeDemanded(1, "apples")).toBe(false);
    expect(canBeDemanded(2, "apples")).toBe(true);
    expect(canBeDemanded(8, "coffee")).toBe(false);
    expect(canBeDemanded(9, "coffee")).toBe(true);
  });

  it("uses human station names in upgrade quotes, events and messages", () => {
    const state = createInitialGame("ES");
    state.franchises[0].stationTiers = { "crop-tomato-1": 1 };

    const quote = upgradeQuote(state, "station");
    const result = applyGameAction(state, { type: "CONTRIBUTE_UPGRADE", upgrade: "station", amountMinor: 100 });

    expect(quote?.label).toBe("Bancal de tomates");
    expect(result.message).toContain("Bancal de tomates");
    expect(result.events[0]?.description).toContain("Bancal de tomates");
    expect(`${quote?.label} ${result.message} ${result.events[0]?.description}`).not.toContain("crop-tomato-1");
  });

  it("recupera la carga legacy de un solo producto dentro de la cesta mixta", () => {
    const legacy = structuredClone(createInitialGame("ES")) as unknown as {
      franchises: { carry: { capacity: number; item: { productId: "tomatoes"; quantity: number }; items?: unknown } }[];
    };
    legacy.franchises[0].carry = { capacity: 5, item: { productId: "tomatoes", quantity: 4 } };

    const migrated = normalizeGameState(legacy);

    expect(migrated.franchises[0].carry).toEqual({ capacity: 5, items: { tomatoes: 4 } });
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
