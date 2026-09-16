import { z } from "zod";
import type { GameEvent, GameState } from "@/game/types";
import { CROP_PRODUCT_IDS, MACHINE_PRODUCT_IDS, PRODUCT_IDS } from "../game/economy/ProductRegistry";
import { OPENING_PURCHASES } from "../game/progression/MartCampaign";
import { CAMPAIGN_TASK_IDS } from "../game/progression/CampaignTasks";
import { CAMPAIGN_CONTRACT_IDS } from "../game/progression/CampaignContracts";
import { MAX_SHOPPING_LINES, MAX_SHOPPING_LINE_UNITS } from "../game/ai/CustomerBrain";

const purchaseIdSchema = z.enum(OPENING_PURCHASES.map((purchase) => purchase.id));
const purchaseStateSchema = z.object({
  version: z.literal(1), inherited: z.array(purchaseIdSchema).max(100),
  purchased: z.array(purchaseIdSchema).max(100),
  contributions: z.partialRecord(purchaseIdSchema, z.number().int().nonnegative().safe()),
  personalProgress: z.partialRecord(z.enum(CAMPAIGN_TASK_IDS), z.number().int().min(0).max(100)).optional(),
  completedContracts: z.array(z.enum(CAMPAIGN_CONTRACT_IDS)).max(18).optional(),
});

const productIdSchema = z.enum(PRODUCT_IDS);
const inventoryQuantitySchema = z.number().int().min(0).max(1_000_000);
const inventorySchema = z.record(productIdSchema, inventoryQuantitySchema);
const carrySchema = z.object({
  capacity: z.number().int().min(1).max(20),
  items: z.partialRecord(productIdSchema, inventoryQuantitySchema),
});
const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const employeeRuntimeSchema = z.object({
  state: z.enum(["IDLE", "NAVIGATE_PICKUP", "PICKUP", "NAVIGATE_DROPOFF", "DROPOFF", "NAVIGATE_RETURN", "RETURN_TO_WAREHOUSE", "NAVIGATE_CHECKOUT", "WAIT_CHECKOUT_STATION", "OPERATE_CHECKOUT"]),
  assignedProduct: productIdSchema.nullable(), assignedStationId: z.string().max(100).nullable(), carry: carrySchema,
  x: z.number().finite(), z: z.number().finite(), targetX: z.number().finite(), targetZ: z.number().finite(),
  path: z.array(pointSchema).max(200), pathIndex: z.number().int().min(0).max(200), speed: z.number().finite().min(0).max(20),
  currentSpeed: z.number().finite().min(0).max(20).optional(), stateSince: z.number().finite().min(0),
});
const employeeSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(80),
  role: z.enum(["farmer", "feeder", "operator", "stocker", "cashier", "builder", "manager"]),
  level: z.number().int().min(1).max(10), salaryMinor: z.number().int().min(0), energy: z.number().finite().min(0).max(100),
  hat: z.enum(["red-panda", "red-fox", "chicken", "frog", "elephant", "rhino", "giraffe", "panda", "owl", "cow", "rabbit", "capybara"]),
  runtime: employeeRuntimeSchema.optional(),
});
const customerSchema = z.object({
  id: z.string().min(1).max(120), identity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  state: z.string().min(1).max(40),
  shoppingList: z.array(z.object({ productId: productIdSchema, requested: z.number().int().min(0).max(MAX_SHOPPING_LINE_UNITS), picked: z.number().int().min(0).max(MAX_SHOPPING_LINE_UNITS) })).max(MAX_SHOPPING_LINES),
  currentLine: z.number().int().min(0).max(5), basket: z.partialRecord(productIdSchema, inventoryQuantitySchema),
  patienceMs: z.number().finite().min(0).max(600_000), checkoutPatienceMs: z.number().finite().min(0).max(600_000),
  waitingSince: z.number().finite().min(0).nullable(), queueSlot: z.number().int().min(0).max(100).nullable(),
  queueLane: z.union([z.literal(0), z.literal(1)]).optional(), queueJoinedAt: z.number().finite().min(0).nullable().optional(), transactionId: z.string().max(120).nullable(),
  hasCart: z.boolean(), hasBag: z.boolean(), angry: z.boolean(),
  x: z.number().finite(), z: z.number().finite(), targetX: z.number().finite(), targetZ: z.number().finite(),
  path: z.array(pointSchema).max(200), pathIndex: z.number().int().min(0).max(200), speed: z.number().finite().min(0).max(20), currentSpeed: z.number().finite().min(0).max(20).optional(),
  stateSince: z.number().finite().min(0), reservedSocketId: z.string().max(120).nullable(), blockedSince: z.number().finite().min(0).nullable(), routeFailures: z.number().int().min(0).max(1_000),
});
const transactionSchema = z.object({
  id: z.string().min(1).max(120), customerId: z.string().min(1).max(120),
  pendingItems: z.array(z.object({
    productId: productIdSchema, quantity: z.number().int().min(1).max(MAX_SHOPPING_LINE_UNITS), loaded: z.number().int().min(0).max(MAX_SHOPPING_LINE_UNITS),
    scanned: z.number().int().min(0).max(MAX_SHOPPING_LINE_UNITS), bagged: z.number().int().min(0).max(MAX_SHOPPING_LINE_UNITS),
  })).max(MAX_SHOPPING_LINES),
  paymentMethod: z.enum(["cash", "card"]), state: z.enum(["CUSTOMER_LOADING", "SCANNING", "BAGGING", "PAYMENT", "COMPLETE", "ABANDONED"]),
  nextUnitIndex: z.number().int().min(0).max(20), paymentCommitted: z.boolean(),
  updatedAt: z.number().finite().min(0), lastLoadedAt: z.number().finite().min(0), lastScannedAt: z.number().finite().min(0), lastBaggedAt: z.number().finite().min(0),
  checkoutLane: z.union([z.literal(0), z.literal(1)]).optional(), handledByPlayer: z.boolean().optional(),
});
const cropSchema = z.object({
  id: z.string().min(1).max(100), productId: z.enum(CROP_PRODUCT_IDS),
  status: z.enum(["LOCKED", "EMPTY", "GROWING", "READY", "HARVESTING"]), plantedAt: z.number().finite(), readyAt: z.number().finite(),
  available: inventoryQuantitySchema, tier: z.number().int().min(1).max(10),
  baseYield: z.number().int().min(1).max(20).optional(),
});
const productionMachineSchema = z.object({
  id: z.string().min(1).max(100), productId: z.enum(MACHINE_PRODUCT_IDS),
  status: z.enum(["LOCKED", "IDLE", "WAITING_INPUT", "PROCESSING", "OUTPUT_READY", "FULL"]), input: z.partialRecord(productIdSchema, inventoryQuantitySchema),
  output: inventoryQuantitySchema, outputCapacity: z.number().int().min(1).max(1_000_000), startedAt: z.number().finite().nullable(), completesAt: z.number().finite().nullable(), tier: z.number().int().min(1).max(10),
});
const franchiseSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(120), city: z.string().min(1).max(120), unlockLevel: z.number().int().min(1).max(30),
  purchaseCostMinor: z.number().int().min(0), owned: z.boolean(), open: z.boolean(), licenseActive: z.boolean(), licenseDaysLeft: z.number().int().min(0).max(365),
  expansionLevel: z.number().int().min(1).max(10), shelvesLevel: z.number().int().min(1).max(10), checkoutLevel: z.number().int().min(1).max(10),
  warehouse: inventorySchema, shelves: inventorySchema,
  machines: z.object({ flourMillLevel: z.number().int().min(1).max(10), bakeryLevel: z.number().int().min(1).max(10), flourQueue: inventoryQuantitySchema, breadQueue: inventoryQuantitySchema }),
  carry: carrySchema, crops: z.array(cropSchema).max(20), productionMachines: z.array(productionMachineSchema).max(20),
  buildProjects: z.array(z.object({ id: z.string().min(1).max(100), level: z.number().int().min(2).max(30), costMinor: z.number().int().min(0), contributedMinor: z.number().int().min(0), completed: z.boolean() })).max(30),
  checkoutTransactions: z.array(transactionSchema).max(100),
  registerCashMinor: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).default([0, 0]),
  purchases: purchaseStateSchema.optional(),
  returnsBin: inventorySchema, returnedCartCount: z.number().int().min(0).max(1_000_000),
  customers: z.array(customerSchema).max(100), nextCustomerSequence: z.number().int().min(1), lastCustomerSpawnAt: z.number().finite(), queueCustomerIds: z.array(z.string().max(120)).max(100),
  unlockedAreas: z.array(z.string().min(1).max(100)).max(100), stationTiers: z.record(z.string().min(1).max(100), z.number().int().min(1).max(10)),
  upgradeContributions: z.record(z.string().min(1).max(100), z.number().int().min(0)), playerSpeedTier: z.number().int().min(1).max(10),
  playerCapacityTier: z.number().int().min(1).max(10), storeRank: z.number().int().min(1).max(10), structureRevision: z.number().int().min(1),
  doorState: z.enum(["CLOSED", "OPENING", "OPEN", "CLOSING", "BLOCKED"]), doorProgress: z.number().finite().min(0).max(1), doorPlayerPresent: z.boolean(),
  doorEmptySince: z.number().finite().min(0).nullable(), lightsOn: z.boolean(), employees: z.array(employeeSchema).max(100),
  revenueTodayMinor: z.number().int().min(0), expensesTodayMinor: z.number().int().min(0), customersToday: z.number().int().min(0), rating: z.number().finite().min(1).max(5),
});

export const savePayloadSchema = z.object({
  expectedRevision: z.number().int().min(0), operationId: z.string().uuid(), deviceId: z.string().uuid(), sessionId: z.string().uuid(),
  /** Conflict resolution chosen by the owner: adopt this snapshot as the next
   * revision without replaying its event chain. */
  adoptLocal: z.boolean().optional(),
  state: z.object({
    schemaVersion: z.literal(4), revision: z.number().int().min(0), countryCode: z.enum(["ES", "US", "CO", "MX", "AR", "CL", "PE"]),
    currency: z.string().length(3), balanceMinor: z.number().int().finite(), level: z.number().int().min(1).max(30), xp: z.number().int().min(0), reputation: z.number().int().min(0),
    day: z.number().int().min(1), minuteOfDay: z.number().finite().min(0), currentFranchiseId: z.string().min(1).max(80),
    avatar: z.object({
      body: z.enum(["adult-man", "adult-woman", "boy", "girl"]),
      hair: z.enum(["side-part", "fade", "waves", "swept", "bob", "ponytail", "long-wavy", "bun", "messy", "curls", "short-fringe", "quiff", "blunt-bob", "pigtails", "braid", "high-ponytail"]),
      hairColor: z.string().regex(/^#[0-9a-f]{6}$/i), skin: z.string().regex(/^#[0-9a-f]{6}$/i), shirt: z.string().regex(/^#[0-9a-f]{6}$/i),
      hat: z.enum(["none", "red-panda", "red-fox", "chicken", "frog", "elephant", "rhino", "giraffe", "panda", "owl", "cow", "rabbit", "capybara"]),
    }),
    franchises: z.array(franchiseSchema).min(1).max(20),
    missions: z.array(z.object({ id: z.string().min(1).max(100), label: z.string().min(1).max(160), kind: z.enum(["sales", "stock", "harvest", "production", "customers"]), target: z.number().finite().min(0), progress: z.number().finite().min(0), rewardMinor: z.number().int().min(0), completed: z.boolean(), claimed: z.boolean() })).max(20),
    pendingOrders: z.array(z.object({ id: z.string().min(1).max(120), franchiseId: z.string().min(1).max(80), supplierId: z.string().min(1).max(80), productId: productIdSchema, quantity: z.number().int().min(1).max(1_000_000), totalMinor: z.number().int().min(0), arrivesAtMinute: z.number().finite().min(0) })).max(200),
    finances: z.object({ grossRevenueMinor: z.number().int().min(0), costOfGoodsMinor: z.number().int().min(0), payrollMinor: z.number().int().min(0), operatingCostsMinor: z.number().int().min(0), taxesMinor: z.number().int().min(0), netProfitMinor: z.number().int() }),
    tutorialStep: z.number().int().min(0).max(100),
    progression: z.object({ completedLevels: z.array(z.number().int().min(1).max(30)).max(30), counters: z.record(z.string().max(120), z.number().finite().min(0)), levelStartedCounters: z.record(z.string().max(120), z.number().finite().min(0)), playerActionCount: z.number().int().min(0), levelStartedPlayerActionCount: z.number().int().min(0), objectiveComplete: z.boolean(), lastUnlockAt: z.number().finite().min(0) }),
    eventSequence: z.number().int().min(0), processedEventIds: z.array(z.string().uuid()).max(1_000), lastServerTime: z.number().finite().min(0), simulationTimeMs: z.number().finite().min(0), lastSavedAt: z.string().datetime(),
  }),
  events: z.array(z.object({
    franchiseId: z.string().min(1).max(80), category: z.string().min(1).max(40), description: z.string().min(1).max(160), amountMinor: z.number().int().finite(),
    eventId: z.string().uuid(), sequence: z.number().int().positive(), occurredAt: z.string().datetime(), type: z.string().min(1).max(80), payload: z.record(z.string(), z.unknown()), idempotencyKey: z.string().min(1).max(120),
  })).max(200).default([]),
});

export type ValidSavePayload = Omit<z.infer<typeof savePayloadSchema>, "state" | "events"> & { state: GameState; events: GameEvent[] };
