export type CountryCode = "ES" | "US" | "CO" | "MX" | "AR" | "CL" | "PE";
export type EmployeeRole = "farmer" | "operator" | "stocker" | "cashier" | "builder" | "manager";
export type HatId = "red-panda" | "red-fox" | "chicken" | "frog" | "mouse" | "elephant" | "rhino" | "giraffe" | "panda" | "owl" | "cow" | "rabbit" | "axolotl" | "capybara";
export type AvatarHatId = HatId | "none";
export type CharacterId = "adult-man" | "adult-woman" | "boy" | "girl";
export type HairId = "side-part" | "fade" | "waves" | "swept" | "bob" | "ponytail" | "long-wavy" | "bun" | "messy" | "curls" | "short-fringe" | "quiff" | "blunt-bob" | "pigtails" | "braid" | "high-ponytail";
export type ProductId = "wheat" | "flour" | "bread" | "milk" | "eggs" | "apples" | "tomatoes" | "coffee" | "juice";
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
}

export interface MachineState {
  flourMillLevel: number;
  bakeryLevel: number;
  flourQueue: number;
  breadQueue: number;
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
  schemaVersion: 2;
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
  lastSavedAt: string;
}

export type GameAction =
  | { type: "SET_COUNTRY"; countryCode: CountryCode }
  | { type: "SET_AVATAR"; body?: CharacterId; hair?: HairId; hairColor?: string; skin?: string; shirt?: string; hat?: AvatarHatId }
  | { type: "TOGGLE_STORE" }
  | { type: "HARVEST" }
  | { type: "LOAD_FLOUR_MILL" }
  | { type: "BAKE_BREAD" }
  | { type: "STOCK"; productId: ProductId; quantity?: number }
  | { type: "CHECKOUT"; paymentMethod: PaymentMethod }
  | { type: "ORDER"; supplierId: string; productId: ProductId; quantity: number }
  | { type: "HIRE"; role: EmployeeRole }
  | { type: "UPGRADE"; upgrade: "shelves" | "checkout" | "expansion" | "mill" | "bakery" }
  | { type: "BUY_LICENSE" }
  | { type: "BUY_FRANCHISE"; franchiseId: string }
  | { type: "TRAVEL"; franchiseId: string }
  | { type: "CLAIM_MISSION"; missionId: string }
  | { type: "CLOSE_DAY" };

export interface GameEvent {
  category: string;
  description: string;
  amountMinor: number;
}

export interface ActionResult {
  state: GameState;
  ok: boolean;
  message: string;
  events: GameEvent[];
}
