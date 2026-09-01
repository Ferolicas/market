import { describe, expect, it } from "vitest";
import { addToCarry, carriedProductIds, carryQuantity, carryTotal, createCarryContainer, nextStockingPulse, preferredStockingProduct, primaryCarryProduct, removeFromCarry } from "./CarrySystem";

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

  it("creates one visual-and-engine stocking unit even when the basket holds more", () => {
    const carry = { items: { tomatoes: 8, apples: 2 } };

    expect(nextStockingPulse(carry, { tomatoes: 11, apples: 12 }, 1)).toEqual({ productId: "tomatoes", quantity: 1 });
    expect(nextStockingPulse(carry, { tomatoes: 12, apples: 12 }, 1)).toBeNull();
    expect(nextStockingPulse({ items: {} }, { tomatoes: 0 }, 1)).toBeNull();
  });
});
