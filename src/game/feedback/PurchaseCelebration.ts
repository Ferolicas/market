export interface PurchaseSnapshot { franchiseId: string; purchased: readonly string[] }

/** Loading a store is a baseline, never a purchase made in another store. */
export function newlyCompletedPurchase(previous: PurchaseSnapshot | null, current: PurchaseSnapshot) {
  if (!previous || previous.franchiseId !== current.franchiseId) return undefined;
  return current.purchased.find(id => !previous.purchased.includes(id));
}
