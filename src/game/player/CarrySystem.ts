import type { CarryState, Inventory, ProductId } from "../types";
import { PRODUCT_CONFIG } from "../economy/products";
import { stationTierModifiers } from "../progression/levels";

export const CAPACITY_TIERS = [3, 5, 8, 12, 16, 20] as const;
export const MAX_WAREHOUSE_PICKUP_BATCH = CAPACITY_TIERS[CAPACITY_TIERS.length - 1];

/** Stable order for a hands-free stockroom pickup. One unit per available SKU
 * is taken per round, so a single proximity pass can build a mixed basket
 * instead of letting the first warehouse key monopolise all free capacity. */
export const WAREHOUSE_PICKUP_PRODUCT_ORDER: readonly ProductId[] = [
  "wheat", "flour", "bread", "corn", "milk", "eggs", "cheese", "apples", "tomatoes", "coffee", "juice",
];

export function createCarryContainer(tier = 0): CarryState {
  return { capacity: CAPACITY_TIERS[Math.min(CAPACITY_TIERS.length - 1, Math.max(0, tier))], items: {} };
}

export function carryTotal(container: Pick<CarryState, "items">) {
  return Object.values(container.items).reduce((total, quantity) => total + Math.max(0, Math.floor(quantity ?? 0)), 0);
}

export function carryQuantity(container: Pick<CarryState, "items">, productId: ProductId) {
  return Math.max(0, Math.floor(container.items[productId] ?? 0));
}

export function carriedProductIds(container: Pick<CarryState, "items">) {
  return (Object.entries(container.items) as [ProductId, number | undefined][])
    .filter((entry): entry is [ProductId, number] => Number.isFinite(entry[1]) && entry[1]! > 0)
    .map(([productId]) => productId);
}

export function primaryCarryProduct(container: Pick<CarryState, "items">): ProductId | null {
  return carriedProductIds(container)[0] ?? null;
}

/** Selects the carried product whose display is least full. Shelf upgrades use
 * one shared capacity multiplier, so comparing each count against its base
 * capacity preserves the exact ordering without copying economy mutations into
 * the scene. This prevents an insertion-order item with a full shelf from
 * blocking another product that can still be stocked. */
export function preferredStockingProduct(
  container: Pick<CarryState, "items">,
  shelves: Partial<Inventory>,
  shelfTier = 1,
  allowedProducts?: readonly ProductId[],
): ProductId | null {
  let selected: ProductId | null = null;
  let selectedFill = Number.POSITIVE_INFINITY;
  const capacityMultiplier = stationTierModifiers(shelfTier).capacity;
  const allowed = allowedProducts ? new Set<ProductId>(allowedProducts) : null;
  for (const productId of carriedProductIds(container)) {
    if (allowed && !allowed.has(productId)) continue;
    const baseCapacity = PRODUCT_CONFIG[productId]?.shelfCapacity ?? 12;
    const capacity = Math.max(1, Math.round(baseCapacity * capacityMultiplier));
    const quantity = Math.max(0, shelves[productId] ?? 0);
    if (quantity >= capacity) continue;
    const fill = quantity / capacity;
    if (fill < selectedFill) {
      selected = productId;
      selectedFill = fill;
    }
  }
  return selected;
}

/**
 * Produces one authoritative proximity batch for a single product. The batch
 * is clamped against both the basket and the exact tier-adjusted shelf space;
 * the same quantity drives the engine mutation and every staggered visual
 * unit, so a fast walk-by can unload the department without teleporting or
 * creating stock.
 */
export function nextStockingPulse(
  container: Pick<CarryState, "items">,
  shelves: Partial<Inventory>,
  shelfTier = 1,
  allowedProducts?: readonly ProductId[],
) {
  const productId = preferredStockingProduct(container, shelves, shelfTier, allowedProducts);
  if (!productId) return null;
  const shelfCapacity = Math.max(1, Math.round((PRODUCT_CONFIG[productId]?.shelfCapacity ?? 12) * stationTierModifiers(shelfTier).capacity));
  const shelfQuantity = Math.max(0, Math.floor(shelves[productId] ?? 0));
  const quantity = Math.min(carryQuantity(container, productId), Math.max(0, shelfCapacity - shelfQuantity));
  return quantity > 0 ? { productId, quantity } : null;
}

/** Executes the carry side of one shelf transfer.  The engine remains the
 * authority for capacity and counters; this helper only guarantees that the
 * basket removal and the shelf addition use the same confirmed integer amount. */
export function transferCarryToShelf(
  container: CarryState,
  productId: ProductId,
  shelfQuantity: number,
  shelfCapacity: number,
  requested = 1,
) {
  const safeShelfQuantity = Math.max(0, Math.floor(Number.isFinite(shelfQuantity) ? shelfQuantity : 0));
  const safeShelfCapacity = Math.max(0, Math.floor(Number.isFinite(shelfCapacity) ? shelfCapacity : 0));
  const safeRequested = Math.max(0, Math.floor(Number.isFinite(requested) ? requested : 0));
  const removable = Math.min(carryQuantity(container, productId), safeRequested, Math.max(0, safeShelfCapacity - safeShelfQuantity));
  const removed = removeFromCarry(container, productId, removable);
  return { container: removed.container, shelfQuantity: safeShelfQuantity + removed.moved, moved: removed.moved };
}

/** Fast, side-effect-free eligibility check used by the physical stockroom
 * sensor. Keeping it beside the transfer prevents the scene from advertising
 * or queueing an action that the authoritative mutation must reject. */
export function canPickupWarehouse(
  warehouse: Partial<Inventory>,
  container: Pick<CarryState, "capacity" | "items">,
  productId?: ProductId,
) {
  if (carryTotal(container) >= Math.max(0, Math.floor(container.capacity))) return false;
  const candidates = productId ? [productId] : WAREHOUSE_PICKUP_PRODUCT_ORDER;
  return candidates.some((candidate) => {
    const quantity = Number(warehouse[candidate] ?? 0);
    return Number.isFinite(quantity) && Math.floor(quantity) > 0;
  });
}

/**
 * Moves one capacity-bounded stockroom batch into the player's basket without
 * mutating either source. Omitting `productId` distributes the batch across
 * every available SKU in deterministic rounds; specifying it keeps a future
 * product selector possible without introducing a second economy transition.
 */
export function transferWarehouseToCarry(
  warehouse: Inventory,
  container: CarryState,
  requested?: number,
  productId?: ProductId,
) {
  const freeCapacity = Math.max(0, Math.floor(container.capacity) - carryTotal(container));
  const safeRequested = requested === undefined
    ? freeCapacity
    : Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  const transferLimit = Math.min(freeCapacity, safeRequested, MAX_WAREHOUSE_PICKUP_BATCH);
  if (transferLimit < 1) return { warehouse, container, moved: 0, movedByProduct: {} as Partial<Inventory> };

  const candidates = productId ? [productId] : WAREHOUSE_PICKUP_PRODUCT_ORDER;
  const nextWarehouse = { ...warehouse };
  const movedByProduct: Partial<Inventory> = {};
  let nextContainer = container;
  let moved = 0;

  // The hard batch cap keeps this loop bounded even if a malformed legacy
  // snapshot claims an unrealistic basket capacity.
  while (moved < transferLimit) {
    let movedThisRound = 0;
    for (const candidate of candidates) {
      if (moved >= transferLimit) break;
      const available = Math.max(0, Math.floor(nextWarehouse[candidate] ?? 0));
      if (available < 1) continue;
      const addition = addToCarry(nextContainer, candidate, available, 1);
      if (addition.moved < 1) continue;
      nextContainer = addition.container;
      nextWarehouse[candidate] = available - addition.moved;
      movedByProduct[candidate] = (movedByProduct[candidate] ?? 0) + addition.moved;
      moved += addition.moved;
      movedThisRound += addition.moved;
    }
    if (movedThisRound < 1) break;
  }

  return { warehouse: nextWarehouse, container: nextContainer, moved, movedByProduct };
}

export function addToCarry(container: CarryState, productId: ProductId, available: number, requested = 1) {
  if (available <= 0 || requested <= 0) return { container, moved: 0 };
  const moved = Math.max(0, Math.min(Math.floor(available), Math.floor(requested), container.capacity - carryTotal(container)));
  if (!moved) return { container, moved: 0 };
  return { container: { ...container, items: { ...container.items, [productId]: carryQuantity(container, productId) + moved } }, moved };
}

export function removeFromCarry(container: CarryState, productId: ProductId, requested = 1) {
  const current = carryQuantity(container, productId);
  if (!current || requested <= 0) return { container, moved: 0 };
  const moved = Math.min(current, Math.floor(requested));
  const items: Partial<Inventory> = { ...container.items };
  const remaining = current - moved;
  if (remaining) items[productId] = remaining;
  else delete items[productId];
  return { container: { ...container, items }, moved };
}
