import { expect, it } from "vitest";
import { newlyCompletedPurchase } from "./PurchaseCelebration";
it("celebrates only a new purchase in the same store, never loading or travelling", () => {
  const before = { franchiseId: "barrio", purchased: ["farmer-1"] };
  const after = { ...before, purchased: [...before.purchased, "cow-1"] };
  expect(newlyCompletedPurchase(null, after)).toBeUndefined();
  expect(newlyCompletedPurchase(before, { ...after, franchiseId: "megastore" })).toBeUndefined();
  expect(newlyCompletedPurchase(before, after)).toBe("cow-1");
  expect(newlyCompletedPurchase(after, after)).toBeUndefined();
});
