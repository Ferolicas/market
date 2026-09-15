import { COUNTRIES, PRODUCTS } from "../catalog";
import { MAX_WAREHOUSE_PICKUP_BATCH } from "../player/CarrySystem";
import type { CarryState, GameEvent, GameState, Inventory, ProductId } from "../types";
import { validatePendingEvents } from "./Snapshot";

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
export function validateSaveTransition(current: GameState, next: GameState, events: GameEvent[]): SaveAuthorityResult {
  if (!validatePendingEvents(events)) return { ok: false, code: "INVALID_EVENTS" };
  if (next.schemaVersion !== 4 || next.revision < current.revision || next.day < current.day || next.simulationTimeMs < current.simulationTimeMs || next.lastServerTime < current.lastServerTime) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (next.level < current.level || next.level > Math.min(30, current.level + 2) || next.xp < current.xp || next.reputation < current.reputation) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (next.currency !== COUNTRIES[next.countryCode].currency) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (current.tutorialStep > 0 && (next.countryCode !== current.countryCode || next.currency !== current.currency)) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (!next.franchises.some((franchise) => franchise.id === next.currentFranchiseId && franchise.owned)) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  const initialCountryConversion = current.tutorialStep === 0 && current.countryCode !== next.countryCode;
  const initialCountryScale = COUNTRIES[next.countryCode].startingCapitalMinor / COUNTRIES[current.countryCode].startingCapitalMinor;
  if (current.franchises.length !== next.franchises.length || current.franchises.some((franchise) => {
    const candidate = next.franchises.find((item) => item.id === franchise.id);
    return !candidate
      || candidate.name !== franchise.name
      || candidate.city !== franchise.city
      || candidate.unlockLevel !== franchise.unlockLevel
      || candidate.purchaseCostMinor !== (initialCountryConversion ? Math.round(franchise.purchaseCostMinor * initialCountryScale) : franchise.purchaseCostMinor)
      || (franchise.owned && !candidate.owned)
      || (!franchise.owned && candidate.owned && next.level < candidate.unlockLevel);
  })) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (!progressionIsMonotonic(current, next)) return { ok: false, code: "INVALID_STATE_TRANSITION" };
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
  if (next.balanceMinor - current.balanceMinor !== declaredDelta) return { ok: false, code: "INVALID_BALANCE_DELTA" };
  if (!positiveEventsArePlausible(current, next, events)) return { ok: false, code: "INVALID_BALANCE_DELTA" };
  return { ok: true };
}

const PRODUCT_IDS: ProductId[] = ["wheat", "flour", "bread", "corn", "milk", "eggs", "cheese", "apples", "tomatoes", "oranges", "coffee", "juice"];

function hasInvalidInventory(inventory: Inventory) {
  return PRODUCT_IDS.some((productId) => !Number.isSafeInteger(inventory[productId]) || inventory[productId] < 0 || inventory[productId] > 1_000_000);
}

function hasInvalidCarry(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return true;
  const carry = input as Partial<CarryState>;
  const capacity = carry.capacity;
  if (typeof capacity !== "number" || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_WAREHOUSE_PICKUP_BATCH) return true;
  if (!carry.items || typeof carry.items !== "object" || Array.isArray(carry.items)) return true;
  const entries = Object.entries(carry.items);
  if (entries.some(([productId, quantity]) => !PRODUCT_IDS.includes(productId as ProductId) || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1_000_000)) return true;
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
  const maximumSale = Math.ceil(maximumUnitPrice * moneyScale * 1.18 * (1 + country.salesTaxRate) * 15);
  for (const event of events) {
    if (event.amountMinor <= 0) continue;
    if (event.category === "sales") {
      if (event.amountMinor > maximumSale || typeof event.payload?.transactionId !== "string") return false;
      continue;
    }
    if (event.category === "mission") {
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
