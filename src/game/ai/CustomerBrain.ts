import type { Inventory, ProductId } from "../types";

export type CustomerState = "SPAWN" | "ENTER_STORE" | "GET_CART" | "BUILD_SHOPPING_LIST" | "NAVIGATE_TO_PRODUCT" | "WAIT_FOR_ACCESS" | "PICK_PRODUCT" | "NEXT_PRODUCT" | "NAVIGATE_TO_QUEUE" | "QUEUE_WAIT" | "MOVE_QUEUE" | "UNLOAD" | "WAIT_CHECKOUT" | "PAY" | "NAVIGATE_TO_BAG" | "TAKE_BAG" | "NAVIGATE_TO_RETURNS" | "LEAVE_RETURNS" | "NAVIGATE_TO_CART_RETURN" | "RETURN_CART" | "EXIT_STORE" | "DESPAWN" | "WAIT_RESTOCK";

export interface ShoppingLine { productId: ProductId; requested: number; picked: number; }
export interface CustomerMind {
  id: string;
  state: CustomerState;
  shoppingList: ShoppingLine[];
  currentLine: number;
  basket: Partial<Inventory>;
  patienceMs: number;
  waitingSince: number | null;
  reservedSocket: string | null;
  queueSlot: number | null;
}

export function createCustomerMind(id: string, unlocked: readonly ProductId[], seed: number, level: number): CustomerMind {
  const random = seededRandom(seed);
  const candidates = [...unlocked].sort(() => random() - 0.5);
  const maximumTypes = level >= 25 ? 5 : 3;
  const typeCount = Math.min(candidates.length, level >= 25 ? 5 : 1 + Math.floor(random() * maximumTypes));
  const shoppingList = candidates.slice(0, typeCount).map((productId) => ({ productId, requested: 1 + Math.floor(random() * 3), picked: 0 }));
  return { id, state: "SPAWN", shoppingList, currentLine: 0, basket: {}, patienceMs: 12_000 + Math.floor(random() * 12_000), waitingSince: null, reservedSocket: null, queueSlot: null };
}

export type CustomerSignal = "spawned" | "entered" | "basket-ready" | "list-ready" | "arrived-product" | "socket-reserved" | "product-picked" | "product-empty" | "restocked" | "route-blocked" | "arrived-queue" | "queue-advanced" | "at-checkout" | "unloaded" | "checkout-complete" | "paid" | "bag-received" | "exited";

export function transitionCustomer(mind: CustomerMind, signal: CustomerSignal, nowMs: number): CustomerMind {
  const next = { ...mind, shoppingList: mind.shoppingList.map((line) => ({ ...line })), basket: { ...mind.basket } };
  const transitions: Partial<Record<CustomerState, Partial<Record<CustomerSignal, CustomerState>>>> = {
    SPAWN: { spawned: "ENTER_STORE" }, ENTER_STORE: { entered: "GET_CART" }, GET_CART: { "basket-ready": "BUILD_SHOPPING_LIST" },
    BUILD_SHOPPING_LIST: { "list-ready": "NAVIGATE_TO_PRODUCT" }, NAVIGATE_TO_PRODUCT: { "arrived-product": "WAIT_FOR_ACCESS", "route-blocked": "NAVIGATE_TO_PRODUCT" },
    WAIT_FOR_ACCESS: { "socket-reserved": "PICK_PRODUCT", "product-empty": "WAIT_RESTOCK" }, PICK_PRODUCT: { "product-picked": "NEXT_PRODUCT", "product-empty": "WAIT_RESTOCK" },
    WAIT_RESTOCK: { restocked: "NAVIGATE_TO_PRODUCT" }, NEXT_PRODUCT: { "list-ready": "NAVIGATE_TO_PRODUCT", "arrived-queue": "NAVIGATE_TO_QUEUE" },
    NAVIGATE_TO_QUEUE: { "arrived-queue": "QUEUE_WAIT", "route-blocked": "NAVIGATE_TO_QUEUE" }, QUEUE_WAIT: { "queue-advanced": "MOVE_QUEUE" },
    MOVE_QUEUE: { "at-checkout": "UNLOAD", "queue-advanced": "MOVE_QUEUE" }, UNLOAD: { unloaded: "WAIT_CHECKOUT" }, WAIT_CHECKOUT: { "checkout-complete": "PAY" },
    PAY: { paid: "NAVIGATE_TO_BAG" }, NAVIGATE_TO_BAG: { "bag-received": "TAKE_BAG" }, TAKE_BAG: { "bag-received": "NAVIGATE_TO_CART_RETURN" }, NAVIGATE_TO_CART_RETURN: { "arrived-queue": "RETURN_CART" }, RETURN_CART: { exited: "EXIT_STORE" }, EXIT_STORE: { exited: "DESPAWN" },
  };
  const target = transitions[next.state]?.[signal];
  if (target) next.state = target;
  if (target === "WAIT_RESTOCK") next.waitingSince = nowMs;
  if (signal === "restocked") next.waitingSince = null;
  return next;
}

export function commitPickedProduct(mind: CustomerMind, stock: Inventory) {
  const line = mind.shoppingList[mind.currentLine];
  if (!line || stock[line.productId] <= 0 || line.picked >= line.requested) return { mind, stock, picked: false };
  const nextMind = { ...mind, shoppingList: mind.shoppingList.map((item) => ({ ...item })), basket: { ...mind.basket } };
  const nextStock = { ...stock };
  nextStock[line.productId] -= 1;
  nextMind.shoppingList[nextMind.currentLine].picked += 1;
  nextMind.basket[line.productId] = (nextMind.basket[line.productId] ?? 0) + 1;
  if (nextMind.shoppingList[nextMind.currentLine].picked >= line.requested) nextMind.currentLine += 1;
  return { mind: nextMind, stock: nextStock, picked: true };
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}
