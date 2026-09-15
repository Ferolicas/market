import type { Inventory, ProductId } from "../types";
import type { CropProductId, MachineProductId } from "../economy/ProductRegistry";
import { PRODUCT_CONFIG } from "../economy/products";
import { stationTierModifiers } from "../progression/levels";
import { advanceAnimal, animalProduction, collectAnimal, feedAnimal, type FedAnimalState } from "./FedAnimal";

export type CropStatus = "LOCKED" | "EMPTY" | "GROWING" | "READY" | "HARVESTING";
export type MachineStatus = "LOCKED" | "IDLE" | "WAITING_INPUT" | "PROCESSING" | "OUTPUT_READY" | "FULL";

export interface CropStation {
  id: string;
  productId: CropProductId;
  status: CropStatus;
  plantedAt: number;
  readyAt: number;
  available: number;
  tier: number;
  baseYield?: number;
}

export interface MachineStation {
  id: string;
  productId: MachineProductId;
  status: MachineStatus;
  input: Partial<Inventory>;
  output: number;
  outputCapacity: number;
  startedAt: number | null;
  completesAt: number | null;
  tier: number;
}

export function cropGrowthDurationMs(productId: CropStation["productId"], tier = 1, gameLevel = 1) {
  const growMs = PRODUCT_CONFIG[productId]?.growMs ?? 4_000;
  const levelSpeed = 1 + Math.min(0.5, Math.max(0, Math.floor(gameLevel) - 1) * 0.025);
  return Math.max(1_500, Math.round(growMs / stationTierModifiers(tier).speed / levelSpeed));
}

export function cropHarvestYield(productId: CropStation["productId"], tier = 1, baseYield = 3) {
  const baseBedUnits = baseYield;
  const productYield = PRODUCT_CONFIG[productId]?.yield ?? 1;
  return Math.max(1, Math.round(baseBedUnits * productYield * stationTierModifiers(tier).capacity));
}

export function createCrop(id: string, productId: CropStation["productId"], nowMs: number, tier = 1, gameLevel = 1, baseYield?: number): CropStation {
  return { id, productId, status: "GROWING", plantedAt: nowMs, readyAt: nowMs + cropGrowthDurationMs(productId, tier, gameLevel), available: 0, tier, ...(baseYield === undefined ? {} : { baseYield }) };
}

export function createEmptyCrop(id: string, productId: CropStation["productId"], tier = 1): CropStation {
  return { id, productId, status: "EMPTY", plantedAt: 0, readyAt: 0, available: 0, tier };
}

export function plantCrop(crop: CropStation, nowMs: number, gameLevel = 1) {
  if (crop.status !== "EMPTY") return { crop, planted: false };
  return { crop: createCrop(crop.id, crop.productId, nowMs, crop.tier, gameLevel, crop.baseYield), planted: true };
}

export function updateCrop(crop: CropStation, nowMs: number): CropStation {
  if (crop.status !== "GROWING" || nowMs < crop.readyAt) return crop;
  return { ...crop, status: "READY", available: cropHarvestYield(crop.productId, crop.tier, crop.baseYield) };
}

export function cropProgress(crop: CropStation, nowMs: number) {
  if (crop.status === "READY" || crop.status === "HARVESTING") return 1;
  if (crop.status !== "GROWING") return 0;
  return Math.min(1, Math.max(0, (nowMs - crop.plantedAt) / Math.max(1, crop.readyAt - crop.plantedAt)));
}

export function harvestCrop(cropInput: CropStation, nowMs: number, gameLevel = 1) {
  const crop = updateCrop(cropInput, nowMs);
  if (crop.status !== "READY" || crop.available < 1) return { crop, harvested: 0 };
  const remaining = crop.available - 1;
  if (remaining > 0) return { crop: { ...crop, status: "READY" as const, available: remaining }, harvested: 1 };
  return { crop: createCrop(crop.id, crop.productId, nowMs, crop.tier, gameLevel, crop.baseYield), harvested: 1 };
}

/** Composes the authoritative one-unit transition into one capacity-bounded trip. */
export function harvestCropBatch(cropInput: CropStation, nowMs: number, requested: number, gameLevel = 1) {
  const readyCrop = updateCrop(cropInput, nowMs);
  const safeRequested = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  const harvestLimit = readyCrop.status === "READY" ? Math.min(safeRequested, readyCrop.available) : 0;
  let crop = readyCrop;
  let harvested = 0;
  for (let unit = 0; unit < harvestLimit; unit += 1) {
    const result = harvestCrop(crop, nowMs, gameLevel);
    crop = result.crop;
    harvested += result.harvested;
    if (result.harvested < 1) break;
  }
  return { crop, harvested };
}

export function createMachine(id: string, productId: MachineStation["productId"], tier = 1): MachineStation {
  return { id, productId, status: "WAITING_INPUT", input: {}, output: 0, outputCapacity: Math.round((PRODUCT_CONFIG[productId]?.outputCapacity ?? 8) * stationTierModifiers(tier).capacity), startedAt: null, completesAt: null, tier };
}

export function loadMachine(machine: MachineStation, inventory: Inventory, nowMs: number) {
  const policy = animalProduction(machine.productId, machine.tier);
  if (policy) {
    if (machine.status === "LOCKED") return { machine, inventory, loaded: false };
    const result = feedAnimal(animalState(machine, nowMs), inventory[policy.input], Math.floor(nowMs), policy);
    return { machine: animalMachine(machine, result.state), inventory: result.consumed ? { ...inventory, [policy.input]: inventory[policy.input] - result.consumed } : inventory, loaded: result.consumed > 0 };
  }
  const config = PRODUCT_CONFIG[machine.productId];
  const recipe = config?.recipe ?? {};
  const canAcceptInput = machine.status === "IDLE" || machine.status === "WAITING_INPUT";
  if (!canAcceptInput || machine.output > 0 || machine.output >= machine.outputCapacity) return { machine, inventory, loaded: false };
  for (const [productId, amount] of Object.entries(recipe) as [ProductId, number][]) {
    if ((inventory[productId] ?? 0) < amount) return { machine: { ...machine, status: "WAITING_INPUT" as const }, inventory, loaded: false };
  }
  const nextInventory = { ...inventory };
  for (const [productId, amount] of Object.entries(recipe) as [ProductId, number][]) nextInventory[productId] -= amount;
  return {
    machine: { ...machine, status: "PROCESSING" as const, startedAt: nowMs, completesAt: nowMs + (config?.cycleMs ?? 1_000) / stationTierModifiers(machine.tier).speed },
    inventory: nextInventory,
    loaded: true,
  };
}

export function updateMachine(machine: MachineStation, nowMs: number): MachineStation {
  const policy = animalProduction(machine.productId, machine.tier);
  if (policy && machine.status !== "LOCKED") return animalMachine(machine, advanceAnimal(animalState(machine, nowMs), Math.floor(nowMs), policy));
  if (machine.status !== "PROCESSING" || machine.completesAt === null || nowMs < machine.completesAt) return machine;
  const produced = PRODUCT_CONFIG[machine.productId]?.yield ?? 1;
  const output = Math.min(machine.outputCapacity, machine.output + produced);
  return { ...machine, output, status: output >= machine.outputCapacity ? "FULL" : "OUTPUT_READY", startedAt: null, completesAt: null };
}

export function collectMachineOutput(machineInput: MachineStation, nowMs: number) {
  const policy = animalProduction(machineInput.productId, machineInput.tier);
  if (policy) {
    if (machineInput.status === "LOCKED") return { machine: machineInput, collected: 0 };
    const result = collectAnimal(animalState(machineInput, nowMs), 1, Math.floor(nowMs), policy);
    return { machine: animalMachine(machineInput, result.state), collected: result.collected };
  }
  const machine = updateMachine(machineInput, nowMs);
  if (machine.output < 1) return { machine, collected: 0 };
  const output = machine.output - 1;
  return { machine: { ...machine, output, status: output ? "OUTPUT_READY" as const : "WAITING_INPUT" as const }, collected: 1 };
}

/** Collects one trip without exceeding either available output or free carry space. */
export function collectMachineOutputBatch(machineInput: MachineStation, nowMs: number, requested: number) {
  const safeRequested = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  let machine = updateMachine(machineInput, nowMs);
  const collectLimit = Math.min(safeRequested, machine.output);
  let collected = 0;
  for (let unit = 0; unit < collectLimit; unit += 1) {
    const result = collectMachineOutput(machine, nowMs);
    machine = result.machine;
    collected += result.collected;
    if (result.collected < 1) break;
  }
  return { machine, collected };
}

/** Persist only existing input/output/deadline fields; never replay a consumed input. */
function animalState(machine: MachineStation, nowMs: number): FedAnimalState {
  const policy = animalProduction(machine.productId, machine.tier)!;
  return {
    feed: machine.input[policy.input] ?? 0, output: machine.output,
    outputCapacity: machine.outputCapacity,
    nextAtMs: machine.status === "PROCESSING" && machine.completesAt !== null ? Math.floor(machine.completesAt) : null,
    updatedAtMs: Math.max(0, Math.floor(Math.min(nowMs, machine.startedAt ?? nowMs))),
  };
}

function animalMachine(machine: MachineStation, animal: FedAnimalState): MachineStation {
  const policy = animalProduction(machine.productId, machine.tier)!;
  const processing = animal.nextAtMs !== null;
  return { ...machine, input: { ...machine.input, [policy.input]: animal.feed }, output: animal.output,
    completesAt: animal.nextAtMs,
    startedAt: processing ? animal.nextAtMs! - policy.cycleMs : null,
    status: processing ? "PROCESSING" : animal.output >= animal.outputCapacity ? "FULL" : animal.output > 0 ? "OUTPUT_READY" : "WAITING_INPUT" };
}

export function animalFeedStatus(machine: MachineStation) {
  const capacity = animalProduction(machine.productId, machine.tier)?.capacity ?? 0;
  const input = animalProduction(machine.productId, machine.tier)?.input;
  const occupied = (input ? machine.input[input] ?? 0 : 0) + Number(machine.status === "PROCESSING" && machine.completesAt !== null);
  return { capacity, occupied, free: Math.max(0, capacity - occupied) };
}

/** Compatibility for the initial chicken fixtures. */
export const chickenFeedStatus = animalFeedStatus;
