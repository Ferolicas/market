export type CountryCode = "ES" | "US" | "CO" | "MX" | "AR" | "CL" | "PE";
export type EmployeeRole = "farmer" | "operator" | "stocker" | "cashier" | "builder" | "manager";
export type HatId = "red-panda" | "red-fox" | "chicken" | "frog" | "elephant" | "rhino" | "giraffe" | "panda" | "owl" | "cow" | "rabbit" | "capybara";
export type AvatarHatId = HatId | "none";
export type CharacterId = "adult-man" | "adult-woman" | "boy" | "girl";
export type HairId = "side-part" | "fade" | "waves" | "swept" | "bob" | "ponytail" | "long-wavy" | "bun" | "messy" | "curls" | "short-fringe" | "quiff" | "blunt-bob" | "pigtails" | "braid" | "high-ponytail";
export type ProductId = "wheat" | "flour" | "bread" | "corn" | "milk" | "eggs" | "cheese" | "apples" | "tomatoes" | "coffee" | "juice";
export type PaymentMethod = "cash" | "card";

export interface AvatarConfig {
  body: CharacterId;
  hair: HairId;
  hairColor: string;
  skin: string;
  shirt: string;
  hat: AvatarHatId;
}

export type Inventory = Record<ProductId, number>;

export interface CountryDefinition {
  code: CountryCode;
  name: string;
  currency: string;
  locale: string;
  corporateTaxRate: number;
  salesTaxRate: number;
  payrollBurdenRate: number;
  startingCapitalMinor: number;
}

export interface Employee {
  id: string;
  name: string;
  role: EmployeeRole;
  level: number;
  salaryMinor: number;
  energy: number;
  hat: HatId;
  runtime?: EmployeeRuntimeState;
}

export interface EmployeeRuntimeState {
  state: "IDLE" | "NAVIGATE_PICKUP" | "PICKUP" | "NAVIGATE_DROPOFF" | "DROPOFF" | "NAVIGATE_CHECKOUT" | "OPERATE_CHECKOUT";
  assignedProduct: ProductId | null;
  assignedStationId: string | null;
  carry: CarryState;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  path: [number, number][];
  pathIndex: number;
  speed: number;
  currentSpeed?: number;
  stateSince: number;
}

export interface MachineState {
  flourMillLevel: number;
  bakeryLevel: number;
  flourQueue: number;
  breadQueue: number;
}

export interface CarryState {
  capacity: number;
  items: Partial<Inventory>;
}

export interface CropState {
  id: string;
  productId: "tomatoes" | "wheat" | "corn";
  status: "LOCKED" | "EMPTY" | "GROWING" | "READY" | "HARVESTING";
  plantedAt: number;
  readyAt: number;
  available: number;
  tier: number;
}

export interface ProductionMachineState {
  id: string;
  productId: "flour" | "bread" | "cheese" | "juice" | "eggs" | "milk";
  status: "LOCKED" | "IDLE" | "WAITING_INPUT" | "PROCESSING" | "OUTPUT_READY" | "FULL";
  input: Partial<Inventory>;
  output: number;
  outputCapacity: number;
  startedAt: number | null;
  completesAt: number | null;
  tier: number;
}

export interface BuildProject {
  id: string;
  level: number;
  costMinor: number;
  contributedMinor: number;
  completed: boolean;
}

export interface ProgressionState {
  completedLevels: number[];
  counters: Record<string, number>;
  objectiveComplete: boolean;
  lastUnlockAt: number;
}

export interface CheckoutTransaction {
  id: string;
  customerId: string;
  pendingItems: { productId: ProductId; quantity: number; loaded: number; scanned: number; bagged: number }[];
  paymentMethod: PaymentMethod;
  state: "CUSTOMER_LOADING" | "SCANNING" | "BAGGING" | "PAYMENT" | "COMPLETE" | "ABANDONED";
  nextUnitIndex: number;
  paymentCommitted: boolean;
  updatedAt: number;
  lastLoadedAt: number;
  lastScannedAt: number;
  lastBaggedAt: number;
  checkoutLane?: 0 | 1;
}

export type CustomerBrainState = "SPAWN" | "ENTER_STORE" | "GET_CART" | "BUILD_SHOPPING_LIST" | "NAVIGATE_TO_PRODUCT" | "WAIT_FOR_ACCESS" | "PICK_PRODUCT" | "NEXT_PRODUCT" | "NAVIGATE_TO_QUEUE" | "QUEUE_WAIT" | "MOVE_QUEUE" | "UNLOAD" | "WAIT_CHECKOUT" | "PAY" | "NAVIGATE_TO_BAG" | "TAKE_BAG" | "NAVIGATE_TO_RETURNS" | "LEAVE_RETURNS" | "NAVIGATE_TO_CART_RETURN" | "RETURN_CART" | "EXIT_STORE" | "DESPAWN" | "WAIT_RESTOCK";

export interface CustomerRuntimeState {
  id: string;
  identity: 1 | 2 | 3 | 4 | 5 | 6;
  state: CustomerBrainState;
  shoppingList: { productId: ProductId; requested: number; picked: number }[];
  currentLine: number;
  basket: Partial<Inventory>;
  patienceMs: number;
  checkoutPatienceMs: number;
  waitingSince: number | null;
  queueSlot: number | null;
  queueLane?: 0 | 1;
  queueJoinedAt?: number | null;
  transactionId: string | null;
  hasCart: boolean;
  hasBag: boolean;
  angry: boolean;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  path: [number, number][];
  pathIndex: number;
  speed: number;
  currentSpeed?: number;
  stateSince: number;
  reservedSocketId: string | null;
  blockedSince: number | null;
  routeFailures: number;
}

export interface FranchiseState {
  id: string;
  name: string;
  city: string;
  unlockLevel: number;
  purchaseCostMinor: number;
  owned: boolean;
  open: boolean;
  licenseActive: boolean;
  licenseDaysLeft: number;
  expansionLevel: number;
  shelvesLevel: number;
  checkoutLevel: number;
  warehouse: Inventory;
  shelves: Inventory;
  machines: MachineState;
  carry: CarryState;
  crops: CropState[];
  productionMachines: ProductionMachineState[];
  buildProjects: BuildProject[];
  checkoutTransactions: CheckoutTransaction[];
  returnsBin: Inventory;
  returnedCartCount: number;
  customers: CustomerRuntimeState[];
  nextCustomerSequence: number;
  lastCustomerSpawnAt: number;
  queueCustomerIds: string[];
  unlockedAreas: string[];
  stationTiers: Record<string, number>;
  upgradeContributions: Record<string, number>;
  playerSpeedTier: number;
  playerCapacityTier: number;
  storeRank: number;
  structureRevision: number;
  doorState: "CLOSED" | "OPENING" | "OPEN" | "CLOSING" | "BLOCKED";
  doorProgress: number;
  doorPlayerPresent: boolean;
  doorEmptySince: number | null;
  lightsOn: boolean;
  employees: Employee[];
  revenueTodayMinor: number;
  expensesTodayMinor: number;
  customersToday: number;
  rating: number;
}

export interface Mission {
  id: string;
  label: string;
  kind: "sales" | "stock" | "harvest" | "production" | "customers";
  target: number;
  progress: number;
  rewardMinor: number;
  completed: boolean;
  claimed: boolean;
}

export interface PendingOrder {
  id: string;
  franchiseId: string;
  supplierId: string;
  productId: ProductId;
  quantity: number;
  totalMinor: number;
  arrivesAtMinute: number;
}

export interface FinancialTotals {
  grossRevenueMinor: number;
  costOfGoodsMinor: number;
  payrollMinor: number;
  operatingCostsMinor: number;
  taxesMinor: number;
  netProfitMinor: number;
}

export interface GameState {
  schemaVersion: 4;
  revision: number;
  countryCode: CountryCode;
  currency: string;
  balanceMinor: number;
  level: number;
  xp: number;
  reputation: number;
  day: number;
  minuteOfDay: number;
  currentFranchiseId: string;
  avatar: AvatarConfig;
  franchises: FranchiseState[];
  missions: Mission[];
  pendingOrders: PendingOrder[];
  finances: FinancialTotals;
  tutorialStep: number;
  progression: ProgressionState;
  eventSequence: number;
  processedEventIds: string[];
  lastServerTime: number;
  simulationTimeMs: number;
  lastSavedAt: string;
}

export type GameAction =
  | { type: "SET_COUNTRY"; countryCode: CountryCode }
  | { type: "SET_AVATAR"; body?: CharacterId; hair?: HairId; hairColor?: string; skin?: string; shirt?: string; hat?: AvatarHatId }
  | { type: "TOGGLE_STORE" }
  | { type: "TEND_CROP"; cropId?: string; productId?: "tomatoes" | "wheat" | "corn" }
  | { type: "HARVEST"; cropId?: string; productId?: "tomatoes" | "wheat" | "corn"; quantity?: number }
  | { type: "LOAD_FLOUR_MILL" }
  | { type: "BAKE_BREAD" }
  | { type: "OPERATE_MACHINE"; machineId: string }
  | { type: "PICKUP_WAREHOUSE"; productId?: ProductId; quantity?: number }
  | { type: "STOCK"; productId: ProductId; quantity?: number; source?: "warehouse" | "carry" }
  | { type: "CHECKOUT"; paymentMethod: PaymentMethod }
  | { type: "ORDER"; supplierId: string; productId: ProductId; quantity: number }
  | { type: "HIRE"; role: EmployeeRole }
  | { type: "UPGRADE"; upgrade: "shelves" | "checkout" | "expansion" | "mill" | "bakery" }
  | { type: "CONTRIBUTE_BUILD"; amountMinor?: number }
  | { type: "CONTRIBUTE_UPGRADE"; upgrade: "station" | "player-speed" | "player-capacity" | "employee"; amountMinor?: number }
  | { type: "DOOR_SENSOR"; active: boolean }
  | { type: "BUY_LICENSE" }
  | { type: "BUY_FRANCHISE"; franchiseId: string }
  | { type: "TRAVEL"; franchiseId: string }
  | { type: "CLAIM_MISSION"; missionId: string }
  | { type: "CLOSE_DAY" };

export type WorldInteractionAction = Extract<GameAction, { type:
  | "TEND_CROP"
  | "HARVEST"
  | "LOAD_FLOUR_MILL"
  | "BAKE_BREAD"
  | "OPERATE_MACHINE"
  | "PICKUP_WAREHOUSE"
  | "STOCK"
  | "CHECKOUT"
  | "CONTRIBUTE_BUILD"
  | "CONTRIBUTE_UPGRADE"
}>;

export interface GameEvent {
  franchiseId: string;
  category: string;
  description: string;
  amountMinor: number;
  eventId?: string;
  sequence?: number;
  occurredAt?: string;
  type?: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface ActionResult {
  state: GameState;
  ok: boolean;
  message: string;
  events: GameEvent[];
}
