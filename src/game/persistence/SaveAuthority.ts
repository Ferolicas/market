import { COUNTRIES } from "../catalog";
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
  if (next.currency !== COUNTRIES[next.countryCode].currency) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (current.tutorialStep > 0 && (next.countryCode !== current.countryCode || next.currency !== current.currency)) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (!next.franchises.some((franchise) => franchise.id === next.currentFranchiseId && franchise.owned)) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (current.franchises.some((franchise) => !next.franchises.some((candidate) => candidate.id === franchise.id))) return { ok: false, code: "INVALID_STATE_TRANSITION" };
  if (next.franchises.some((franchise) => (
    hasInvalidInventory(franchise.warehouse)
    || hasInvalidInventory(franchise.shelves)
    || hasInvalidCarry(franchise.carry)
    || franchise.employees.some((employee) => hasInvalidEmployeeCarry(employee.runtime))
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
  return { ok: true };
}

const PRODUCT_IDS: ProductId[] = ["wheat", "flour", "bread", "corn", "milk", "eggs", "cheese", "apples", "tomatoes", "coffee", "juice"];

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
