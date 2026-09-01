import { describe, expect, it } from "vitest";
import type { CarryState, CropState, Inventory } from "../types";
import { deriveVisualTransferPresentation, updateVisualTransferRemaining, type VisualTransferLedgerEntry } from "./VisualTransferLedger";

const shelves = { milk: 3, tomatoes: 0 } as Inventory;
const harvestedCrop: CropState = {
  id: "crop-tomatoes-1",
  productId: "tomatoes",
  status: "GROWING",
  plantedAt: 100,
  readyAt: 200,
  available: 0,
  tier: 10,
};

function transfers(harvestRemaining: number, stockRemaining: number): VisualTransferLedgerEntry[] {
  return [
    { sequence: 1, kind: "harvest", cropId: harvestedCrop.id, productId: "tomatoes", quantity: 7, remainingQuantity: harvestRemaining, carryStart: 0, cropStart: 7 },
    { sequence: 2, kind: "stock", productId: "milk", quantity: 3, remainingQuantity: stockRemaining, carryStart: 3, shelfStart: 0 },
  ];
}

describe("VisualTransferLedger", () => {
  it("keeps every in-flight unit at its visual source and reveals only landed units", () => {
    const authoritativeCarry: CarryState = { capacity: 20, items: { tomatoes: 7 } };

    const justCommitted = deriveVisualTransferPresentation(authoritativeCarry, [harvestedCrop], shelves, transfers(7, 3));
    expect(justCommitted.carry.items).toEqual({ milk: 3 });
    expect(justCommitted.shelves.milk).toBe(0);
    expect(justCommitted.crops[0]).toMatchObject({ status: "READY", available: 7 });

    const partiallyLanded = deriveVisualTransferPresentation(authoritativeCarry, [harvestedCrop], shelves, transfers(2, 2));
    expect(partiallyLanded.carry.items).toEqual({ tomatoes: 5, milk: 2 });
    expect(partiallyLanded.shelves.milk).toBe(1);
    expect(partiallyLanded.crops[0]).toMatchObject({ status: "READY", available: 2 });

    const completed = deriveVisualTransferPresentation(authoritativeCarry, [harvestedCrop], shelves, []);
    expect(completed).toEqual({ carry: authoritativeCarry, crops: [harvestedCrop], shelves });
  });

  it("does not double an event queued before its authoritative world tick", () => {
    const preCommitCarry: CarryState = { capacity: 20, items: { milk: 3 } };
    const readyCrop = { ...harvestedCrop, status: "READY", available: 7 } as CropState;
    const preCommitShelves = { ...shelves, milk: 0 };

    const presentation = deriveVisualTransferPresentation(preCommitCarry, [readyCrop], preCommitShelves, transfers(7, 3));

    expect(presentation.carry).toBe(preCommitCarry);
    expect(presentation.crops[0]).toEqual(readyCrop);
    expect(presentation.shelves).toBe(preCommitShelves);
  });

  it("applies overlapping remainders additively without mutating authoritative state", () => {
    const carry: CarryState = { capacity: 20, items: { tomatoes: 5 } };
    const crop = { ...harvestedCrop, status: "READY", available: 2 } as CropState;
    const entries: VisualTransferLedgerEntry[] = [
      { sequence: 3, kind: "harvest", cropId: crop.id, productId: "tomatoes", quantity: 2, remainingQuantity: 1, carryStart: 3, cropStart: 4 },
      { sequence: 4, kind: "harvest", cropId: crop.id, productId: "tomatoes", quantity: 2, remainingQuantity: 2, carryStart: 3, cropStart: 4 },
    ];

    const presentation = deriveVisualTransferPresentation(carry, [crop], shelves, entries);

    expect(presentation.carry.items.tomatoes).toBe(2);
    expect(presentation.crops[0].available).toBe(5);
    expect(carry.items.tomatoes).toBe(5);
    expect(crop.available).toBe(2);
  });

  it("records absolute low-FPS progress and removes only the final remainder", () => {
    const entries = transfers(7, 3);
    const oneLeft = updateVisualTransferRemaining(entries, 2, 1);
    const complete = updateVisualTransferRemaining(oneLeft, 2, 0);

    expect(oneLeft.find((entry) => entry.sequence === 2)?.remainingQuantity).toBe(1);
    expect(complete.map((entry) => entry.sequence)).toEqual([1]);
    expect(entries[1].remainingQuantity).toBe(3);
  });
});
