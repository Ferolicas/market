import { describe, expect, it } from "vitest";
import { addToCarry, createCarryContainer, removeFromCarry } from "./CarrySystem";

describe("CarrySystem", () => {
  it("enforces capacity and one product type", () => {
    const initial = createCarryContainer();
    const tomatoes = addToCarry(initial, "tomatoes", 8, 8);
    expect(tomatoes.moved).toBe(3);
    expect(addToCarry(tomatoes.container, "wheat", 2).moved).toBe(0);
    const removed = removeFromCarry(tomatoes.container, "tomatoes", 3);
    expect(removed.container.item).toBeNull();
  });
});
