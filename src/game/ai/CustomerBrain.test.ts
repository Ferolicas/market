import { describe, expect, it } from "vitest";
import { commitPickedProduct, createCustomerMind, transitionCustomer } from "./CustomerBrain";
import { QueueManager } from "./QueueManager";
import type { Inventory } from "../types";

const stock = (): Inventory => ({ wheat: 0, flour: 0, bread: 0, corn: 0, milk: 0, eggs: 0, cheese: 0, apples: 0, tomatoes: 0, coffee: 0, juice: 0 });

describe("customer AI", () => {
  it("builds deterministic lists and only picks real shelf stock", () => {
    const first = createCustomerMind("c1", ["tomatoes", "bread", "milk"], 42, 3);
    const second = createCustomerMind("c1", ["tomatoes", "bread", "milk"], 42, 3);
    expect(first.shoppingList).toEqual(second.shoppingList);
    const inventory = stock(); inventory[first.shoppingList[0].productId] = 1;
    const picked = commitPickedProduct(first, inventory);
    expect(picked.picked).toBe(true);
    expect(picked.stock[first.shoppingList[0].productId]).toBe(0);
    expect(commitPickedProduct(picked.mind, picked.stock).picked).toBe(false);
  });

  it("crea listas reales de cinco tipos cuando el objetivo del nivel 25 las exige", () => {
    const unlocked: (keyof Inventory)[] = ["tomatoes", "apples", "bread", "eggs", "coffee", "corn", "milk"];
    const mind = createCustomerMind("level-25", unlocked, 25, 25);

    expect(mind.shoppingList).toHaveLength(5);
    expect(new Set(mind.shoppingList.map((line) => line.productId)).size).toBe(5);
  });

  it("covers the mandatory entrance and restock branches", () => {
    let mind = createCustomerMind("c2", ["tomatoes"], 7, 1);
    mind = transitionCustomer(mind, "spawned", 0);
    mind = transitionCustomer(mind, "entered", 10);
    mind = transitionCustomer(mind, "basket-ready", 20);
    mind = transitionCustomer(mind, "list-ready", 30);
    mind = transitionCustomer(mind, "arrived-product", 40);
    mind = transitionCustomer(mind, "product-empty", 50);
    expect(mind.state).toBe("WAIT_RESTOCK");
    expect(transitionCustomer(mind, "restocked", 100).state).toBe("NAVIGATE_TO_PRODUCT");
  });

  it("reserves distinct queue positions and advances without overlap", () => {
    const queue = new QueueManager(3);
    expect(queue.reserve("a")).toBe(2);
    expect(queue.reserve("b")).toBe(1);
    expect(queue.reserve("c")).toBe(0);
    queue.advance();
    expect(queue.snapshot().map((slot) => slot.customerId)).toEqual(["c", "b", "a"]);
    queue.release("c");
    expect(queue.snapshot().map((slot) => slot.customerId)).toEqual(["b", "a", null]);
  });
});
