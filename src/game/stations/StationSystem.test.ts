import { describe, expect, it } from "vitest";
import { collectMachineOutput, createEmptyCrop, createMachine, harvestCrop, loadMachine, plantCrop, updateCrop, updateMachine } from "./StationSystem";
import type { Inventory } from "../types";

const emptyInventory = (): Inventory => ({ wheat: 0, flour: 0, bread: 0, corn: 0, milk: 0, eggs: 0, cheese: 0, apples: 0, tomatoes: 0, coffee: 0, juice: 0 });

describe("station systems", () => {
  it("shows the explicit empty, planted, growing, ready and harvested crop cycle", () => {
    const empty = createEmptyCrop("tomato-1", "tomatoes");
    const planted = plantCrop(empty, 1_000);
    expect(planted.planted).toBe(true);
    const crop = planted.crop;
    expect(updateCrop(crop, 4_999).status).toBe("GROWING");
    const ready = updateCrop(crop, 5_000);
    expect(ready.status).toBe("READY");
    const harvested = harvestCrop(ready, 5_100);
    expect(harvested.harvested).toBe(1);
    expect(harvested.crop.status).toBe("EMPTY");
    expect(harvested.crop.readyAt).toBe(0);
  });

  it("consumes recipes only on valid batch and never loses full output", () => {
    const inventory = emptyInventory(); inventory.wheat = 2;
    const loaded = loadMachine(createMachine("mill", "flour"), inventory, 2_000);
    expect(loaded.loaded).toBe(true);
    expect(loaded.inventory.wheat).toBe(0);
    expect(updateMachine(loaded.machine, 5_999).status).toBe("PROCESSING");
    const complete = updateMachine(loaded.machine, 6_000);
    expect(complete.output).toBe(1);
    expect(collectMachineOutput(complete, 6_000).collected).toBe(1);
  });
});
