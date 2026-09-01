import type { CarryState, CropState, Inventory, ProductId } from "../types";

export interface VisualTransferLedgerEntry {
  sequence: number;
  kind: string;
  cropId?: string;
  productId?: ProductId;
  quantity?: number;
  remainingQuantity?: number;
  carryStart?: number;
  cropStart?: number;
  shelfStart?: number;
}

export interface VisualTransferPresentation {
  carry: CarryState;
  crops: CropState[];
  shelves: Inventory;
}

function nonNegativeInteger(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function inventoryQuantity(inventory: Readonly<Partial<Inventory>>, productId: ProductId) {
  return nonNegativeInteger(inventory[productId]);
}

function transferRemaining(entry: VisualTransferLedgerEntry) {
  return Math.min(nonNegativeInteger(entry.quantity), nonNegativeInteger(entry.remainingQuantity));
}

/**
 * Updates one flight ledger entry with an absolute remaining unit count. A
 * zero remainder removes the entry, which makes the final landing the single
 * point where its presentation overlay disappears. The generic return keeps
 * component-specific event metadata intact.
 */
export function updateVisualTransferRemaining<T extends VisualTransferLedgerEntry>(
  entries: readonly T[],
  sequence: number,
  remainingQuantity: number,
) {
  const remaining = nonNegativeInteger(remainingQuantity);
  return entries.flatMap((entry) => {
    if (entry.sequence !== sequence) return [entry];
    if (remaining < 1) return [];
    return [{ ...entry, remainingQuantity: Math.min(nonNegativeInteger(entry.quantity), remaining) }];
  });
}

function authoritativeMutationIsVisible(
  entry: VisualTransferLedgerEntry,
  carry: CarryState,
  crops: readonly CropState[],
  shelves: Inventory,
) {
  if (!entry.productId) return false;
  const quantity = nonNegativeInteger(entry.quantity);
  if (entry.kind === "stock") {
    const shelfCommitted = entry.shelfStart !== undefined
      && inventoryQuantity(shelves, entry.productId) >= nonNegativeInteger(entry.shelfStart) + quantity;
    const carryCommitted = entry.carryStart !== undefined
      && inventoryQuantity(carry.items, entry.productId) <= Math.max(0, nonNegativeInteger(entry.carryStart) - quantity);
    return shelfCommitted || carryCommitted;
  }
  if (entry.kind === "harvest") {
    const crop = entry.cropId ? crops.find((candidate) => candidate.id === entry.cropId) : undefined;
    const cropCommitted = crop && entry.cropStart !== undefined
      && (crop.status !== "READY" || crop.available <= Math.max(0, nonNegativeInteger(entry.cropStart) - quantity));
    const carryCommitted = entry.carryStart !== undefined
      && inventoryQuantity(carry.items, entry.productId) >= nonNegativeInteger(entry.carryStart) + quantity;
    return Boolean(cropCommitted || carryCommitted);
  }
  return false;
}

/**
 * Reconciles immediate authoritative mutations with transfers that are still
 * visible in flight. Harvested units enter the displayed basket only as they
 * land; stocked units remain displayed in the basket and stay hidden at the
 * destination until their corresponding flight lands.
 *
 * The queued interaction can precede the next authoritative world tick. In
 * that brief window its baseline fields keep the unmutated source snapshot as
 * is, avoiding a doubled basket or crop before the engine confirms the move.
 */
export function deriveVisualTransferPresentation(
  carry: CarryState,
  crops: readonly CropState[],
  shelves: Inventory,
  entries: readonly VisualTransferLedgerEntry[],
): VisualTransferPresentation {
  const active = entries.filter((entry) => transferRemaining(entry) > 0
    && (entry.kind === "harvest" || entry.kind === "stock")
    && entry.productId
    && authoritativeMutationIsVisible(entry, carry, crops, shelves));
  if (!active.length) return { carry, crops: crops as CropState[], shelves };

  const visualCarry: CarryState = { capacity: carry.capacity, items: { ...carry.items } };
  const visualShelves = { ...shelves };
  let visualCrops: CropState[] | null = null;

  for (const entry of active) {
    const productId = entry.productId!;
    const remaining = transferRemaining(entry);
    if (entry.kind === "stock") {
      visualCarry.items[productId] = inventoryQuantity(visualCarry.items, productId) + remaining;
      visualShelves[productId] = Math.max(0, inventoryQuantity(visualShelves, productId) - remaining);
      continue;
    }

    const carryQuantity = Math.max(0, inventoryQuantity(visualCarry.items, productId) - remaining);
    if (carryQuantity > 0) visualCarry.items[productId] = carryQuantity;
    else delete visualCarry.items[productId];
    if (!entry.cropId) continue;
    visualCrops ??= crops.map((crop) => ({ ...crop }));
    const crop = visualCrops.find((candidate) => candidate.id === entry.cropId);
    if (crop) {
      crop.available = nonNegativeInteger(crop.available) + remaining;
      crop.status = "READY";
    }
  }

  return { carry: visualCarry, crops: visualCrops ?? (crops as CropState[]), shelves: visualShelves };
}
