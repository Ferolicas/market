import { COUNTRIES, EMPLOYEE_NAMES, FRANCHISE_TEMPLATES, HATS, PRODUCTS, ROLE_INFO, SUPPLIERS } from "./catalog";
import { campaignExpansionQuote } from "./progression/CampaignExpansion";
import { campaignCustomerLimit, campaignShoppingList } from "./progression/CampaignLocations";
import { campaignContracts } from "./progression/CampaignContracts";
import type { ActionResult, AvatarConfig, CarryState, CheckoutTransaction, CountryCode, CustomerRuntimeState, Employee, EmployeeRuntimeState, FranchiseState, GameAction, GameEvent, GameState, Inventory, Mission, ProductId, WorldInteractionAction } from "./types";
import { CAMPAIGN_BED_YIELD, chickenFeedStatus, collectMachineOutputBatch, createCrop, createEmptyCrop, createMachine, cropGrowthDurationMs, harvestCropBatch, loadMachine, machineInputRoom, machineQueuedCycles, plantCrop, updateCrop, updateMachine } from "./stations/StationSystem";
import { animalProduction } from "./stations/FedAnimal";
import { contributePurchase, createPurchaseState, purchaseQuote } from "./progression/PurchaseState";
import { campaignGlobalLevel, campaignEmployeeLimit, campaignLevel, campaignPriceMultiplier } from "./progression/CampaignLevels";
import { cashierTillModifiers, employeeCarryCapacity, employeeWalkSpeed } from "./progression/EmployeeStats";
import { addCampaignTaskProgress, CAMPAIGN_TASK_IDS, campaignTaskStatus, type CampaignTaskProgress } from "./progression/CampaignTasks";
import { campaignAvailableProducts, OPENING_PURCHASES, type OpeningPurchaseId } from "./progression/MartCampaign";
import { rosterBaseTier, rosterEntries, rosterPlayerBase, type RosterEntry } from "./progression/RosterUpgrades";
import { PRODUCT_CONFIG } from "./economy/products";
import { createEmptyInventory } from "./economy/ProductRegistry";
import { createCustomerMind, MAX_SHOPPING_LINES, MAX_SHOPPING_LINE_UNITS } from "./ai/CustomerBrain";
import { campaignNeedsCustomer, customerWalkSpeed } from "./ai/CustomerTraffic";
import { CUSTOMER_PATIENCE_MS, customerShowingAnger } from "./ai/CustomerPatience";
import { LEVELS, stationTierModifiers } from "./progression/levels";
import { averageShelfAvailability, levelObjectiveSatisfied, levelObjectiveTasks, unlockedCustomerProducts } from "./progression/objectives";
import { CHECKOUT_LANES, checkoutQueueArrival, checkoutQueuePosition, type CheckoutLane } from "./stations/checkout-layout";
import { pantryEntranceRowBand, retailServicePoint, retailShelfCapacityForTier } from "./stations/retail-layout";
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
import { storefrontDoorActorPresent, STORE_REAR_DOOR, STOREFRONT_LAYOUT } from "./stations/storefront-layout";
import { PRODUCTION_MACHINE_POINTS } from "./stations/production-layout";
import { STOCKROOM_POINT, WAREHOUSE_RETURN_STATION } from "./stations/warehouse-layout";
import { STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE, storeSegmentIsClear } from "./world-scale";
import { BUSINESS_DAY_NIGHT_MINUTE, BUSINESS_DAY_OPEN_MINUTE, businessDayIsClosing, businessMinutesForRealMs } from "./time/BusinessDay";

const EMPTY_INVENTORY = createEmptyInventory;
export const CHECKOUT_PATIENCE_MS = CUSTOMER_PATIENCE_MS;
export const CHECKOUT_LOAD_UNIT_MS = 900;
export const CHECKOUT_SCAN_UNIT_MS = 700;
export const CHECKOUT_BAG_UNIT_MS = 650;
export const CHECKOUT_PAYMENT_MS = 1_800;
export const CHECKOUT_BAG_HANDOFF_MS = 900;
export { levelObjectiveTasks, unlockedCustomerProducts };
const DOOR_PASSAGE_Z = STOREFRONT_LAYOUT.z;
const DOOR_OUTSIDE_WAIT_Z = 8.35;
const DOOR_INSIDE_WAIT_Z = 7.25;
const DOOR_PASSAGE_HALF_WIDTH = STOREFRONT_LAYOUT.door.outerPostX;
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
    crops: [createCrop("crop-tomato-1", "tomatoes", 0, 1, 1), { ...createEmptyCrop("crop-apple-1", "apples"), status: "LOCKED" }, { ...createEmptyCrop("crop-wheat-1", "wheat"), status: "LOCKED" }, { ...createEmptyCrop("crop-corn-1", "corn"), status: "LOCKED" }, { ...createEmptyCrop("crop-orange-1", "oranges"), status: "LOCKED" }],
    productionMachines: [{ ...createMachine("flour-mill-1", "flour"), status: "LOCKED" }, { ...createMachine("bread-oven-1", "bread"), status: "LOCKED" }, { ...createMachine("cheese-maker-1", "cheese"), status: "LOCKED" }, { ...createMachine("juice-machine-1", "juice"), status: "LOCKED" }, { ...createMachine("chicken-coop-1", "eggs"), status: "LOCKED" }, { ...createMachine("cow-station-1", "milk"), status: "LOCKED" }],
    buildProjects: [{ id: "level-2", level: 2, costMinor: Math.round(LEVELS[1].costMinor * moneyScale), contributedMinor: 0, completed: false }],
    checkoutTransactions: [],
    registerCashMinor: [0, 0],
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
    minuteOfDay: BUSINESS_DAY_OPEN_MINUTE,
    currentFranchiseId: franchises[0].id,
    avatar: { ...DEFAULT_AVATAR },
    franchises,
    missions: missionsForDay(1, moneyScale, 1),
    pendingOrders: [],
    finances: { grossRevenueMinor: 0, costOfGoodsMinor: 0, payrollMinor: 0, operatingCostsMinor: 0, taxesMinor: 0, netProfitMinor: 0 },
    tutorialStep: 0,
    progression: { completedLevels: [], counters: {}, levelStartedCounters: {}, playerActionCount: 0, levelStartedPlayerActionCount: 0, objectiveComplete: false, lastUnlockAt: 0 },
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
  state.progression ??= { completedLevels: [], counters: {}, levelStartedCounters: {}, playerActionCount: 0, levelStartedPlayerActionCount: 0, objectiveComplete: false, lastUnlockAt: 0 };
  state.progression.counters ??= {};
  state.progression.levelStartedCounters ??= {};
  state.progression.playerActionCount = Number.isFinite(state.progression.playerActionCount) ? Math.max(0, Math.floor(state.progression.playerActionCount)) : 0;
  state.progression.levelStartedPlayerActionCount = Number.isFinite(state.progression.levelStartedPlayerActionCount)
    ? Math.min(state.progression.playerActionCount, Math.max(0, Math.floor(state.progression.levelStartedPlayerActionCount)))
    : 0;
  const validEmployeeHats = new Set<string>(HATS.map((hat) => hat.id));
  if (state.avatar.hat !== "none" && !validEmployeeHats.has(String(state.avatar.hat))) state.avatar.hat = "none";
  for (const franchise of state.franchises ?? []) {
    const franchiseTemplate = FRANCHISE_TEMPLATES.find((template) => template.id === franchise.id);
    if (franchiseTemplate) franchise.unlockLevel = franchiseTemplate.unlockLevel;
    franchise.warehouse = normalizeInventory(franchise.warehouse);
    franchise.shelves = normalizeInventory(franchise.shelves);
    franchise.carry = normalizeCarry(franchise.carry, 3);
    franchise.crops ??= [createCrop("crop-tomato-1", "tomatoes", state.simulationTimeMs, 1, state.level), { ...createEmptyCrop("crop-wheat-1", "wheat"), status: "LOCKED" }, { ...createEmptyCrop("crop-corn-1", "corn"), status: "LOCKED" }, { ...createEmptyCrop("crop-orange-1", "oranges"), status: "LOCKED" }];
    if (!franchise.crops.some((crop) => crop.id === "crop-orange-1")) franchise.crops.push({ ...createEmptyCrop("crop-orange-1", "oranges"), status: "LOCKED" });
    // Saves older than the orchard: apples grow from the level that makes
    // customers ask for them, so an advanced store gets a growing tree at once.
    if (!franchise.crops.some((crop) => crop.id === "crop-apple-1")) {
      franchise.crops.splice(1, 0, state.level >= 2
        ? createCrop("crop-apple-1", "apples", state.simulationTimeMs, 1, state.level)
        : { ...createEmptyCrop("crop-apple-1", "apples"), status: "LOCKED" });
      if (state.level >= 2) franchise.stationTiers["crop-apple-1"] ??= 1;
    }
    franchise.crops = franchise.crops.map((crop) => crop.status === "EMPTY"
      ? createCrop(crop.id, crop.productId, state.simulationTimeMs, crop.tier, state.level, crop.baseYield)
      : normalizeCropClock(crop, state.simulationTimeMs, state.lastServerTime, state.level));
    franchise.productionMachines ??= [createMachine("flour-mill-1", "flour"), createMachine("bread-oven-1", "bread"), createMachine("cheese-maker-1", "cheese"), createMachine("juice-machine-1", "juice")];
    if (!franchise.productionMachines.some((machine) => machine.id === "chicken-coop-1")) franchise.productionMachines.push({ ...createMachine("chicken-coop-1", "eggs"), status: state.level >= 8 ? "WAITING_INPUT" : "LOCKED" });
    if (!franchise.productionMachines.some((machine) => machine.id === "cow-station-1")) franchise.productionMachines.push({ ...createMachine("cow-station-1", "milk"), status: state.level >= 13 ? "WAITING_INPUT" : "LOCKED" });
    franchise.productionMachines = franchise.productionMachines.map((machine) => normalizeMachineClock(machine, state.simulationTimeMs, state.lastServerTime));
    franchise.buildProjects ??= [];
    franchise.buildProjects = franchise.buildProjects
      .filter((project) => Number.isInteger(project.level) && project.level >= 2 && project.level <= 30)
      .map((project) => normalizeBuildProject(project, state.countryCode));
    ensureNextBuildProject(state as GameState, franchise);
    franchise.checkoutTransactions ??= [];
    // Historical sales already credited the wallet: never credit them again.
    franchise.registerCashMinor ??= [0, 0];
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
      customer.speed = customerWalkSpeed(customer.identity);
      customer.checkoutPatienceMs = CHECKOUT_PATIENCE_MS;
      customer.patienceMs = CUSTOMER_PATIENCE_MS;
      customer.hasCart ??= !["SPAWN", "ENTER_STORE", "GET_CART", "EXIT_STORE", "DESPAWN"].includes(customer.state);
      customer.hasBag ??= ["TAKE_BAG", "NAVIGATE_TO_CART_RETURN", "RETURN_CART", "EXIT_STORE"].includes(customer.state);
      customer.angry ??= false;
      // Baskets written by an older shopper generator can exceed the save
      // schema (five lines of three units); trim them so the save is accepted.
      customer.shoppingList = customer.shoppingList.slice(0, MAX_SHOPPING_LINES).map((line) => {
        const requested = Math.max(0, Math.min(MAX_SHOPPING_LINE_UNITS, Math.floor(Number.isFinite(line.requested) ? line.requested : 0)));
        return { ...line, requested, picked: Math.max(0, Math.min(requested, Math.floor(Number.isFinite(line.picked) ? line.picked : 0))) };
      });
      customer.currentLine = Math.max(0, Math.min(customer.currentLine, customer.shoppingList.length));
    });
    franchise.checkoutTransactions.forEach((transaction) => {
      transaction.checkoutLane ??= 0;
      transaction.lastLoadedAt ??= transaction.updatedAt;
      transaction.lastScannedAt ??= transaction.updatedAt;
      transaction.lastBaggedAt ??= transaction.updatedAt;
      transaction.pendingItems = transaction.pendingItems.slice(0, MAX_SHOPPING_LINES);
      transaction.pendingItems.forEach((line) => {
        line.quantity = Math.max(1, Math.min(MAX_SHOPPING_LINE_UNITS, Math.floor(Number.isFinite(line.quantity) ? line.quantity : 1)));
        line.loaded ??= line.quantity;
        line.bagged ??= transaction.state === "BAGGING" || transaction.state === "PAYMENT" || transaction.state === "COMPLETE" ? line.scanned : 0;
        line.loaded = Math.min(line.loaded, line.quantity);
        line.scanned = Math.min(line.scanned, line.quantity);
        line.bagged = Math.min(line.bagged, line.quantity);
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
    ensureSecondCheckoutForCashiers(franchise);
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
    if (franchise.owned && !franchise.purchases) synchronizeFranchiseProgression(state as GameState, franchise);
  }
  // A restored campaign must already show the staff its levels granted, before
  // any tick runs: the level reward is state, not a live-session side effect.
  if (state.franchises.some((franchise) => franchise.owned && franchise.purchases)) {
    for (const franchise of state.franchises) {
      sanitizeCampaignPurchases(franchise);
      syncCampaignStaff(state as GameState, franchise);
      trimCampaignStaff(franchise);
      for (const crop of franchise.crops) crop.baseYield ??= CAMPAIGN_BED_YIELD;
    }
    syncCampaignProgression(state as GameState);
  }
  state.missions = reconcileMissionsForCurrentLevel(state as GameState);
  return state as GameState;
}

/**
 * The campaign level and its ladder are derived from the purchases, never
 * stored authority. Loading and ticking must both derive them: a save whose
 * purchases lost a level (a retired purchase) keeps `completedLevels` one
 * step too long otherwise, and the first tick then shortens it, which the
 * server reads as progress moving backwards and rejects every save.
 */
function syncCampaignProgression(state: GameState) {
  state.level = campaignGlobalLevel(state);
  state.progression.completedLevels = Array.from({ length: state.level - 1 }, (_, index) => index + 1);
  state.progression.objectiveComplete = state.level === 30;
}

/** New campaign constructor. Production enrollment switches only after scene QA. */
export function createCampaignGame(countryCode: CountryCode = "ES"): GameState {
  const state = createInitialGame(countryCode);
  state.balanceMinor = 0;
  state.missions = [];
  for (const franchise of state.franchises) {
    franchise.shelves = EMPTY_INVENTORY();
    franchise.buildProjects = [];
    franchise.purchases = createPurchaseState();
    franchise.unlockedAreas.push("purchase-campaign");
    for (const crop of franchise.crops) crop.baseYield = CAMPAIGN_BED_YIELD;
  }
  return state;
}

export function campaignPurchaseQuotes(state: GameState) {
  const franchise = currentFranchise(state);
  const purchases = franchise.purchases;
  if (!purchases) return [];
  return OPENING_PURCHASES.map((purchase) => purchaseQuote(purchases, purchase.id, state.countryCode));
}

/** Campaign economy is scoped to the save, not the currently visited store. */
export function isCampaignGame(state: GameState): boolean {
  return state.franchises.some((franchise) => franchise.owned && Boolean(franchise.purchases));
}

export function campaignPersonalTasks(state: GameState) {
  const purchases = currentFranchise(state).purchases;
  if (!purchases) return [];
  const available = campaignAvailableProducts(purchases);
  return CAMPAIGN_TASK_IDS.filter((id) => {
    const source = id === "player:feed:chicken" ? "eggs" : id === "player:feed:cow" ? "milk" : id.split(":").at(-1) as ProductId;
    return available.includes(source);
  }).map((id) => campaignTaskStatus(id, purchases.personalProgress, currentFranchise(state).id));
}

export function canOrderProduct(state: GameState, productId: ProductId) {
  const franchise = currentFranchise(state);
  if (franchise.purchases) return campaignAvailableProducts(franchise.purchases).includes(productId);
  if (productId === "cannedCorn") return false;
  const supplier = SUPPLIERS.find((candidate) => candidate.id === PRODUCTS[productId].supplier);
  return Boolean(supplier && supplier.unlockLevel <= state.level);
}

/**
 * A save written before the campaign was reordered can name purchases that no
 * longer exist (the cashier used to be one; that desk is now a level reward).
 * Both the save schema and the server's transition check reject an unknown
 * id, so a stale entry would make every future save fail: drop it here, on
 * load, instead.
 */
function sanitizeCampaignPurchases(franchise: FranchiseState) {
  const purchases = franchise.purchases;
  if (!purchases) return;
  const known = new Set<string>(OPENING_PURCHASES.map((purchase) => purchase.id));
  purchases.purchased = purchases.purchased.filter((id) => known.has(id));
  purchases.inherited = (purchases.inherited ?? []).filter((id) => known.has(id));
  purchases.contributions = Object.fromEntries(
    Object.entries(purchases.contributions ?? {}).filter(([id]) => known.has(id)),
  ) as typeof purchases.contributions;
}

/** Desks the current rules no longer open (staff of a retired role, more
 * cashiers than the level grants) are retired on load, so the state the
 * client sends can pass the server's quota check. */
function trimCampaignStaff(franchise: FranchiseState) {
  if (!franchise.purchases) return;
  const kept: Employee[] = [];
  const countByRole = new Map<Employee["role"], number>();
  for (const employee of franchise.employees) {
    const count = countByRole.get(employee.role) ?? 0;
    if (count >= campaignEmployeeLimit(franchise, employee.role)) continue;
    countByRole.set(employee.role, count + 1);
    kept.push(employee);
  }
  if (kept.length !== franchise.employees.length) franchise.employees = kept;
}

/** Campaign staff is granted, never bought: a purchase or a level reward adds
 * the desk and this fills it exactly once, idempotently, on every tick. */
function hireCampaignStaff(state: GameState, franchise: FranchiseState, role: Employee["role"], count: number) {
  while (franchise.employees.filter((employee) => employee.role === role).length < count) {
    const index = franchise.employees.length;
    franchise.employees.push({ id: `campaign-${role}-${count}-${index}`, role, name: EMPLOYEE_NAMES[index % EMPLOYEE_NAMES.length], level: 1,
      salaryMinor: employeeHiringQuote(role, state.countryCode).salaryMinor, energy: 100, hat: HATS[index % HATS.length].id,
      runtime: createEmployeeRuntime(role, index, state.simulationTimeMs) });
  }
}

/** Every desk the purchases and the level rewards open is filled here, on
 * load and on every tick, so a save that predates a grant (the operator the
 * mill was supposed to bring, a cashier level) gets its staff without a new
 * purchase. Cashiers arrive at levels 5, 10 and 20 and only serve the till. */
const CAMPAIGN_GRANTED_ROLES: readonly Employee["role"][] = ["cashier", "farmer", "feeder", "operator"];

function syncCampaignStaff(state: GameState, franchise: FranchiseState) {
  if (!franchise.purchases || !franchise.owned) return;
  for (const role of CAMPAIGN_GRANTED_ROLES) {
    const slots = campaignEmployeeLimit(franchise, role);
    if (slots) hireCampaignStaff(state, franchise, role, slots);
  }
  ensureSecondCheckoutForCashiers(franchise);
}

function applyPurchaseContent(state: GameState, franchise: FranchiseState, id: OpeningPurchaseId) {
  const area = (name: string) => { if (!franchise.unlockedAreas.includes(name)) franchise.unlockedAreas.push(name); };
  const crop = (station: string, product: FranchiseState["crops"][number]["productId"], zone: string) => {
    area(zone);
    if (!franchise.crops.some((candidate) => candidate.id === station)) franchise.crops.push(createCrop(station, product, state.simulationTimeMs));
    unlockCrop(franchise, station, state.simulationTimeMs, 1);
    // Every campaign bed has the same authored yield, so its tier steps and
    // the LISTOS sign have a defined capacity to grow from.
    franchise.crops.find((candidate) => candidate.id === station)!.baseYield = CAMPAIGN_BED_YIELD;
    franchise.stationTiers[station] ??= 1;
  };
  const machine = (station: string, product: FranchiseState["productionMachines"][number]["productId"], zone: string) => {
    area(zone);
    if (!franchise.productionMachines.some((candidate) => candidate.id === station)) franchise.productionMachines.push(createMachine(station, product));
    unlockMachine(franchise, station);
    franchise.stationTiers[station] ??= 1;
  };
  const hire = (role: Employee["role"], count: number) => hireCampaignStaff(state, franchise, role, count);
  switch (id) {
    case "farmer-1": hire("farmer", 1); break;
    case "farmer-2": hire("farmer", 2); break;
    case "farmer-3": hire("farmer", 3); break;
    case "player-2": franchise.carry.capacity = Math.max(4, franchise.carry.capacity); franchise.playerSpeedTier = Math.max(2, franchise.playerSpeedTier); break;
    case "egg-display-1": area("egg-display"); break;
    case "dairy-display-1": area("dairy-display"); break;
    case "expansion-1": area("expansion-side"); franchise.expansionLevel = Math.max(2, franchise.expansionLevel); franchise.storeRank = Math.max(2, franchise.storeRank); break;
    case "tomato-2": crop("crop-tomato-2", "tomatoes", "farm-tomato-2"); break;
    case "tomato-3": crop("crop-tomato-3", "tomatoes", "farm-tomato-3"); break;
    case "wheat-1": crop("crop-wheat-1", "wheat", "farm-wheat"); break;
    case "apple-1": crop("crop-apple-1", "apples", "farm-apple"); break;
    case "corn-1": crop("crop-corn-1", "corn", "farm-corn"); break;
    case "orange-1": crop("crop-orange-1", "oranges", "farm-orange"); break;
    case "coffee-supply-1": area("coffee-supply"); break;
    case "preserves-supply-1": area("preserves-supply"); break;
    case "corn-canner-1": machine(id, "cannedCorn", "corn-canner"); break;
    // The mill and the dairy each bring the operator who feeds the machines
    // from the warehouse and carries their output back; farmers only farm.
    case "flour-mill-1": machine(id, "flour", "flour-mill"); hire("operator", 1); break;
    case "bread-oven-1": machine(id, "bread", "bread-oven"); break;
    case "cheese-maker-1": machine(id, "cheese", "cheese-maker"); hire("operator", 2); break;
    case "juice-machine-1": machine(id, "juice", "juice-machine"); break;
    case "chicken-1": machine("chicken-coop-1", "eggs", "chicken-coop"); break;
    case "chicken-2": machine("chicken-coop-2", "eggs", "chicken-coop-2"); break;
    // The dairy opens the dedicated animal feeder desk alongside the cow.
    case "cow-1": machine("cow-station-1", "milk", "cow-station"); hire("feeder", 1); break;
    default: {
      const station = id.startsWith("cow") ? "cow-station-1" : "chicken-coop-1";
      const target = franchise.productionMachines.find((candidate) => candidate.id === station);
      const tier = id.endsWith("-3") ? 3 : 2;
      if (target) target.tier = Math.max(target.tier, tier);
      franchise.stationTiers[station] = Math.max(franchise.stationTiers[station] ?? 1, tier);
    }
  }
  franchise.structureRevision += 1;
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
  const countersBeforeAction = { ...state.progression.counters };
  const franchise = currentFranchise(state);
  const fail = (message: string): ActionResult => ({ state: input, ok: false, message, events: [] });
  const success = (message: string): ActionResult => {
    if (COUNTS_AS_PLAYER_PROGRESS.has(action.type)) attributePlayerAction(state, action, countersBeforeAction);
    if (franchise.purchases) {
      const before = franchise.purchases.personalProgress ?? {};
      const deltas: CampaignTaskProgress = {};
      for (const id of CAMPAIGN_TASK_IDS) {
        const delta = (state.progression.counters[id] ?? 0) - (countersBeforeAction[id] ?? 0);
        if (delta > 0) deltas[id] = delta;
      }
      const after = addCampaignTaskProgress(before, deltas, franchise.id);
      const applied: CampaignTaskProgress = {};
      for (const id of CAMPAIGN_TASK_IDS) if ((after[id] ?? 0) > (before[id] ?? 0)) applied[id] = after[id]! - (before[id] ?? 0);
      if (Object.keys(applied).length) {
        franchise.purchases.personalProgress = after;
        events.push({ franchiseId: franchise.id, category: "player_progress", description: "Trabajo personal en la campaña", amountMinor: 0, payload: { deltas: applied } });
      }
    }
    if (finalize) {
      if (COUNTS_AS_PLAYER_PROGRESS.has(action.type)) state.progression.playerActionCount += 1;
      state.revision += 1;
      normalizeLevel(state);
      stampEvents(state, events);
    }
    return { state, ok: true, message, events };
  };

  switch (action.type) {
    case "DELIVER_CONTRACT": {
      const contract = campaignContracts(franchise).find((item) => item.id === action.contractId);
      if (!franchise.owned || !franchise.purchases || !contract) return fail("Este encargo no pertenece a tu local.");
      if (contract.completed) return fail("Ya entregaste este encargo.");
      if (!contract.previousDone) return fail("Completa primero el encargo anterior.");
      if (!contract.unlocked) return fail("Desbloquea todos los productos del encargo.");
      if (!contract.ready) return fail("Reúne una unidad de cada producto en tu cesta personal.");
      for (const product of contract.products) franchise.carry = removeFromCarry(franchise.carry, product, 1).container;
      franchise.purchases.completedContracts = [...(franchise.purchases.completedContracts ?? []), contract.id];
      events.push({ franchiseId: franchise.id, category: "contract_delivery", description: contract.label, amountMinor: 0, payload: { contractId: contract.id, products: [...contract.products] } });
      return success(`Entregado: ${contract.label}. Encargo personal completado.`);
    }
    case "CONTRIBUTE_PURCHASE": {
      const purchases = franchise.purchases;
      if (!purchases) return fail("La nueva campaña empieza desde nivel 1; no se transfieren compras de la partida anterior.");
      const pendingTasks = purchaseQuote(purchases, action.purchaseId, state.countryCode).tasks.filter((task) => !task.completed);
      if (pendingTasks.length) return fail(`Falta trabajo personal: ${pendingTasks[0].label} (${pendingTasks[0].progress}/${pendingTasks[0].target}).`);
      const result = contributePurchase(purchases, action.purchaseId, state.countryCode, state.balanceMinor,
        action.amountMinor ?? Math.round(500 * countryMoneyScale(state.countryCode)));
      if (!result.spentMinor) return fail("Compra no disponible o sin dinero recogido para aportar.");
      franchise.purchases = result.state;
      if (!franchise.unlockedAreas.includes("purchase-campaign")) franchise.unlockedAreas.push("purchase-campaign");
      state.balanceMinor -= result.spentMinor;
      franchise.expensesTodayMinor += result.spentMinor;
      if (result.completedNow) applyPurchaseContent(state, franchise, action.purchaseId);
      const quote = purchaseQuote(result.state, action.purchaseId, state.countryCode);
      events.push({ franchiseId: franchise.id, category: "purchase", description: `Aporte: ${quote.label}`, amountMinor: -result.spentMinor,
        payload: { purchaseId: action.purchaseId, contributedMinor: quote.contributedMinor, completed: result.completedNow } });
      return success(result.completedNow ? `${quote.label}: desbloqueado.` : `${quote.label}: faltan ${formatMoney(quote.remainingMinor!, state)}.`);
    }
    case "COLLECT_REGISTER": {
      if (action.lane !== 0 && action.lane !== 1) return fail("Caja desconocida.");
      const amountMinor = franchise.registerCashMinor[action.lane];
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return fail("No hay dinero pendiente en esta caja.");
      if (!Number.isSafeInteger(state.balanceMinor + amountMinor)) return fail("No se puede recoger este importe.");
      franchise.registerCashMinor[action.lane] = 0;
      state.balanceMinor += amountMinor;
      recordDomain(state, "player:collect-register", 1);
      events.push({ franchiseId: franchise.id, category: "cash_collection", description: `Recogida de caja ${action.lane + 1}`, amountMinor: 0, payload: { lane: action.lane, collectedMinor: amountMinor } });
      return success("Dinero de la caja recogido.");
    }
    case "SET_COUNTRY": {
      if (state.countryCode !== action.countryCode && state.franchises.some((item) => item.purchases && (item.purchases.purchased.length > 0 || Object.keys(item.purchases.contributions).length > 0))) return fail("El país queda fijado al realizar la primera compra.");
      if (state.day > 1 || state.finances.grossRevenueMinor > 0) return fail("El país fiscal queda fijado al iniciar la empresa.");
      const balanceBefore = state.balanceMinor;
      const oldStart = COUNTRIES[state.countryCode].startingCapitalMinor;
      const country = COUNTRIES[action.countryCode];
      const ratio = country.startingCapitalMinor / oldStart;
      state.countryCode = country.code;
      state.currency = country.currency;
      state.balanceMinor = Math.round(state.balanceMinor * ratio);
      state.franchises.forEach((item) => {
        item.purchaseCostMinor = Math.round(item.purchaseCostMinor * ratio);
        item.buildProjects = item.buildProjects.map((project) => ({
          ...project,
          costMinor: Math.round(project.costMinor * ratio),
          contributedMinor: Math.round(project.contributedMinor * ratio),
        }));
      });
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
      if (!franchise.purchases && !franchise.licenseActive) return fail("Necesitas una licencia comercial activa.");
      if (franchise.open) return success(beginBusinessDayClosure(state, events));
      if (businessDayIsClosing(state.minuteOfDay)) return fail("La jornada está cerrando; primero deben salir los últimos clientes.");
      franchise.open = true;
      franchise.lightsOn = true;
      return success("Tienda abierta: ¡a trabajar!");
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
      return operateMachine(state, franchise, "flour-mill-1", "wheat", success, fail);
    case "BAKE_BREAD":
      return operateMachine(state, franchise, "bread-oven-1", "flour", success, fail);
    case "OPERATE_MACHINE": {
      const machine = franchise.productionMachines.find((candidate) => candidate.id === action.machineId);
      if (!machine || machine.status === "LOCKED") return fail("La estación todavía no está desbloqueada.");
      const ingredient = Object.keys(PRODUCT_CONFIG[machine.productId]?.recipe ?? {})[0] as ProductId | undefined;
      if (!ingredient && machine.output < 1) return fail("La estación sigue produciendo.");
      return operateMachine(state, franchise, machine.id, ingredient ?? machine.productId, success, fail);
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
    case "RETURN_TO_WAREHOUSE": {
      const carried = (Object.entries(franchise.carry.items) as [ProductId, number | undefined][])
        .map(([productId, rawQuantity]) => [productId, Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity ?? 0)) : 0] as const)
        .filter(([, quantity]) => quantity > 0);
      if (!carried.length) return fail("La cesta está vacía.");
      let returned = 0;
      for (const [productId, quantity] of carried) {
        franchise.warehouse[productId] += quantity;
        returned += quantity;
        recordDomain(state, `return:${productId}`, quantity);
      }
      recordDomain(state, "return:warehouse", returned);
      franchise.carry = { capacity: franchise.carry.capacity, items: {} };
      const summary = carried.map(([productId, quantity]) => `${quantity} × ${PRODUCTS[productId].name.toLowerCase()}`).join(", ");
      return success(`Devolviste al almacén: ${summary}.`);
    }
    case "STOCK": {
      if (action.productId === "cannedCorn" && !franchise.purchases?.purchased.includes("preserves-supply-1")) return fail("Desbloquea primero el expositor de conservas.");
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
      transaction.handledByPlayer = true;
      const result = processCheckoutUnit(state, franchise, transaction, events);
      return success(result);
    }
    case "ORDER": {
      const product = PRODUCTS[action.productId];
      const supplier = SUPPLIERS.find((item) => item.id === action.supplierId);
      if (!supplier || !canOrderProduct(state, action.productId) || product.supplier !== supplier.id) return fail("Proveedor no disponible para ese producto.");
      const quantity = Math.max(1, Math.min(100, Math.floor(action.quantity)));
      const total = Math.round(product.wholesaleMinor * countryMoneyScale(state.countryCode) * quantity * (1 - supplier.discount));
      if (state.balanceMinor < total) return fail("No hay caja suficiente para este pedido.");
      state.balanceMinor -= total;
      franchise.expensesTodayMinor += total;
      state.finances.costOfGoodsMinor += total;
      state.pendingOrders.push({ id: crypto.randomUUID(), franchiseId: franchise.id, supplierId: supplier.id, productId: action.productId, quantity, totalMinor: total, arrivesAtMinute: state.minuteOfDay + supplier.leadMinutes });
      recordDomain(state, "orders", 1);
      recordDomain(state, `order:${action.productId}`, 1);
      events.push({ franchiseId: franchise.id, category: "inventory", description: `Pedido de ${product.name}`, amountMinor: -total });
      return success(`Pedido confirmado. Entrega en ${supplier.leadMinutes} min del juego.`);
    }
    case "HIRE": {
      const info = ROLE_INFO[action.role];
      if (!canHireEmployee(state, action.role)) return fail(franchise.purchases ? "Completa la compra o la cadena de este empleado primero." : `Se desbloquea en nivel ${info.unlockLevel}.`);
      const { salaryMinor: scaledSalary, signingCostMinor: signingCost } = employeeHiringQuote(action.role, state.countryCode);
      if (state.balanceMinor < signingCost) return fail("Falta caja para contratación y alta.");
      state.balanceMinor -= signingCost;
      franchise.expensesTodayMinor += signingCost;
      const employee: Employee = { id: crypto.randomUUID(), name: EMPLOYEE_NAMES[franchise.employees.length % EMPLOYEE_NAMES.length], role: action.role, level: 1, salaryMinor: scaledSalary, energy: 100, hat: HATS[(franchise.employees.length + 1) % HATS.length].id, runtime: createEmployeeRuntime(action.role, franchise.employees.length, state.simulationTimeMs) };
      franchise.employees.push(employee);
      ensureSecondCheckoutForCashiers(franchise);
      events.push({ franchiseId: franchise.id, category: "payroll", description: `Alta de ${employee.name} (${info.name})`, amountMinor: -signingCost });
      gain(state, 55, "stock", 0);
      return success(`${employee.name} se incorporó como ${info.name.toLowerCase()}.`);
    }
    case "UPGRADE": {
      if (franchise.purchases && (action.upgrade === "expansion"
        || (action.upgrade === "mill" && !franchise.purchases.purchased.includes("flour-mill-1"))
        || (action.upgrade === "bakery" && !franchise.purchases.purchased.includes("bread-oven-1")))) {
        return fail("Desbloquea esta instalación mediante las compras del supermercado.");
      }
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
      if (franchise.purchases) return fail("Esta tienda avanza mediante sus compras y expansiones, no pagando niveles.");
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
      const levelWillAdvance = project.completed && levelObjectiveSatisfied(state.level, state);
      return success(levelWillAdvance
        ? `Ampliación completada. Nivel ${project.level} desbloqueado.`
        : project.completed
          ? "Financiación completa; falta terminar el objetivo del nivel."
          : `Aporte confirmado. Faltan ${formatMoney(project.costMinor - project.contributedMinor, state)} para completar la obra.`);
    }
    case "UPGRADE_ROSTER": {
      const entry = rosterEntries(franchise, countryMoneyScale(state.countryCode)).find((candidate) => candidate.id === action.entryId);
      if (!entry) return fail("Esa ficha ya no está en tu equipo.");
      if (entry.nextCostMinor === null) return fail("Ya tiene las cuatro mejoras.");
      if (state.balanceMinor < entry.nextCostMinor) return fail(`Faltan ${formatMoney(entry.nextCostMinor - state.balanceMinor, state)} para esta mejora.`);
      state.balanceMinor -= entry.nextCostMinor;
      franchise.expensesTodayMinor += entry.nextCostMinor;
      applyRosterUpgrade(franchise, entry);
      events.push({ franchiseId: franchise.id, category: "upgrade", description: `Mejora ${entry.label} (${entry.step + 1}/4)`, amountMinor: -entry.nextCostMinor });
      return success(`${entry.label}: mejora ${entry.step + 1} de 4 aplicada.`);
    }
    case "CONTRIBUTE_UPGRADE": {
      const target = upgradeTarget(state, franchise, action.upgrade);
      if (!target) return fail(upgradeUnavailableMessage(action.upgrade, Boolean(franchise.purchases)));
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
      if (franchise.purchases) return fail("La licencia de campaña es permanente; no necesitas renovarla.");
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
      const campaign = isCampaignGame(state);
      if (campaign) {
        const quote = campaignExpansionQuote(state, target.id);
        if (!quote.available) return fail(quote.reason);
        if (!target.purchases) return fail("El local no pertenece a esta campaña.");
      } else if (state.level < target.unlockLevel) return fail(`Requiere nivel ${target.unlockLevel}.`);
      if (state.balanceMinor < target.purchaseCostMinor) return fail("Capital global insuficiente.");
      state.balanceMinor -= target.purchaseCostMinor;
      target.owned = true;
      target.licenseActive = true;
      target.licenseDaysLeft = 7;
      if (!campaign) synchronizeFranchiseProgression(state, target);
      events.push({ franchiseId: target.id, category: "capital", description: `Apertura de ${target.name}`, amountMinor: -target.purchaseCostMinor, ...(campaign ? { payload: { campaignOpening: true } } : {}) });
      return success(`${target.name} ya forma parte de tu empresa.`);
    }
    case "TRAVEL": {
      const target = state.franchises.find((item) => item.id === action.franchiseId && item.owned);
      if (!target) return fail("Aún no eres dueño de esa franquicia.");
      state.currentFranchiseId = target.id;
      return success(`Viaje instantáneo a ${target.name}.`);
    }
    case "CLAIM_MISSION": {
      if (isCampaignGame(state)) return fail("La campaña avanza con trabajo personal y ventas, sin bonos diarios.");
      const mission = state.missions.find((item) => item.id === action.missionId);
      if (!mission?.completed || mission.claimed) return fail("La misión todavía no se puede cobrar.");
      mission.claimed = true;
      state.balanceMinor += mission.rewardMinor;
      events.push({ franchiseId: globalEventFranchiseId(state), category: "mission", description: mission.label, amountMinor: mission.rewardMinor, payload: { scope: "global", missionId: mission.id } });
      return success("Recompensa ingresada en la caja global.");
    }
    case "CLOSE_DAY":
      if (!state.franchises.some((candidate) => candidate.owned && candidate.open)) return fail("La tienda ya está cerrada.");
      return success(beginBusinessDayClosure(state, events));
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
    if (result.ok) {
      if (COUNTS_AS_PLAYER_PROGRESS.has(action.type)) state.progression.playerActionCount += 1;
      events.push(...result.events);
    }
  }
  const elapsedMs = Math.min(1_000, Math.max(0, deltaMs));
  state.simulationTimeMs += elapsedMs;
  const openFranchises = state.franchises.filter((candidate) => candidate.owned && candidate.open);
  if (openFranchises.length && businessDayIsClosing(state.minuteOfDay)) {
    interactionMessage = beginBusinessDayClosure(state, events, true);
  } else if (openFranchises.length) {
    const elapsedBusinessMinutes = businessMinutesForRealMs(elapsedMs);
    state.minuteOfDay = Math.min(BUSINESS_DAY_NIGHT_MINUTE, state.minuteOfDay + elapsedBusinessMinutes);
    state.lastServerTime += elapsedBusinessMinutes * 60_000;
    for (const openFranchise of openFranchises) {
      openFranchise.employees.forEach((employee) => { employee.energy = Math.max(15, employee.energy - 0.15 * elapsedBusinessMinutes); });
    }
    deliverOrders(state);
    if (businessDayIsClosing(state.minuteOfDay)) interactionMessage = beginBusinessDayClosure(state, events, true);
  }
  const playerDistanceMeters = Math.max(0, Math.min(100, worldInput.playerDistanceMeters ?? 0));
  if (playerDistanceMeters > 0) recordDomain(state, "distance:player", playerDistanceMeters);

  for (const franchise of state.franchises.filter((candidate) => candidate.owned)) {
    franchise.crops = franchise.crops.map((crop) => updateCrop(crop, state.simulationTimeMs));
    franchise.productionMachines = franchise.productionMachines.map((machine) => updateMachineWithProgress(state, machine));
    updateAutomaticDoor(franchise, state.simulationTimeMs, elapsedMs);
    franchise.lightsOn = franchise.open || (businessDayIsClosing(state.minuteOfDay) && hasCustomersInStore(franchise));
    if (franchise.open) spawnCustomerIfNeeded(state, franchise, pathfinder);
    franchise.employees.forEach((employee, index) => {
      employee.runtime ??= createEmployeeRuntime(employee.role, index, state.simulationTimeMs);
      updateEmployee(state, franchise, employee, elapsedMs, events, pathfinder);
    });
    updateCustomerQueue(franchise, pathfinder);
    for (const customer of franchise.customers) updateCustomer(state, franchise, customer, elapsedMs, events, pathfinder);
    if (businessDayIsClosing(state.minuteOfDay)) {
      // Once the doors close, the remaining customers must be allowed to pay
      // even if the owner is no longer standing at the till and no cashier was
      // hired yet. This drains only transactions already created inside.
      for (const transaction of franchise.checkoutTransactions) processCheckoutUnit(state, franchise, transaction, events);
    }
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
  if (businessDayIsClosing(state.minuteOfDay)
    && state.franchises.filter((candidate) => candidate.owned).every((candidate) => !hasActiveCustomers(candidate))) {
    settleBusinessDay(state, events);
    interactionMessage = businessDayClosureMessage(state, state.day - 1, true);
  }
  state.revision += 1;
  normalizeLevel(state);
  stampEvents(state, events);
  return { state, ok: true, message: interactionMessage ?? "Mundo actualizado.", events };
}

function settleBusinessDay(state: GameState, events: GameEvent[]) {
  const country = COUNTRIES[state.countryCode];
  const moneyScale = countryMoneyScale(state.countryCode);
  let payroll = 0;
  let operating = 0;
  let taxableProfit = 0;
  for (const franchise of state.franchises.filter((item) => item.owned)) {
    franchise.open = false;
    // Campaign hires are one-off purchases. Closing an empty store must not
    // create debt, consume register funds or charge the legacy fiscal model.
    if (franchise.purchases) {
      franchise.expensesTodayMinor = 0;
      franchise.revenueTodayMinor = 0;
      franchise.customersToday = 0;
      franchise.licenseActive = true;
      franchise.employees.forEach((employee) => { employee.energy = 100; });
      continue;
    }
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
  state.minuteOfDay = BUSINESS_DAY_OPEN_MINUTE;
  state.missions = isCampaignGame(state) ? [] : missionsForDay(state.day, moneyScale, state.level);
}

function businessDayClosureMessage(state: GameState, day: number, automatic: boolean) {
  const allCampaign = state.franchises.filter((franchise) => franchise.owned).every((franchise) => franchise.purchases);
  return `Día ${day} cerrado${automatic ? " automáticamente" : ""}. ${allCampaign ? "Progreso conservado, sin cargos diarios." : "Nóminas, operación e impuestos contabilizados."}`;
}

function beginBusinessDayClosure(state: GameState, events: GameEvent[], automatic = false) {
  state.minuteOfDay = BUSINESS_DAY_NIGHT_MINUTE;
  for (const franchise of state.franchises.filter((candidate) => candidate.owned)) {
    franchise.open = false;
    removeCustomersWhoNeverEntered(franchise, state.simulationTimeMs);
    franchise.lightsOn = hasCustomersInStore(franchise);
  }
  if (!state.franchises.filter((candidate) => candidate.owned).some((candidate) => hasActiveCustomers(candidate))) {
    const closedDay = state.day;
    settleBusinessDay(state, events);
    return businessDayClosureMessage(state, closedDay, automatic);
  }
  return `${automatic ? "Son las 21:00: entrada cerrada automáticamente" : "Entrada cerrada"}. Atendiendo a los últimos clientes antes del cierre de caja.`;
}

function hasActiveCustomers(franchise: FranchiseState) {
  return franchise.customers.some((customer) => customer.state !== "DESPAWN");
}

function hasCustomersInStore(franchise: FranchiseState) {
  return franchise.customers.some((customer) => customer.state !== "DESPAWN" && customer.z <= DOOR_PASSAGE_Z);
}

function removeCustomersWhoNeverEntered(franchise: FranchiseState, now: number) {
  const admittedIds = new Set(franchise.customers
    .filter((customer) => customer.state !== "DESPAWN" && customer.z <= DOOR_PASSAGE_Z)
    .map((customer) => customer.id));
  for (const customer of franchise.customers) {
    if (admittedIds.has(customer.id) || customer.state === "DESPAWN") continue;
    if (customer.hasCart) franchise.returnedCartCount += 1;
    customer.hasCart = false;
    customer.queueSlot = null;
    customer.queueJoinedAt = null;
    customer.reservedSocketId = null;
    customer.state = "DESPAWN";
    customer.stateSince = now;
  }
  franchise.queueCustomerIds = franchise.queueCustomerIds.filter((customerId) => admittedIds.has(customerId));
}

function updateAutomaticDoor(franchise: FranchiseState, now: number, deltaMs: number) {
  const customerPresent = franchise.customers.some((customer) => (
    customer.state !== "DESPAWN"
    && storefrontDoorActorPresent([customer.x, customer.z])
  ));
  const employeePresent = franchise.employees.some((employee) => {
    const runtime = employee.runtime;
    return Boolean(runtime && storefrontDoorActorPresent([runtime.x, runtime.z]));
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
  farmer: [...FARM_WORKER_HOME], feeder: [FARM_WORKER_HOME[0] + 1.4, FARM_WORKER_HOME[1]], operator: [-4.8, -0.9], stocker: [0, -2.2], cashier: [4.7, 2.2], builder: [2.9, -4.5], manager: [5.4, -3.6],
};
const LEGACY_OPERATOR_HOME: [number, number] = [-4.8, -1.5];
const CASHIER_WORK_POINTS: Record<CheckoutLane, [number, number]> = {
  0: [CHECKOUT_LANES[0].cashierWork[0], CHECKOUT_LANES[0].cashierWork[2]],
  1: [CHECKOUT_LANES[1].cashierWork[0], CHECKOUT_LANES[1].cashierWork[2]],
};
const CROP_POINTS: Record<string, [number, number]> = Object.fromEntries(FARM_PLOTS.map((plot) => [plot.id, [plot.position[0], plot.position[2]]]));
const MACHINE_POINTS: Record<string, [number, number]> = {
  ...PRODUCTION_MACHINE_POINTS,
  "chicken-coop-1": [FARM_ANIMAL_STATIONS.chicken.workPosition[0], FARM_ANIMAL_STATIONS.chicken.workPosition[2]],
  "chicken-coop-2": [FARM_ANIMAL_STATIONS.chicken2.workPosition[0], FARM_ANIMAL_STATIONS.chicken2.workPosition[2]],
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
  const assignedMachinePoint = assignedMachine ? MACHINE_POINTS[assignedMachine.id] : undefined;
  const assignedFarmMachinePoint = assignedMachine && (assignedMachine.id === "chicken-coop-1" || assignedMachine.id === "cow-station-1")
    ? assignedMachinePoint
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

  // Schema-v4 saves may still place farm staff in the retired east service
  // lane. That lane is outside the now sealed estate, so restore them to the
  // farm station they came from before rebuilding a route through both doors.
  const relocatedLegacyServiceLane = isLegacyFarmServiceLanePoint([runtime.x, runtime.z]);
  if (relocatedLegacyServiceLane) {
    relocate(assignedCrop ?? assignedFarmMachinePoint
      ?? (employee.role === "farmer" ? FARM_WORKER_HOME : EMPLOYEE_HOME.operator));
    runtime.path = [];
    runtime.pathIndex = 0;
  }

  // The old operator home sat inside the bakery's actor-clearance envelope.
  // Move that exact persisted resting pose into the aisle before calculating a
  // rear-door fallback, otherwise its first segment can graze the fixture.
  const relocatedLegacyOperatorHome = employee.role === "operator"
    && Math.hypot(runtime.x - LEGACY_OPERATOR_HOME[0], runtime.z - LEGACY_OPERATOR_HOME[1]) < 0.12;
  if (relocatedLegacyOperatorHome) relocate(EMPLOYEE_HOME.operator);

  if (runtime.state === "IDLE" && !carryTotal(runtime.carry)) {
    if (employee.role === "farmer" && (atRetiredHome || currentAtRetiredFarm)) relocate(FARM_WORKER_HOME);
    else if (employee.role === "operator" && currentAtRetiredFarm) relocate(assignedFarmMachinePoint ?? EMPLOYEE_HOME.operator);
    if (atRetiredHome || retiredRoute || relocatedLegacyOperatorHome || relocatedLegacyServiceLane) {
      runtime.path = [];
      runtime.pathIndex = 0;
    }
    return;
  }

  const collecting = runtime.state === "NAVIGATE_PICKUP" || runtime.state === "PICKUP";
  const delivering = runtime.state === "NAVIGATE_DROPOFF" || runtime.state === "DROPOFF"
    || (runtime.state === "IDLE" && carryTotal(runtime.carry) > 0 && (retiredRoute || relocatedLegacyServiceLane));
  const expectedTarget = employee.role === "farmer"
    ? collecting ? runtime.assignedStationId === "stockroom" ? STOCKROOM_POINT : assignedCrop ?? assignedFarmMachinePoint
      : delivering ? runtime.assignedStationId?.startsWith("retail:") && runtime.assignedProduct ? retailServicePoint(runtime.assignedProduct) : STOCKROOM_POINT : undefined
    : collecting ? assignedMachinePoint
      : delivering && assignedMachinePoint
        ? assignedMachine?.productId === runtime.assignedProduct ? STOCKROOM_POINT : assignedMachinePoint
        : delivering && (retiredRoute || relocatedLegacyServiceLane) ? STOCKROOM_POINT : undefined;
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
  if (!retiredRoute && !relocatedLegacyOperatorHome && !relocatedLegacyServiceLane && endpointMatches && (!(transitionNeedsFarmAccess || farmDeliveryNeedsFarmAccess) || pathUsesRearDoor) && !actionAtWrongPlace) return;

  runtime.state = collecting ? "NAVIGATE_PICKUP" : "NAVIGATE_DROPOFF";
  runtime.stateSince = now;
  setEmployeePath(runtime, navigatePath(undefined, [runtime.x, runtime.z], expectedTarget));
}

function createEmployeeRuntime(role: Employee["role"], index: number, now: number): EmployeeRuntimeState {
  const home = EMPLOYEE_HOME[role];
  return { state: "IDLE", assignedProduct: null, assignedStationId: null, carry: { capacity: 2, items: {} }, x: home[0] + index * 0.12, z: home[1], targetX: home[0], targetZ: home[1], path: [], pathIndex: 0, speed: 1.5, currentSpeed: 0, stateSince: now };
}

function updateEmployee(state: GameState, franchise: FranchiseState, employee: Employee, deltaMs: number, events: GameEvent[], pathfinder?: WorldPathfinder) {
  if (employee.runtime && isLegacyFarmServiceLanePoint([employee.runtime.x, employee.runtime.z])) {
    normalizePersistedFarmEmployee(franchise, employee, state.simulationTimeMs);
  }
  const runtime = employee.runtime!;
  runtime.carry.capacity = employeeCarryCapacity(employee.level);
  runtime.speed = employeeWalkSpeed(employee.level);
  if (employee.energy <= 0 || employee.role === "builder" || employee.role === "manager") return;
  if (employee.role === "cashier") {
    updateCashierEmployee(state, franchise, employee, deltaMs, events, pathfinder);
    return;
  }
  switch (runtime.state) {
    case "IDLE":
      if (state.simulationTimeMs - runtime.stateSince < 350 || !assignEmployeeTask(state, franchise, employee, pathfinder)) return;
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
      if (employee.role === "stocker") {
        const productId = primaryCarryProduct(runtime.carry);
        if (productId && franchise.shelves[productId] >= shelfCapacity(franchise, productId)) {
          routeEmployeeToReturns(runtime, state.simulationTimeMs, pathfinder);
          break;
        }
      }
      if (walkEmployeeThroughAutomaticDoor(runtime, franchise, deltaMs)) { runtime.state = "DROPOFF"; runtime.stateSince = state.simulationTimeMs; }
      break;
    case "DROPOFF":
      if (state.simulationTimeMs - runtime.stateSince < 320) return;
      employeeDropoff(state, franchise, employee, pathfinder);
      break;
    case "NAVIGATE_RETURN":
      if (walkEmployeeThroughAutomaticDoor(runtime, franchise, deltaMs)) {
        runtime.state = "RETURN_TO_WAREHOUSE";
        runtime.stateSince = state.simulationTimeMs;
      }
      break;
    case "RETURN_TO_WAREHOUSE":
      if (state.simulationTimeMs - runtime.stateSince < 320) return;
      employeeReturnCarry(state, franchise, employee);
      break;
  }
}

function updateCashierEmployee(state: GameState, franchise: FranchiseState, employee: Employee, deltaMs: number, events: GameEvent[], pathfinder?: WorldPathfinder) {
  const runtime = employee.runtime!;
  const assignedLane = cashierLaneForEmployee(franchise, employee);
  if (assignedLane === null) {
    if (runtime.state !== "IDLE" || runtime.assignedStationId !== null) resetEmployee(employee, state.simulationTimeMs);
    return;
  }
  const assignedStationId = `checkout-${assignedLane + 1}`;
  const workPoint = CASHIER_WORK_POINTS[assignedLane];
  const activeTransactions = franchise.checkoutTransactions
    .filter((transaction) => transaction.state !== "COMPLETE" && transaction.state !== "ABANDONED")
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const transaction = activeTransactions.find((candidate) => (candidate.checkoutLane ?? 0) === assignedLane);

  if (runtime.assignedStationId !== assignedStationId
    || (runtime.state !== "NAVIGATE_CHECKOUT" && runtime.state !== "WAIT_CHECKOUT_STATION" && runtime.state !== "OPERATE_CHECKOUT")) {
    runtime.state = "NAVIGATE_CHECKOUT";
    runtime.assignedStationId = assignedStationId;
    runtime.stateSince = state.simulationTimeMs;
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], workPoint));
    return;
  }

  if (runtime.state === "NAVIGATE_CHECKOUT") {
    if (walkEmployeeThroughAutomaticDoor(runtime, franchise, deltaMs)) {
      // Recast projects authored destinations to the centre of its nearest
      // cell. At checkout that leaves the cashier up to 24 cm outside the
      // exact work marker, so the following tick used to route them again
      // forever. Employees are simulation actors, therefore finish the short
      // projected remainder at the authoritative station socket.
      runtime.x = workPoint[0];
      runtime.z = workPoint[1];
      runtime.targetX = workPoint[0];
      runtime.targetZ = workPoint[1];
      runtime.path = [];
      runtime.pathIndex = 0;
      runtime.state = transaction ? "OPERATE_CHECKOUT" : "WAIT_CHECKOUT_STATION";
      runtime.stateSince = state.simulationTimeMs;
      runtime.currentSpeed = 0;
    }
    return;
  }

  // Saved cashiers may still be standing at the retired rear-side work point.
  // Do not let them scan remotely: route them to the current lane geometry.
  if (Math.hypot(runtime.x - workPoint[0], runtime.z - workPoint[1]) > 0.16) {
    runtime.state = "NAVIGATE_CHECKOUT";
    runtime.assignedStationId = assignedStationId;
    runtime.stateSince = state.simulationTimeMs;
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], workPoint));
    return;
  }

  if (!transaction) {
    runtime.state = "WAIT_CHECKOUT_STATION";
    runtime.currentSpeed = 0;
    return;
  }
  runtime.state = "OPERATE_CHECKOUT";
  const interval = checkoutScanInterval(franchise, transaction, employee);
  if (state.simulationTimeMs - transaction.lastScannedAt >= interval) {
    processCheckoutUnit(state, franchise, transaction, events, employee);
    employee.energy = Math.max(0, employee.energy - 0.015);
  }
}

function cashierLaneForEmployee(franchise: FranchiseState, employee: Employee): CheckoutLane | null {
  const laneCount = franchise.unlockedAreas.includes("checkout-2") ? 2 : 1;
  const cashiers = franchise.employees.filter((candidate) => candidate.role === "cashier");
  const index = cashiers.findIndex((candidate) => candidate.id === employee.id);
  if (index < 0 || index >= laneCount) return null;
  return index as CheckoutLane;
}

function assignEmployeeTask(state: GameState, franchise: FranchiseState, employee: Employee, pathfinder?: WorldPathfinder) {
  const runtime = employee.runtime!;
  if (employee.role === "stocker") {
    const saleableProducts = new Set(franchise.purchases ? campaignAvailableProducts(franchise.purchases) : unlockedCustomerProducts(state.level));
    const productId = (Object.keys(franchise.warehouse) as ProductId[])
      .filter((id) => saleableProducts.has(id) && availableWarehouseForEmployee(franchise, id, employee.id) > productionIngredientReserve(franchise, id))
      .sort((a, b) => shelfFill(franchise, a) - shelfFill(franchise, b))[0];
    if (!productId || shelfFill(franchise, productId) >= 1) return false;
    runtime.assignedProduct = productId; runtime.assignedStationId = "stockroom";
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], STOCKROOM_POINT));
    return true;
  }
  if (employee.role === "feeder") {
    const reserved = new Set(franchise.employees
      .filter((candidate) => candidate.id !== employee.id && candidate.role === "feeder")
      .map((candidate) => candidate.runtime?.assignedStationId));
    const target = franchise.productionMachines
      .filter((machine) => machine.status !== "LOCKED" && !reserved.has(machine.id))
      .map((machine) => ({ machine, policy: animalProduction(machine.productId, machine.tier) }))
      .filter((candidate) => candidate.policy
        && chickenFeedStatus(candidate.machine).free > 0
        && availableWarehouseForEmployee(franchise, candidate.policy.input, employee.id) > 0)
      .sort((a, b) => chickenFeedStatus(b.machine).free - chickenFeedStatus(a.machine).free)[0];
    if (!target?.policy) return false;
    runtime.assignedProduct = target.policy.input;
    runtime.assignedStationId = target.machine.id;
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], STOCKROOM_POINT));
    return true;
  }
  if (employee.role === "farmer") {
    if (franchise.purchases) {
      const reserved = new Set(franchise.employees.filter((candidate) => candidate.id !== employee.id).map((candidate) => candidate.runtime?.assignedStationId));
      const readyAnimal = franchise.productionMachines
        .filter((machine) => animalProduction(machine.productId, machine.tier) && machine.status !== "LOCKED" && machine.output > 0 && !reserved.has(machine.id))
        .sort((a, b) => shelfFill(franchise, a.productId) - shelfFill(franchise, b.productId))[0];
      if (readyAnimal && shelfFill(franchise, readyAnimal.productId) < 1) {
        runtime.assignedProduct = readyAnimal.productId; runtime.assignedStationId = readyAnimal.id;
        setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], MACHINE_POINTS[readyAnimal.id]));
        return true;
      }
      const stock = campaignAvailableProducts(franchise.purchases)
        .filter((product) => availableWarehouseForEmployee(franchise, product, employee.id) > productionIngredientReserve(franchise, product) && shelfFill(franchise, product) < 1)
        .sort((a, b) => shelfFill(franchise, a) - shelfFill(franchise, b))[0];
      if (stock) {
        runtime.assignedProduct = stock; runtime.assignedStationId = "stockroom";
        setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], STOCKROOM_POINT));
        return true;
      }
    }
    const reservedCropIds = new Set(franchise.employees
      .filter((candidate) => candidate.id !== employee.id && candidate.role === "farmer")
      .map((candidate) => candidate.runtime?.assignedStationId)
      .filter((stationId): stationId is string => Boolean(stationId)));
    // The scarcest product is the only one anyone harvests: every farmer
    // works the crop the store holds least of (shelves, warehouse, loaded
    // feed and the baskets of workers already on their way) until it catches
    // up with the rest, and whichever falls behind next takes over. A surplus
    // crop is never picked, so when the scarce bed is still growing or
    // already taken, the farmer waits for it instead of piling up tomatoes.
    const unlocked = franchise.crops.filter((candidate) => candidate.status !== "LOCKED");
    if (!unlocked.length) return false;
    const scarcest = Math.min(...unlocked.map((candidate) => productOnHand(franchise, candidate.productId)));
    const crop = unlocked
      .map((candidate, index) => ({ candidate, index, onHand: productOnHand(franchise, candidate.productId) }))
      .filter(({ candidate, onHand }) => onHand <= scarcest
        && !reservedCropIds.has(candidate.id)
        && (candidate.status === "EMPTY" || (candidate.status === "READY" && candidate.available > 0)))
      .sort((a, b) => Number(b.candidate.status === "READY") - Number(a.candidate.status === "READY")
        || b.candidate.available - a.candidate.available
        || a.index - b.index)[0]?.candidate;
    if (!crop) return false;
    runtime.assignedProduct = crop.productId; runtime.assignedStationId = crop.id;
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], CROP_POINTS[crop.id] ?? CROP_POINTS[FARM_PLOTS[0].id]));
    return true;
  }
  if (employee.role === "operator") {
    const reserved = new Set(franchise.employees
      .filter((candidate) => candidate.id !== employee.id && candidate.role === "operator")
      .map((candidate) => candidate.runtime?.assignedStationId));
    const machines = franchise.productionMachines.filter((machine) => machine.status !== "LOCKED" && !reserved.has(machine.id));
    // Collect a full basket, or whatever is left once the queue has run dry;
    // never a trip per unit while the machine is still working.
    const output = machines.find((machine) => machine.output > 0
      && (machine.output >= Math.min(runtime.carry.capacity, machine.outputCapacity)
        || (machine.status !== "PROCESSING" && machineQueuedCycles(machine) < 1)));
    if (output) {
      runtime.assignedProduct = output.productId; runtime.assignedStationId = output.id;
      setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], MACHINE_POINTS[output.id]));
      return true;
    }
    // Otherwise bring a basket of ingredient to the emptiest queue; the
    // animals' troughs belong to the feeder.
    const target = machines
      .filter((machine) => !animalProduction(machine.productId, machine.tier))
      .map((machine) => ({ machine, ingredient: Object.keys(PRODUCT_CONFIG[machine.productId]?.recipe ?? {})[0] as ProductId | undefined }))
      .filter(({ machine, ingredient }) => ingredient
        && machineInputRoom(machine, ingredient) >= Number(PRODUCT_CONFIG[machine.productId]?.recipe?.[ingredient] ?? 1)
        && availableWarehouseForEmployee(franchise, ingredient, employee.id) >= 1)
      .sort((a, b) => machineQueuedCycles(a.machine) - machineQueuedCycles(b.machine))[0];
    if (!target?.ingredient) return false;
    runtime.assignedProduct = target.ingredient; runtime.assignedStationId = target.machine.id;
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], STOCKROOM_POINT));
    return true;
  }
  return false;
}

function availableWarehouseForEmployee(franchise: FranchiseState, productId: ProductId, employeeId: string) {
  const reserved = franchise.employees.reduce((total, candidate) => {
    if (candidate.id === employeeId) return total;
    const runtime = candidate.runtime;
    if (!runtime || runtime.assignedProduct !== productId || (runtime.state !== "NAVIGATE_PICKUP" && runtime.state !== "PICKUP")) return total;
    return total + runtime.carry.capacity;
  }, 0);
  return Math.max(0, franchise.warehouse[productId] - reserved);
}

/** Keeps at least one actionable recipe batch away from retail restocking. */
function productionIngredientReserve(franchise: FranchiseState, productId: ProductId) {
  return franchise.productionMachines.reduce((total, machine) => {
    if (machine.status === "LOCKED" || machine.status === "PROCESSING" || machine.output >= machine.outputCapacity) return total;
    const required = Number(PRODUCT_CONFIG[machine.productId]?.recipe?.[productId] ?? 0);
    const loaded = Number(machine.input[productId] ?? 0);
    return total + Math.max(0, required - loaded);
  }, 0);
}

/** Everything the store already holds of a product: on the shelves, in the
 * warehouse, loaded into a machine or feeder, and in workers' baskets. */
function productOnHand(franchise: FranchiseState, productId: ProductId) {
  const carried = franchise.employees.reduce((total, employee) => total + (employee.runtime?.carry.items[productId] ?? 0), 0);
  const loaded = franchise.productionMachines.reduce((total, machine) => total + (machine.input[productId] ?? 0), 0);
  return franchise.shelves[productId] + franchise.warehouse[productId] + carried + loaded;
}

function employeePickup(state: GameState, franchise: FranchiseState, employee: Employee, pathfinder?: WorldPathfinder) {
  const runtime = employee.runtime!;
  const productId = runtime.assignedProduct;
  if (!productId) return resetEmployee(employee, state.simulationTimeMs);
  if (employee.role === "stocker" || (employee.role === "farmer" && franchise.purchases && runtime.assignedStationId === "stockroom")) {
    const quantity = Math.min(runtime.carry.capacity, Math.max(0, availableWarehouseForEmployee(franchise, productId, employee.id) - productionIngredientReserve(franchise, productId)));
    franchise.warehouse[productId] -= quantity;
    runtime.carry.items = quantity ? { [productId]: quantity } : {};
  } else if (employee.role === "farmer") {
    const animal = franchise.purchases && franchise.productionMachines.find((machine) => machine.id === runtime.assignedStationId && animalProduction(machine.productId, machine.tier));
    if (animal) {
      const collected = collectMachineOutputBatch(animal, state.simulationTimeMs, Math.max(0, runtime.carry.capacity - carryTotal(runtime.carry)));
      Object.assign(animal, collected.machine);
      runtime.carry = addToCarry(runtime.carry, productId, collected.collected, collected.collected).container;
    }
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
  } else if (employee.role === "feeder") {
    const machine = franchise.productionMachines.find((candidate) => candidate.id === runtime.assignedStationId);
    const free = machine ? chickenFeedStatus(machine).free : 0;
    const quantity = Math.min(runtime.carry.capacity, free, franchise.warehouse[productId]);
    franchise.warehouse[productId] -= quantity;
    runtime.carry.items = quantity ? { [productId]: quantity } : {};
  } else if (employee.role === "operator") {
    const machine = franchise.productionMachines.find((candidate) => candidate.id === runtime.assignedStationId);
    // The errand decides: sent for the machine's product, collect it there;
    // sent for an ingredient, take it from the warehouse. Output that appears
    // meanwhile is never collected from the stockroom and booked as wheat.
    if (machine && machine.productId === productId) {
      const freeCapacity = Math.max(0, runtime.carry.capacity - carryTotal(runtime.carry));
      const result = collectMachineOutputBatch(machine, state.simulationTimeMs, freeCapacity);
      Object.assign(machine, result.machine);
      runtime.carry = addToCarry(runtime.carry, productId, result.collected, result.collected).container;
    } else {
      // A whole basket for the queue, not one recipe per trip.
      const room = machine ? machineInputRoom(machine, productId) : 0;
      const quantity = Math.min(runtime.carry.capacity, room, franchise.warehouse[productId]);
      franchise.warehouse[productId] -= quantity;
      runtime.carry.items = quantity ? { [productId]: quantity } : {};
    }
  }
  if (!carryTotal(runtime.carry)) return resetEmployee(employee, state.simulationTimeMs);
  if (employee.role === "farmer" && franchise.purchases && campaignAvailableProducts(franchise.purchases).includes(productId) && shelfFill(franchise, productId) < 1) {
    runtime.assignedStationId = `retail:${productId}`;
    runtime.state = "NAVIGATE_DROPOFF"; runtime.stateSince = state.simulationTimeMs;
    setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], retailServicePoint(productId)));
    return;
  }
  const assignedMachine = franchise.productionMachines.find((machine) => machine.id === runtime.assignedStationId);
  const target = employee.role === "stocker" ? retailServicePoint(productId)
    : employee.role === "feeder" ? MACHINE_POINTS[runtime.assignedStationId ?? ""] ?? STOCKROOM_POINT
      : employee.role === "farmer" || assignedMachine?.productId === productId ? STOCKROOM_POINT
        : MACHINE_POINTS[runtime.assignedStationId ?? ""] ?? STOCKROOM_POINT;
  runtime.state = "NAVIGATE_DROPOFF"; runtime.stateSince = state.simulationTimeMs;
  setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], target));
}

function employeeDropoff(state: GameState, franchise: FranchiseState, employee: Employee, pathfinder?: WorldPathfinder) {
  const runtime = employee.runtime!;
  const productId = primaryCarryProduct(runtime.carry);
  if (!productId) return resetEmployee(employee, state.simulationTimeMs);
  let quantity = carryQuantity(runtime.carry, productId);
  if (employee.role === "stocker" || (employee.role === "farmer" && franchise.purchases && runtime.assignedStationId?.startsWith("retail:"))) {
    const capacity = shelfCapacity(franchise, productId);
    const moved = Math.min(quantity, Math.max(0, capacity - franchise.shelves[productId]));
    franchise.shelves[productId] += moved;
    runtime.carry = removeFromCarry(runtime.carry, productId, moved).container;
    if (carryTotal(runtime.carry) > 0) {
      routeEmployeeToReturns(runtime, state.simulationTimeMs, pathfinder);
      return;
    }
  } else if ((employee.role === "operator" || employee.role === "feeder") && franchise.productionMachines.find((machine) => machine.id === runtime.assignedStationId)?.productId !== productId) {
    const index = franchise.productionMachines.findIndex((machine) => machine.id === runtime.assignedStationId);
    if (index >= 0) {
      const temporary = EMPTY_INVENTORY(); temporary[productId] = quantity;
      const result = loadMachine(franchise.productionMachines[index], temporary, state.simulationTimeMs);
      franchise.productionMachines[index] = result.machine;
      quantity = result.inventory[productId];
      if (quantity > 0) franchise.warehouse[productId] += quantity;
    }
  } else franchise.warehouse[productId] += quantity;
  resetEmployee(employee, state.simulationTimeMs);
}

function routeEmployeeToReturns(runtime: EmployeeRuntimeState, now: number, pathfinder?: WorldPathfinder) {
  runtime.state = "NAVIGATE_RETURN";
  runtime.stateSince = now;
  runtime.assignedStationId = WAREHOUSE_RETURN_STATION.obstacleId;
  setEmployeePath(runtime, navigatePath(pathfinder, [runtime.x, runtime.z], [...WAREHOUSE_RETURN_STATION.workerPosition]));
}

function employeeReturnCarry(state: GameState, franchise: FranchiseState, employee: Employee) {
  const runtime = employee.runtime!;
  let returned = 0;
  for (const [productId, rawQuantity] of Object.entries(runtime.carry.items) as [ProductId, number | undefined][]) {
    const quantity = Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity ?? 0)) : 0;
    if (quantity < 1) continue;
    franchise.warehouse[productId] += quantity;
    returned += quantity;
    recordDomain(state, `employee-return:${productId}`, quantity);
  }
  if (returned > 0) recordDomain(state, "employee-return:warehouse", returned);
  resetEmployee(employee, state.simulationTimeMs);
}

function resetEmployee(employee: Employee, now: number) {
  const runtime = employee.runtime!;
  runtime.state = "IDLE"; runtime.stateSince = now; runtime.assignedProduct = null; runtime.assignedStationId = null; runtime.carry.items = {}; runtime.currentSpeed = 0;
}

function shelfFill(franchise: FranchiseState, productId: ProductId) {
  return franchise.shelves[productId] / shelfCapacity(franchise, productId);
}

/** Authoritative units the store holds of a product at a display tier: every
 * physical slot of its fixtures at tier 1, deeper rows as the display tier
 * grows. Exported so presentation (slot signs, fill meters) reads the same rule. */
export function shelfCapacityForTier(tier: number, productId: ProductId, areas: readonly string[] = []) {
  return retailShelfCapacityForTier(tier, productId, areas);
}

function shelfCapacity(franchise: FranchiseState, productId: ProductId) {
  return shelfCapacityForTier(franchise.stationTiers["shelves-1"] ?? franchise.shelvesLevel, productId, franchise.unlockedAreas);
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
    && Math.abs(beforeX) <= DOOR_PASSAGE_HALF_WIDTH
    && Math.abs(nextTarget[0]) <= DOOR_PASSAGE_HALF_WIDTH);
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
  const crossedDoorCorridor = Math.abs(beforeX) <= DOOR_PASSAGE_HALF_WIDTH
    && Math.abs(runtime.x) <= DOOR_PASSAGE_HALF_WIDTH;
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
function spawnCustomerIfNeeded(state: GameState, franchise: FranchiseState, pathfinder?: WorldPathfinder) {
  const active = franchise.customers.filter((customer) => customer.state !== "DESPAWN");
  const franchiseLevel = franchise.purchases ? campaignLevel(franchise) : state.level;
  const maximum = franchise.purchases ? campaignCustomerLimit(franchiseLevel)
    : state.level < 20 ? Math.min(12, 3 + Math.floor(state.level / 2)) : Math.min(30, 12 + Math.floor((state.level - 20) * 1.8));
  if (franchise.purchases) {
    if (!campaignNeedsCustomer(active, maximum)) return;
  } else if (active.length >= maximum || state.simulationTimeMs - franchise.lastCustomerSpawnAt < 3_000) return;
  const sequence = franchise.nextCustomerSequence++;
  const identity = ((sequence - 1) % 6 + 1) as CustomerRuntimeState["identity"];
  const id = `${franchise.id}-customer-${sequence}`;
  const mind = createCustomerMind(id, franchise.purchases ? campaignAvailableProducts(franchise.purchases) : unlockedCustomerProducts(state.level), sequence * 2654435761, state.level);
  if (franchise.purchases) {
    mind.shoppingList = campaignShoppingList(franchise.id, campaignAvailableProducts(franchise.purchases), Math.imul(sequence, 2654435761), franchiseLevel);
  }
  const entryX = identity % 2 ? -0.82 : 0.82;
  const customer: CustomerRuntimeState = {
    id, identity, state: "ENTER_STORE", shoppingList: mind.shoppingList, currentLine: 0, basket: {}, patienceMs: mind.patienceMs,
    checkoutPatienceMs: CHECKOUT_PATIENCE_MS, waitingSince: null, queueSlot: null, queueLane: 0, queueJoinedAt: null, transactionId: null,
    hasCart: false, hasBag: false, angry: false, x: entryX, z: 15.2, targetX: entryX, targetZ: 5.6,
    path: navigatePath(pathfinder, [entryX, 15.2], [...CART_RETURN_POINT]), pathIndex: 0, speed: customerWalkSpeed(identity), currentSpeed: 0, stateSince: state.simulationTimeMs, reservedSocketId: null, blockedSince: null, routeFailures: 0,
  };
  franchise.customers.push(customer);
  franchise.lastCustomerSpawnAt = state.simulationTimeMs;
}

function updateCustomer(state: GameState, franchise: FranchiseState, customer: CustomerRuntimeState, deltaMs: number, events: GameEvent[], pathfinder?: WorldPathfinder) {
  const now = state.simulationTimeMs;
  if (["NAVIGATE_TO_PRODUCT", "WAIT_FOR_ACCESS", "PICK_PRODUCT", "WAIT_RESTOCK"].includes(customer.state)
    && customer.waitingSince !== null && now - customer.waitingSince >= CUSTOMER_PATIENCE_MS) {
    abandonCheckout(franchise, customer, now, events, pathfinder, "producto no disponible");
    return;
  }
  if (!customer.transactionId && isCheckoutQueueState(customer) && customerBasketUnits(customer) === 0) {
    leaveWithoutPurchase(customer, now, pathfinder);
    return;
  }
  if (isWaitingForCheckout(customer) && customer.queueJoinedAt != null && now - customer.queueJoinedAt >= CHECKOUT_PATIENCE_MS) {
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
        else { customer.waitingSince ??= now; setCustomerState(customer, "WAIT_RESTOCK", now); }
      }
      break;
    case "PICK_PRODUCT":
      if (now - customer.stateSince >= 520) {
        const line = customer.shoppingList[customer.currentLine];
        if (!line || franchise.shelves[line.productId] <= 0) { customer.waitingSince ??= now; setCustomerState(customer, "WAIT_RESTOCK", now); break; }
        franchise.shelves[line.productId] -= 1;
        line.picked += 1;
        customer.basket[line.productId] = (customer.basket[line.productId] ?? 0) + 1;
        customer.reservedSocketId = null;
        if (line.picked >= line.requested) { customer.waitingSince = null; customer.currentLine += 1; setCustomerState(customer, "NEXT_PRODUCT", now); }
        else setCustomerState(customer, "WAIT_FOR_ACCESS", now);
      }
      break;
    case "WAIT_RESTOCK": {
      const line = customer.shoppingList[customer.currentLine];
      if (line && franchise.shelves[line.productId] > 0) {
        setCustomerState(customer, "NAVIGATE_TO_PRODUCT", now);
        setProductPath(franchise, customer, pathfinder);
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
        const pendingItems = (Object.entries(customer.basket) as [ProductId, number][]).filter(([, quantity]) => quantity > 0).slice(0, MAX_SHOPPING_LINES)
          .map(([productId, quantity]) => ({ productId, quantity: Math.min(MAX_SHOPPING_LINE_UNITS, quantity), loaded: 0, scanned: 0, bagged: 0 }));
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
      if (customerShowingAnger(customer, now)) break;
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

function abandonCheckout(franchise: FranchiseState, customer: CustomerRuntimeState, now: number, events: GameEvent[], pathfinder?: WorldPathfinder, reason = "caja sin atender") {
  const transaction = franchise.checkoutTransactions.find((candidate) => candidate.id === customer.transactionId);
  if (transaction && transaction.state !== "COMPLETE") {
    transaction.state = "ABANDONED";
    transaction.updatedAt = now;
  }
  customer.angry = true;
  customer.waitingSince = null;
  customer.reservedSocketId = null;
  customer.currentSpeed = 0;
  customer.queueJoinedAt = null;
  customer.queueSlot = null;
  customer.transactionId = null;
  franchise.rating = roundRating(Math.max(1, franchise.rating - 0.15));
  setCustomerState(customer, "NAVIGATE_TO_RETURNS", now);
  setCustomerPath(customer, navigatePath(pathfinder, [customer.x, customer.z], [...RETURNS_POINT]));
  events.push({ franchiseId: franchise.id, category: "returns", description: `Cliente ${customer.id} agotó sus 2 minutos de espera: ${reason}`, amountMinor: 0, payload: { customerId: customer.id, reason } });
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

function processCheckoutUnit(state: GameState, franchise: FranchiseState, transaction: CheckoutTransaction, events: GameEvent[], cashier?: Pick<Employee, "level">) {
  if (transaction.state === "COMPLETE" || transaction.state === "ABANDONED") return "La caja ya no tiene una compra activa.";
  const totals = checkoutUnitTotals(transaction);
  if (totals.loaded < totals.total) return "El cliente está colocando los productos en la cinta.";
  if (state.simulationTimeMs - transaction.lastScannedAt < checkoutScanInterval(franchise, transaction, cashier)) return "El cajero está terminando de pasar el producto anterior.";
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
    if (bagLine && now - transaction.lastBaggedAt >= checkoutBagInterval(laneCashier(franchise, transaction.checkoutLane ?? 0))) {
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

/** Time between two scanned units: the till's own tier, and on top of it the
 * training of the cashier working that lane. The owner scans at till speed. */
export function checkoutScanInterval(
  franchise: Pick<FranchiseState, "stationTiers" | "checkoutLevel" | "shelvesLevel">,
  transaction: Pick<CheckoutTransaction, "checkoutLane">,
  cashier?: Pick<Employee, "level">,
) {
  const lane = transaction.checkoutLane ?? 0;
  const tillSpeed = stationTierModifiers(franchise.stationTiers[`checkout-${lane + 1}`] ?? franchise.checkoutLevel).speed;
  const cashierSpeed = cashier ? cashierTillModifiers(cashier.level).speed : 1;
  return CHECKOUT_SCAN_UNIT_MS / (tillSpeed * cashierSpeed);
}

/** Bagging is automatic, but a trained cashier packs more per moment. */
export function checkoutBagInterval(cashier?: Pick<Employee, "level">) {
  return CHECKOUT_BAG_UNIT_MS / (cashier ? cashierTillModifiers(cashier.level).capacity : 1);
}

/** The cashier standing at a lane's till right now, if any. */
function laneCashier(franchise: Pick<FranchiseState, "employees">, lane: CheckoutLane) {
  return franchise.employees.find((employee) => employee.role === "cashier"
    && employee.runtime?.assignedStationId === `checkout-${lane + 1}`
    && (employee.runtime.state === "OPERATE_CHECKOUT" || employee.runtime.state === "WAIT_CHECKOUT_STATION"));
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
  // Campaign prices climb with the store's own level, 3 % per level.
  const levelValue = franchise.purchases ? campaignPriceMultiplier(campaignLevel(franchise)) : 1;
  for (const line of transaction.pendingItems) {
    const base = franchise.purchases && line.productId === "tomatoes" ? 100
      : franchise.purchases && line.productId === "eggs" ? 200 : PRODUCTS[line.productId].saleMinor;
    saleMinor += Math.round(base * countryMoneyScale(state.countryCode) * presentationValue * levelValue) * line.quantity;
  }
  // Campaign prices are final game prices, without the legacy fiscal model.
  const tax = franchise.purchases ? 0
    : Math.round(saleMinor * COUNTRIES[state.countryCode].salesTaxRate);
  const gross = franchise.purchases ? saleMinor : saleMinor + tax;
  if (franchise.purchases) saleMinor -= tax;
  transaction.paymentCommitted = true;
  transaction.state = "COMPLETE";
  transaction.updatedAt = state.simulationTimeMs;
  franchise.registerCashMinor[transaction.checkoutLane ?? 0] += gross;
  state.finances.grossRevenueMinor += saleMinor;
  franchise.revenueTodayMinor += saleMinor;
  franchise.customersToday += 1;
  const requestedUnits = customer.shoppingList.reduce((total, line) => total + line.requested, 0);
  const fulfilledUnits = customer.shoppingList.reduce((total, line) => total + line.picked, 0);
  const fulfillment = requestedUnits > 0 ? fulfilledUnits / requestedUnits : 1;
  const queueSeconds = customer.queueJoinedAt == null ? 0 : (state.simulationTimeMs - customer.queueJoinedAt) / 1_000;
  const serviceScore = Math.max(1, Math.min(5, 3.5 + fulfillment * 1.5 - Math.max(0, queueSeconds - 30) / 120));
  franchise.rating = roundRating(franchise.rating * 0.9 + serviceScore * 0.1);
  state.reputation += 1;
  gain(state, 20, "customers", 1);
  recordDomain(state, "customers", 1);
  const unitsSold = transaction.pendingItems.reduce((total, line) => total + line.quantity, 0);
  recordDomain(state, "sales:units", unitsSold);
  for (const line of transaction.pendingItems) recordDomain(state, `sales:${line.productId}`, line.quantity);
  if (averageShelfAvailability(franchise) >= 0.9) recordDomain(state, "availability:sales", 1);
  if (customer.queueJoinedAt != null && state.simulationTimeMs - customer.queueJoinedAt <= 30_000) recordDomain(state, "queue:under30", 1);
  if (customer.shoppingList.length >= 5 && customer.shoppingList.every((line) => line.picked >= line.requested)) recordDomain(state, "lists:five", 1);
  events.push({ franchiseId: franchise.id, category: "sales", description: `Compra ${transaction.id} · ${transaction.paymentMethod === "cash" ? "efectivo" : "tarjeta"}`, amountMinor: gross, payload: { transactionId: transaction.id, lane: transaction.checkoutLane ?? 0 } });
  customer.queueJoinedAt = null;
  customer.queueSlot = null;
  setCustomerState(customer, "NAVIGATE_TO_BAG", state.simulationTimeMs);
  const lane = transaction.checkoutLane ?? 0;
  setCustomerPath(customer, navigatePath(pathfinder, [customer.x, customer.z], CUSTOMER_BAG_POINTS[lane]));
}

function roundRating(value: number) {
  return Math.round(value * 100) / 100;
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
    customer.waitingSince ??= customer.stateSince;
    setCustomerState(customer, "WAIT_FOR_ACCESS", customer.stateSince);
    return;
  }
  customer.reservedSocketId = `${line.productId}:${slot}`;
  const base = currentProductTarget(customer);
  const offsets: [number, number][] = [[-0.38, 0], [0.38, 0], [0, -0.38], [0, 0.38]];
  const target: [number, number] = [base[0] + offsets[slot][0], base[1] + offsets[slot][1]];
  setCustomerPath(customer, navigatePath(pathfinder, [customer.x, customer.z], target));
}

export function applyCustomerAvoidance(customers: CustomerRuntimeState[]) {
  const moving = new Set<CustomerRuntimeState["state"]>(["ENTER_STORE", "NAVIGATE_TO_PRODUCT", "NAVIGATE_TO_QUEUE", "MOVE_QUEUE", "NAVIGATE_TO_BAG", "NAVIGATE_TO_RETURNS", "NAVIGATE_TO_CART_RETURN", "EXIT_STORE"]);
  const cellSize = 0.6;
  const cells = new Map<string, number[]>();
  for (let firstIndex = 0; firstIndex < customers.length; firstIndex++) {
    const first = customers[firstIndex];
    if (!moving.has(first.state)) continue;
    const cellX = Math.floor(first.x / cellSize);
    const cellZ = Math.floor(first.z / cellSize);
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
      for (const secondIndex of cells.get(`${cellX + offsetX}:${cellZ + offsetZ}`) ?? []) {
        const second = customers[secondIndex];
      const dx = second.x - first.x; const dz = second.z - first.z; const distance = Math.hypot(dx, dz);
      if (distance >= 0.6) continue;
      const nx = distance > 0.001 ? dx / distance : first.id < second.id ? 1 : -1;
      const nz = distance > 0.001 ? dz / distance : 0;
      const correction = Math.min(0.08, (0.6 - distance) * 0.5);
      first.x -= nx * correction; first.z -= nz * correction;
      second.x += nx * correction; second.z += nz * correction;
      }
    }
    const key = `${Math.floor(first.x / cellSize)}:${Math.floor(first.z / cellSize)}`;
    const occupants = cells.get(key);
    if (occupants) occupants.push(firstIndex);
    else cells.set(key, [firstIndex]);
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

/** Pre-Recast fallback lane: the only full-height north–south aisle runs at
 * x ≈ 3.1, east of the entrance gondola row and west of the drinks display
 * (see STORE_REAR_DOOR.interiorCorridor). */
function laneFor() { return 3.1; }

/** The entrance row (x −3.46…2.46, z −0.37…0.87) plus a walking margin: its
 * edges, the drinks display's north and south edges and two open rows are the
 * horizontal legs a fallback walk may use to reach the lane. */
const PANTRY_ROW_BAND = pantryEntranceRowBand(STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE, 0.36);
const LANE_APPROACH_ROWS = [PANTRY_ROW_BAND.minZ, PANTRY_ROW_BAND.maxZ, -1.8, -4.4, 0.45, 5.6] as const;

/** Waypoints from a floor point to the fallback lane that cross neither the
 * gondola row nor the drinks display: straight across when that leg is clear,
 * otherwise along the point's own column to the nearest clear row first. */
function laneApproach(point: readonly [number, number]): [number, number][] {
  const lane = laneFor();
  const direct: [number, number] = [lane, Math.min(5.6, point[1])];
  if (storeSegmentIsClear(point, direct)) return [direct];
  for (const z of LANE_APPROACH_ROWS) {
    const corner: [number, number] = [point[0], z];
    const laneAt: [number, number] = [lane, z];
    if (storeSegmentIsClear(point, corner) && storeSegmentIsClear(corner, laneAt)) return [corner, laneAt];
  }
  return [direct];
}

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
  // A clear straight walk needs no lane: the fallback used to send a customer
  // round the whole aisle to reach the neighbouring slot of the same shelf.
  if (!startsOutside && !endsOutside && storeSegmentIsClear(start, target)) return compactPath(start, [target]);
  const path: [number, number][] = [];
  if (start[1] > 5.6) path.push([start[0], 5.6]);
  path.push(...laneApproach(path.at(-1) ?? start));
  path.push(...laneApproach(target).reverse(), target);
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

/** The open apron in front of the orders block on the rear wall, from which
 * the rear door is reached in a straight segment. */
function isRearStockroomPoint(point: readonly [number, number]) {
  return point[0] >= STOCKROOM_POINT[0] - 1.5 && point[0] <= STOCKROOM_POINT[0] + 1.7 && point[1] <= -4.2 && point[1] > -6.6;
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

function updateMachineWithProgress(state: GameState, machine: FranchiseState["productionMachines"][number]) {
  const updated = updateMachine(machine, state.simulationTimeMs);
  const produced = Math.max(0, updated.output - machine.output);
  if (produced > 0) {
    recordDomain(state, `production:${updated.productId}`, produced);
    recordDomain(state, "production:all", produced);
    gain(state, 24 * produced, "production", produced);
  }
  return updated;
}

function normalizeLevel(state: GameState) {
  if (currentFranchise(state).purchases) {
    for (const franchise of state.franchises) syncCampaignStaff(state, franchise);
    syncCampaignProgression(state);
    return;
  }
  state.progression.objectiveComplete = levelObjectiveSatisfied(state.level, state);
  const franchise = currentFranchise(state);
  while (state.level < 30) {
    const project = franchise.buildProjects.find((candidate) => candidate.level === state.level + 1);
    if (!state.progression.objectiveComplete || !project?.completed) break;
    state.progression.completedLevels.push(state.level);
    state.level += 1;
    state.progression.lastUnlockAt = state.simulationTimeMs;
    state.progression.levelStartedCounters = { ...state.progression.counters };
    state.progression.levelStartedPlayerActionCount = state.progression.playerActionCount;
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

/** Shared by menu, proximity upgrades and commands; campaign access is never XP-based. */
export function canHireEmployee(state: GameState, role: Employee["role"]): boolean {
  const franchise = currentFranchise(state);
  const purchases = franchise.purchases;
  if (!purchases) return state.level >= ROLE_INFO[role].unlockLevel;
  if (franchise.employees.filter((employee) => employee.role === role).length >= campaignEmployeeLimit(franchise, role)) return false;
  // Campaign staff arrives with its purchase or its level reward, so no desk
  // is ever bought from a menu: reaching the limit is the only gate left.
  return true;
}

function upgradeTarget(state: GameState, franchise: FranchiseState, upgrade: "station" | "player-speed" | "player-capacity" | "employee"): UpgradeTarget | null {
  if (upgrade === "station") {
    const entry = Object.entries(franchise.stationTiers).filter(([id, tier]) => {
      if (tier >= 10) return false;
      if (!franchise.purchases) return true;
      const crop = franchise.crops.find((candidate) => candidate.id === id);
      const machine = franchise.productionMachines.find((candidate) => candidate.id === id);
      if (crop?.status === "LOCKED" || machine?.status === "LOCKED") return false;
      // These animal tiers have dedicated prices and prerequisites in the graph.
      if (id === "chicken-coop-1" && !franchise.purchases.purchased.includes("chicken-1-tier-3")) return false;
      if (id === "cow-station-1" && !franchise.purchases.purchased.includes("cow-1-tier-3")) return false;
      return true;
    }).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
    return entry ? { kind: "station", id: entry[0], label: stationUpgradeLabel(franchise, entry[0]), currentTier: entry[1] } : null;
  }
  const playerUpgradesAvailable = franchise.purchases ? franchise.purchases.purchased.includes("player-2") : state.level >= 3;
  if (upgrade === "player-speed") return playerUpgradesAvailable && franchise.playerSpeedTier < 10 ? { kind: "player-speed", id: "player-speed", label: "Velocidad del vendedor", currentTier: franchise.playerSpeedTier } : null;
  if (upgrade === "player-capacity") {
    const currentTier = carryCapacityTier(franchise.carry.capacity);
    return playerUpgradesAvailable && currentTier < CAPACITY_TIERS.length
      ? { kind: "player-capacity", id: "player-capacity", label: "Capacidad de carga", currentTier }
      : null;
  }
  const roles = (Object.keys(ROLE_INFO) as Employee["role"][]).filter((role) => canHireEmployee(state, role));
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
    "corn-canner-1": "Enlatadora de maíz",
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

/** One roster step: speed and capacity, never money multipliers. */
function applyRosterUpgrade(franchise: FranchiseState, entry: RosterEntry) {
  if (entry.kind === "player") {
    const base = rosterPlayerBase(franchise);
    const step = entry.step + 1;
    franchise.playerSpeedTier = base.speedTier + step;
    franchise.carry.capacity = base.capacity + step;
    franchise.playerCapacityTier = carryCapacityTier(franchise.carry.capacity);
    return;
  }
  if (entry.kind === "employee") {
    const employee = franchise.employees.find((candidate) => `employee:${candidate.id}` === entry.id);
    if (employee) employee.level = entry.step + 2;
    return;
  }
  const stationId = entry.id.slice("station:".length);
  const tier = rosterBaseTier(franchise, stationId) + entry.step + 1;
  franchise.stationTiers[stationId] = tier;
  const crop = franchise.crops.find((candidate) => candidate.id === stationId);
  if (crop) crop.tier = tier;
  const machine = franchise.productionMachines.find((candidate) => candidate.id === stationId);
  if (machine) {
    machine.tier = tier;
    machine.outputCapacity = Math.max(machine.output, Math.round((PRODUCT_CONFIG[machine.productId]?.outputCapacity ?? 8) * stationTierModifiers(tier).capacity));
  }
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
      machine.outputCapacity = Math.max(machine.output, Math.round((PRODUCT_CONFIG[machine.productId]?.outputCapacity ?? 8) * stationTierModifiers(nextTier).capacity));
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

function upgradeUnavailableMessage(upgrade: "station" | "player-speed" | "player-capacity" | "employee", campaign = false) {
  if (campaign && (upgrade === "player-speed" || upgrade === "player-capacity")) return "Compra primero «Carga 4 y velocidad +3 %»; después podrás seguir mejorando hasta el máximo.";
  if (upgrade === "player-speed") return "La mejora de velocidad se desbloquea en nivel 3 o ya está al máximo.";
  if (upgrade === "player-capacity") return "La mejora de carga se desbloquea en nivel 3 o ya está al máximo.";
  if (upgrade === "employee") return "No hay nuevas contrataciones o formaciones disponibles.";
  return "Todas las estaciones disponibles ya están al máximo.";
}

function recordDomain(state: GameState, counter: string, amount: number) {
  state.progression.counters[counter] = (state.progression.counters[counter] ?? 0) + amount;
}

const COUNTS_AS_PLAYER_PROGRESS = new Set<GameAction["type"]>([
  "DELIVER_CONTRACT",
  "CONTRIBUTE_PURCHASE",
  "TEND_CROP",
  "HARVEST",
  "LOAD_FLOUR_MILL",
  "BAKE_BREAD",
  "OPERATE_MACHINE",
  "PICKUP_WAREHOUSE",
  "RETURN_TO_WAREHOUSE",
  "STOCK",
  "CHECKOUT",
  "COLLECT_REGISTER",
  "ORDER",
  "CONTRIBUTE_UPGRADE",
]);

function attributePlayerAction(state: GameState, action: GameAction, countersBeforeAction: Record<string, number>) {
  recordDomain(state, `player:action:${action.type}`, 1);
  for (const [counterId, value] of Object.entries(state.progression.counters)) {
    if (counterId.startsWith("player:")) continue;
    const delta = value - (countersBeforeAction[counterId] ?? 0);
    if (delta > 0) recordDomain(state, `player:${counterId}`, delta);
  }
  if (action.type === "LOAD_FLOUR_MILL") recordDomain(state, "player:machine:flour-mill-1", 1);
  if (action.type === "BAKE_BREAD") recordDomain(state, "player:machine:bread-oven-1", 1);
  if (action.type === "OPERATE_MACHINE") recordDomain(state, `player:machine:${action.machineId}`, 1);
}

function applyLevelUnlock(state: GameState, franchise: FranchiseState, level: number) {
  const unlockArea = (id: string) => { if (!franchise.unlockedAreas.includes(id)) franchise.unlockedAreas.push(id); };
  if (level === 2) {
    if (!franchise.crops.some((crop) => crop.id === "crop-tomato-2")) franchise.crops.push(createCrop("crop-tomato-2", "tomatoes", state.simulationTimeMs, 1, level));
    franchise.stationTiers["crop-tomato-2"] ??= 1;
    // Customers start asking for apples at this level, so the orchard opens
    // with the demand instead of leaving the supplier as the only source.
    unlockArea("farm-apple");
    if (!franchise.crops.some((crop) => crop.id === "crop-apple-1")) franchise.crops.push({ ...createEmptyCrop("crop-apple-1", "apples"), status: "LOCKED" });
    unlockCrop(franchise, "crop-apple-1", state.simulationTimeMs, level);
    franchise.stationTiers["crop-apple-1"] ??= 1;
  }
  if (level === 3) {
    franchise.carry.capacity = Math.max(5, franchise.carry.capacity);
    franchise.playerCapacityTier = carryCapacityTier(franchise.carry.capacity);
    franchise.playerSpeedTier = Math.max(2, franchise.playerSpeedTier);
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
    unlockArea("farm-orange");
    if (!franchise.crops.some((crop) => crop.id === "crop-orange-1")) franchise.crops.push({ ...createEmptyCrop("crop-orange-1", "oranges"), status: "LOCKED" });
    unlockCrop(franchise, "crop-orange-1", state.simulationTimeMs, level);
    franchise.stationTiers["crop-orange-1"] ??= 1;
  }
  if (level === 21) { unlockArea("juice-machine"); unlockMachine(franchise, "juice-machine-1"); franchise.stationTiers["juice-machine-1"] ??= 1; }
  if (level === 22) hireUnlockedEmployee(franchise, "farmer", state.countryCode, state.simulationTimeMs);
  if (level === 23) unlockArea("facade-premium");
  if (level === 24) {
    franchise.carry.capacity = Math.max(12, franchise.carry.capacity);
    franchise.playerCapacityTier = carryCapacityTier(franchise.carry.capacity);
    franchise.stationTiers["shelves-1"] = Math.max(3, franchise.stationTiers["shelves-1"] ?? franchise.shelvesLevel);
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
  if (franchise.purchases) {
    franchise.buildProjects = [];
    return;
  }
  if (state.level >= 30 || franchise.buildProjects.some((candidate) => candidate.level === state.level + 1)) return;
  franchise.buildProjects.push({
    id: `level-${state.level + 1}`,
    level: state.level + 1,
    costMinor: Math.round(LEVELS[state.level].costMinor * countryMoneyScale(state.countryCode)),
    contributedMinor: 0,
    completed: false,
  });
}

function normalizeBuildProject(project: FranchiseState["buildProjects"][number], countryCode: CountryCode) {
  const expectedCost = Math.round(LEVELS[project.level - 1].costMinor * countryMoneyScale(countryCode));
  const previousCost = Number.isSafeInteger(project.costMinor) && project.costMinor > 0 ? project.costMinor : expectedCost;
  const previousContribution = Number.isSafeInteger(project.contributedMinor) ? Math.max(0, project.contributedMinor) : 0;
  const fundedRatio = project.completed ? 1 : Math.min(1, previousContribution / Math.max(1, previousCost));
  const contributedMinor = project.completed ? expectedCost : Math.min(expectedCost, Math.round(expectedCost * fundedRatio));
  return {
    ...project,
    id: `level-${project.level}`,
    costMinor: expectedCost,
    contributedMinor,
    completed: contributedMinor >= expectedCost,
  };
}

function unlockCrop(franchise: FranchiseState, id: string, now: number, gameLevel: number) {
  const crop = franchise.crops.find((candidate) => candidate.id === id);
  if (crop?.status === "LOCKED") Object.assign(crop, createCrop(crop.id, crop.productId, now, crop.tier, gameLevel, crop.baseYield));
}

function unlockMachine(franchise: FranchiseState, id: string) {
  const machine = franchise.productionMachines.find((candidate) => candidate.id === id);
  if (machine?.status === "LOCKED") machine.status = "WAITING_INPUT";
}

/** A second cashier needs a second real checkout: opening it on hire (or on
 * load for older saves) instead of waiting for the level-17 unlock. */
function ensureSecondCheckoutForCashiers(franchise: FranchiseState) {
  const cashiers = franchise.employees.filter((employee) => employee.role === "cashier").length;
  if (cashiers < 2 || franchise.unlockedAreas.includes("checkout-2")) return;
  franchise.unlockedAreas.push("checkout-2");
  franchise.stationTiers["checkout-2"] ??= 1;
  franchise.structureRevision += 1;
}

function hireUnlockedEmployee(franchise: FranchiseState, role: Employee["role"], countryCode: CountryCode, now: number) {
  if (franchise.employees.some((employee) => employee.role === role)) return;
  const index = franchise.employees.length;
  const { salaryMinor } = employeeHiringQuote(role, countryCode);
  franchise.employees.push({ id: `unlock-${role}-${index}`, name: EMPLOYEE_NAMES[index % EMPLOYEE_NAMES.length], role, level: 1, salaryMinor, energy: 100, hat: HATS[index % HATS.length].id, runtime: createEmployeeRuntime(role, index, now) });
}

function missionsForDay(day: number, moneyScale = 1, level = 1): Mission[] {
  const scale = 1 + Math.floor(day / 3);
  const productionUnlocked = level >= 5;
  const activity: Mission = productionUnlocked
    ? { id: `d${day}-produce`, label: `Completa ${2 + scale} ciclos de producción`, kind: "production", target: 2 + scale, progress: 0, rewardMinor: Math.round(19000 * scale * moneyScale), completed: false, claimed: false }
    : { id: `d${day}-harvest`, label: `Cosecha ${2 + scale} productos`, kind: "harvest", target: 2 + scale, progress: 0, rewardMinor: Math.round(19000 * scale * moneyScale), completed: false, claimed: false };
  return [
    { id: `d${day}-stock`, label: `Repón ${5 + scale * 2} productos`, kind: "stock", target: 5 + scale * 2, progress: 0, rewardMinor: Math.round(12000 * scale * moneyScale), completed: false, claimed: false },
    { id: `d${day}-customers`, label: `Atiende ${3 + scale} clientes`, kind: "customers", target: 3 + scale, progress: 0, rewardMinor: Math.round(16000 * scale * moneyScale), completed: false, claimed: false },
    activity,
  ];
}

function reconcileMissionsForCurrentLevel(state: GameState): Mission[] {
  if (isCampaignGame(state)) return [];
  const expected = missionsForDay(state.day, countryMoneyScale(state.countryCode), state.level);
  const existing = Array.isArray(state.missions) ? state.missions : [];
  return expected.map((expectedTemplate) => {
    const sameDayHarvest = expectedTemplate.kind === "production"
      ? existing.find((mission) => mission?.id === `d${state.day}-harvest`)
      : undefined;
    const template: Mission = sameDayHarvest
      ? { ...expectedTemplate, id: `d${state.day}-harvest`, label: `Cosecha ${expectedTemplate.target} productos`, kind: "harvest" }
      : expectedTemplate;
    const sameMission = existing.find((mission) => mission?.id === template.id);
    const legacyActivity = template.kind === "harvest" && !sameDayHarvest
      ? existing.find((mission) => mission?.id === `d${state.day}-produce`)
      : undefined;
    const previous = sameMission ?? legacyActivity;
    if (!previous) return template;
    const progress = Math.min(template.target, Math.max(0, Math.floor(Number(previous.progress) || 0)));
    const completed = Boolean(previous.completed) || progress >= template.target;
    return {
      ...template,
      progress,
      completed,
      claimed: completed && Boolean(previous.claimed),
    };
  });
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
  success: (message: string) => ActionResult,
  fail: (message: string) => ActionResult,
) {
  const machineIndex = franchise.productionMachines.findIndex((machine) => machine.id === machineId);
  if (machineIndex < 0) return fail("La estación todavía no está construida.");
  const sourceMachine = franchise.productionMachines[machineIndex];
  const machine = updateMachine(sourceMachine, state.simulationTimeMs);
  const commitMachine = (next: typeof machine) => {
    const produced = Math.max(0, machine.output - sourceMachine.output);
    if (produced > 0) {
      recordDomain(state, `production:${machine.productId}`, produced);
      recordDomain(state, "production:all", produced);
      gain(state, 24 * produced, "production", produced);
    }
    franchise.productionMachines[machineIndex] = next;
  };
  const animal = animalProduction(machine.productId, machine.tier);
  if (animal && carryQuantity(franchise.carry, animal.input) > 0 && chickenFeedStatus(machine).free > 0) {
    const inventory = EMPTY_INVENTORY();
    inventory[animal.input] = carryQuantity(franchise.carry, animal.input);
    const loaded = loadMachine(machine, inventory, state.simulationTimeMs);
    if (loaded.loaded) {
      const consumed = inventory[animal.input] - loaded.inventory[animal.input];
      franchise.carry = removeFromCarry(franchise.carry, animal.input, consumed).container;
      commitMachine(loaded.machine);
      recordDomain(state, `feed:${animal.species}`, consumed);
      return success(`Llevaste ${consumed} × ${PRODUCTS[animal.input].name.toLowerCase()} al comedero.`);
    }
  }
  // Whatever ingredient the owner brings goes into the queue first, as much
  // as it holds; the next pulse collects finished goods. One visit does both.
  const carried = carryQuantity(franchise.carry, ingredient);
  if (carried > 0 && machineInputRoom(machine, ingredient) > 0) {
    const temporary = EMPTY_INVENTORY();
    temporary[ingredient] = carried;
    const loaded = loadMachine(machine, temporary, state.simulationTimeMs);
    const consumed = carried - loaded.inventory[ingredient];
    franchise.carry = removeFromCarry(franchise.carry, ingredient, consumed).container;
    commitMachine(loaded.machine);
    const queued = machineQueuedCycles(loaded.machine) + Number(loaded.machine.status === "PROCESSING");
    return success(`Cargaste ${consumed} × ${PRODUCTS[ingredient].name.toLowerCase()}: ${queued} ${queued === 1 ? "ciclo" : "ciclos"} de ${PRODUCTS[machine.productId].name.toLowerCase()} en cola.`);
  }
  if (machine.output > 0) {
    const freeCapacity = Math.max(0, franchise.carry.capacity - carryTotal(franchise.carry));
    if (freeCapacity < 1) return fail("La cesta está llena.");
    const collected = collectMachineOutputBatch(machine, state.simulationTimeMs, freeCapacity);
    commitMachine(collected.machine);
    franchise.carry = addToCarry(franchise.carry, machine.productId, collected.collected, collected.collected).container;
    recordDomain(state, `collect:${machine.productId}`, collected.collected);
    return success(`Recogiste ${collected.collected} × ${PRODUCTS[machine.productId].name.toLowerCase()} terminado.`);
  }
  if (carried > 0) return fail(`La cola de ${PRODUCTS[machine.productId].name.toLowerCase()} está llena.`);
  return fail(`Faltan ingredientes para ${PRODUCTS[machine.productId].name.toLowerCase()}.`);
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
  const animal = animalProduction(machine.productId, machine.tier);
  if (animal && carryQuantity(franchise.carry, animal.input) > 0 && chickenFeedStatus(machine).free > 0) return true;
  // The queue takes ingredients at any time, even mid-cycle or with output
  // waiting; a station without a recipe cannot start through a pulse.
  const ingredients = Object.entries(PRODUCT_CONFIG[machine.productId]?.recipe ?? {}) as [ProductId, number][];
  if (!animal && ingredients.some(([productId]) => carryQuantity(franchise.carry, productId) > 0 && machineInputRoom(machine, productId) > 0)) return true;
  if (machine.output > 0) return carryTotal(franchise.carry) < franchise.carry.capacity;
  return false;
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
