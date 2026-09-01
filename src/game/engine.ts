import { COUNTRIES, EMPLOYEE_NAMES, FRANCHISE_TEMPLATES, HATS, PRODUCTS, ROLE_INFO, SUPPLIERS } from "./catalog";
import type { ActionResult, AvatarConfig, CarryState, CheckoutTransaction, CountryCode, CustomerRuntimeState, Employee, EmployeeRuntimeState, FranchiseState, GameAction, GameEvent, GameState, Inventory, Mission, ProductId, WorldInteractionAction } from "./types";
import { collectMachineOutputBatch, createCrop, createEmptyCrop, createMachine, cropGrowthDurationMs, harvestCropBatch, loadMachine, plantCrop, updateCrop, updateMachine } from "./stations/StationSystem";
import { PRODUCT_CONFIG } from "./economy/products";
import { createCustomerMind } from "./ai/CustomerBrain";
import { LEVELS, stationTierModifiers } from "./progression/levels";
import { CHECKOUT_LANES, checkoutQueueArrival, checkoutQueuePosition, type CheckoutLane } from "./stations/checkout-layout";
import { retailServicePoint } from "./stations/retail-layout";
import {
  FARM_ACCESS_WAYPOINTS,
  FARM_ANIMAL_STATIONS,
  FARM_FIELD,
  FARM_PLOTS,
  FARM_WORKER_HOME,
  farmInteriorRouteBetween,
  farmInteriorRouteFromEntrance,
  farmInteriorRouteToEntrance,
  isRetiredFrontFarmPoint,
} from "./stations/farm-layout";
import { addToCarry, CAPACITY_TIERS, carryQuantity, carryTotal, MAX_WAREHOUSE_PICKUP_BATCH, primaryCarryProduct, removeFromCarry, transferCarryToShelf, transferWarehouseToCarry } from "./player/CarrySystem";
import { CART_RETURN_POINT, RETURNS_POINT, RETURNS_TO_CART_FALLBACK, STORE_SERVICE_FIXTURES } from "./stations/store-service-layout";
import { STORE_REAR_DOOR } from "./stations/storefront-layout";

const EMPTY_INVENTORY = (): Inventory => ({ wheat: 0, flour: 0, bread: 0, corn: 0, milk: 0, eggs: 0, cheese: 0, apples: 0, tomatoes: 0, coffee: 0, juice: 0 });
export const CHECKOUT_PATIENCE_MS = 5 * 60_000;
export const CHECKOUT_LOAD_UNIT_MS = 900;
export const CHECKOUT_SCAN_UNIT_MS = 700;
export const CHECKOUT_BAG_UNIT_MS = 650;
export const CHECKOUT_PAYMENT_MS = 1_800;
export const CHECKOUT_BAG_HANDOFF_MS = 900;
const DOOR_PASSAGE_Z = 7.8;
const DOOR_OUTSIDE_WAIT_Z = 8.35;
const DOOR_INSIDE_WAIT_Z = 7.25;
const DOOR_CUSTOMER_SENSOR_MIN_Z = 6.2;
const DOOR_CUSTOMER_SENSOR_MAX_Z = 10.8;
const DOOR_CUSTOMER_SENSOR_HALF_WIDTH = 2.35;
export const DEFAULT_AVATAR: AvatarConfig = { body: "adult-man", hair: "side-part", hairColor: "#332b27", skin: "#bd815f", shirt: "#76aee5", hat: "none" };
const LEGACY_DEFAULT_AVATAR: AvatarConfig = { ...DEFAULT_AVATAR, hat: "red-panda" };
export type WorldPathfinder = (start: [number, number], end: [number, number]) => [number, number][];

export function createInitialGame(countryCode: CountryCode = "ES"): GameState {
  const country = COUNTRIES[countryCode];
  const moneyScale = countryMoneyScale(countryCode);
  const franchises = FRANCHISE_TEMPLATES.map((template, index): FranchiseState => ({
    ...template,
    purchaseCostMinor: Math.round(template.purchaseCostMinor * moneyScale),
    owned: index === 0,
    open: false,
    licenseActive: index === 0,
    licenseDaysLeft: index === 0 ? 7 : 0,
    expansionLevel: 1,
    shelvesLevel: 1,
    checkoutLevel: 1,
    warehouse: EMPTY_INVENTORY(),
    shelves: { ...EMPTY_INVENTORY(), milk: index === 0 ? 8 : 0, eggs: index === 0 ? 6 : 0, apples: index === 0 ? 8 : 0 },
    machines: { flourMillLevel: 1, bakeryLevel: 1, flourQueue: 0, breadQueue: 0 },
    carry: { capacity: 3, items: {} },
    crops: [createCrop("crop-tomato-1", "tomatoes", 0, 1, 1), { ...createEmptyCrop("crop-wheat-1", "wheat"), status: "LOCKED" }, { ...createEmptyCrop("crop-corn-1", "corn"), status: "LOCKED" }],
    productionMachines: [{ ...createMachine("flour-mill-1", "flour"), status: "LOCKED" }, { ...createMachine("bread-oven-1", "bread"), status: "LOCKED" }, { ...createMachine("cheese-maker-1", "cheese"), status: "LOCKED" }, { ...createMachine("juice-machine-1", "juice"), status: "LOCKED" }, { ...createMachine("chicken-coop-1", "eggs"), status: "LOCKED" }, { ...createMachine("cow-station-1", "milk"), status: "LOCKED" }],
    buildProjects: [{ id: "level-2", level: 2, costMinor: Math.round(LEVELS[1].costMinor * moneyScale), contributedMinor: 0, completed: false }],
    checkoutTransactions: [],
    returnsBin: EMPTY_INVENTORY(),
    returnedCartCount: 6,
    customers: [],
    nextCustomerSequence: 1,
    lastCustomerSpawnAt: -3_000,
    queueCustomerIds: [],
    unlockedAreas: ["store-floor", "farm-tomato", "checkout-1"],
    stationTiers: { "crop-tomato-1": 1, "shelves-1": 1, "checkout-1": 1 },
    upgradeContributions: {},
    playerSpeedTier: 1,
    playerCapacityTier: 1,
    storeRank: 1,
    structureRevision: 1,
    doorState: "CLOSED",
    doorProgress: 0,
    doorPlayerPresent: false,
    doorEmptySince: null,
    lightsOn: false,
    employees: [],
    revenueTodayMinor: 0,
    expensesTodayMinor: 0,
    customersToday: 0,
    rating: 3.5,
  }));

  return {
    schemaVersion: 4,
    revision: 0,
    countryCode,
    currency: country.currency,
    balanceMinor: country.startingCapitalMinor,
    level: 1,
    xp: 0,
    reputation: 0,
    day: 1,
    minuteOfDay: 7 * 60 + 30,
    currentFranchiseId: franchises[0].id,
    avatar: { ...DEFAULT_AVATAR },
    franchises,
    missions: missionsForDay(1, moneyScale),
    pendingOrders: [],
    finances: { grossRevenueMinor: 0, costOfGoodsMinor: 0, payrollMinor: 0, operatingCostsMinor: 0, taxesMinor: 0, netProfitMinor: 0 },
    tutorialStep: 0,
    progression: { completedLevels: [], counters: {}, objectiveComplete: false, lastUnlockAt: 0 },
    eventSequence: 0,
    processedEventIds: [],
    lastServerTime: 0,
    simulationTimeMs: 0,
    lastSavedAt: new Date(0).toISOString(),
  };
}

export function normalizeGameState(input: unknown): GameState {
  if (!input || typeof input !== "object" || Array.isArray(input)) return createInitialGame();
  const state = structuredClone(input) as Omit<GameState, "schemaVersion" | "avatar"> & {
    schemaVersion?: number;
    avatar?: Partial<AvatarConfig>;
  };
  const sourceSchemaVersion = Number.isInteger(state.schemaVersion) ? Number(state.schemaVersion) : 0;
  const inheritedLegacyAvatar = isLegacyDefaultAvatar(sourceSchemaVersion, state.avatar);
  state.schemaVersion = 4;
  state.avatar = { ...DEFAULT_AVATAR, ...state.avatar };
  if (inheritedLegacyAvatar) state.avatar.hat = "none";
  state.eventSequence = Number.isInteger(state.eventSequence) ? state.eventSequence : 0;
  state.processedEventIds = Array.isArray(state.processedEventIds) ? state.processedEventIds.filter((id): id is string => typeof id === "string").slice(-1_000) : [];
  state.lastServerTime = Number.isFinite(state.lastServerTime) ? state.lastServerTime : Math.max(0, Date.parse(state.lastSavedAt || "") || 0);
  state.simulationTimeMs = Number.isFinite(state.simulationTimeMs) ? state.simulationTimeMs : 0;
  state.progression ??= { completedLevels: [], counters: {}, objectiveComplete: false, lastUnlockAt: 0 };
  const validEmployeeHats = new Set<string>(HATS.map((hat) => hat.id));
  if (state.avatar.hat !== "none" && !validEmployeeHats.has(String(state.avatar.hat))) state.avatar.hat = "none";
  for (const franchise of state.franchises ?? []) {
    const franchiseTemplate = FRANCHISE_TEMPLATES.find((template) => template.id === franchise.id);
    if (franchiseTemplate) franchise.unlockLevel = franchiseTemplate.unlockLevel;
    franchise.warehouse = normalizeInventory(franchise.warehouse);
    franchise.shelves = normalizeInventory(franchise.shelves);
    franchise.carry = normalizeCarry(franchise.carry, 3);
    franchise.crops ??= [createCrop("crop-tomato-1", "tomatoes", state.simulationTimeMs, 1, state.level), { ...createEmptyCrop("crop-wheat-1", "wheat"), status: "LOCKED" }, { ...createEmptyCrop("crop-corn-1", "corn"), status: "LOCKED" }];
    franchise.crops = franchise.crops.map((crop) => crop.status === "EMPTY"
      ? createCrop(crop.id, crop.productId, state.simulationTimeMs, crop.tier, state.level)
      : normalizeCropClock(crop, state.simulationTimeMs, state.lastServerTime, state.level));
    franchise.productionMachines ??= [createMachine("flour-mill-1", "flour"), createMachine("bread-oven-1", "bread"), createMachine("cheese-maker-1", "cheese"), createMachine("juice-machine-1", "juice")];
    if (!franchise.productionMachines.some((machine) => machine.id === "chicken-coop-1")) franchise.productionMachines.push({ ...createMachine("chicken-coop-1", "eggs"), status: state.level >= 8 ? "WAITING_INPUT" : "LOCKED" });
    if (!franchise.productionMachines.some((machine) => machine.id === "cow-station-1")) franchise.productionMachines.push({ ...createMachine("cow-station-1", "milk"), status: state.level >= 13 ? "WAITING_INPUT" : "LOCKED" });
    franchise.productionMachines = franchise.productionMachines.map((machine) => normalizeMachineClock(machine, state.simulationTimeMs, state.lastServerTime));
    franchise.buildProjects ??= [];
    ensureNextBuildProject(state as GameState, franchise);
    franchise.checkoutTransactions ??= [];
    franchise.customers ??= [];
    franchise.returnsBin = normalizeInventory(franchise.returnsBin);
    franchise.returnedCartCount = Number.isFinite(franchise.returnedCartCount) ? Math.max(0, Math.floor(franchise.returnedCartCount)) : 6;
    franchise.customers.forEach((customer) => {
      if ((customer.state as string) === "GET_BASKET") customer.state = "GET_CART";
      if ((customer.state as string) === "RECEIVE_BAG") customer.state = "TAKE_BAG";
      customer.reservedSocketId ??= null;
      customer.blockedSince ??= null;
      customer.routeFailures ??= 0;
      customer.queueLane ??= 0;
      customer.queueJoinedAt ??= null;
      customer.currentSpeed ??= 0;
      customer.checkoutPatienceMs = Number.isFinite(customer.checkoutPatienceMs) ? customer.checkoutPatienceMs : CHECKOUT_PATIENCE_MS;
      customer.hasCart ??= !["SPAWN", "ENTER_STORE", "GET_CART", "EXIT_STORE", "DESPAWN"].includes(customer.state);
      customer.hasBag ??= ["TAKE_BAG", "NAVIGATE_TO_CART_RETURN", "RETURN_CART", "EXIT_STORE"].includes(customer.state);
      customer.angry ??= false;
    });
    franchise.checkoutTransactions.forEach((transaction) => {
      transaction.checkoutLane ??= 0;
      transaction.lastLoadedAt ??= transaction.updatedAt;
      transaction.lastScannedAt ??= transaction.updatedAt;
      transaction.lastBaggedAt ??= transaction.updatedAt;
      transaction.pendingItems.forEach((line) => {
        line.loaded ??= line.quantity;
        line.bagged ??= transaction.state === "BAGGING" || transaction.state === "PAYMENT" || transaction.state === "COMPLETE" ? line.scanned : 0;
      });
    });
    franchise.nextCustomerSequence ??= 1;
    franchise.lastCustomerSpawnAt ??= -3_000;
    franchise.queueCustomerIds ??= [];
    franchise.unlockedAreas ??= ["store-floor", "farm-tomato", "checkout-1"];
    franchise.stationTiers ??= { "crop-tomato-1": 1, "checkout-1": 1 };
    franchise.stationTiers["shelves-1"] ??= 1;
    franchise.upgradeContributions ??= {};
    franchise.playerSpeedTier ??= 1;
    franchise.playerCapacityTier = carryCapacityTier(franchise.carry.capacity);
    franchise.storeRank ??= 1;
    franchise.structureRevision ??= 1;
    franchise.doorState ??= "CLOSED";
    franchise.doorProgress ??= franchise.doorState === "OPEN" ? 1 : 0;
    // Player position is intentionally not persisted. A saved sensor flag can
    // therefore never be trusted after reload: the player respawns outside
    // the threshold and no InteractionDirector instance exists to emit exit.
    franchise.doorPlayerPresent = false;
    franchise.doorEmptySince = null;
    franchise.lightsOn ??= franchise.open;
    for (const [index, employee] of (franchise.employees ?? []).entries()) {
      if (!validEmployeeHats.has(String(employee.hat))) employee.hat = "red-panda";
      employee.runtime ??= createEmployeeRuntime(employee.role, index, state.simulationTimeMs);
      employee.runtime.carry = normalizeCarry(employee.runtime.carry, 2);
      employee.runtime.currentSpeed ??= 0;
      normalizePersistedFarmEmployee(franchise, employee, state.simulationTimeMs);
    }
    if (franchise.owned) synchronizeFranchiseProgression(state as GameState, franchise);
  }
  return state as GameState;
}

function isLegacyDefaultAvatar(sourceSchemaVersion: number, avatar: Partial<AvatarConfig> | undefined) {
  if (sourceSchemaVersion < 1 || sourceSchemaVersion >= 4 || !avatar) return false;
  return (Object.keys(LEGACY_DEFAULT_AVATAR) as (keyof AvatarConfig)[])
    .every((key) => avatar[key] === LEGACY_DEFAULT_AVATAR[key]);
}

export function applyGameAction(input: GameState, action: GameAction): ActionResult {
  return applyGameActionInternal(input, action, true, true);
}

function applyGameActionInternal(input: GameState, action: GameAction, cloneInput: boolean, finalize: boolean): ActionResult {
  const state = cloneInput ? structuredClone(input) : input;
  const events: GameEvent[] = [];
  const franchise = currentFranchise(state);
  const fail = (message: string): ActionResult => ({ state: input, ok: false, message, events: [] });
  const success = (message: string): ActionResult => {
    if (finalize) {
      state.revision += 1;
      normalizeLevel(state);
      stampEvents(state, events);
    }
    return { state, ok: true, message, events };
  };

  switch (action.type) {
    case "SET_COUNTRY": {
      if (state.day > 1 || state.finances.grossRevenueMinor > 0) return fail("El país fiscal queda fijado al iniciar la empresa.");
      const balanceBefore = state.balanceMinor;
      const oldStart = COUNTRIES[state.countryCode].startingCapitalMinor;
      const country = COUNTRIES[action.countryCode];
      const ratio = country.startingCapitalMinor / oldStart;
      state.countryCode = country.code;
      state.currency = country.currency;
      state.balanceMinor = Math.round(state.balanceMinor * ratio);
      state.franchises.forEach((item) => { item.purchaseCostMinor = Math.round(item.purchaseCostMinor * ratio); });
      state.missions.forEach((item) => { item.rewardMinor = Math.round(item.rewardMinor * ratio); });
      state.tutorialStep = 1;
      events.push({ franchiseId: globalEventFranchiseId(state), category: "configuration", description: `Capital inicial convertido a ${country.currency}`, amountMinor: state.balanceMinor - balanceBefore, payload: { scope: "global", countryCode: country.code } });
      return success(`Empresa registrada en ${country.name}.`);
    }
    case "SET_AVATAR": {
      if (action.body !== undefined) state.avatar.body = action.body;
      if (action.hair !== undefined) state.avatar.hair = action.hair;
      if (action.hairColor !== undefined) state.avatar.hairColor = action.hairColor;
      if (action.skin !== undefined) state.avatar.skin = action.skin;
      if (action.shirt !== undefined) state.avatar.shirt = action.shirt;
      if (action.hat !== undefined) state.avatar.hat = action.hat;
      return success("Avatar actualizado.");
    }
    case "TOGGLE_STORE":
      if (!franchise.licenseActive) return fail("Necesitas una licencia comercial activa.");
      franchise.open = !franchise.open;
      return success(franchise.open ? "Tienda abierta: ¡a trabajar!" : "Tienda cerrada al público.");
    case "TEND_CROP":
    case "HARVEST":
      {
        const objectiveProduct = state.level === 5 ? "wheat" : state.level === 11 ? "corn" : undefined;
        const matchesTarget = (crop: FranchiseState["crops"][number]) => (!action.cropId || crop.id === action.cropId) && (!action.productId || crop.productId === action.productId);
        const candidates = franchise.crops.map((crop, index) => ({ crop: updateCrop(crop, state.simulationTimeMs), index }))
          .filter(({ crop }) => crop.status === "READY" && matchesTarget(crop))
          .sort((a, b) => Number(b.crop.productId === objectiveProduct) - Number(a.crop.productId === objectiveProduct));
        const cropIndex = candidates[0]?.index ?? -1;
        if (cropIndex < 0) {
          const emptyIndex = action.type === "TEND_CROP" ? franchise.crops.findIndex((crop) => crop.status === "EMPTY" && matchesTarget(crop)) : -1;
          if (emptyIndex >= 0) {
            const planted = plantCrop(franchise.crops[emptyIndex], state.simulationTimeMs, state.level);
            franchise.crops[emptyIndex] = planted.crop;
            if (planted.planted) {
              recordDomain(state, `plant:${planted.crop.productId}`, 1);
              gain(state, 8, "harvest", 0);
              return success(`${PRODUCTS[planted.crop.productId].name} empezó a crecer automáticamente.`);
            }
          }
          const growing = franchise.crops.find((crop) => crop.status === "GROWING" && matchesTarget(crop));
          if (growing) {
            const remainingSeconds = Math.max(1, Math.ceil((growing.readyAt - state.simulationTimeMs) / 1_000));
            return fail(`${PRODUCTS[growing.productId].name}: creciendo, faltan ${remainingSeconds} s.`);
          }
          return fail("Todavía no hay un cultivo listo.");
        }
        const crop = updateCrop(franchise.crops[cropIndex], state.simulationTimeMs);
        if (crop.status !== "READY") {
          franchise.crops[cropIndex] = crop;
          return fail("El trigo todavía está creciendo.");
        }
        const freeCarryCapacity = Math.max(0, franchise.carry.capacity - carryTotal(franchise.carry));
        if (freeCarryCapacity < 1) return fail("La cesta está llena.");
        const rawRequested = action.type === "HARVEST" ? action.quantity ?? 1 : 1;
        const requested = Number.isFinite(rawRequested) ? Math.max(0, Math.floor(rawRequested)) : 0;
        const harvestLimit = Math.min(requested, crop.available, freeCarryCapacity);
        if (harvestLimit < 1) return fail("Todavía no hay un cultivo listo.");

        const { crop: nextCrop, harvested } = harvestCropBatch(crop, state.simulationTimeMs, harvestLimit, state.level);
        if (harvested < 1) return fail("Todavía no hay un cultivo listo.");
        franchise.crops[cropIndex] = nextCrop;
        franchise.carry = addToCarry(franchise.carry, crop.productId, harvested, harvested).container;
        recordDomain(state, `harvest:${crop.productId}`, harvested);
        recordDomain(state, "harvest:all", harvested);
        gain(state, 18 * harvested, "harvest", harvested);
        return success(nextCrop.status === "GROWING"
          ? `Cosechaste ${harvested} × ${PRODUCTS[crop.productId].name.toLowerCase()}. El bancal ya está volviendo a crecer.`
          : `${PRODUCTS[crop.productId].name}: cosechaste ${harvested}; quedan ${nextCrop.available} unidades maduras.`);
      }
    case "LOAD_FLOUR_MILL":
      return operateMachine(state, franchise, "flour-mill-1", "wheat", events, gain, success, fail);
    case "BAKE_BREAD":
      return operateMachine(state, franchise, "bread-oven-1", "flour", events, gain, success, fail);
    case "OPERATE_MACHINE": {
      const machine = franchise.productionMachines.find((candidate) => candidate.id === action.machineId);
      if (!machine || machine.status === "LOCKED") return fail("La estación todavía no está desbloqueada.");
      const ingredient = Object.keys(PRODUCT_CONFIG[machine.productId]?.recipe ?? {})[0] as ProductId | undefined;
      if (!ingredient && machine.output < 1) return fail("La estación sigue produciendo.");
      return operateMachine(state, franchise, machine.id, ingredient ?? machine.productId, events, gain, success, fail);
    }
    case "PICKUP_WAREHOUSE": {
      if (carryTotal(franchise.carry) >= franchise.carry.capacity) return fail("La cesta está llena.");
      const transfer = transferWarehouseToCarry(franchise.warehouse, franchise.carry, action.quantity, action.productId);
      if (transfer.moved < 1) {
        return fail(action.productId
          ? `No hay ${PRODUCTS[action.productId].name.toLowerCase()} disponible en el almacén.`
          : "No hay mercancía disponible en el almacén.");
      }
      franchise.warehouse = transfer.warehouse;
      franchise.carry = transfer.container;
      const summary = (Object.entries(transfer.movedByProduct) as [ProductId, number][])
        .filter(([, quantity]) => quantity > 0)
        .map(([productId, quantity]) => `${quantity} × ${PRODUCTS[productId].name.toLowerCase()}`)
        .join(", ");
      recordDomain(state, "pickup:warehouse", transfer.moved);
      for (const [productId, quantity] of Object.entries(transfer.movedByProduct) as [ProductId, number][]) {
        if (quantity > 0) recordDomain(state, `pickup:${productId}`, quantity);
      }
      return success(`Cargaste ${summary} desde el almacén.`);
    }
    case "STOCK": {
      const capacity = shelfCapacity(franchise, action.productId);
      const requested = Number.isFinite(action.quantity ?? 1) ? Math.max(0, Math.floor(action.quantity ?? 1)) : 0;
      let quantity = 0;
      if (action.source === "carry") {
        const transfer = transferCarryToShelf(franchise.carry, action.productId, franchise.shelves[action.productId], capacity, requested);
        franchise.carry = transfer.container;
        franchise.shelves[action.productId] = transfer.shelfQuantity;
        quantity = transfer.moved;
      } else {
        quantity = Math.max(0, Math.min(requested, franchise.warehouse[action.productId], capacity - franchise.shelves[action.productId]));
      }
      if (quantity <= 0) return fail(`No puedes surtir más ${PRODUCTS[action.productId].name.toLowerCase()} ahora.`);
      if (action.source !== "carry") {
        franchise.warehouse[action.productId] -= quantity;
        franchise.shelves[action.productId] += quantity;
      }
      recordDomain(state, `stock:${action.productId}`, quantity);
      recordDomain(state, "stock:all", quantity);
      recordDomain(state, "transport:all", quantity);
      gain(state, 12 * quantity, "stock", quantity);
      return success(`Colocaste ${quantity} × ${PRODUCTS[action.productId].name}.`);
    }
    case "CHECKOUT": {
      if (!franchise.open) return fail("Abre la tienda antes de cobrar.");
      const transaction = franchise.checkoutTransactions.find((candidate) => candidate.state !== "COMPLETE" && candidate.state !== "ABANDONED");
      if (!transaction) return fail("Todavía no hay un cliente listo en caja.");
      transaction.paymentMethod = action.paymentMethod;
      const result = processCheckoutUnit(state, franchise, transaction, events);
      return success(result);
    }
    case "ORDER": {
      const product = PRODUCTS[action.productId];
      const supplier = SUPPLIERS.find((item) => item.id === action.supplierId);
      if (!supplier || supplier.unlockLevel > state.level || product.supplier !== supplier.id) return fail("Proveedor no disponible para ese producto.");
      const quantity = Math.max(1, Math.min(100, Math.floor(action.quantity)));
      const total = Math.round(product.wholesaleMinor * countryMoneyScale(state.countryCode) * quantity * (1 - supplier.discount));
      if (state.balanceMinor < total) return fail("No hay caja suficiente para este pedido.");
      state.balanceMinor -= total;
      franchise.expensesTodayMinor += total;
      state.finances.costOfGoodsMinor += total;
      state.pendingOrders.push({ id: crypto.randomUUID(), franchiseId: franchise.id, supplierId: supplier.id, productId: action.productId, quantity, totalMinor: total, arrivesAtMinute: state.minuteOfDay + supplier.leadMinutes });
      recordDomain(state, "orders", 1);
      events.push({ franchiseId: franchise.id, category: "inventory", description: `Pedido de ${product.name}`, amountMinor: -total });
      return success(`Pedido confirmado. Entrega en ${supplier.leadMinutes} min del juego.`);
    }
    case "HIRE": {
      const info = ROLE_INFO[action.role];
      if (state.level < info.unlockLevel) return fail(`Se desbloquea en nivel ${info.unlockLevel}.`);
      const { salaryMinor: scaledSalary, signingCostMinor: signingCost } = employeeHiringQuote(action.role, state.countryCode);
      if (state.balanceMinor < signingCost) return fail("Falta caja para contratación y alta.");
      state.balanceMinor -= signingCost;
      franchise.expensesTodayMinor += signingCost;
      const employee: Employee = { id: crypto.randomUUID(), name: EMPLOYEE_NAMES[franchise.employees.length % EMPLOYEE_NAMES.length], role: action.role, level: 1, salaryMinor: scaledSalary, energy: 100, hat: HATS[(franchise.employees.length + 1) % HATS.length].id, runtime: createEmployeeRuntime(action.role, franchise.employees.length, state.simulationTimeMs) };
      franchise.employees.push(employee);
      events.push({ franchiseId: franchise.id, category: "payroll", description: `Alta de ${employee.name} (${info.name})`, amountMinor: -signingCost });
      gain(state, 55, "stock", 0);
      return success(`${employee.name} se incorporó como ${info.name.toLowerCase()}.`);
    }
    case "UPGRADE": {
      const levels = { shelves: franchise.shelvesLevel, checkout: franchise.checkoutLevel, expansion: franchise.expansionLevel, mill: franchise.machines.flourMillLevel, bakery: franchise.machines.bakeryLevel };
      const current = levels[action.upgrade];
      const hasBuilder = franchise.employees.some((employee) => employee.role === "builder");
      const cost = Math.round(55000 * countryMoneyScale(state.countryCode) * current ** 1.65 * (hasBuilder ? 0.82 : 1));
      if (state.balanceMinor < cost) return fail("Caja insuficiente para constructores y mobiliario.");
      state.balanceMinor -= cost;
      franchise.expensesTodayMinor += cost;
      if (action.upgrade === "shelves") franchise.shelvesLevel++;
      if (action.upgrade === "checkout") franchise.checkoutLevel++;
      if (action.upgrade === "expansion") franchise.expansionLevel++;
      if (action.upgrade === "mill") franchise.machines.flourMillLevel++;
      if (action.upgrade === "bakery") franchise.machines.bakeryLevel++;
      events.push({ franchiseId: franchise.id, category: "capital", description: `Obra y mejora: ${action.upgrade}`, amountMinor: -cost });
      gain(state, 80, "production", 0);
      return success("Constructores terminaron la mejora.");
    }
    case "CONTRIBUTE_BUILD": {
      const project = franchise.buildProjects.find((candidate) => candidate.level === state.level + 1 && !candidate.completed);
      if (!project) return fail(state.level >= 30 ? "La tienda ya alcanzó el rango máximo." : "No hay una ampliación disponible ahora.");
      const pulse = Math.max(1, Math.round(action.amountMinor ?? 500 * countryMoneyScale(state.countryCode)));
      const contribution = Math.min(pulse, state.balanceMinor, project.costMinor - project.contributedMinor);
      if (contribution <= 0) return fail("No hay caja disponible para continuar la obra.");
      state.balanceMinor -= contribution;
      franchise.expensesTodayMinor += contribution;
      project.contributedMinor += contribution;
      project.completed = project.contributedMinor >= project.costMinor;
      events.push({ franchiseId: franchise.id, category: "capital", description: `Aporte ampliación nivel ${project.level}`, amountMinor: -contribution, payload: { projectId: project.id, contributedMinor: project.contributedMinor } });
      return success(project.completed ? "Financiación completa; termina el objetivo para inaugurar." : "La construcción sigue avanzando.");
    }
    case "CONTRIBUTE_UPGRADE": {
      const target = upgradeTarget(state, franchise, action.upgrade);
      if (!target) return fail(upgradeUnavailableMessage(action.upgrade));
      const cost = upgradeCostMinor(state, target.currentTier, action.upgrade);
      const key = `${action.upgrade}:${target.id}:${target.currentTier + 1}`;
      const contributed = franchise.upgradeContributions[key] ?? 0;
      const pulse = Math.max(1, Math.round(action.amountMinor ?? 350 * countryMoneyScale(state.countryCode)));
      const contribution = Math.min(pulse, state.balanceMinor, cost - contributed);
      if (contribution <= 0) return fail("No hay caja disponible para continuar esta mejora.");
      state.balanceMinor -= contribution;
      franchise.expensesTodayMinor += contribution;
      const total = contributed + contribution;
      franchise.upgradeContributions[key] = total;
      events.push({ franchiseId: franchise.id, category: "upgrade", description: `Aporte ${target.label}`, amountMinor: -contribution, payload: { key, contributedMinor: total, costMinor: cost } });
      if (total >= cost) {
        applyUpgradeTarget(state, franchise, target);
        delete franchise.upgradeContributions[key];
        return success(`${target.label}: nivel ${target.currentTier + 1} completado.`);
      }
      return success(`${target.label}: ${Math.floor(total / cost * 100)} % financiado.`);
    }
    case "DOOR_SENSOR":
      franchise.doorPlayerPresent = action.active;
      return success(action.active ? "Sensor de puerta activo." : "Umbral despejado.");
    case "BUY_LICENSE": {
      const cost = Math.round(24000 * countryMoneyScale(state.countryCode) * (1 + franchise.expansionLevel));
      if (state.balanceMinor < cost) return fail("No hay caja para renovar la licencia.");
      state.balanceMinor -= cost;
      franchise.licenseActive = true;
      franchise.licenseDaysLeft += 14;
      events.push({ franchiseId: franchise.id, category: "license", description: "Licencia comercial (14 días)", amountMinor: -cost });
      return success("Licencia comercial renovada.");
    }
    case "BUY_FRANCHISE": {
      const target = state.franchises.find((item) => item.id === action.franchiseId);
      if (!target || target.owned) return fail("Franquicia no disponible.");
      if (state.level < target.unlockLevel) return fail(`Requiere nivel ${target.unlockLevel}.`);
      if (state.balanceMinor < target.purchaseCostMinor) return fail("Capital global insuficiente.");
      state.balanceMinor -= target.purchaseCostMinor;
      target.owned = true;
      target.licenseActive = true;
      target.licenseDaysLeft = 7;
      synchronizeFranchiseProgression(state, target);
      events.push({ franchiseId: target.id, category: "capital", description: `Apertura de ${target.name}`, amountMinor: -target.purchaseCostMinor });
      return success(`${target.name} ya forma parte de tu empresa.`);
    }
    case "TRAVEL": {
      const target = state.franchises.find((item) => item.id === action.franchiseId && item.owned);
      if (!target) return fail("Aún no eres dueño de esa franquicia.");
      state.currentFranchiseId = target.id;
      return success(`Viaje instantáneo a ${target.name}.`);
    }
    case "CLAIM_MISSION": {
      const mission = state.missions.find((item) => item.id === action.missionId);
      if (!mission?.completed || mission.claimed) return fail("La misión todavía no se puede cobrar.");
      mission.claimed = true;
      state.balanceMinor += mission.rewardMinor;
      events.push({ franchiseId: globalEventFranchiseId(state), category: "mission", description: mission.label, amountMinor: mission.rewardMinor, payload: { scope: "global", missionId: mission.id } });
      return success("Recompensa ingresada en la caja global.");
    }
    case "CLOSE_DAY":
      return closeBusinessDay(state, events);
  }
}

export function advanceSimulation(input: GameState, minutes = 10): ActionResult {
  const state = structuredClone(input);
  const events: GameEvent[] = [];
  state.minuteOfDay += minutes;
  state.lastServerTime += minutes * 60_000;
  deliverOrders(state);

  for (const franchise of state.franchises.filter((item) => item.owned && item.open)) {
    // Inventory changes only through real actors and station transactions in
    // advanceWorld. The coarse clock must not manufacture, teleport or sell.
    franchise.employees.forEach((employee) => { employee.energy = Math.max(15, employee.energy - 0.15 * minutes); });
  }
  state.revision += 1;
  normalizeLevel(state);
  stampEvents(state, events);
  return { state, ok: true, message: "Simulación actualizada.", events };
}

export interface WorldTickInput {
  playerDistanceMeters?: number;
  interactions?: readonly WorldInteractionAction[];
}

export function advanceWorld(input: GameState, deltaMs = 250, pathfinder?: WorldPathfinder, worldInput: WorldTickInput = {}): ActionResult {
  const state = structuredClone(input);
  const events: GameEvent[] = [];
  let interactionMessage: string | null = null;
  for (const action of worldInput.interactions ?? []) {
    const result = applyGameActionInternal(state, action, false, false);
    interactionMessage = result.message;
    if (result.ok) events.push(...result.events);
  }
  const elapsedMs = Math.min(1_000, Math.max(0, deltaMs));
  state.simulationTimeMs += elapsedMs;
  const playerDistanceMeters = Math.max(0, Math.min(100, worldInput.playerDistanceMeters ?? 0));
  if (playerDistanceMeters > 0) recordDomain(state, "distance:player", playerDistanceMeters);

  for (const franchise of state.franchises.filter((candidate) => candidate.owned)) {
    franchise.crops = franchise.crops.map((crop) => updateCrop(crop, state.simulationTimeMs));
    franchise.productionMachines = franchise.productionMachines.map((machine) => updateMachine(machine, state.simulationTimeMs));
    franchise.productionMachines = franchise.productionMachines.map((machine) => {
      if ((machine.productId !== "eggs" && machine.productId !== "milk") || machine.status === "LOCKED" || machine.status === "PROCESSING" || machine.output >= machine.outputCapacity) return machine;
      return loadMachine(machine, EMPTY_INVENTORY(), state.simulationTimeMs).machine;
    });
    updateAutomaticDoor(franchise, state.simulationTimeMs, elapsedMs);
    franchise.lightsOn = franchise.open;
    if (franchise.open) spawnCustomerIfNeeded(state, franchise, pathfinder);
    franchise.employees.forEach((employee, index) => {
      employee.runtime ??= createEmployeeRuntime(employee.role, index, state.simulationTimeMs);
      updateEmployee(state, franchise, employee, elapsedMs, events, pathfinder);
    });
    updateCustomerQueue(franchise, pathfinder);
    for (const customer of franchise.customers) updateCustomer(state, franchise, customer, elapsedMs, events, pathfinder);
    updateCheckoutTransactions(state, franchise, events, pathfinder);
    applyCustomerAvoidance(franchise.customers);
    updateCustomerQueue(franchise, pathfinder);
    franchise.customers = franchise.customers.filter((customer) => customer.state !== "DESPAWN" || state.simulationTimeMs - customer.stateSince < 1_000);
    franchise.checkoutTransactions = franchise.checkoutTransactions.filter((transaction) => {
      if (!["COMPLETE", "ABANDONED"].includes(transaction.state)) return true;
      const customerStillCollecting = franchise.customers.some((customer) => customer.transactionId === transaction.id);
      return customerStillCollecting || state.simulationTimeMs - transaction.updatedAt < 2_000;
    });
  }
  state.revision += 1;
  normalizeLevel(state);
  stampEvents(state, events);
  return { state, ok: true, message: interactionMessage ?? "Mundo actualizado.", events };
}

function closeBusinessDay(state: GameState, events: GameEvent[]): ActionResult {
  const country = COUNTRIES[state.countryCode];
  const moneyScale = countryMoneyScale(state.countryCode);
  let payroll = 0;
  let operating = 0;
  let taxableProfit = 0;
  for (const franchise of state.franchises.filter((item) => item.owned)) {
    franchise.open = false;
    const basePayroll = franchise.employees.reduce((total, employee) => total + employee.salaryMinor, 0);
    const payrollCost = Math.round(basePayroll * (1 + country.payrollBurdenRate));
    const dailyOperating = Math.round((1900 * franchise.expansionLevel + 700 * franchise.checkoutLevel) * moneyScale);
    payroll += payrollCost;
    operating += dailyOperating;
    events.push({ franchiseId: franchise.id, category: "payroll", description: `Nóminas y cargas laborales · ${franchise.name}`, amountMinor: -payrollCost });
    events.push({ franchiseId: franchise.id, category: "operations", description: `Alquiler, energía y mantenimiento · ${franchise.name}`, amountMinor: -dailyOperating });
    taxableProfit += franchise.revenueTodayMinor - franchise.expensesTodayMinor - payrollCost - dailyOperating;
    franchise.expensesTodayMinor = 0;
    franchise.revenueTodayMinor = 0;
    franchise.customersToday = 0;
    franchise.licenseDaysLeft = Math.max(0, franchise.licenseDaysLeft - 1);
    franchise.licenseActive = franchise.licenseDaysLeft > 0;
    franchise.employees.forEach((employee) => { employee.energy = 100; });
  }
  const tax = Math.max(0, Math.round(taxableProfit * country.corporateTaxRate));
  const total = payroll + operating + tax;
  state.balanceMinor -= total;
  state.finances.payrollMinor += payroll;
  state.finances.operatingCostsMinor += operating;
  state.finances.taxesMinor += tax;
  state.finances.netProfitMinor = state.finances.grossRevenueMinor - state.finances.costOfGoodsMinor - state.finances.payrollMinor - state.finances.operatingCostsMinor - state.finances.taxesMinor;
  if (tax > 0) events.push({ franchiseId: globalEventFranchiseId(state), category: "tax", description: `Provisión fiscal ${Math.round(country.corporateTaxRate * 100)}%`, amountMinor: -tax, payload: { scope: "global" } });
  state.day++;
  state.minuteOfDay = 7 * 60 + 30;
  state.missions = missionsForDay(state.day, moneyScale);
  state.revision++;
  stampEvents(state, events);
  return { state, ok: true, message: `Día ${state.day - 1} cerrado. Nóminas, operación e impuestos contabilizados.`, events };
}

function updateAutomaticDoor(franchise: FranchiseState, now: number, deltaMs: number) {
  const customerPresent = franchise.customers.some((customer) => (
    (customer.state === "ENTER_STORE" || customer.state === "EXIT_STORE")
    && customer.z >= DOOR_CUSTOMER_SENSOR_MIN_Z
    && customer.z <= DOOR_CUSTOMER_SENSOR_MAX_Z
    && Math.abs(customer.x) <= DOOR_CUSTOMER_SENSOR_HALF_WIDTH
  ));
  const employeePresent = franchise.employees.some((employee) => {
    const runtime = employee.runtime;
    return Boolean(runtime
      && (runtime.state === "NAVIGATE_PICKUP" || runtime.state === "NAVIGATE_DROPOFF" || runtime.state === "NAVIGATE_CHECKOUT")
      && runtime.z >= DOOR_CUSTOMER_SENSOR_MIN_Z
      && runtime.z <= DOOR_CUSTOMER_SENSOR_MAX_Z
      && Math.abs(runtime.x) <= DOOR_CUSTOMER_SENSOR_HALF_WIDTH);
  });
  const occupied = franchise.doorPlayerPresent || customerPresent || employeePresent;
  if (occupied) {
    franchise.doorEmptySince = null;
    if (franchise.doorState !== "OPEN") franchise.doorState = "OPENING";
    franchise.doorProgress = Math.min(1, franchise.doorProgress + deltaMs / 450);
    if (franchise.doorProgress >= 1) franchise.doorState = "OPEN";
    return;
  }
  franchise.doorEmptySince ??= now;
  if (franchise.doorState === "OPEN" && now - franchise.doorEmptySince < 700) return;
  if (franchise.doorProgress > 0) {
    franchise.doorState = "CLOSING";
    franchise.doorProgress = Math.max(0, franchise.doorProgress - deltaMs / 450);
    if (franchise.doorProgress <= 0) franchise.doorState = "CLOSED";
  }
}

function currentFranchise(state: GameState) {
  return state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0];
}

const EMPLOYEE_HOME: Record<Employee["role"], [number, number]> = {
  farmer: [...FARM_WORKER_HOME], operator: [-4.8, -0.9], stocker: [0, -2.2], cashier: [4.7, 2.2], builder: [2.9, -4.5], manager: [5.4, -3.6],
};
const LEGACY_OPERATOR_HOME: [number, number] = [-4.8, -1.5];
const CASHIER_WORK_POINTS: Record<CheckoutLane, [number, number]> = {
  0: [CHECKOUT_LANES[0].cashierWork[0], CHECKOUT_LANES[0].cashierWork[2]],
  1: [CHECKOUT_LANES[1].cashierWork[0], CHECKOUT_LANES[1].cashierWork[2]],
};
const STOCKROOM_POINT: [number, number] = [7.35, -5.2];
const CROP_POINTS: Record<string, [number, number]> = Object.fromEntries(FARM_PLOTS.map((plot) => [plot.id, [plot.position[0], plot.position[2]]]));
const MACHINE_POINTS: Record<string, [number, number]> = {
  "flour-mill-1": [-7.55, -4.05],
  "bread-oven-1": [-7.45, -0.45],
  "cheese-maker-1": [-6.15, -2.2],
  "juice-machine-1": [-5.65, 1.55],
  "chicken-coop-1": [FARM_ANIMAL_STATIONS.chicken.workPosition[0], FARM_ANIMAL_STATIONS.chicken.workPosition[2]],
  "cow-station-1": [FARM_ANIMAL_STATIONS.cow.workPosition[0], FARM_ANIMAL_STATIONS.cow.workPosition[2]],
};

function normalizePersistedFarmEmployee(franchise: FranchiseState, employee: Employee, now: number) {
  if (!employee.runtime || (employee.role !== "farmer" && employee.role !== "operator")) return;
  const runtime = employee.runtime;
  runtime.path = Array.isArray(runtime.path) ? runtime.path : [];
  const atRetiredHome = Math.hypot(runtime.x + 5.3, runtime.z - 3.6) < 0.35;
  const assignedCrop = employee.role === "farmer" && runtime.assignedStationId ? CROP_POINTS[runtime.assignedStationId] : undefined;
  const assignedMachine = employee.role === "operator" && runtime.assignedStationId
    ? franchise.productionMachines.find((machine) => machine.id === runtime.assignedStationId)
    : undefined;
  const assignedFarmMachinePoint = assignedMachine && (assignedMachine.id === "chicken-coop-1" || assignedMachine.id === "cow-station-1")
    ? MACHINE_POINTS[assignedMachine.id]
    : undefined;
  const currentPoint: [number, number] = [runtime.x, runtime.z];
  const currentAtRetiredFarm = isRetiredFrontFarmPoint(currentPoint);
  const retiredRoute = currentAtRetiredFarm
    || isRetiredFrontFarmPoint([runtime.targetX, runtime.targetZ])
    || runtime.path.some((point) => Array.isArray(point) && point.length >= 2 && isRetiredFrontFarmPoint(point));

  const relocate = (point: readonly [number, number]) => {
    runtime.x = point[0];
    runtime.z = point[1];
    runtime.targetX = point[0];
    runtime.targetZ = point[1];
    runtime.currentSpeed = 0;
  };

  // The old operator home sat inside the bakery's actor-clearance envelope.
  // Move that exact persisted resting pose into the aisle before calculating a
  // rear-door fallback, otherwise its first segment can graze the fixture.
  const relocatedLegacyOperatorHome = employee.role === "operator"
    && Math.hypot(runtime.x - LEGACY_OPERATOR_HOME[0], runtime.z - LEGACY_OPERATOR_HOME[1]) < 0.12;
  if (relocatedLegacyOperatorHome) relocate(EMPLOYEE_HOME.operator);

  if (runtime.state === "IDLE" && !carryTotal(runtime.carry)) {
    if (employee.role === "farmer" && (atRetiredHome || currentAtRetiredFarm)) relocate(FARM_WORKER_HOME);
    else if (employee.role === "operator" && currentAtRetiredFarm) relocate(assignedFarmMachinePoint ?? EMPLOYEE_HOME.operator);
    if (atRetiredHome || retiredRoute || relocatedLegacyOperatorHome) {
      runtime.path = [];
      runtime.pathIndex = 0;
    }
    return;
  }

  const collecting = runtime.state === "NAVIGATE_PICKUP" || runtime.state === "PICKUP";
  const delivering = runtime.state === "NAVIGATE_DROPOFF" || runtime.state === "DROPOFF"
    || (runtime.state === "IDLE" && carryTotal(runtime.carry) > 0 && retiredRoute);
  const expectedTarget = employee.role === "farmer"
    ? collecting ? assignedCrop : delivering ? STOCKROOM_POINT : undefined
    : collecting ? assignedFarmMachinePoint
      : delivering && assignedFarmMachinePoint
        ? assignedMachine?.productId === runtime.assignedProduct ? STOCKROOM_POINT : assignedFarmMachinePoint
        : delivering && retiredRoute ? STOCKROOM_POINT : undefined;
  if (!expectedTarget) {
    if (!retiredRoute) return;
    const fallback = assignedCrop ?? assignedFarmMachinePoint
      ?? (employee.role === "farmer" ? FARM_WORKER_HOME : EMPLOYEE_HOME.operator);
    if (currentAtRetiredFarm) relocate(fallback);
    runtime.currentSpeed = 0;
    runtime.stateSince = now;
    if (carryTotal(runtime.carry) > 0) {
      runtime.state = "NAVIGATE_DROPOFF";
      setEmployeePath(runtime, navigatePath(undefined, [runtime.x, runtime.z], STOCKROOM_POINT));
    } else {
      runtime.state = "IDLE";
      runtime.assignedProduct = null;
      runtime.assignedStationId = null;
      runtime.path = [];
      runtime.pathIndex = 0;
    }
    return;
  }

  if (currentAtRetiredFarm) {
    const relocatedSource = assignedCrop ?? assignedFarmMachinePoint
      ?? (employee.role === "farmer" ? FARM_WORKER_HOME : EMPLOYEE_HOME.operator);
    relocate(relocatedSource);
  }
  const endpoint = runtime.path.at(-1);
  const endpointMatches = Boolean(endpoint && Math.hypot(endpoint[0] - expectedTarget[0], endpoint[1] - expectedTarget[1]) < 0.6);
  const transitionNeedsFarmAccess = isRearFarmPoint([runtime.x, runtime.z]) !== isRearFarmPoint(expectedTarget)
    || isLegacyFarmServiceLanePoint([runtime.x, runtime.z]);
  const pathUsesRearDoor = runtime.path.some((point) => (
    Math.hypot(point[0] - STORE_REAR_DOOR.x, point[1] - STORE_REAR_DOOR.z) <= 2
  ));
  const farmDeliveryNeedsFarmAccess = delivering && Boolean(assignedCrop || assignedFarmMachinePoint);
  const actionAtWrongPlace = (runtime.state === "PICKUP" || runtime.state === "DROPOFF")
    && Math.hypot(runtime.x - expectedTarget[0], runtime.z - expectedTarget[1]) >= 0.6;
  if (!retiredRoute && !relocatedLegacyOperatorHome && endpointMatches && (!(transitionNeedsFarmAccess || farmDeliveryNeedsFarmAccess) || pathUsesRearDoor) && !actionAtWrongPlace) return;

  runtime.state = collecting ? "NAVIGATE_PICKUP" : "NAVIGATE_DROPOFF";
  runtime.stateSince = now;
  setEmployeePath(runtime, navigatePath(undefined, [runtime.x, runtime.z], expectedTarget));
}

function createEmployeeRuntime(role: Employee["role"], index: number, now: number): EmployeeRuntimeState {
  const home = EMPLOYEE_HOME[role];
  return { state: "IDLE", assignedProduct: null, assignedStationId: null, carry: { capacity: 2, items: {} }, x: home[0] + index * 0.12, z: home[1], targetX: home[0], targetZ: home[1], path: [], pathIndex: 0, speed: 1.5, currentSpeed: 0, stateSince: now };
}

function updateEmployee(state: GameState, franchise: FranchiseState, employee: Employee, deltaMs: number, events: GameEvent[], pathfinder?: WorldPathfinder) {
  const runtime = employee.runtime!;
  runtime.carry.capacity = Math.min(8, 2 + employee.level);
  runtime.speed = Math.min(2.15, 1.42 + employee.level * 0.08);
  if (employee.energy <= 0 || employee.role === "builder" || employee.role === "manager") return;
  if (employee.role === "cashier") {
    updateCashierEmployee(state, franchise, employee, deltaMs, events, pathfinder);
    return;
  }
  switch (runtime.state) {
    case "IDLE":
      if (state.simulationTimeMs - runtime.stateSince < 350 || !assignEmployeeTask(franchise, employee, pathfinder)) return;
      runtime.state = "NAVIGATE_PICKUP";
      runtime.stateSince = state.simulationTimeMs;
      break;
    case "NAVIGATE_PICKUP":
      if (walkEmployeeThroughAutomaticDoor(runtime, franchise, deltaMs)) { runtime.state = "PICKUP"; runtime.stateSince = state.simulationTimeMs; }
      break;
    case "PICKUP":
      if (state.simulationTimeMs - runtime.stateSince < 320) return;
      employeePickup(state, franchise, employee, pathfinder);
      break;
    case "NAVIGATE_DROPOFF":
      if (walkEmployeeThroughAutomaticDoor(runtime, franchise, deltaMs)) { runtime.state = "DROPOFF"; runtime.stateSince = state.simulationTimeMs; }
      break;
    case "DROPOFF":
      if (state.simulationTimeMs - runtime.stateSince < 320) return;
      employeeDropoff(state, franchise, employee);
      break;
  }
}

function updateCashierEmployee(state: GameState, franchise: FranchiseState, employee: Employee, deltaMs: number, events: GameEvent[], pathfinder?: WorldPathfinder) {
  const runtime = employee.runtime!;
  const activeTransactions = franchise.checkoutTransactions
    .filter((transaction) => transaction.state !== "COMPLETE" && transaction.state !== "ABANDONED")
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const waitingCustomer = franchise.customers.find((customer) => ["NAVIGATE_TO_QUEUE", "QUEUE_WAIT", "MOVE_QUEUE", "UNLOAD", "WAIT_CHECKOUT"].includes(customer.state));
  const lane = (activeTransactions[0]?.checkoutLane ?? waitingCustomer?.queueLane ?? 0) as 0 | 1;
  const workPoint = CASHIER_WORK_POINTS[lane];
  const hasCheckoutWork = activeTransactions.length > 0 || Boolean(waitingCustomer);

  if (runtime.state !== "NAVIGATE_CHECKOUT" && runtime.state !== "OPERATE_CHECKOUT") {
    if (!hasCheckoutWork) return;
    runtime.state = "NAVIGATE_CHECKOUT";
    runtime.assignedStationId = `checkout-${lane + 1}`;
    runtime.stateSince = state.simulationTimeMs;
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], workPoint));
    return;
  }

  if (runtime.state === "NAVIGATE_CHECKOUT") {
    if (walkEmployeeThroughAutomaticDoor(runtime, franchise, deltaMs)) {
      runtime.state = "OPERATE_CHECKOUT";
      runtime.stateSince = state.simulationTimeMs;
      runtime.currentSpeed = 0;
    }
    return;
  }

  // Saved cashiers may still be standing at the retired rear-side work point.
  // Do not let them scan remotely: route them to the current lane geometry.
  if (Math.hypot(runtime.x - workPoint[0], runtime.z - workPoint[1]) > 0.16) {
    runtime.state = "NAVIGATE_CHECKOUT";
    runtime.assignedStationId = `checkout-${lane + 1}`;
    runtime.stateSince = state.simulationTimeMs;
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], workPoint));
    return;
  }

  const assignedLane = runtime.assignedStationId === "checkout-2" ? 1 : 0;
  const transaction = activeTransactions.find((candidate) => (candidate.checkoutLane ?? 0) === assignedLane);
  if (!transaction) {
    if (hasCheckoutWork && lane !== assignedLane) {
      runtime.state = "NAVIGATE_CHECKOUT";
      runtime.assignedStationId = `checkout-${lane + 1}`;
      runtime.stateSince = state.simulationTimeMs;
      setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], workPoint));
    }
    return;
  }
  const interval = checkoutScanInterval(franchise, transaction);
  if (state.simulationTimeMs - transaction.lastScannedAt >= interval) {
    processCheckoutUnit(state, franchise, transaction, events);
    employee.energy = Math.max(0, employee.energy - 0.015);
  }
}

function assignEmployeeTask(franchise: FranchiseState, employee: Employee, pathfinder?: WorldPathfinder) {
  const runtime = employee.runtime!;
  if (employee.role === "stocker") {
    const productId = (Object.keys(franchise.warehouse) as ProductId[])
      .filter((id) => franchise.warehouse[id] > 0)
      .sort((a, b) => shelfFill(franchise, a) - shelfFill(franchise, b))[0];
    if (!productId || shelfFill(franchise, productId) >= 1) return false;
    runtime.assignedProduct = productId; runtime.assignedStationId = "stockroom";
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], STOCKROOM_POINT));
    return true;
  }
  if (employee.role === "farmer") {
    const crop = franchise.crops.find((candidate) => candidate.status === "READY" && candidate.available > 0)
      ?? franchise.crops.find((candidate) => candidate.status === "EMPTY");
    if (!crop) return false;
    runtime.assignedProduct = crop.productId; runtime.assignedStationId = crop.id;
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], CROP_POINTS[crop.id] ?? CROP_POINTS[FARM_PLOTS[0].id]));
    return true;
  }
  if (employee.role === "operator") {
    const output = franchise.productionMachines.find((machine) => machine.status !== "LOCKED" && machine.output > 0);
    if (output) {
      runtime.assignedProduct = output.productId; runtime.assignedStationId = output.id;
      setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], MACHINE_POINTS[output.id]));
      return true;
    }
    const machine = franchise.productionMachines.find((candidate) => (
      (candidate.status === "IDLE" || candidate.status === "WAITING_INPUT")
      && candidate.output === 0
      && candidate.output < candidate.outputCapacity
      && Object.entries(PRODUCT_CONFIG[candidate.productId]?.recipe ?? {}).every(([id, quantity]) => franchise.warehouse[id as ProductId] >= quantity)
    ));
    const ingredient = machine ? Object.keys(PRODUCT_CONFIG[machine.productId]?.recipe ?? {})[0] as ProductId | undefined : undefined;
    if (!machine || !ingredient) return false;
    runtime.assignedProduct = ingredient; runtime.assignedStationId = machine.id;
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], STOCKROOM_POINT));
    return true;
  }
  return false;
}

function employeePickup(state: GameState, franchise: FranchiseState, employee: Employee, pathfinder?: WorldPathfinder) {
  const runtime = employee.runtime!;
  const productId = runtime.assignedProduct;
  if (!productId) return resetEmployee(employee, state.simulationTimeMs);
  if (employee.role === "stocker") {
    const quantity = Math.min(runtime.carry.capacity, franchise.warehouse[productId]);
    franchise.warehouse[productId] -= quantity;
    runtime.carry.items = quantity ? { [productId]: quantity } : {};
  } else if (employee.role === "farmer") {
    const index = franchise.crops.findIndex((crop) => crop.id === runtime.assignedStationId);
    if (index >= 0) {
      if (franchise.crops[index].status === "EMPTY") {
        franchise.crops[index] = plantCrop(franchise.crops[index], state.simulationTimeMs, state.level).crop;
        return resetEmployee(employee, state.simulationTimeMs);
      }
      const freeCapacity = Math.max(0, runtime.carry.capacity - carryTotal(runtime.carry));
      const result = harvestCropBatch(franchise.crops[index], state.simulationTimeMs, freeCapacity, state.level);
      franchise.crops[index] = result.crop;
      runtime.carry = addToCarry(runtime.carry, productId, result.harvested, result.harvested).container;
    }
  } else if (employee.role === "operator") {
    const machine = franchise.productionMachines.find((candidate) => candidate.id === runtime.assignedStationId);
    if (machine?.output) {
      const freeCapacity = Math.max(0, runtime.carry.capacity - carryTotal(runtime.carry));
      const result = collectMachineOutputBatch(machine, state.simulationTimeMs, freeCapacity);
      Object.assign(machine, result.machine);
      runtime.carry = addToCarry(runtime.carry, productId, result.collected, result.collected).container;
    } else {
      const required = Number(PRODUCT_CONFIG[machine?.productId ?? "flour"]?.recipe?.[productId] ?? 0);
      const quantity = Math.min(runtime.carry.capacity, required, franchise.warehouse[productId]);
      franchise.warehouse[productId] -= quantity;
      runtime.carry.items = quantity ? { [productId]: quantity } : {};
    }
  }
  if (!carryTotal(runtime.carry)) return resetEmployee(employee, state.simulationTimeMs);
  const assignedMachine = franchise.productionMachines.find((machine) => machine.id === runtime.assignedStationId);
  const target = employee.role === "stocker" ? retailServicePoint(productId)
    : employee.role === "farmer" || assignedMachine?.productId === productId ? STOCKROOM_POINT
      : MACHINE_POINTS[runtime.assignedStationId ?? ""] ?? STOCKROOM_POINT;
  runtime.state = "NAVIGATE_DROPOFF"; runtime.stateSince = state.simulationTimeMs;
  setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], target));
}

function employeeDropoff(state: GameState, franchise: FranchiseState, employee: Employee) {
  const runtime = employee.runtime!;
  const productId = primaryCarryProduct(runtime.carry);
  if (!productId) return resetEmployee(employee, state.simulationTimeMs);
  let quantity = carryQuantity(runtime.carry, productId);
  if (employee.role === "stocker") {
    const capacity = shelfCapacity(franchise, productId);
    const moved = Math.min(quantity, Math.max(0, capacity - franchise.shelves[productId]));
    franchise.shelves[productId] += moved;
    quantity -= moved;
    if (quantity > 0) franchise.warehouse[productId] += quantity;
  } else if (employee.role === "operator" && franchise.productionMachines.find((machine) => machine.id === runtime.assignedStationId)?.productId !== productId) {
    const index = franchise.productionMachines.findIndex((machine) => machine.id === runtime.assignedStationId);
    if (index >= 0) {
      const temporary = EMPTY_INVENTORY(); temporary[productId] = quantity;
      const result = loadMachine(franchise.productionMachines[index], temporary, state.simulationTimeMs);
      franchise.productionMachines[index] = result.machine;
      quantity = result.inventory[productId];
      if (result.loaded) { recordDomain(state, `production:${result.machine.productId}`, 1); recordDomain(state, "production:all", 1); }
      if (quantity > 0) franchise.warehouse[productId] += quantity;
    }
  } else franchise.warehouse[productId] += quantity;
  resetEmployee(employee, state.simulationTimeMs);
}

function resetEmployee(employee: Employee, now: number) {
  const runtime = employee.runtime!;
  runtime.state = "IDLE"; runtime.stateSince = now; runtime.assignedProduct = null; runtime.assignedStationId = null; runtime.carry.items = {}; runtime.currentSpeed = 0;
}

function shelfFill(franchise: FranchiseState, productId: ProductId) {
  return franchise.shelves[productId] / shelfCapacity(franchise, productId);
}

function shelfCapacity(franchise: FranchiseState, productId: ProductId) {
  const tier = franchise.stationTiers["shelves-1"] ?? franchise.shelvesLevel;
  return Math.max(1, Math.round((PRODUCT_CONFIG[productId]?.shelfCapacity ?? 12) * stationTierModifiers(tier).capacity));
}

function setEmployeePath(runtime: EmployeeRuntimeState, path: [number, number][]) {
  runtime.path = path; runtime.pathIndex = 0;
  const first = path[0] ?? [runtime.x, runtime.z]; runtime.targetX = first[0]; runtime.targetZ = first[1];
}

function walkEmployeeThroughAutomaticDoor(runtime: EmployeeRuntimeState, franchise: FranchiseState, deltaMs: number) {
  const beforeX = runtime.x;
  const beforeZ = runtime.z;
  if (franchise.doorState === "OPEN" && franchise.doorProgress >= 1) return walkPathActor(runtime, deltaMs);

  const nextTarget = runtime.path[runtime.pathIndex];
  const targetUsesDoor = Boolean(nextTarget
    && Math.abs(beforeX) <= DOOR_CUSTOMER_SENSOR_HALF_WIDTH
    && Math.abs(nextTarget[0]) <= DOOR_CUSTOMER_SENSOR_HALF_WIDTH);
  const waitingToEnter = targetUsesDoor && beforeZ >= DOOR_PASSAGE_Z && nextTarget![1] < DOOR_PASSAGE_Z
    && beforeZ <= DOOR_OUTSIDE_WAIT_Z + 0.02;
  const waitingToExit = targetUsesDoor && beforeZ <= DOOR_PASSAGE_Z && nextTarget![1] > DOOR_PASSAGE_Z
    && beforeZ >= DOOR_INSIDE_WAIT_Z - 0.02;
  if (waitingToEnter || waitingToExit) {
    runtime.z = waitingToEnter ? DOOR_OUTSIDE_WAIT_Z : DOOR_INSIDE_WAIT_Z;
    runtime.currentSpeed = 0;
    runtime.targetZ = nextTarget?.[1] ?? runtime.targetZ;
    return false;
  }

  const arrived = walkPathActor(runtime, deltaMs);

  // Employees are simulation actors rather than Rapier bodies. Clamp both
  // crossing directions at their visible waiting points until the same
  // authoritative automatic door used by players and customers is fully open.
  const crossedDoorCorridor = Math.abs(beforeX) <= DOOR_CUSTOMER_SENSOR_HALF_WIDTH
    && Math.abs(runtime.x) <= DOOR_CUSTOMER_SENSOR_HALF_WIDTH;
  const entering = crossedDoorCorridor && beforeZ >= DOOR_PASSAGE_Z && runtime.z < DOOR_PASSAGE_Z;
  const exiting = crossedDoorCorridor && beforeZ <= DOOR_PASSAGE_Z && runtime.z > DOOR_PASSAGE_Z;
  if (entering) {
    runtime.z = DOOR_OUTSIDE_WAIT_Z;
    runtime.currentSpeed = 0;
    runtime.targetZ = runtime.path[runtime.pathIndex]?.[1] ?? runtime.targetZ;
    return false;
  }
  if (exiting) {
    runtime.z = DOOR_INSIDE_WAIT_Z;
    runtime.currentSpeed = 0;
    runtime.targetZ = runtime.path[runtime.pathIndex]?.[1] ?? runtime.targetZ;
    return false;
  }
  return arrived;
}

const CUSTOMER_BAG_POINTS: Record<CheckoutLane, [number, number]> = {
  0: [...CHECKOUT_LANES[0].bagPickup],
  1: [...CHECKOUT_LANES[1].bagPickup],
};
const CUSTOMER_PRODUCT_UNLOCKS: readonly (readonly [ProductId, number])[] = [
  ["tomatoes", 1],
  ["apples", 2],
  ["bread", 6],
  ["eggs", 8],
  ["coffee", 9],
  ["corn", 11],
  ["milk", 13],
  ["cheese", 16],
  ["juice", 21],
];

export function unlockedCustomerProducts(level: number): ProductId[] {
  const normalizedLevel = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return CUSTOMER_PRODUCT_UNLOCKS.filter(([, unlockLevel]) => normalizedLevel >= unlockLevel).map(([productId]) => productId);
}

function spawnCustomerIfNeeded(state: GameState, franchise: FranchiseState, pathfinder?: WorldPathfinder) {
  const active = franchise.customers.filter((customer) => customer.state !== "DESPAWN");
  const maximum = state.level < 20 ? Math.min(12, 3 + Math.floor(state.level / 2)) : Math.min(30, 12 + Math.floor((state.level - 20) * 1.8));
  if (active.length >= maximum || state.simulationTimeMs - franchise.lastCustomerSpawnAt < 3_000) return;
  const sequence = franchise.nextCustomerSequence++;
  const identity = ((sequence - 1) % 6 + 1) as CustomerRuntimeState["identity"];
  const id = `${franchise.id}-customer-${sequence}`;
  const mind = createCustomerMind(id, unlockedCustomerProducts(state.level), sequence * 2654435761, state.level);
  const entryX = identity % 2 ? -0.82 : 0.82;
  const customer: CustomerRuntimeState = {
    id, identity, state: "ENTER_STORE", shoppingList: mind.shoppingList, currentLine: 0, basket: {}, patienceMs: mind.patienceMs,
    checkoutPatienceMs: CHECKOUT_PATIENCE_MS, waitingSince: null, queueSlot: null, queueLane: 0, queueJoinedAt: null, transactionId: null,
    hasCart: false, hasBag: false, angry: false, x: entryX, z: 15.2, targetX: entryX, targetZ: 5.6,
    path: navigatePath(pathfinder, [entryX, 15.2], [...CART_RETURN_POINT]), pathIndex: 0, speed: 1.35 + identity * 0.065, currentSpeed: 0, stateSince: state.simulationTimeMs, reservedSocketId: null, blockedSince: null, routeFailures: 0,
  };
  franchise.customers.push(customer);
  franchise.lastCustomerSpawnAt = state.simulationTimeMs;
}

function updateCustomer(state: GameState, franchise: FranchiseState, customer: CustomerRuntimeState, deltaMs: number, events: GameEvent[], pathfinder?: WorldPathfinder) {
  const now = state.simulationTimeMs;
  if (!customer.transactionId && isCheckoutQueueState(customer) && customerBasketUnits(customer) === 0) {
    leaveWithoutPurchase(customer, now, pathfinder);
    return;
  }
  if (isWaitingForCheckout(customer) && customer.queueJoinedAt != null && now - customer.queueJoinedAt >= customer.checkoutPatienceMs) {
    abandonCheckout(franchise, customer, now, events, pathfinder);
    return;
  }
  switch (customer.state) {
    case "ENTER_STORE":
      if (walkCustomerThroughAutomaticDoor(customer, franchise, deltaMs, "ENTER")) setCustomerState(customer, "GET_CART", now);
      break;
    case "GET_CART":
      if (now - customer.stateSince >= 450) {
        customer.hasCart = true;
        setCustomerState(customer, "BUILD_SHOPPING_LIST", now);
      }
      break;
    case "BUILD_SHOPPING_LIST":
      setCustomerState(customer, "NAVIGATE_TO_PRODUCT", now);
      setProductPath(franchise, customer, pathfinder);
      break;
    case "NAVIGATE_TO_PRODUCT":
      if (walkCustomer(customer, deltaMs)) setCustomerState(customer, "WAIT_FOR_ACCESS", now);
      break;
    case "WAIT_FOR_ACCESS":
      if (now - customer.stateSince >= 250) {
        if (!customer.reservedSocketId) {
          setCustomerState(customer, "NAVIGATE_TO_PRODUCT", now);
          setProductPath(franchise, customer, pathfinder);
          break;
        }
        const line = customer.shoppingList[customer.currentLine];
        if (!line || line.picked >= line.requested) setCustomerState(customer, "NEXT_PRODUCT", now);
        else if (franchise.shelves[line.productId] > 0) setCustomerState(customer, "PICK_PRODUCT", now);
        else { customer.waitingSince = now; setCustomerState(customer, "WAIT_RESTOCK", now); }
      }
      break;
    case "PICK_PRODUCT":
      if (now - customer.stateSince >= 520) {
        const line = customer.shoppingList[customer.currentLine];
        if (!line || franchise.shelves[line.productId] <= 0) { customer.waitingSince = now; setCustomerState(customer, "WAIT_RESTOCK", now); break; }
        franchise.shelves[line.productId] -= 1;
        line.picked += 1;
        customer.basket[line.productId] = (customer.basket[line.productId] ?? 0) + 1;
        customer.reservedSocketId = null;
        if (line.picked >= line.requested) { customer.currentLine += 1; setCustomerState(customer, "NEXT_PRODUCT", now); }
        else setCustomerState(customer, "WAIT_FOR_ACCESS", now);
      }
      break;
    case "WAIT_RESTOCK": {
      const line = customer.shoppingList[customer.currentLine];
      if (line && franchise.shelves[line.productId] > 0) {
        customer.waitingSince = null;
        setCustomerState(customer, "NAVIGATE_TO_PRODUCT", now);
        setProductPath(franchise, customer, pathfinder);
      } else if (customer.waitingSince !== null && now - customer.waitingSince >= customer.patienceMs) {
        customer.currentLine += 1;
        customer.waitingSince = null;
        customer.reservedSocketId = null;
        setCustomerState(customer, "NEXT_PRODUCT", now);
      }
      break;
    }
    case "NEXT_PRODUCT":
      if (customer.currentLine < customer.shoppingList.length) {
        setCustomerState(customer, "NAVIGATE_TO_PRODUCT", now);
        setProductPath(franchise, customer, pathfinder);
      } else if (customerBasketUnits(customer) === 0) {
        leaveWithoutPurchase(customer, now, pathfinder);
      } else {
        setCustomerState(customer, "NAVIGATE_TO_QUEUE", now);
        customer.queueJoinedAt = now;
        setCustomerPath(customer, queueArrivalPath(pathfinder, [customer.x, customer.z], franchise.customers.length - 1, customer.queueLane ?? 0));
      }
      break;
    case "NAVIGATE_TO_QUEUE":
    case "MOVE_QUEUE":
      if (walkCustomer(customer, deltaMs)) setCustomerState(customer, customer.queueSlot === 0 ? "UNLOAD" : "QUEUE_WAIT", now);
      break;
    case "QUEUE_WAIT":
      if (customer.queueSlot === 0) {
        setCustomerState(customer, "MOVE_QUEUE", now);
        setCustomerPath(customer, queueArrivalPath(pathfinder, [customer.x, customer.z], 0, customer.queueLane ?? 0));
      }
      break;
    case "UNLOAD":
      if (now - customer.stateSince >= 300 && !customer.transactionId) {
        const pendingItems = (Object.entries(customer.basket) as [ProductId, number][]).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity, loaded: 0, scanned: 0, bagged: 0 }));
        if (!pendingItems.length) {
          customer.queueJoinedAt = null;
          customer.queueSlot = null;
          setCustomerState(customer, "NAVIGATE_TO_CART_RETURN", now);
          setCustomerPath(customer, navigatePath(pathfinder, [customer.x, customer.z], [...CART_RETURN_POINT]));
          break;
        }
        const transaction: CheckoutTransaction = {
          id: crypto.randomUUID(), customerId: customer.id, pendingItems,
          paymentMethod: (franchise.customersToday + customer.identity) % 2 ? "cash" : "card",
          state: "CUSTOMER_LOADING", nextUnitIndex: 0, paymentCommitted: false, updatedAt: now,
          lastLoadedAt: now, lastScannedAt: now, lastBaggedAt: now, checkoutLane: customer.queueLane ?? 0,
        };
        franchise.checkoutTransactions.push(transaction);
        customer.transactionId = transaction.id;
        setCustomerState(customer, "WAIT_CHECKOUT", now);
      }
      break;
    case "WAIT_CHECKOUT":
      break;
    case "PAY":
      break;
    case "NAVIGATE_TO_BAG":
      if (walkCustomer(customer, deltaMs)) setCustomerState(customer, "TAKE_BAG", now);
      break;
    case "TAKE_BAG":
      if (now - customer.stateSince >= CHECKOUT_BAG_HANDOFF_MS) {
        customer.hasBag = true;
        customer.transactionId = null;
        customer.basket = {};
        setCustomerState(customer, "NAVIGATE_TO_CART_RETURN", now);
        setCustomerPath(customer, navigatePath(pathfinder, [customer.x, customer.z], [...CART_RETURN_POINT]));
      }
      break;
    case "NAVIGATE_TO_RETURNS":
      if (walkCustomer(customer, deltaMs)) setCustomerState(customer, "LEAVE_RETURNS", now);
      break;
    case "LEAVE_RETURNS":
      if (now - customer.stateSince >= 450) {
        for (const [productId, quantity] of Object.entries(customer.basket) as [ProductId, number][]) franchise.returnsBin[productId] += quantity;
        customer.basket = {};
        setCustomerState(customer, "NAVIGATE_TO_CART_RETURN", now);
        setCustomerPath(customer, navigatePath(pathfinder, [customer.x, customer.z], [...CART_RETURN_POINT]));
      }
      break;
    case "NAVIGATE_TO_CART_RETURN":
      if (walkCustomer(customer, deltaMs)) setCustomerState(customer, "RETURN_CART", now);
      break;
    case "RETURN_CART":
      if (now - customer.stateSince >= 420) {
        if (customer.hasCart) franchise.returnedCartCount += 1;
        customer.hasCart = false;
        setCustomerState(customer, "EXIT_STORE", now);
        setCustomerPath(customer, navigatePath(pathfinder, [customer.x, customer.z], [customer.identity % 2 ? -0.82 : 0.82, 15.4]));
      }
      break;
    case "EXIT_STORE":
      if (walkCustomerThroughAutomaticDoor(customer, franchise, deltaMs, "EXIT")) setCustomerState(customer, "DESPAWN", now);
      break;
    case "DESPAWN":
    case "SPAWN":
      break;
  }
}

function isWaitingForCheckout(customer: CustomerRuntimeState) {
  return ["NAVIGATE_TO_QUEUE", "QUEUE_WAIT", "MOVE_QUEUE", "UNLOAD", "WAIT_CHECKOUT"].includes(customer.state);
}

function isCheckoutQueueState(customer: CustomerRuntimeState) {
  return ["NAVIGATE_TO_QUEUE", "QUEUE_WAIT", "MOVE_QUEUE", "UNLOAD"].includes(customer.state);
}

function customerBasketUnits(customer: CustomerRuntimeState) {
  return Object.values(customer.basket).reduce((total, quantity) => total + (quantity ?? 0), 0);
}

function leaveWithoutPurchase(customer: CustomerRuntimeState, now: number, pathfinder?: WorldPathfinder) {
  customer.queueJoinedAt = null;
  customer.queueSlot = null;
  customer.currentSpeed = 0;
  setCustomerState(customer, "NAVIGATE_TO_CART_RETURN", now);
  setCustomerPath(customer, navigatePath(pathfinder, [customer.x, customer.z], [...CART_RETURN_POINT]));
}

function abandonCheckout(franchise: FranchiseState, customer: CustomerRuntimeState, now: number, events: GameEvent[], pathfinder?: WorldPathfinder) {
  const transaction = franchise.checkoutTransactions.find((candidate) => candidate.id === customer.transactionId);
  if (transaction && transaction.state !== "COMPLETE") {
    transaction.state = "ABANDONED";
    transaction.updatedAt = now;
  }
  customer.angry = true;
  customer.queueJoinedAt = null;
  customer.queueSlot = null;
  customer.transactionId = null;
  setCustomerState(customer, "NAVIGATE_TO_RETURNS", now);
  setCustomerPath(customer, navigatePath(pathfinder, [customer.x, customer.z], [...RETURNS_POINT]));
  events.push({ franchiseId: franchise.id, category: "returns", description: `Cliente ${customer.id} agotó sus 5 minutos de espera`, amountMinor: 0, payload: { customerId: customer.id } });
}

function updateCustomerQueue(franchise: FranchiseState, pathfinder?: WorldPathfinder) {
  const queued = franchise.customers
    .filter((customer) => ["NAVIGATE_TO_QUEUE", "QUEUE_WAIT", "MOVE_QUEUE", "UNLOAD", "WAIT_CHECKOUT", "PAY"].includes(customer.state))
    .sort((a, b) => (a.queueJoinedAt ?? a.stateSince) - (b.queueJoinedAt ?? b.stateSince) || a.id.localeCompare(b.id));
  const laneCount = franchise.unlockedAreas.includes("checkout-2") ? 2 : 1;
  const lanes: CustomerRuntimeState[][] = Array.from({ length: laneCount }, () => []);
  for (const customer of queued) {
    const existingLane = customer.queueLane ?? 0;
    const shortestLane = lanes.reduce((best, lane, index) => lane.length < lanes[best].length ? index : best, 0);
    const lane = existingLane < laneCount && lanes[existingLane].length <= lanes[shortestLane].length ? existingLane : shortestLane;
    lanes[lane].push(customer);
  }
  lanes.forEach((laneCustomers, lane) => laneCustomers.forEach((customer, nextSlot) => {
    const changed = customer.queueSlot !== nextSlot || customer.queueLane !== lane;
    customer.queueLane = lane as 0 | 1;
    customer.queueSlot = nextSlot;
    const destination = queuePosition(nextSlot, lane);
    const finalTarget = customer.path.at(-1) ?? [customer.targetX, customer.targetZ];
    const targetChanged = Math.hypot(finalTarget[0] - destination[0], finalTarget[1] - destination[1]) > 0.08;
    if ((changed || targetChanged) && (customer.state === "NAVIGATE_TO_QUEUE" || customer.state === "QUEUE_WAIT" || customer.state === "MOVE_QUEUE")) {
      customer.state = "MOVE_QUEUE";
      setCustomerPath(customer, queueArrivalPath(pathfinder, [customer.x, customer.z], nextSlot, lane));
    } else if (["UNLOAD", "WAIT_CHECKOUT", "PAY"].includes(customer.state) && Math.hypot(customer.x - destination[0], customer.z - destination[1]) > 0.08) {
      customer.x = destination[0]; customer.z = destination[1];
      customer.targetX = destination[0]; customer.targetZ = destination[1];
      customer.path = []; customer.pathIndex = 0; customer.currentSpeed = 0;
    }
  }));
  franchise.queueCustomerIds = lanes.flatMap((lane) => lane.map((customer) => customer.id));
}

function processCheckoutUnit(state: GameState, franchise: FranchiseState, transaction: CheckoutTransaction, events: GameEvent[]) {
  if (transaction.state === "COMPLETE" || transaction.state === "ABANDONED") return "La caja ya no tiene una compra activa.";
  const totals = checkoutUnitTotals(transaction);
  if (totals.loaded < totals.total) return "El cliente está colocando los productos en la cinta.";
  if (state.simulationTimeMs - transaction.lastScannedAt < checkoutScanInterval(franchise, transaction)) return "El cajero está terminando de pasar el producto anterior.";
  const line = transaction.pendingItems.find((candidate) => candidate.scanned < candidate.loaded);
  if (!line) {
    if (totals.bagged < totals.scanned) return "El embolsado automático está terminando.";
    return transaction.state === "PAYMENT" ? "El cliente está realizando el pago." : "No hay otro producto listo para escanear.";
  }
  if (totals.bagged >= totals.scanned) transaction.lastBaggedAt = state.simulationTimeMs;
  line.scanned += 1;
  transaction.nextUnitIndex += 1;
  transaction.lastScannedAt = state.simulationTimeMs;
  transaction.updatedAt = state.simulationTimeMs;
  transaction.state = transaction.pendingItems.every((candidate) => candidate.scanned >= candidate.quantity) ? "BAGGING" : "SCANNING";
  void franchise;
  void events;
  return `Escaneado: ${PRODUCTS[line.productId].name}.`;
}

function updateCheckoutTransactions(state: GameState, franchise: FranchiseState, events: GameEvent[], pathfinder?: WorldPathfinder) {
  const now = state.simulationTimeMs;
  for (const transaction of franchise.checkoutTransactions) {
    if (transaction.state === "COMPLETE" || transaction.state === "ABANDONED") continue;
    let changed = false;
    const loadLine = transaction.pendingItems.find((line) => line.loaded < line.quantity);
    if (loadLine && now - transaction.lastLoadedAt >= CHECKOUT_LOAD_UNIT_MS) {
      loadLine.loaded += 1;
      transaction.lastLoadedAt = now;
      changed = true;
    }
    const bagLine = transaction.pendingItems.find((line) => line.bagged < line.scanned);
    if (bagLine && now - transaction.lastBaggedAt >= CHECKOUT_BAG_UNIT_MS) {
      bagLine.bagged += 1;
      transaction.lastBaggedAt = now;
      changed = true;
    }
    const totals = checkoutUnitTotals(transaction);
    const nextState: CheckoutTransaction["state"] = totals.loaded < totals.total
      ? "CUSTOMER_LOADING"
      : totals.scanned < totals.total
        ? "SCANNING"
        : totals.bagged < totals.total
          ? "BAGGING"
          : "PAYMENT";
    if (transaction.state !== nextState) {
      transaction.state = nextState;
      changed = true;
    }
    if (changed) transaction.updatedAt = now;
    const customer = franchise.customers.find((candidate) => candidate.id === transaction.customerId);
    if (transaction.state === "PAYMENT" && customer?.state === "WAIT_CHECKOUT") {
      setCustomerState(customer, "PAY", now);
    }
    if (transaction.state === "PAYMENT" && customer?.state === "PAY" && now - customer.stateSince >= CHECKOUT_PAYMENT_MS) commitCheckoutPayment(state, franchise, transaction, customer, events, pathfinder);
  }
}

function checkoutScanInterval(
  franchise: Pick<FranchiseState, "stationTiers" | "checkoutLevel" | "shelvesLevel">,
  transaction: CheckoutTransaction,
) {
  const lane = transaction.checkoutLane ?? 0;
  return CHECKOUT_SCAN_UNIT_MS / stationTierModifiers(franchise.stationTiers[`checkout-${lane + 1}`] ?? franchise.checkoutLevel).speed;
}

function checkoutUnitTotals(transaction: CheckoutTransaction) {
  return transaction.pendingItems.reduce((totals, line) => ({
    total: totals.total + line.quantity,
    loaded: totals.loaded + line.loaded,
    scanned: totals.scanned + line.scanned,
    bagged: totals.bagged + line.bagged,
  }), { total: 0, loaded: 0, scanned: 0, bagged: 0 });
}

function commitCheckoutPayment(state: GameState, franchise: FranchiseState, transaction: CheckoutTransaction, customer: CustomerRuntimeState, events: GameEvent[], pathfinder?: WorldPathfinder) {
  if (transaction.paymentCommitted) return;
  let saleMinor = 0;
  const presentationValue = stationTierModifiers(franchise.stationTiers["shelves-1"] ?? franchise.shelvesLevel).value;
  for (const line of transaction.pendingItems) saleMinor += Math.round(PRODUCTS[line.productId].saleMinor * countryMoneyScale(state.countryCode) * presentationValue) * line.quantity;
  const tax = Math.round(saleMinor * COUNTRIES[state.countryCode].salesTaxRate);
  const gross = saleMinor + tax;
  transaction.paymentCommitted = true;
  transaction.state = "COMPLETE";
  transaction.updatedAt = state.simulationTimeMs;
  state.balanceMinor += gross;
  state.finances.grossRevenueMinor += saleMinor;
  franchise.revenueTodayMinor += saleMinor;
  franchise.customersToday += 1;
  state.reputation += 1;
  gain(state, 20, "customers", 1);
  recordDomain(state, "customers", 1);
  const unitsSold = transaction.pendingItems.reduce((total, line) => total + line.quantity, 0);
  recordDomain(state, "sales:units", unitsSold);
  for (const line of transaction.pendingItems) recordDomain(state, `sales:${line.productId}`, line.quantity);
  if (averageShelfAvailability(franchise) >= 0.9) recordDomain(state, "availability:sales", 1);
  if (customer.queueJoinedAt != null && state.simulationTimeMs - customer.queueJoinedAt <= 30_000) recordDomain(state, "queue:under30", 1);
  if (customer.shoppingList.length >= 5 && customer.shoppingList.every((line) => line.picked >= line.requested)) recordDomain(state, "lists:five", 1);
  events.push({ franchiseId: franchise.id, category: "sales", description: `Compra ${transaction.id} · ${transaction.paymentMethod === "cash" ? "efectivo" : "tarjeta"}`, amountMinor: gross, payload: { transactionId: transaction.id } });
  customer.queueJoinedAt = null;
  customer.queueSlot = null;
  setCustomerState(customer, "NAVIGATE_TO_BAG", state.simulationTimeMs);
  const lane = transaction.checkoutLane ?? 0;
  setCustomerPath(customer, navigatePath(pathfinder, [customer.x, customer.z], CUSTOMER_BAG_POINTS[lane]));
}

function setCustomerState(customer: CustomerRuntimeState, state: CustomerRuntimeState["state"], now: number) {
  customer.state = state;
  customer.stateSince = now;
}

function currentProductTarget(customer: CustomerRuntimeState) {
  return retailServicePoint(customer.shoppingList[customer.currentLine]?.productId ?? "tomatoes");
}

function setProductPath(franchise: FranchiseState, customer: CustomerRuntimeState, pathfinder?: WorldPathfinder) {
  const line = customer.shoppingList[customer.currentLine];
  if (!line) { setCustomerPath(customer, []); return; }
  const used = new Set(franchise.customers.filter((candidate) => candidate.id !== customer.id).map((candidate) => candidate.reservedSocketId).filter(Boolean));
  const slot = [0, 1, 2, 3].find((candidate) => !used.has(`${line.productId}:${candidate}`));
  if (slot === undefined) {
    customer.reservedSocketId = null;
    customer.waitingSince = customer.stateSince;
    setCustomerState(customer, "WAIT_FOR_ACCESS", customer.stateSince);
    return;
  }
  customer.reservedSocketId = `${line.productId}:${slot}`;
  const base = currentProductTarget(customer);
  const offsets: [number, number][] = [[-0.38, 0], [0.38, 0], [0, -0.38], [0, 0.38]];
  const target: [number, number] = [base[0] + offsets[slot][0], base[1] + offsets[slot][1]];
  setCustomerPath(customer, navigatePath(pathfinder, [customer.x, customer.z], target));
}

function applyCustomerAvoidance(customers: CustomerRuntimeState[]) {
  const moving = new Set<CustomerRuntimeState["state"]>(["ENTER_STORE", "NAVIGATE_TO_PRODUCT", "NAVIGATE_TO_QUEUE", "MOVE_QUEUE", "NAVIGATE_TO_BAG", "NAVIGATE_TO_RETURNS", "NAVIGATE_TO_CART_RETURN", "EXIT_STORE"]);
  for (let firstIndex = 0; firstIndex < customers.length; firstIndex++) {
    const first = customers[firstIndex];
    if (!moving.has(first.state)) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < customers.length; secondIndex++) {
      const second = customers[secondIndex];
      if (!moving.has(second.state)) continue;
      const dx = second.x - first.x; const dz = second.z - first.z; const distance = Math.hypot(dx, dz);
      if (distance >= 0.6) continue;
      const nx = distance > 0.001 ? dx / distance : first.id < second.id ? 1 : -1;
      const nz = distance > 0.001 ? dz / distance : 0;
      const correction = Math.min(0.08, (0.6 - distance) * 0.5);
      first.x -= nx * correction; first.z -= nz * correction;
      second.x += nx * correction; second.z += nz * correction;
    }
  }
}

function setCustomerPath(customer: CustomerRuntimeState, path: [number, number][]) {
  customer.path = path;
  customer.pathIndex = 0;
  const first = path[0] ?? [customer.x, customer.z];
  customer.targetX = first[0]; customer.targetZ = first[1];
}

function walkCustomer(customer: CustomerRuntimeState, deltaMs: number) {
  return walkPathActor(customer, deltaMs);
}

function walkCustomerThroughAutomaticDoor(customer: CustomerRuntimeState, franchise: FranchiseState, deltaMs: number, direction: "ENTER" | "EXIT") {
  const beforeZ = customer.z;
  const arrived = walkCustomer(customer, deltaMs);
  if (franchise.doorState === "OPEN" && franchise.doorProgress >= 1) return arrived;

  const enteringBeforeDoor = direction === "ENTER" && beforeZ >= DOOR_PASSAGE_Z;
  const exitingBeforeDoor = direction === "EXIT" && beforeZ <= DOOR_PASSAGE_Z;
  if (enteringBeforeDoor && customer.z < DOOR_OUTSIDE_WAIT_Z) {
    customer.z = DOOR_OUTSIDE_WAIT_Z;
    customer.currentSpeed = 0;
    customer.targetZ = customer.path[customer.pathIndex]?.[1] ?? customer.targetZ;
    return false;
  }
  if (exitingBeforeDoor && customer.z > DOOR_INSIDE_WAIT_Z) {
    customer.z = DOOR_INSIDE_WAIT_Z;
    customer.currentSpeed = 0;
    customer.targetZ = customer.path[customer.pathIndex]?.[1] ?? customer.targetZ;
    return false;
  }
  return arrived;
}

type PathActor = Pick<CustomerRuntimeState, "x" | "z" | "targetX" | "targetZ" | "path" | "pathIndex" | "speed" | "currentSpeed">;

function walkPathActor(actor: PathActor, deltaMs: number) {
  const target = actor.path[actor.pathIndex];
  if (!target) return true;
  const seconds = deltaMs / 1_000;
  let remainingPathDistance = 0;
  let pathX = actor.x; let pathZ = actor.z;
  for (let index = actor.pathIndex; index < actor.path.length; index += 1) {
    const [nextX, nextZ] = actor.path[index];
    remainingPathDistance += Math.hypot(nextX - pathX, nextZ - pathZ);
    pathX = nextX; pathZ = nextZ;
  }
  const brakingSpeed = Math.sqrt(Math.max(0, 2 * 6.2 * remainingPathDistance));
  const desiredSpeed = Math.min(actor.speed, brakingSpeed);
  const currentSpeed = actor.currentSpeed ?? 0;
  actor.currentSpeed = currentSpeed < desiredSpeed ? Math.min(desiredSpeed, currentSpeed + 5.2 * seconds) : Math.max(desiredSpeed, currentSpeed - 6.2 * seconds);
  let remainingStep = actor.currentSpeed * seconds;
  let guard = actor.path.length + 1;
  while (remainingStep >= 0 && actor.pathIndex < actor.path.length && guard > 0) {
    guard -= 1;
    const [targetX, targetZ] = actor.path[actor.pathIndex];
    actor.targetX = targetX; actor.targetZ = targetZ;
    const dx = targetX - actor.x; const dz = targetZ - actor.z; const distance = Math.hypot(dx, dz);
    if (distance > remainingStep + 1e-9 && distance >= 0.025) {
      actor.x += dx / distance * remainingStep; actor.z += dz / distance * remainingStep;
      remainingStep = -1;
      break;
    }
    actor.x = targetX; actor.z = targetZ; actor.pathIndex += 1;
    remainingStep -= distance;
  }
  const next = actor.path[actor.pathIndex];
  if (next) { actor.targetX = next[0]; actor.targetZ = next[1]; }
  const arrived = actor.pathIndex >= actor.path.length;
  if (arrived) actor.currentSpeed = 0;
  return arrived;
}

function laneFor(target: [number, number]) { return target[0] < -1 ? -2.2 : target[0] > 1 ? 2.2 : 2.15; }

function customerPath(start: [number, number], target: [number, number]): [number, number][] {
  if (sameStorePoint(target, RETURNS_POINT)) {
    const [aisleApproach, frontApproach] = STORE_SERVICE_FIXTURES.returns.approach.map((point) => [...point] as [number, number]);
    return compactPath(start, [aisleApproach, frontApproach, [...RETURNS_POINT]]);
  }
  if (sameStorePoint(target, CART_RETURN_POINT) && Math.hypot(start[0] - RETURNS_POINT[0], start[1] - RETURNS_POINT[1]) < 1.5) {
    return compactPath(start, RETURNS_TO_CART_FALLBACK.map((point) => [...point] as [number, number]));
  }
  const startsOutside = start[1] > DOOR_OUTSIDE_WAIT_Z;
  const endsOutside = target[1] > DOOR_OUTSIDE_WAIT_Z;
  if (startsOutside && !endsOutside) {
    const doorwayX = Math.max(-0.82, Math.min(0.82, start[0]));
    const insideStart: [number, number] = [doorwayX, 5.6];
    return compactPath(start, [[doorwayX, 9], insideStart, ...customerPath(insideStart, target)]);
  }
  if (!startsOutside && endsOutside) {
    const doorwayX = Math.max(-0.82, Math.min(0.82, target[0]));
    return compactPath(start, [[start[0], 5.6], [doorwayX, 5.6], [doorwayX, 9], target]);
  }
  const lane = laneFor(target); const path: [number, number][] = [];
  if (start[1] > 5.6) path.push([start[0], 5.6]);
  path.push([lane, Math.min(5.6, Math.max(0.45, start[1]))]);
  if (target[1] < 0.45) path.push([lane, 0.45]);
  path.push([lane, target[1]], target);
  return compactPath(start, path);
}

function sameStorePoint(left: readonly [number, number], right: readonly [number, number]) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]) < 0.01;
}

function navigatePath(pathfinder: WorldPathfinder | undefined, start: [number, number], target: [number, number]) {
  const navPath = pathfinder?.(start, target) ?? [];
  return navPath.length ? compactPath(start, navPath) : safeFallbackPath(start, target);
}

function isRearFarmPoint(point: readonly [number, number]) {
  const farmFrontEdge = FARM_FIELD.center[2] + FARM_FIELD.size[2] / 2;
  return point[1] <= farmFrontEdge + 0.5 && !isLegacyFarmServiceLanePoint(point);
}

function isLegacyFarmServiceLanePoint(point: readonly [number, number]) {
  return point[0] >= FARM_FIELD.serviceLaneX - 0.7
    && point[0] <= 13
    && point[1] >= -12.1
    && point[1] <= 9.15;
}

function isRearStockroomPoint(point: readonly [number, number]) {
  return point[0] >= 6.1 && point[1] <= -4 && point[1] > -8.2;
}

function storeInteriorRouteToRearDoor(start: [number, number]) {
  const corridor = STORE_REAR_DOOR.interiorCorridor.map((point) => [...point] as [number, number]);
  if (isRearStockroomPoint(start)) return compactPath(start, [corridor.at(-1)!]);
  return compactPath(start, [
    ...customerPath(start, corridor[0]),
    ...corridor.slice(1),
  ]);
}

function storeInteriorRouteFromRearDoor(target: [number, number]) {
  const corridor = STORE_REAR_DOOR.interiorCorridor.map((point) => [...point] as [number, number]);
  const rearDoorInside = corridor.at(-1)!;
  if (isRearStockroomPoint(target)) return compactPath(rearDoorInside, [target]);
  const reversed = corridor.slice(0, -1).reverse();
  const centralAisle = corridor[0];
  return compactPath(rearDoorInside, [
    ...reversed,
    ...customerPath(centralAisle, target),
  ]);
}

function safeFallbackPath(start: [number, number], target: [number, number]) {
  const [rearDoorInside, rearDoorOutside, farmGate] = FARM_ACCESS_WAYPOINTS.map((point) => [...point] as [number, number]);
  const startAtFarm = isRearFarmPoint(start);
  const targetAtFarm = isRearFarmPoint(target);
  if (startAtFarm === targetAtFarm) {
    if (startAtFarm) return compactPath(start, farmInteriorRouteBetween(start, target));
    const targetInsideStore = Math.abs(target[0]) < 11.13 && target[1] > -8.2 && target[1] < 7.55;
    if (isLegacyFarmServiceLanePoint(start) && targetInsideStore) {
      return compactPath(start, [
        [FARM_FIELD.serviceLaneX, rearDoorOutside[1]],
        rearDoorOutside,
        rearDoorInside,
        ...storeInteriorRouteFromRearDoor(target),
      ]);
    }
    const startsOutsideFront = start[1] > DOOR_OUTSIDE_WAIT_Z && Math.abs(start[0]) > 1.82;
    if (startsOutsideFront && targetInsideStore) {
      const insideDoor: [number, number] = [0, DOOR_INSIDE_WAIT_Z];
      return compactPath(start, [[0, DOOR_OUTSIDE_WAIT_Z], insideDoor, ...customerPath(insideDoor, target)]);
    }
    return customerPath(start, target);
  }

  if (targetAtFarm) {
    const path: [number, number][] = [];
    const startsInsideStore = Math.abs(start[0]) < 11.13 && start[1] > -8.2 && start[1] < 7.55;
    if (startsInsideStore) {
      path.push(...storeInteriorRouteToRearDoor(start), rearDoorOutside);
    } else if (isLegacyFarmServiceLanePoint(start)) {
      path.push([FARM_FIELD.serviceLaneX, rearDoorOutside[1]], rearDoorOutside);
    } else {
      path.push(rearDoorOutside);
    }
    path.push(farmGate, ...farmInteriorRouteFromEntrance(target));
    return compactPath(start, path);
  }

  return compactPath(start, [
    ...farmInteriorRouteToEntrance(start),
    rearDoorOutside,
    rearDoorInside,
    ...storeInteriorRouteFromRearDoor(target),
  ]);
}

function queuePosition(slot: number, lane = 0): [number, number] {
  return checkoutQueuePosition(slot, lane === 1 ? 1 : 0);
}

function queueArrivalPath(pathfinder: WorldPathfinder | undefined, start: [number, number], slot: number, lane = 0): [number, number][] {
  const [approach, destination] = checkoutQueueArrival(slot, lane === 1 ? 1 : 0);
  return compactPath(start, [
    ...navigatePath(pathfinder, start, [...approach]),
    [...destination],
  ]);
}

function compactPath(start: [number, number], path: [number, number][]) {
  let previous = start;
  return path.filter((point) => {
    const keep = Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 0.05;
    if (keep) previous = point;
    return keep;
  });
}

function deliverOrders(state: GameState) {
  const delivered = state.pendingOrders.filter((order) => order.arrivesAtMinute <= state.minuteOfDay);
  for (const order of delivered) {
    const franchise = state.franchises.find((item) => item.id === order.franchiseId);
    if (franchise) franchise.warehouse[order.productId] += order.quantity;
    recordDomain(state, "deliveries", 1);
  }
  state.pendingOrders = state.pendingOrders.filter((order) => order.arrivesAtMinute > state.minuteOfDay);
}

function gain(state: GameState, xp: number, missionKind: Mission["kind"], amount: number) {
  state.xp += xp;
  for (const mission of state.missions.filter((item) => item.kind === missionKind && !item.completed)) {
    mission.progress = Math.min(mission.target, mission.progress + amount);
    mission.completed = mission.progress >= mission.target;
  }
}

function normalizeLevel(state: GameState) {
  state.progression.objectiveComplete = levelObjectiveSatisfied(state.level, state);
  const franchise = currentFranchise(state);
  while (state.level < 30) {
    const project = franchise.buildProjects.find((candidate) => candidate.level === state.level + 1);
    if (!state.progression.objectiveComplete || !project?.completed) break;
    state.progression.completedLevels.push(state.level);
    state.level += 1;
    state.progression.lastUnlockAt = state.simulationTimeMs;
    for (const ownedFranchise of state.franchises.filter((candidate) => candidate.owned)) {
      applyLevelUnlock(state, ownedFranchise, state.level);
      ensureNextBuildProject(state, ownedFranchise);
    }
    state.progression.objectiveComplete = levelObjectiveSatisfied(state.level, state);
  }
}

type UpgradeTarget = {
  kind: "station" | "player-speed" | "player-capacity" | "employee" | "hire";
  id: string;
  label: string;
  currentTier: number;
};

function upgradeTarget(state: GameState, franchise: FranchiseState, upgrade: "station" | "player-speed" | "player-capacity" | "employee"): UpgradeTarget | null {
  if (upgrade === "station") {
    const entry = Object.entries(franchise.stationTiers).filter(([, tier]) => tier < 10).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
    return entry ? { kind: "station", id: entry[0], label: stationUpgradeLabel(franchise, entry[0]), currentTier: entry[1] } : null;
  }
  if (upgrade === "player-speed") return state.level >= 12 && franchise.playerSpeedTier < 10 ? { kind: "player-speed", id: "player-speed", label: "Velocidad del vendedor", currentTier: franchise.playerSpeedTier } : null;
  if (upgrade === "player-capacity") {
    const currentTier = carryCapacityTier(franchise.carry.capacity);
    return state.level >= 3 && currentTier < CAPACITY_TIERS.length
      ? { kind: "player-capacity", id: "player-capacity", label: "Capacidad de carga", currentTier }
      : null;
  }
  const roles = (Object.keys(ROLE_INFO) as Employee["role"][]).filter((role) => state.level >= ROLE_INFO[role].unlockLevel);
  const missing = roles.find((role) => !franchise.employees.some((employee) => employee.role === role));
  if (missing) return { kind: "hire", id: missing, label: `Contratación: ${ROLE_INFO[missing].name}`, currentTier: 0 };
  const employee = [...franchise.employees].filter((candidate) => candidate.level < 10).sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))[0];
  return employee ? { kind: "employee", id: employee.id, label: `Formación de ${employee.name}`, currentTier: employee.level } : null;
}

function stationUpgradeLabel(franchise: FranchiseState, stationId: string) {
  const fixedLabels: Record<string, string> = {
    "shelves-1": "Expositores de venta",
    "checkout-1": "Caja principal",
    "checkout-2": "Caja secundaria",
    "flour-mill-1": "Molino de harina",
    "bread-oven-1": "Horno de pan",
    "chicken-coop-1": "Gallinero",
    "cow-station-1": "Estación de leche",
    "cheese-maker-1": "Quesera",
    "juice-machine-1": "Máquina de zumo",
  };
  if (fixedLabels[stationId]) return fixedLabels[stationId];
  const crop = franchise.crops.find((candidate) => candidate.id === stationId);
  if (crop) return `Bancal de ${PRODUCTS[crop.productId].name.toLocaleLowerCase("es")}`;
  const machine = franchise.productionMachines.find((candidate) => candidate.id === stationId);
  if (machine) return `Estación de ${PRODUCTS[machine.productId].name.toLocaleLowerCase("es")}`;
  return "Estación prioritaria";
}

function upgradeCostMinor(state: GameState, tier: number, upgrade: "station" | "player-speed" | "player-capacity" | "employee") {
  const base = { station: 5_000, "player-speed": 7_500, "player-capacity": 6_500, employee: 8_000 }[upgrade];
  return Math.round(base * Math.max(1, tier) ** 1.55 * countryMoneyScale(state.countryCode));
}

export function upgradeQuote(state: GameState, upgrade: "station" | "player-speed" | "player-capacity" | "employee") {
  const franchise = currentFranchise(state);
  const target = upgradeTarget(state, franchise, upgrade);
  if (!target) return null;
  const costMinor = upgradeCostMinor(state, target.currentTier, upgrade);
  const key = `${upgrade}:${target.id}:${target.currentTier + 1}`;
  const contributedMinor = franchise.upgradeContributions[key] ?? 0;
  return {
    label: target.label,
    currentTier: target.currentTier,
    nextTier: Math.min(10, target.currentTier + 1),
    costMinor,
    contributedMinor,
    remainingMinor: Math.max(0, costMinor - contributedMinor),
  };
}

function applyUpgradeTarget(state: GameState, franchise: FranchiseState, target: UpgradeTarget) {
  const nextTier = Math.min(10, target.currentTier + 1);
  if (target.kind === "station") {
    franchise.stationTiers[target.id] = nextTier;
    const crop = franchise.crops.find((candidate) => candidate.id === target.id);
    if (crop) crop.tier = nextTier;
    const machine = franchise.productionMachines.find((candidate) => candidate.id === target.id);
    if (machine) {
      machine.tier = nextTier;
      machine.outputCapacity = Math.max(machine.output, Math.round((PRODUCT_CONFIG[machine.productId]?.shelfCapacity ?? 8) * stationTierModifiers(nextTier).capacity));
    }
    if (target.id === "checkout-1") franchise.checkoutLevel = nextTier;
    if (target.id === "shelves-1") franchise.shelvesLevel = nextTier;
    return;
  }
  if (target.kind === "player-speed") { franchise.playerSpeedTier = nextTier; return; }
  if (target.kind === "player-capacity") {
    const nextCapacity = CAPACITY_TIERS[target.currentTier];
    if (nextCapacity === undefined || nextCapacity <= franchise.carry.capacity) return;
    franchise.playerCapacityTier = target.currentTier + 1;
    franchise.carry.capacity = nextCapacity;
    return;
  }
  if (target.kind === "employee") {
    const employee = franchise.employees.find((candidate) => candidate.id === target.id);
    if (employee) employee.level = nextTier;
    return;
  }
  const role = target.id as Employee["role"];
  const index = franchise.employees.length;
  const { salaryMinor } = employeeHiringQuote(role, state.countryCode);
  franchise.employees.push({ id: crypto.randomUUID(), name: EMPLOYEE_NAMES[index % EMPLOYEE_NAMES.length], role, level: 1, salaryMinor, energy: 100, hat: HATS[index % HATS.length].id, runtime: createEmployeeRuntime(role, index, state.simulationTimeMs) });
}

function upgradeUnavailableMessage(upgrade: "station" | "player-speed" | "player-capacity" | "employee") {
  if (upgrade === "player-speed") return "La mejora de velocidad se desbloquea en nivel 12 o ya está al máximo.";
  if (upgrade === "player-capacity") return "La mejora de carga se desbloquea en nivel 3 o ya está al máximo.";
  if (upgrade === "employee") return "No hay nuevas contrataciones o formaciones disponibles.";
  return "Todas las estaciones disponibles ya están al máximo.";
}

function recordDomain(state: GameState, counter: string, amount: number) {
  state.progression.counters[counter] = (state.progression.counters[counter] ?? 0) + amount;
}

function counter(state: GameState, id: string) { return state.progression.counters[id] ?? 0; }

function levelObjectiveSatisfied(level: number, state: GameState) {
  const franchise = currentFranchise(state);
  switch (level) {
    case 1: return counter(state, "harvest:tomatoes") >= 3 && counter(state, "stock:tomatoes") >= 3 && counter(state, "customers") >= 1;
    case 2: return state.progression.completedLevels.includes(1);
    case 3: return counter(state, "customers") >= 4;
    case 4: return counter(state, "stock:all") >= 12;
    case 5: return counter(state, "harvest:wheat") >= 6;
    case 6: return counter(state, "sales:bread") >= 4;
    case 7: return counter(state, "customers") >= 12;
    case 8: return counter(state, "sales:eggs") >= 8;
    case 9: return averageShelfAvailability(franchise) >= 0.8;
    case 10: return counter(state, "sales:units") >= 20;
    case 11: return counter(state, "harvest:corn") >= 20;
    case 12: return counter(state, "distance:player") >= 500;
    case 13: return counter(state, "sales:milk") >= 12;
    case 14: return counter(state, "customers") >= 30;
    case 15: return counter(state, "transport:all") >= 40;
    case 16: return counter(state, "production:cheese") >= 10;
    case 17: return counter(state, "queue:under30") >= 1;
    case 18: return counter(state, "deliveries") >= 5;
    case 19: return counter(state, "orders") >= 8;
    case 20: return counter(state, "customers") >= 50;
    case 21: return counter(state, "sales:juice") >= 15;
    case 22: return counter(state, "harvest:all") >= 60;
    case 23: return franchise.rating >= 4.25;
    case 24: return counter(state, "stock:all") >= 100;
    case 25: return counter(state, "lists:five") >= 1;
    case 26: return counter(state, "production:all") >= 50;
    case 27: return counter(state, "sales:units") >= 150;
    case 28: return Object.values(franchise.stationTiers).every((tier) => tier >= 3);
    case 29: return counter(state, "availability:sales") >= 50;
    case 30: return true;
    default: return false;
  }
}

function averageShelfAvailability(franchise: FranchiseState) {
  const unlocked = unlockedCustomerProducts(Math.max(1, franchise.storeRank * 10));
  return unlocked.reduce((sum, productId) => sum + shelfFill(franchise, productId), 0) / Math.max(1, unlocked.length);
}

function applyLevelUnlock(state: GameState, franchise: FranchiseState, level: number) {
  const unlockArea = (id: string) => { if (!franchise.unlockedAreas.includes(id)) franchise.unlockedAreas.push(id); };
  if (level === 2) {
    if (!franchise.crops.some((crop) => crop.id === "crop-tomato-2")) franchise.crops.push(createCrop("crop-tomato-2", "tomatoes", state.simulationTimeMs, 1, level));
    franchise.stationTiers["crop-tomato-2"] ??= 1;
  }
  if (level === 3) {
    franchise.carry.capacity = Math.max(5, franchise.carry.capacity);
    franchise.playerCapacityTier = carryCapacityTier(franchise.carry.capacity);
  }
  if (level === 4) { unlockArea("farm-wheat"); unlockCrop(franchise, "crop-wheat-1", state.simulationTimeMs, level); franchise.stationTiers["crop-wheat-1"] ??= 1; }
  if (level === 5) { unlockArea("flour-mill"); unlockMachine(franchise, "flour-mill-1"); franchise.stationTiers["flour-mill-1"] ??= 1; }
  if (level === 6) { unlockArea("bread-oven"); unlockMachine(franchise, "bread-oven-1"); franchise.stationTiers["bread-oven-1"] ??= 1; }
  if (level === 7) { franchise.checkoutLevel = Math.max(2, franchise.checkoutLevel); franchise.stationTiers["checkout-1"] = Math.max(2, franchise.stationTiers["checkout-1"] ?? 1); }
  if (level === 8) { unlockArea("chicken-coop"); unlockMachine(franchise, "chicken-coop-1"); franchise.stationTiers["chicken-coop-1"] ??= 1; }
  if (level === 9) hireUnlockedEmployee(franchise, "stocker", state.countryCode, state.simulationTimeMs);
  if (level === 10) {
    franchise.storeRank = Math.max(2, franchise.storeRank);
    if (!franchise.unlockedAreas.includes("expansion-side")) franchise.structureRevision += 1;
    unlockArea("expansion-side");
  }
  if (level === 11) { unlockArea("farm-corn"); unlockCrop(franchise, "crop-corn-1", state.simulationTimeMs, level); franchise.stationTiers["crop-corn-1"] ??= 1; }
  if (level === 12) franchise.playerSpeedTier = Math.max(2, franchise.playerSpeedTier);
  if (level === 13) { unlockArea("cow-station"); unlockMachine(franchise, "cow-station-1"); franchise.stationTiers["cow-station-1"] ??= 1; }
  if (level === 14) hireUnlockedEmployee(franchise, "cashier", state.countryCode, state.simulationTimeMs);
  if (level === 15) {
    franchise.carry.capacity = Math.max(8, franchise.carry.capacity);
    franchise.playerCapacityTier = carryCapacityTier(franchise.carry.capacity);
  }
  if (level === 16) { unlockArea("cheese-maker"); unlockMachine(franchise, "cheese-maker-1"); franchise.stationTiers["cheese-maker-1"] ??= 1; }
  if (level === 17) { unlockArea("checkout-2"); franchise.stationTiers["checkout-2"] ??= 1; }
  if (level === 18) { unlockArea("stockroom-rack"); unlockArea("delivery-dock"); }
  if (level === 20) {
    franchise.storeRank = Math.max(3, franchise.storeRank);
    if (!franchise.unlockedAreas.includes("expansion-rear")) franchise.structureRevision += 1;
    unlockArea("expansion-rear");
  }
  if (level === 21) { unlockArea("juice-machine"); unlockMachine(franchise, "juice-machine-1"); franchise.stationTiers["juice-machine-1"] ??= 1; }
  if (level === 22) hireUnlockedEmployee(franchise, "farmer", state.countryCode, state.simulationTimeMs);
  if (level === 23) unlockArea("facade-premium");
  if (level === 24) {
    franchise.carry.capacity = Math.max(12, franchise.carry.capacity);
    franchise.playerCapacityTier = carryCapacityTier(franchise.carry.capacity);
    for (const id of Object.keys(franchise.stationTiers)) {
      franchise.stationTiers[id] = Math.max(3, franchise.stationTiers[id]);
      const crop = franchise.crops.find((candidate) => candidate.id === id); if (crop) crop.tier = Math.max(3, crop.tier);
      const machine = franchise.productionMachines.find((candidate) => candidate.id === id); if (machine) machine.tier = Math.max(3, machine.tier);
    }
    franchise.shelvesLevel = Math.max(3, franchise.shelvesLevel);
  }
  if (level === 26) hireUnlockedEmployee(franchise, "operator", state.countryCode, state.simulationTimeMs);
  if (level === 27) {
    if (!franchise.unlockedAreas.includes("expansion-third")) franchise.structureRevision += 1;
    unlockArea("expansion-third"); unlockArea("endcap-display");
  }
  if (level === 28) unlockArea("equipment-premium");
  if (level === 30) { franchise.storeRank = Math.max(4, franchise.storeRank); unlockArea("franchise-unlocked"); }
}

function synchronizeFranchiseProgression(state: GameState, franchise: FranchiseState) {
  for (let level = 2; level <= Math.min(30, state.level); level += 1) applyLevelUnlock(state, franchise, level);
  franchise.playerCapacityTier = carryCapacityTier(franchise.carry.capacity);
  ensureNextBuildProject(state, franchise);
}

function ensureNextBuildProject(state: GameState, franchise: FranchiseState) {
  if (state.level >= 30 || franchise.buildProjects.some((candidate) => candidate.level === state.level + 1)) return;
  franchise.buildProjects.push({
    id: `level-${state.level + 1}`,
    level: state.level + 1,
    costMinor: Math.round(LEVELS[state.level].costMinor * countryMoneyScale(state.countryCode)),
    contributedMinor: 0,
    completed: false,
  });
}

function unlockCrop(franchise: FranchiseState, id: string, now: number, gameLevel: number) {
  const crop = franchise.crops.find((candidate) => candidate.id === id);
  if (crop?.status === "LOCKED") Object.assign(crop, createCrop(crop.id, crop.productId, now, crop.tier, gameLevel));
}

function unlockMachine(franchise: FranchiseState, id: string) {
  const machine = franchise.productionMachines.find((candidate) => candidate.id === id);
  if (machine?.status === "LOCKED") machine.status = "WAITING_INPUT";
}

function hireUnlockedEmployee(franchise: FranchiseState, role: Employee["role"], countryCode: CountryCode, now: number) {
  if (franchise.employees.some((employee) => employee.role === role)) return;
  const index = franchise.employees.length;
  const { salaryMinor } = employeeHiringQuote(role, countryCode);
  franchise.employees.push({ id: `unlock-${role}-${index}`, name: EMPLOYEE_NAMES[index % EMPLOYEE_NAMES.length], role, level: 1, salaryMinor, energy: 100, hat: HATS[index % HATS.length].id, runtime: createEmployeeRuntime(role, index, now) });
}

function missionsForDay(day: number, moneyScale = 1): Mission[] {
  const scale = 1 + Math.floor(day / 3);
  return [
    { id: `d${day}-stock`, label: `Repón ${5 + scale * 2} productos`, kind: "stock", target: 5 + scale * 2, progress: 0, rewardMinor: Math.round(12000 * scale * moneyScale), completed: false, claimed: false },
    { id: `d${day}-customers`, label: `Atiende ${3 + scale} clientes`, kind: "customers", target: 3 + scale, progress: 0, rewardMinor: Math.round(16000 * scale * moneyScale), completed: false, claimed: false },
    { id: `d${day}-produce`, label: `Completa ${2 + scale} ciclos de producción`, kind: "production", target: 2 + scale, progress: 0, rewardMinor: Math.round(19000 * scale * moneyScale), completed: false, claimed: false },
  ];
}

export function formatMoney(amountMinor: number, state: Pick<GameState, "countryCode" | "currency">) {
  return new Intl.NumberFormat(COUNTRIES[state.countryCode].locale, { style: "currency", currency: state.currency, maximumFractionDigits: state.currency === "COP" || state.currency === "CLP" ? 0 : 2 }).format(amountMinor / 100);
}

export function countryMoneyScale(countryCode: CountryCode) {
  return COUNTRIES[countryCode].startingCapitalMinor / COUNTRIES.ES.startingCapitalMinor;
}

export function employeeHiringQuote(role: Employee["role"], countryCode: CountryCode) {
  const salaryMinor = Math.round(ROLE_INFO[role].salaryMinor * countryMoneyScale(countryCode));
  return { salaryMinor, signingCostMinor: salaryMinor * 2 };
}

function normalizeInventory(input: Partial<Inventory> | undefined): Inventory {
  const inventory = EMPTY_INVENTORY();
  for (const productId of Object.keys(inventory) as ProductId[]) inventory[productId] = Math.max(0, Math.floor(Number(input?.[productId] ?? 0)));
  return inventory;
}

function normalizeCarry(input: unknown, fallbackCapacity: number): CarryState {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? input as { capacity?: unknown; items?: Partial<Inventory>; item?: { productId?: ProductId; quantity?: unknown } | null }
    : {};
  const capacityValue = Number(raw.capacity);
  const capacity = Math.min(
    MAX_WAREHOUSE_PICKUP_BATCH,
    Number.isFinite(capacityValue) ? Math.max(1, Math.floor(capacityValue)) : fallbackCapacity,
  );
  const items: Partial<Inventory> = {};
  const validProducts = Object.keys(EMPTY_INVENTORY()) as ProductId[];

  for (const productId of validProducts) {
    const quantity = Math.max(0, Math.floor(Number(raw.items?.[productId] ?? 0)));
    if (quantity > 0) items[productId] = quantity;
  }

  if (!Object.keys(items).length && raw.item?.productId && validProducts.includes(raw.item.productId)) {
    const quantity = Math.max(0, Math.floor(Number(raw.item.quantity ?? 0)));
    if (quantity > 0) items[raw.item.productId] = quantity;
  }

  const normalized: CarryState = { capacity, items: {} };
  for (const productId of validProducts) {
    const quantity = Math.min(items[productId] ?? 0, capacity - carryTotal(normalized));
    if (quantity > 0) normalized.items[productId] = quantity;
  }
  return normalized;
}

function carryCapacityTier(capacity: number) {
  const safeCapacity = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : CAPACITY_TIERS[0];
  let tier = 1;
  for (let index = 1; index < CAPACITY_TIERS.length; index += 1) {
    if (safeCapacity < CAPACITY_TIERS[index]) break;
    tier = index + 1;
  }
  return tier;
}

const LEGACY_CLOCK_DRIFT_TOLERANCE_MS = 60_000;

function normalizeCropClock(crop: FranchiseState["crops"][number], simulationNow: number, wallNow: number, gameLevel: number) {
  if (crop.status !== "GROWING") return crop;
  const configuredDuration = cropGrowthDurationMs(crop.productId, crop.tier, gameLevel);
  const storedDuration = crop.readyAt - crop.plantedAt;
  const duration = Number.isFinite(storedDuration) && storedDuration > 0 ? storedDuration : configuredDuration;
  const clockDrift = crop.readyAt - simulationNow;
  if (clockDrift <= Math.max(LEGACY_CLOCK_DRIFT_TOLERANCE_MS, duration * 2)) return updateCrop(crop, simulationNow);

  const remaining = Math.min(duration, Math.max(0, crop.readyAt - wallNow));
  const readyAt = simulationNow + remaining;
  return updateCrop({ ...crop, plantedAt: readyAt - duration, readyAt }, simulationNow);
}

function normalizeMachineClock(machine: FranchiseState["productionMachines"][number], simulationNow: number, wallNow: number) {
  if (machine.status !== "PROCESSING" || machine.completesAt === null) return machine;
  const configuredDuration = (PRODUCT_CONFIG[machine.productId]?.cycleMs ?? 1_000) / stationTierModifiers(machine.tier).speed;
  const storedDuration = machine.startedAt === null ? configuredDuration : machine.completesAt - machine.startedAt;
  const duration = Number.isFinite(storedDuration) && storedDuration > 0 ? storedDuration : configuredDuration;
  const clockDrift = machine.completesAt - simulationNow;
  if (clockDrift <= Math.max(LEGACY_CLOCK_DRIFT_TOLERANCE_MS, duration * 2)) return updateMachine(machine, simulationNow);

  const remaining = Math.min(duration, Math.max(0, machine.completesAt - wallNow));
  const completesAt = simulationNow + remaining;
  return updateMachine({ ...machine, startedAt: completesAt - duration, completesAt }, simulationNow);
}

function stampEvents(state: GameState, events: GameEvent[]) {
  for (const event of events) {
    event.franchiseId ||= globalEventFranchiseId(state);
    event.eventId ??= crypto.randomUUID();
    event.sequence ??= ++state.eventSequence;
    event.occurredAt ??= new Date(state.lastServerTime).toISOString();
    event.type ??= event.category;
    event.payload ??= {};
    event.idempotencyKey ??= event.eventId;
    state.processedEventIds.push(event.eventId);
  }
  state.processedEventIds = state.processedEventIds.slice(-1_000);
}

function globalEventFranchiseId(state: Pick<GameState, "currentFranchiseId" | "franchises">) {
  return state.franchises.find((franchise) => franchise.id === state.currentFranchiseId)?.id
    ?? state.franchises.find((franchise) => franchise.owned)?.id
    ?? state.franchises[0]?.id
    ?? state.currentFranchiseId;
}

function operateMachine(
  state: GameState,
  franchise: FranchiseState,
  machineId: string,
  ingredient: ProductId,
  _events: GameEvent[],
  gainXp: typeof gain,
  success: (message: string) => ActionResult,
  fail: (message: string) => ActionResult,
) {
  const machineIndex = franchise.productionMachines.findIndex((machine) => machine.id === machineId);
  if (machineIndex < 0) return fail("La estación todavía no está construida.");
  let machine = updateMachine(franchise.productionMachines[machineIndex], state.simulationTimeMs);
  if (machine.output > 0) {
    const freeCapacity = Math.max(0, franchise.carry.capacity - carryTotal(franchise.carry));
    if (freeCapacity < 1) return fail("La cesta está llena.");
    const collected = collectMachineOutputBatch(machine, state.simulationTimeMs, freeCapacity);
    machine = collected.machine;
    franchise.productionMachines[machineIndex] = machine;
    franchise.carry = addToCarry(franchise.carry, machine.productId, collected.collected, collected.collected).container;
    return success(`Recogiste ${collected.collected} × ${PRODUCTS[machine.productId].name.toLowerCase()} terminado.`);
  }
  const carried = carryQuantity(franchise.carry, ingredient);
  const temporary = EMPTY_INVENTORY();
  temporary[ingredient] = carried;
  const loaded = loadMachine(machine, temporary, state.simulationTimeMs);
  if (!loaded.loaded) return fail(`Faltan ingredientes para ${PRODUCTS[machine.productId].name.toLowerCase()}.`);
  const consumed = carried - loaded.inventory[ingredient];
  franchise.carry = removeFromCarry(franchise.carry, ingredient, consumed).container;
  franchise.productionMachines[machineIndex] = loaded.machine;
  recordDomain(state, `production:${loaded.machine.productId}`, 1);
  recordDomain(state, "production:all", 1);
  gainXp(state, 24, "production", 1);
  return success(`${PRODUCTS[machine.productId].name} en proceso.`);
}

/**
 * Reports whether one proximity pulse can make a real machine transition.
 * The scene uses this pure guard before queueing an authoritative action, so
 * standing beside an empty, busy or blocked station cannot create a stream of
 * failed interactions and repeated feedback.
 */
export function canOperateMachine(
  franchise: Pick<FranchiseState, "productionMachines" | "carry">,
  machineId: string,
  nowMs: number,
) {
  const source = franchise.productionMachines.find((candidate) => candidate.id === machineId);
  if (!source || source.status === "LOCKED") return false;
  const machine = updateMachine(source, nowMs);
  if (machine.output > 0) return carryTotal(franchise.carry) < franchise.carry.capacity;
  if ((machine.status !== "IDLE" && machine.status !== "WAITING_INPUT") || machine.output >= machine.outputCapacity) return false;
  const recipe = PRODUCT_CONFIG[machine.productId]?.recipe ?? {};
  const ingredients = Object.entries(recipe) as [ProductId, number][];
  // Egg and milk stations begin their own timer in advanceWorld. Their player
  // action is collection-only, so an empty WAITING_INPUT state is not yet an
  // actionable pulse even though its recipe is intentionally empty.
  return ingredients.length > 0
    && ingredients.every(([productId, quantity]) => carryQuantity(franchise.carry, productId) >= quantity);
}

/** True only for the instant in which a manual checkout pulse can scan a unit. */
export function canProcessCheckoutUnit(
  state: Pick<GameState, "simulationTimeMs">,
  franchise: Pick<FranchiseState, "checkoutTransactions" | "stationTiers" | "checkoutLevel" | "shelvesLevel">,
) {
  const transaction = franchise.checkoutTransactions.find((candidate) => candidate.state !== "COMPLETE" && candidate.state !== "ABANDONED");
  if (!transaction) return false;
  const totals = checkoutUnitTotals(transaction);
  if (totals.loaded < totals.total) return false;
  if (state.simulationTimeMs - transaction.lastScannedAt < checkoutScanInterval(franchise, transaction)) return false;
  return transaction.pendingItems.some((line) => line.scanned < line.loaded);
}
