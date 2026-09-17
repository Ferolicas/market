export interface PaymentSnapshot { franchiseId: string; customersToday: number }

/** Customers who paid in the visited store since the previous snapshot.
 * Loading a game, travelling to another store or a new day resetting the
 * count are not payments, so they never ring the till. */
export function newCustomerPayments(previous: PaymentSnapshot | null, current: PaymentSnapshot) {
  if (!previous || previous.franchiseId !== current.franchiseId || current.customersToday <= previous.customersToday) return 0;
  return current.customersToday - previous.customersToday;
}
