import type { CarryState, Inventory, ProductId } from "../types";
import { PRODUCT_CONFIG } from "../economy/products";
import { stationTierModifiers } from "../progression/levels";

export const CAPACITY_TIERS = [3, 5, 8, 12, 16, 20] as const;

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
export function preferredStockingProduct(container: Pick<CarryState, "items">, shelves: Partial<Inventory>, shelfTier = 1): ProductId | null {
  let selected: ProductId | null = null;
  let selectedFill = Number.POSITIVE_INFINITY;
  const capacityMultiplier = stationTierModifiers(shelfTier).capacity;
  for (const productId of carriedProductIds(container)) {
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
 * Produces one authoritative proximity pulse for shelf stocking. Keeping each
 * pulse unitary means the visual transfer and the engine mutation cannot
 * disagree when a shelf only has a small amount of free space: the same pulse
 * supplies both the action quantity and the burst quantity.
 */
export function nextStockingPulse(container: Pick<CarryState, "items">, shelves: Partial<Inventory>, shelfTier = 1) {
  const productId = preferredStockingProduct(container, shelves, shelfTier);
  return productId ? { productId, quantity: 1 as const } : null;
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
