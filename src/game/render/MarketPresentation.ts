import type {
  CheckoutTransaction,
  CropState,
  CustomerRuntimeState,
  Inventory,
  ProductId,
  ProductionMachineState,
} from "../types";

const PRODUCT_IDS: readonly ProductId[] = [
  "wheat",
  "flour",
  "bread",
  "corn",
  "milk",
  "eggs",
  "cheese",
  "apples",
  "tomatoes",
  "coffee",
  "juice",
];

export interface FurniturePresentationProps {
  shelves: Inventory;
  machines: ProductionMachineState[];
  customers: CustomerRuntimeState[];
  checkoutTransactions: CheckoutTransaction[];
  returnsBin: Inventory;
  returnedCartCount: number;
  lightsOn: boolean;
  unlockedAreas: string[];
}

export interface FarmPresentationProps {
  crops: CropState[];
  machines: ProductionMachineState[];
  nowMs: number;
  unlockedAreas: string[];
}

/**
 * The authoritative world advances at 10 Hz, but furniture changes only when
 * stock, checkout presentation, unlocks, lights or a machine's visible state
 * changes. Movement/path fields are intentionally excluded here: customer
 * bodies consume those snapshots independently from KitFurniture.
 */
export function sameFurniturePresentation(
  previous: Readonly<FurniturePresentationProps>,
  next: Readonly<FurniturePresentationProps>,
) {
  if (previous.returnedCartCount !== next.returnedCartCount || previous.lightsOn !== next.lightsOn) return false;
  if (!sameStringList(previous.unlockedAreas, next.unlockedAreas)) return false;
  if (!sameInventory(previous.shelves, next.shelves) || !sameInventory(previous.returnsBin, next.returnsBin)) return false;
  if (!sameMachinePresentation(previous.machines, next.machines)) return false;
  if (!sameCustomerFixturePresentation(previous.customers, next.customers)) return false;
  return sameCheckoutPresentation(previous.checkoutTransactions, next.checkoutTransactions);
}

/**
 * Crop growth is authored in five discrete visual stages. Reconcile the farm
 * only on a stage/status/inventory transition instead of cloning its complete
 * JSX tree for every simulation timestamp.
 */
export function sameFarmPresentation(
  previous: Readonly<FarmPresentationProps>,
  next: Readonly<FarmPresentationProps>,
) {
  if (!sameStringList(previous.unlockedAreas, next.unlockedAreas)) return false;
  if (previous.crops.length !== next.crops.length) return false;
  for (let index = 0; index < previous.crops.length; index += 1) {
    const left = previous.crops[index];
    const right = next.crops[index];
    if (
      left.id !== right.id
      || left.productId !== right.productId
      || left.status !== right.status
      || left.available !== right.available
      || left.tier !== right.tier
      || cropPresentationStage(left, previous.nowMs) !== cropPresentationStage(right, next.nowMs)
    ) return false;
  }
  return sameFarmMachine(previous.machines, next.machines, "chicken-coop-1")
    && sameFarmMachine(previous.machines, next.machines, "cow-station-1");
}

export function cropPresentationStage(crop: CropState, nowMs: number) {
  if (crop.status === "READY") return 4;
  if (crop.status !== "GROWING" && crop.status !== "HARVESTING") return 0;
  const progress = crop.status === "HARVESTING"
    ? 1
    : Math.min(1, Math.max(0, (nowMs - crop.plantedAt) / Math.max(1, crop.readyAt - crop.plantedAt)));
  return Math.max(0, Math.min(3, Math.floor(progress * 4)));
}

function sameInventory(previous: Inventory, next: Inventory) {
  return PRODUCT_IDS.every((productId) => previous[productId] === next[productId]);
}

function sameStringList(previous: readonly string[], next: readonly string[]) {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function sameMachinePresentation(previous: readonly ProductionMachineState[], next: readonly ProductionMachineState[]) {
  if (previous.length !== next.length) return false;
  return previous.every((machine, index) => {
    const candidate = next[index];
    return machine.id === candidate.id && machine.status === candidate.status && machine.output === candidate.output;
  });
}

function sameCustomerFixturePresentation(previous: readonly CustomerRuntimeState[], next: readonly CustomerRuntimeState[]) {
  if (previous.length !== next.length) return false;
  return previous.every((customer, index) => {
    const candidate = next[index];
    return customer.id === candidate.id
      && customer.state === candidate.state
      && customer.transactionId === candidate.transactionId
      && customer.currentLine === candidate.currentLine
      && customer.shoppingList[customer.currentLine]?.productId === candidate.shoppingList[candidate.currentLine]?.productId;
  });
}

function sameCheckoutPresentation(previous: readonly CheckoutTransaction[], next: readonly CheckoutTransaction[]) {
  if (previous.length !== next.length) return false;
  return previous.every((transaction, index) => {
    const candidate = next[index];
    if (
      transaction.id !== candidate.id
      || transaction.customerId !== candidate.customerId
      || transaction.state !== candidate.state
      || transaction.checkoutLane !== candidate.checkoutLane
      || transaction.updatedAt !== candidate.updatedAt
      || transaction.pendingItems.length !== candidate.pendingItems.length
    ) return false;
    return transaction.pendingItems.every((line, lineIndex) => {
      const nextLine = candidate.pendingItems[lineIndex];
      return line.productId === nextLine.productId
        && line.quantity === nextLine.quantity
        && line.loaded === nextLine.loaded
        && line.scanned === nextLine.scanned
        && line.bagged === nextLine.bagged;
    });
  });
}

function sameFarmMachine(
  previous: readonly ProductionMachineState[],
  next: readonly ProductionMachineState[],
  id: string,
) {
  const left = previous.find((machine) => machine.id === id);
  const right = next.find((machine) => machine.id === id);
  return left?.status === right?.status && left?.output === right?.output;
}
