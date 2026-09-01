import { describe, expect, it } from "vitest";
import { addToCarry, canPickupWarehouse, carriedProductIds, carryQuantity, carryTotal, createCarryContainer, MAX_WAREHOUSE_PICKUP_BATCH, nextStockingPulse, preferredStockingProduct, primaryCarryProduct, removeFromCarry, transferCarryToShelf, transferWarehouseToCarry } from "./CarrySystem";

const inventory = () => ({ wheat: 0, flour: 0, bread: 0, corn: 0, milk: 0, eggs: 0, cheese: 0, apples: 0, tomatoes: 0, coffee: 0, juice: 0 });

describe("CarrySystem", () => {
  it("combines product types while enforcing total basket capacity", () => {
    const initial = createCarryContainer();
    const tomatoes = addToCarry(initial, "tomatoes", 8, 8);
    expect(tomatoes.moved).toBe(3);
    expect(addToCarry(tomatoes.container, "wheat", 2).moved).toBe(0);
    const oneTomatoRemoved = removeFromCarry(tomatoes.container, "tomatoes", 1);
    const mixed = addToCarry(oneTomatoRemoved.container, "wheat", 2);
    expect(mixed.moved).toBe(1);
    expect(mixed.container.items).toEqual({ tomatoes: 2, wheat: 1 });
    expect(carryTotal(mixed.container)).toBe(3);
    expect(carryQuantity(mixed.container, "tomatoes")).toBe(2);
    expect(carriedProductIds(mixed.container)).toEqual(["tomatoes", "wheat"]);
    expect(primaryCarryProduct(mixed.container)).toBe("tomatoes");
    expect(removeFromCarry(mixed.container, "tomatoes", 2).container.items).toEqual({ wheat: 1 });
  });

  it("leaves the source immutable while products enter and leave the basket", () => {
    const source = { capacity: 4, items: { tomatoes: 1, corn: 1 } } as const;
    const added = addToCarry(source, "wheat", 2, 2);
    const removed = removeFromCarry(added.container, "corn", 1);

    expect(source.items).toEqual({ tomatoes: 1, corn: 1 });
    expect(added.container.items).toEqual({ tomatoes: 1, corn: 1, wheat: 2 });
    expect(removed.container.items).toEqual({ tomatoes: 1, wheat: 2 });
  });

  it("selects a stockable carried product instead of being blocked by the first full shelf", () => {
    const carry = { items: { tomatoes: 2, bread: 2, apples: 1 } };
    const shelves = { tomatoes: 12, bread: 7, apples: 1 };

    expect(primaryCarryProduct(carry)).toBe("tomatoes");
    expect(preferredStockingProduct(carry, shelves)).toBe("apples");
    expect(preferredStockingProduct({ items: {} }, shelves)).toBeNull();
    expect(preferredStockingProduct({ items: { tomatoes: 1, bread: 1 } }, { tomatoes: 12, bread: 8 }, 1)).toBeNull();
    expect(preferredStockingProduct({ items: { tomatoes: 1, bread: 1 } }, { tomatoes: 12, bread: 8 }, 2)).toBe("tomatoes");
    expect(preferredStockingProduct({ items: { tomatoes: 1, bread: 1 } }, { tomatoes: 15, bread: 10 }, 2)).toBeNull();
  });

  it("creates one exact visual-and-engine batch capped by remaining shelf space", () => {
    const carry = { items: { tomatoes: 8, apples: 2 } };

    expect(nextStockingPulse(carry, { tomatoes: 11, apples: 12 }, 1)).toEqual({ productId: "tomatoes", quantity: 1 });
    expect(nextStockingPulse(carry, { tomatoes: 4, apples: 12 }, 1)).toEqual({ productId: "tomatoes", quantity: 8 });
    expect(nextStockingPulse(carry, { tomatoes: 12, apples: 12 }, 1)).toBeNull();
    expect(nextStockingPulse({ items: {} }, { tomatoes: 0 }, 1)).toBeNull();
  });

  it("only pulses products accepted by the department magnet", () => {
    const carry = { items: { tomatoes: 2, eggs: 2, milk: 2, cheese: 1 } };
    const shelves = { tomatoes: 0, eggs: 0, milk: 0, cheese: 0 };

    expect(nextStockingPulse(carry, shelves, 1, ["eggs"])).toEqual({ productId: "eggs", quantity: 2 });
    expect(nextStockingPulse(carry, shelves, 1, ["milk", "cheese"])).toEqual({ productId: "milk", quantity: 2 });
    expect(nextStockingPulse(carry, shelves, 1, ["bread", "flour", "wheat"])).toBeNull();
  });

  it("adds exactly the amount removed from the basket and empties it on the final shelf pulse", () => {
    const carry = { capacity: 3, items: { tomatoes: 2 } };
    const first = transferCarryToShelf(carry, "tomatoes", 10, 12, 1);
    const final = transferCarryToShelf(first.container, "tomatoes", first.shelfQuantity, 12, 5);

    expect(first).toEqual({ container: { capacity: 3, items: { tomatoes: 1 } }, shelfQuantity: 11, moved: 1 });
    expect(final).toEqual({ container: { capacity: 3, items: {} }, shelfQuantity: 12, moved: 1 });
    expect(carry.items).toEqual({ tomatoes: 2 });
  });

  it("cannot create stock from a full shelf or an invalid requested quantity", () => {
    const carry = { capacity: 3, items: { tomatoes: 2 } };

    expect(transferCarryToShelf(carry, "tomatoes", 12, 12, 1)).toEqual({ container: carry, shelfQuantity: 12, moved: 0 });
    expect(transferCarryToShelf(carry, "tomatoes", 0, 12, Number.NaN)).toEqual({ container: carry, shelfQuantity: 0, moved: 0 });
  });

  it("loads one deterministic mixed stockroom batch without mutating its sources", () => {
    const warehouse = { ...inventory(), milk: 2, eggs: 2, apples: 2 };
    const carry = { capacity: 5, items: { tomatoes: 1 } };

    const result = transferWarehouseToCarry(warehouse, carry);

    expect(result).toEqual({
      warehouse: { ...inventory(), milk: 0, eggs: 1, apples: 1 },
      container: { capacity: 5, items: { tomatoes: 1, milk: 2, eggs: 1, apples: 1 } },
      moved: 4,
      movedByProduct: { milk: 2, eggs: 1, apples: 1 },
    });
    expect(warehouse).toEqual({ ...inventory(), milk: 2, eggs: 2, apples: 2 });
    expect(carry).toEqual({ capacity: 5, items: { tomatoes: 1 } });
  });

  it("only enables physical warehouse pickup when stock and free carry capacity coexist", () => {
    const warehouse = { ...inventory(), wheat: 2 };

    expect(canPickupWarehouse(warehouse, { capacity: 3, items: {} })).toBe(true);
    expect(canPickupWarehouse(warehouse, { capacity: 3, items: {} }, "milk")).toBe(false);
    expect(canPickupWarehouse(warehouse, { capacity: 3, items: { eggs: 3 } })).toBe(false);
    expect(canPickupWarehouse(inventory(), { capacity: 3, items: {} })).toBe(false);
    expect(canPickupWarehouse({ ...inventory(), wheat: Number.NaN }, { capacity: 3, items: {} })).toBe(false);
  });

  it("honours a requested SKU, remaining capacity and the hard manual batch bound", () => {
    const warehouse = { ...inventory(), apples: 50, wheat: 50 };
    const almostFull = transferWarehouseToCarry(warehouse, { capacity: 3, items: { eggs: 1 } }, 99, "apples");
    const defensiveBound = transferWarehouseToCarry(warehouse, { capacity: 100, items: {} }, 50, "wheat");

    expect(almostFull.container).toEqual({ capacity: 3, items: { eggs: 1, apples: 2 } });
    expect(almostFull.warehouse.apples).toBe(48);
    expect(defensiveBound.moved).toBe(MAX_WAREHOUSE_PICKUP_BATCH);
    expect(defensiveBound.container.items.wheat).toBe(MAX_WAREHOUSE_PICKUP_BATCH);
    expect(defensiveBound.warehouse.wheat).toBe(50 - MAX_WAREHOUSE_PICKUP_BATCH);
    expect(transferWarehouseToCarry(warehouse, { capacity: 3, items: {} }, Number.NaN).moved).toBe(0);
  });
});
