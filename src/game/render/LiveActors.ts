import type { CheckoutTransaction, CustomerRuntimeState, EmployeeRuntimeState } from "../types";

/**
 * Latest authoritative actor snapshots, published once per world tick by the
 * scene and read inside frame callbacks. Customer and employee bodies use them
 * for locomotion and timing, so a tick no longer has to re-render every body
 * just to hand it a new position; React only re-renders a body when its
 * presentation (state, cart, basket, transaction) actually changes.
 */
export interface LiveActors {
  customers: Map<string, CustomerRuntimeState>;
  transactions: Map<string, CheckoutTransaction>;
  employees: Map<string, EmployeeRuntimeState>;
  simulationTimeMs: number;
}

export const liveActors: LiveActors = {
  customers: new Map(),
  transactions: new Map(),
  employees: new Map(),
  simulationTimeMs: 0,
};

export function publishLiveActors(
  customers: readonly CustomerRuntimeState[],
  transactions: readonly CheckoutTransaction[],
  employees: readonly { id: string; runtime?: EmployeeRuntimeState }[],
  simulationTimeMs: number,
) {
  if (liveActors.simulationTimeMs === simulationTimeMs && liveActors.customers.size === customers.length && liveActors.employees.size === employees.length) {
    // Same tick republished by an unrelated render: keep the existing maps so
    // identity checks in frame callbacks stay stable.
    let unchanged = true;
    for (const customer of customers) if (liveActors.customers.get(customer.id) !== customer) { unchanged = false; break; }
    if (unchanged) return;
  }
  liveActors.customers.clear();
  for (const customer of customers) liveActors.customers.set(customer.id, customer);
  liveActors.transactions.clear();
  for (const transaction of transactions) liveActors.transactions.set(transaction.id, transaction);
  liveActors.employees.clear();
  for (const employee of employees) if (employee.runtime) liveActors.employees.set(employee.id, employee.runtime);
  liveActors.simulationTimeMs = simulationTimeMs;
}

/** Fields that change the rendered customer tree or its animation timing. */
export function customerPresentationKey(customer: CustomerRuntimeState, transaction: CheckoutTransaction | undefined) {
  const basket = Object.entries(customer.basket).filter(([, quantity]) => (quantity ?? 0) > 0).map(([productId, quantity]) => `${productId}=${quantity}`).join(",");
  const transactionKey = transaction
    ? `${transaction.id}:${transaction.state}:${transaction.updatedAt}:${transaction.pendingItems.map((line) => `${line.productId}${line.quantity}${line.loaded}${line.scanned}${line.bagged}`).join("|")}`
    : "";
  return [
    customer.id,
    customer.identity,
    customer.state,
    customer.currentLine,
    customer.shoppingList[customer.currentLine]?.productId ?? "",
    customer.hasCart ? 1 : 0,
    customer.hasBag ? 1 : 0,
    customer.transactionId ?? "",
    basket,
    transactionKey,
  ].join("/");
}

/** Fields that change the rendered employee tree. */
export function employeePresentationKey(employee: { id: string; role: string; level: number; hat: string; runtime?: EmployeeRuntimeState }) {
  const runtime = employee.runtime;
  const carry = runtime ? Object.entries(runtime.carry.items).filter(([, quantity]) => (quantity ?? 0) > 0).map(([productId, quantity]) => `${productId}=${quantity}`).join(",") : "";
  return [employee.id, employee.role, employee.level, employee.hat, runtime?.state ?? "", carry].join("/");
}
