export interface CarryItem {
  productId: string;
  quantity: number;
}

export interface CarryContainer {
  capacity: number;
  item: CarryItem | null;
}

export const CAPACITY_TIERS = [3, 5, 8, 12, 16, 20] as const;

export function createCarryContainer(tier = 0): CarryContainer {
  return { capacity: CAPACITY_TIERS[Math.min(CAPACITY_TIERS.length - 1, Math.max(0, tier))], item: null };
}

export function addToCarry(container: CarryContainer, productId: string, available: number, requested = 1) {
  if (available <= 0 || requested <= 0) return { container, moved: 0 };
  if (container.item && container.item.productId !== productId) return { container, moved: 0 };
  const current = container.item?.quantity ?? 0;
  const moved = Math.max(0, Math.min(available, requested, container.capacity - current));
  if (!moved) return { container, moved: 0 };
  return { container: { ...container, item: { productId, quantity: current + moved } }, moved };
}

export function removeFromCarry(container: CarryContainer, productId: string, requested = 1) {
  if (!container.item || container.item.productId !== productId || requested <= 0) return { container, moved: 0 };
  const moved = Math.min(container.item.quantity, requested);
  const remaining = container.item.quantity - moved;
  return { container: { ...container, item: remaining ? { productId, quantity: remaining } : null }, moved };
}
