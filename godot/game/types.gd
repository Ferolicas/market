class_name MarketTypes
extends RefCounted
## Port of src/game/types.ts. TypeScript interfaces have no runtime, so this
## file documents every state shape (Dictionary keys, camelCase, identical to
## the JSON the server validates) and exposes the string unions as constant
## lists plus small factories for the shapes the engine builds most.

const COUNTRY_CODES := ["ES", "US", "CO", "MX", "AR", "CL", "PE"]
const EMPLOYEE_ROLES := ["farmer", "feeder", "operator", "stocker", "cashier", "builder", "manager"]
const HAT_IDS := ["red-panda", "red-fox", "chicken", "frog", "elephant", "rhino", "giraffe", "panda", "owl", "cow", "rabbit", "capybara"]
## AvatarHatId = HatId | "none"
const AVATAR_HAT_IDS := ["red-panda", "red-fox", "chicken", "frog", "elephant", "rhino", "giraffe", "panda", "owl", "cow", "rabbit", "capybara", "none"]
const CHARACTER_IDS := ["adult-man", "adult-woman", "boy", "girl"]
const HAIR_IDS := ["side-part", "fade", "waves", "swept", "bob", "ponytail", "long-wavy", "bun", "messy", "curls", "short-fringe", "quiff", "blunt-bob", "pigtails", "braid", "high-ponytail"]
const PAYMENT_METHODS := ["cash", "card"]

## EmployeeRuntimeState.state
const EMPLOYEE_RUNTIME_STATES := ["IDLE", "NAVIGATE_PICKUP", "PICKUP", "NAVIGATE_DROPOFF", "DROPOFF", "NAVIGATE_RETURN", "RETURN_TO_WAREHOUSE", "NAVIGATE_CHECKOUT", "WAIT_CHECKOUT_STATION", "OPERATE_CHECKOUT"]
## CropState.status
const CROP_STATUSES := ["LOCKED", "EMPTY", "GROWING", "READY", "HARVESTING"]
## ProductionMachineState.status
const MACHINE_STATUSES := ["LOCKED", "IDLE", "WAITING_INPUT", "PROCESSING", "OUTPUT_READY", "FULL"]
## CheckoutTransaction.state
const CHECKOUT_TRANSACTION_STATES := ["CUSTOMER_LOADING", "SCANNING", "BAGGING", "PAYMENT", "COMPLETE", "ABANDONED"]
## CustomerBrainState
const CUSTOMER_BRAIN_STATES := ["SPAWN", "ENTER_STORE", "GET_CART", "BUILD_SHOPPING_LIST", "NAVIGATE_TO_PRODUCT", "WAIT_FOR_ACCESS", "PICK_PRODUCT", "NEXT_PRODUCT", "NAVIGATE_TO_QUEUE", "QUEUE_WAIT", "MOVE_QUEUE", "UNLOAD", "WAIT_CHECKOUT", "PAY", "NAVIGATE_TO_BAG", "TAKE_BAG", "NAVIGATE_TO_RETURNS", "LEAVE_RETURNS", "NAVIGATE_TO_CART_RETURN", "RETURN_CART", "EXIT_STORE", "DESPAWN", "WAIT_RESTOCK"]
## FranchiseState.doorState
const DOOR_STATES := ["CLOSED", "OPENING", "OPEN", "CLOSING", "BLOCKED"]
## Mission.kind
const MISSION_KINDS := ["sales", "stock", "harvest", "production", "customers"]
## CustomerRuntimeState.identity
const CUSTOMER_IDENTITIES := [1, 2, 3, 4, 5, 6]
## Checkout lanes (CheckoutTransaction.checkoutLane / CustomerRuntimeState.queueLane / COLLECT_REGISTER.lane)
const CHECKOUT_LANE_IDS := [0, 1, 2]
## GameAction.type
const GAME_ACTION_TYPES := ["DELIVER_CONTRACT", "SET_COUNTRY", "SET_AVATAR", "TOGGLE_STORE", "TEND_CROP", "HARVEST", "LOAD_FLOUR_MILL", "BAKE_BREAD", "OPERATE_MACHINE", "PICKUP_WAREHOUSE", "RETURN_TO_WAREHOUSE", "STOCK", "CHECKOUT", "COLLECT_REGISTER", "CONTRIBUTE_PURCHASE", "ORDER", "HIRE", "UPGRADE", "CONTRIBUTE_BUILD", "CONTRIBUTE_UPGRADE", "UPGRADE_ROSTER", "DOOR_SENSOR", "BUY_LICENSE", "BUY_FRANCHISE", "TRAVEL", "CLAIM_MISSION", "CLOSE_DAY"]
## WorldInteractionAction.type (the subset dispatched from the 3D world)
const WORLD_INTERACTION_ACTION_TYPES := ["TEND_CROP", "HARVEST", "LOAD_FLOUR_MILL", "BAKE_BREAD", "OPERATE_MACHINE", "PICKUP_WAREHOUSE", "RETURN_TO_WAREHOUSE", "STOCK", "CHECKOUT", "COLLECT_REGISTER", "CONTRIBUTE_BUILD", "CONTRIBUTE_PURCHASE", "CONTRIBUTE_UPGRADE"]
## UPGRADE.upgrade / CONTRIBUTE_UPGRADE.upgrade / STOCK.source
const UPGRADE_KINDS := ["shelves", "checkout", "expansion", "mill", "bakery"]
const CONTRIBUTE_UPGRADE_KINDS := ["station", "player-speed", "player-capacity", "employee"]
const STOCK_SOURCES := ["warehouse", "carry"]
const SCHEMA_VERSION := 4

## AvatarConfig: { body: CharacterId, hair: HairId, hairColor: String, skin: String, shirt: String, hat: AvatarHatId }
## Inventory: Dictionary<ProductId, int> with every ProductId present.
## CountryDefinition: { code, name, currency, locale, corporateTaxRate, salesTaxRate, payrollBurdenRate, startingCapitalMinor }
## Employee: { id, name, role: EmployeeRole, level, salaryMinor, energy, hat: HatId, runtime?: EmployeeRuntimeState }
## EmployeeRuntimeState: { state, assignedProduct: ProductId|null, assignedStationId: String|null, carry: CarryState,
##   x, z, targetX, targetZ, path: [[x, z], ...], pathIndex, speed, currentSpeed?, stateSince }
## MachineState: { flourMillLevel, bakeryLevel, flourQueue, breadQueue }
## CarryState: { capacity: int, items: Partial<Inventory> }
## CropState: { id, productId: CropProductId, status: CROP_STATUSES, plantedAt, readyAt, available, tier, baseYield? }
## ProductionMachineState: { id, productId: MachineProductId, status: MACHINE_STATUSES, input: Partial<Inventory>,
##   output, outputCapacity, startedAt: int|null, completesAt: int|null, tier }
## BuildProject: { id, level, costMinor, contributedMinor, completed }
## ProgressionState: { completedLevels: int[], counters: Dictionary<String, int>, levelStartedCounters: Dictionary<String, int>,
##   playerActionCount, levelStartedPlayerActionCount, objectiveComplete: bool, lastUnlockAt }
## CheckoutTransaction: { id, customerId, pendingItems: [{ productId, quantity, loaded, scanned, bagged }], paymentMethod,
##   state: CHECKOUT_TRANSACTION_STATES, nextUnitIndex, paymentCommitted, updatedAt, lastLoadedAt, lastScannedAt, lastBaggedAt,
##   checkoutLane?: 0|1|2, handledByPlayer?: bool }
## CustomerRuntimeState: { id, identity: 1..6, state: CustomerBrainState, shoppingList: [{ productId, requested, picked }],
##   currentLine, basket: Partial<Inventory>, patienceMs, checkoutPatienceMs, waitingSince: int|null, queueSlot: int|null,
##   queueLane?: 0|1|2, queueJoinedAt?: int|null, transactionId: String|null, hasCart, hasBag, angry, x, z, targetX, targetZ,
##   path: [[x, z], ...], pathIndex, speed, currentSpeed?, stateSince, reservedSocketId: String|null, blockedSince: int|null, routeFailures }
## FranchiseState: { id, name, city, unlockLevel, purchaseCostMinor, owned, open, licenseActive, licenseDaysLeft, expansionLevel,
##   shelvesLevel, checkoutLevel, warehouse: Inventory, shelves: Inventory, machines: MachineState, carry: CarryState,
##   crops: CropState[], productionMachines: ProductionMachineState[], buildProjects: BuildProject[],
##   checkoutTransactions: CheckoutTransaction[], registerCashMinor: [int, int, int], supplyFocus?: { productId, target },
##   businessDay?, businessMinute?, purchases?: PurchaseState, returnsBin: Inventory, returnedCartCount,
##   customers: CustomerRuntimeState[], nextCustomerSequence, lastCustomerSpawnAt, queueCustomerIds: String[],
##   unlockedAreas: String[], stationTiers: Dictionary<String, int>, upgradeContributions: Dictionary<String, int>,
##   playerSpeedTier, playerCapacityTier, storeRank, structureRevision, doorState: DOOR_STATES, doorProgress,
##   doorPlayerPresent, doorEmptySince: int|null, lightsOn, employees: Employee[], revenueTodayMinor, expensesTodayMinor,
##   customersToday, rating }
## Mission: { id, label, kind: MISSION_KINDS, target, progress, rewardMinor, completed, claimed }
## PendingOrder: { id, franchiseId, supplierId, productId, quantity, totalMinor, arrivesAtMinute }
## FinancialTotals: { grossRevenueMinor, costOfGoodsMinor, payrollMinor, operatingCostsMinor, taxesMinor, netProfitMinor }
## GameState: { schemaVersion: 4, revision, countryCode, currency, balanceMinor, level, xp, reputation, day, minuteOfDay,
##   currentFranchiseId, avatar: AvatarConfig, franchises: FranchiseState[], missions: Mission[], pendingOrders: PendingOrder[],
##   finances: FinancialTotals, tutorialStep, progression: ProgressionState, eventSequence, processedEventIds: String[],
##   lastServerTime, simulationTimeMs, lastSavedAt: String }
## GameAction: { type: GAME_ACTION_TYPES, ...payload } — e.g. { "type": "STOCK", "productId": "tomatoes", "quantity": 3, "source": "carry" }
## GameEvent: { franchiseId, category, description, amountMinor, eventId?, sequence?, occurredAt?, type?, payload?, idempotencyKey? }
## ActionResult: { state: GameState, ok: bool, message: String, events: GameEvent[] }

static func create_carry_state(capacity := 3) -> Dictionary:
	return { "capacity": capacity, "items": {} }

static func create_machine_state() -> Dictionary:
	return { "flourMillLevel": 0, "bakeryLevel": 0, "flourQueue": 0, "breadQueue": 0 }

static func create_progression_state() -> Dictionary:
	return { "completedLevels": [], "counters": {}, "levelStartedCounters": {}, "playerActionCount": 0, "levelStartedPlayerActionCount": 0, "objectiveComplete": false, "lastUnlockAt": 0 }

static func create_financial_totals() -> Dictionary:
	return { "grossRevenueMinor": 0, "costOfGoodsMinor": 0, "payrollMinor": 0, "operatingCostsMinor": 0, "taxesMinor": 0, "netProfitMinor": 0 }

static func create_game_event(franchise_id: String, category: String, description: String, amount_minor: int, extra := {}) -> Dictionary:
	return JS.spread({ "franchiseId": franchise_id, "category": category, "description": description, "amountMinor": amount_minor }, extra)

static func action_result(state: Dictionary, ok: bool, message: String, events: Array = []) -> Dictionary:
	return { "state": state, "ok": ok, "message": message, "events": events }

static func is_country_code(value: Variant) -> bool:
	return value is String and COUNTRY_CODES.has(value)

static func is_employee_role(value: Variant) -> bool:
	return value is String and EMPLOYEE_ROLES.has(value)
