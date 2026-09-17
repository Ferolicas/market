import { COUNTRIES, PRODUCTS } from "../catalog";
import { isProductId, PRODUCT_IDS } from "../economy/ProductRegistry";
import { MAX_WAREHOUSE_PICKUP_BATCH } from "../player/CarrySystem";
import type { CarryState, GameEvent, GameState, Inventory } from "../types";
import { validatePendingEvents } from "./Snapshot";
import { contributePurchase } from "../progression/PurchaseState";
import { addCampaignTaskProgress, CAMPAIGN_TASK_IDS, campaignTaskTarget, type CampaignTaskId, type CampaignTaskProgress } from "../progression/CampaignTasks";
import { OPENING_PURCHASES, campaignAvailableProducts } from "../progression/MartCampaign";
import { CAMPAIGN_CONTRACTS, type CampaignContractId } from "../progression/CampaignContracts";
import { campaignExpansionQuote } from "../progression/CampaignExpansion";
import { campaignGlobalLevel, campaignEmployeeLimit, campaignPriceMultiplier } from "../progression/CampaignLevels";
import { CHECKOUT_LANE_IDS, isCheckoutLane } from "../stations/checkout-layout";

export type SaveAuthorityCode =
  | "INVALID_EVENTS"
  | "INVALID_SEQUENCE"
  | "INVALID_EVENT_CHAIN"
  | "INVALID_BALANCE_DELTA"
  | "INVALID_STATE_TRANSITION";

export type SaveAuthorityResult = { ok: true } | { ok: false; code: SaveAuthorityCode };

/**
 * Guards the client snapshot with invariants that can be verified without
 * replaying graphics or trusting a browser clock. Save revision locking is
 * handled by the API transaction; this verifies the enclosed domain stream.
 */
export function validateSaveTransition(current: GameState, next: GameState, events: GameEvent[], options: { allowLegacyWalletSales?: boolean } = {}): SaveAuthorityResult {
  if (!validatePendingEvents(events)) return { ok: false, code: "INVALID_EVENTS" };
  if (next.schemaVersion !== 4 || next.revision < current.revision || next.simulationTimeMs < current.simulationTimeMs || next.lastServerTime < current.lastServerTime) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  const campaign = current.franchises.some((item) => item.purchases);
  if (next.level < current.level || (campaign ? next.level !== campaignGlobalLevel(next) : next.level > Math.min(30, current.level + 2)) || next.xp < current.xp || next.reputation < current.reputation) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (campaign && next.franchises.some((franchise) => franchise.employees.some((employee) => franchise.employees.filter((item) => item.role === employee.role).length > campaignEmployeeLimit(franchise, employee.role)))) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (next.currency !== COUNTRIES[next.countryCode].currency) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (current.tutorialStep > 0 && (next.countryCode !== current.countryCode || next.currency !== current.currency)) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (!next.franchises.some((franchise) => franchise.id === next.currentFranchiseId && franchise.owned)) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  const initialCountryConversion = current.tutorialStep === 0 && current.countryCode !== next.countryCode;
  const initialCountryScale = COUNTRIES[next.countryCode].startingCapitalMinor / COUNTRIES[current.countryCode].startingCapitalMinor;
  if (current.franchises.length !== next.franchises.length || current.franchises.some((franchise) => {
    const candidate = next.franchises.find((item) => item.id === franchise.id);
    return !candidate
      || (candidate.id === next.currentFranchiseId ? next.day : candidate.businessDay ?? 1) < (franchise.id === current.currentFranchiseId ? current.day : franchise.businessDay ?? 1)
      || candidate.name !== franchise.name
      || candidate.city !== franchise.city
      || candidate.unlockLevel !== franchise.unlockLevel
      || candidate.purchaseCostMinor !== (initialCountryConversion ? Math.round(franchise.purchaseCostMinor * initialCountryScale) : franchise.purchaseCostMinor)
      || (franchise.owned && !candidate.owned)
      || (!franchise.owned && candidate.owned && !franchise.purchases && next.level < candidate.unlockLevel);
  })) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (!progressionIsMonotonic(current, next)) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (!purchaseTransfersAreConserved(current, next, events)) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (!campaignOpeningsAreConserved(current, next, events)) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (next.franchises.some((franchise) => (
    hasInvalidInventory(franchise.warehouse)
    || hasInvalidInventory(franchise.shelves)
    || hasInvalidCarry(franchise.carry)
    || franchise.employees.some((employee) => hasInvalidEmployeeCarry(employee.runtime))
    || franchise.rating < 1 || franchise.rating > 5
    || !validTier(franchise.expansionLevel) || !validTier(franchise.shelvesLevel) || !validTier(franchise.checkoutLevel)
    || !validTier(franchise.playerSpeedTier) || !validTier(franchise.playerCapacityTier)
    || franchise.employees.some((employee) => !validTier(employee.level) || employee.energy < 0 || employee.energy > 100)
    || Object.values(franchise.stationTiers).some((tier) => !validTier(tier))
  ))) return { ok: false, code: "INVALID_STATE_TRANSITION" };

  const ids = new Set<string>();
  const idempotencyKeys = new Set<string>();
  const ownedFranchiseIds = new Set(next.franchises.filter((franchise) => franchise.owned).map((franchise) => franchise.id));
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!ownedFranchiseIds.has(event.franchiseId)) return { ok: false, code: "INVALID_EVENTS" };
    if (!event.eventId || !event.idempotencyKey || event.sequence !== current.eventSequence + index + 1 || ids.has(event.eventId) || idempotencyKeys.has(event.idempotencyKey)) return { ok: false, code: "INVALID_SEQUENCE" };
    ids.add(event.eventId);
    idempotencyKeys.add(event.idempotencyKey);
  }
  if (next.eventSequence !== current.eventSequence + events.length) return { ok: false, code: "INVALID_SEQUENCE" };
  if (events.some((event) => !next.processedEventIds.includes(event.eventId!))) return { ok: false, code: "INVALID_EVENT_CHAIN" };
  const retainedCurrentIds = current.processedEventIds.slice(-Math.max(0, 1_000 - events.length));
  if (retainedCurrentIds.some((id) => !next.processedEventIds.includes(id))) return { ok: false, code: "INVALID_EVENT_CHAIN" };

  const declaredDelta = events.reduce((total, event) => total + event.amountMinor, 0);
  const tillTotal = (state: GameState) => state.franchises.reduce((sum, franchise) => sum + CHECKOUT_LANE_IDS.reduce<number>((lanes, lane) => lanes + (franchise.registerCashMinor?.[lane] ?? 0), 0), 0);
  const wealthDelta = (next.balanceMinor - current.balanceMinor) + (tillTotal(next) - tillTotal(current));
  if (!Number.isSafeInteger(wealthDelta) || !Number.isSafeInteger(declaredDelta) || !Number.isSafeInteger(tillTotal(current)) || !Number.isSafeInteger(tillTotal(next))
    || wealthDelta !== declaredDelta || !registerTransfersAreConserved(current, next, events, options.allowLegacyWalletSales === true)) return { ok: false, code: "INVALID_BALANCE_DELTA" };
  if (!positiveEventsArePlausible(current, next, events)) return { ok: false, code: "INVALID_BALANCE_DELTA" };
  return { ok: true };
}

/** Replay monetary transfers only. Collection is not a second sale and may
 * not move funds between franchises or invent money by reducing a till. */
function registerTransfersAreConserved(current: GameState, next: GameState, events: GameEvent[], allowLegacyWalletSales: boolean) {
  const balances = new Map(current.franchises.map((franchise) => [franchise.id, CHECKOUT_LANE_IDS.map((lane) => franchise.registerCashMinor?.[lane] ?? 0)]));
  for (const event of events) {
    if (event.category !== "sales" && event.category !== "cash_collection") continue;
    // One-way upgrade: only the server may enable this, based on the stored
    // pre-register snapshot. Old unsent sales already credited the wallet.
    if (allowLegacyWalletSales && event.category === "sales" && event.payload?.lane === undefined) continue;
    const lane = event.payload?.lane;
    const balance = balances.get(event.franchiseId);
    if (!balance || !isCheckoutLane(lane)) return false;
    if (event.category === "sales") {
      if (event.amountMinor <= 0) return false;
      balance[lane] += event.amountMinor;
    } else {
      const amount = event.payload?.collectedMinor;
      if (event.amountMinor !== 0 || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 || amount > balance[lane]) return false;
      balance[lane] -= amount;
    }
    if (!Number.isSafeInteger(balance[lane])) return false;
  }
  return next.franchises.every((franchise) => {
    const expected = balances.get(franchise.id);
    const actual = franchise.registerCashMinor;
    return expected && Array.isArray(actual) && actual.length === CHECKOUT_LANE_IDS.length
      && actual.every((value, lane) => Number.isSafeInteger(value) && value >= 0 && value === expected[lane]);
  });
}

function hasInvalidInventory(inventory: Inventory) {
  return PRODUCT_IDS.some((productId) => !Number.isSafeInteger(inventory[productId]) || inventory[productId] < 0 || inventory[productId] > 1_000_000);
}

function purchaseTransfersAreConserved(current: GameState, next: GameState, events: GameEvent[]) {
  const known = new Map(OPENING_PURCHASES.map((purchase) => [purchase.id as string, purchase.id]));
  for (const franchise of current.franchises) {
    const candidate = next.franchises.find((item) => item.id === franchise.id);
    const transfers = events.filter((event) => event.franchiseId === franchise.id && ["purchase", "player_progress", "contract_delivery"].includes(event.category));
    if (!candidate?.purchases) {
      if (franchise.purchases || transfers.length) return false;
      continue;
    }
    // Campaign reset is a release operation, never a client-side inheritance.
    if (!franchise.purchases) return false;
    let expected = franchise.purchases;
    if (current.countryCode !== next.countryCode && !(current.tutorialStep === 0 && !transfers.length
      && !expected.purchased.length && !Object.keys(expected.contributions).length)) return false;
    for (const transfer of transfers) {
      if (transfer.category === "contract_delivery") {
        const definitions = CAMPAIGN_CONTRACTS.filter((contract) => contract.location === franchise.id);
        const index = definitions.findIndex((contract) => contract.id === transfer.payload?.contractId);
        const contract = definitions[index];
        const completed = expected.completedContracts ?? [];
        if (!contract || transfer.amountMinor !== 0 || completed.includes(contract.id)
          || !definitions.slice(0, index).every((previous) => completed.includes(previous.id))
          || !contract.products.every((product) => campaignAvailableProducts(expected).includes(product))
          || JSON.stringify(transfer.payload?.products) !== JSON.stringify(contract.products)) return false;
        expected = { ...expected, completedContracts: [...completed, contract.id] };
        continue;
      }
      if (transfer.category === "player_progress") {
        const deltas = transfer.payload?.deltas;
        if (transfer.amountMinor !== 0 || !deltas || typeof deltas !== "object" || Array.isArray(deltas)) return false;
        const entries = Object.entries(deltas);
        if (!entries.length || entries.some(([key, value]) => !CAMPAIGN_TASK_IDS.includes(key as CampaignTaskId)
          || !Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > campaignTaskTarget(key as CampaignTaskId, franchise.id))) return false;
        const personalProgress = addCampaignTaskProgress(expected.personalProgress ?? {}, deltas as CampaignTaskProgress, franchise.id);
        if (entries.some(([key, delta]) => (personalProgress[key as keyof typeof personalProgress] ?? 0) - (expected.personalProgress?.[key as keyof typeof personalProgress] ?? 0) !== delta)) return false;
        expected = { ...expected, personalProgress };
        continue;
      }
      const rawId = transfer.payload?.purchaseId;
      const id = typeof rawId === "string" ? known.get(rawId) : undefined;
      if (!id || !Number.isSafeInteger(transfer.amountMinor) || transfer.amountMinor >= 0) return false;
      const result = contributePurchase(expected, id, current.countryCode, -transfer.amountMinor, -transfer.amountMinor);
      if (result.spentMinor !== -transfer.amountMinor || result.state.contributions[id] !== transfer.payload?.contributedMinor
        || result.completedNow !== transfer.payload?.completed) return false;
      expected = result.state;
    }
    const actual = candidate.purchases;
    if (JSON.stringify(actual.completedContracts ?? []) !== JSON.stringify(expected.completedContracts ?? [])) return false;
    if (Object.keys(actual.personalProgress ?? {}).some((id) => !CAMPAIGN_TASK_IDS.includes(id as CampaignTaskId))
      || CAMPAIGN_TASK_IDS.some((id) => (actual.personalProgress?.[id] ?? 0) !== (expected.personalProgress?.[id] ?? 0))) return false;
    if (actual.version !== 1 || JSON.stringify(actual.inherited) !== JSON.stringify(expected.inherited)
      || JSON.stringify(actual.purchased) !== JSON.stringify(expected.purchased)
      || Object.keys(actual.contributions).some((id) => !known.has(id))
      || OPENING_PURCHASES.some(({ id }) => actual.contributions[id] !== expected.contributions[id])) return false;
  }
  return true;
}

/** Purchase/progress values have already been validated above. Replay their
 * order here so finishing a task later cannot authorize an earlier opening. */
function campaignOpeningsAreConserved(current: GameState, next: GameState, events: GameEvent[]) {
  if (!current.franchises.some((franchise) => franchise.owned && franchise.purchases)) return true;
  const cursor = structuredClone(current);
  for (const event of events) {
    const franchise = cursor.franchises.find((item) => item.id === event.franchiseId);
    if (!franchise) return false;
    if (event.category === "capital") {
      const quote = campaignExpansionQuote(cursor, franchise.id);
      if (event.payload?.campaignOpening !== true || !quote.available || event.amountMinor !== -quote.costMinor || !franchise.purchases) return false;
      franchise.owned = true;
    } else if (event.category === "purchase" || event.category === "player_progress" || event.category === "contract_delivery") {
      if (!franchise.owned || !franchise.purchases) return false;
      if (event.category === "contract_delivery") {
        franchise.purchases.completedContracts = [...(franchise.purchases.completedContracts ?? []), event.payload!.contractId as CampaignContractId];
      } else if (event.category === "player_progress") {
        franchise.purchases.personalProgress = addCampaignTaskProgress(franchise.purchases.personalProgress ?? {}, event.payload!.deltas as CampaignTaskProgress, franchise.id);
      } else {
        const id = event.payload!.purchaseId as typeof OPENING_PURCHASES[number]["id"];
        franchise.purchases = contributePurchase(franchise.purchases, id, current.countryCode, -event.amountMinor, -event.amountMinor).state;
      }
    }
  }
  return cursor.franchises.every((franchise) => next.franchises.find((item) => item.id === franchise.id)?.owned === franchise.owned);
}

function hasInvalidCarry(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return true;
  const carry = input as Partial<CarryState>;
  const capacity = carry.capacity;
  if (typeof capacity !== "number" || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_WAREHOUSE_PICKUP_BATCH) return true;
  if (!carry.items || typeof carry.items !== "object" || Array.isArray(carry.items)) return true;
  const entries = Object.entries(carry.items);
  if (entries.some(([productId, quantity]) => !isProductId(productId) || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1_000_000)) return true;
  return entries.reduce((total, [, quantity]) => total + quantity, 0) > capacity;
}

function hasInvalidEmployeeCarry(runtime: unknown) {
  if (runtime === undefined) return false;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return true;
  return hasInvalidCarry((runtime as { carry?: unknown }).carry);
}

function validTier(value: number) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 10;
}

function progressionIsMonotonic(current: GameState, next: GameState) {
  if (next.progression.playerActionCount < current.progression.playerActionCount) return false;
  if (current.progression.completedLevels.some((level) => !next.progression.completedLevels.includes(level))) return false;
  for (const [key, value] of Object.entries(current.progression.counters)) {
    if ((next.progression.counters[key] ?? 0) < value) return false;
  }
  return true;
}

function positiveEventsArePlausible(current: GameState, next: GameState, events: GameEvent[]) {
  const country = COUNTRIES[next.countryCode];
  const moneyScale = country.startingCapitalMinor / COUNTRIES.ES.startingCapitalMinor;
  const maximumUnitPrice = Math.max(...Object.values(PRODUCTS).map((product) => product.saleMinor));
  // Display tier value (1.18), legacy tax and the level-30 campaign price.
  const maximumSale = Math.ceil(maximumUnitPrice * moneyScale * 1.18 * (1 + country.salesTaxRate) * 15 * campaignPriceMultiplier(30));
  for (const event of events) {
    if (event.amountMinor <= 0) continue;
    if (event.category === "sales") {
      if (event.amountMinor > maximumSale || typeof event.payload?.transactionId !== "string") return false;
      continue;
    }
    if (event.category === "mission") {
      if ([current, next].some((state) => state.franchises.some((franchise) => franchise.owned && franchise.purchases))) return false;
      const missionId = event.payload?.missionId;
      const mission = [...current.missions, ...next.missions].find((candidate) => candidate.id === missionId);
      if (!mission || event.amountMinor !== mission.rewardMinor) return false;
      continue;
    }
    if (event.category === "configuration") {
      const validInitialConversion = current.tutorialStep === 0
        && event.payload?.countryCode === next.countryCode
        && next.balanceMinor <= COUNTRIES[next.countryCode].startingCapitalMinor
        && event.amountMinor === COUNTRIES[next.countryCode].startingCapitalMinor - current.balanceMinor;
      if (!validInitialConversion) return false;
      continue;
    }
    return false;
  }
  return true;
}
