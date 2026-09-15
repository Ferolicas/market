import { advanceAnimal, animalProduction, collectAnimal, feedAnimal, type FedAnimalState } from "./FedAnimal";

/** Compatibility facade for opening-campaign callers; production is shared
 * with every animal, not implemented independently for chickens. */
export interface FedChickenState {
  tier: 1 | 2 | 3;
  feed: number;
  eggs: number;
  outputCapacity: number;
  nextEggAtMs: number | null;
  updatedAtMs: number;
}
export function createFedChicken(nowMs = 0): FedChickenState {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("Invalid simulation time");
  return { tier: 1, feed: 0, eggs: 0, outputCapacity: 8, nextEggAtMs: null, updatedAtMs: nowMs };
}
export function chickenFeedCapacity(tier: FedChickenState["tier"]) { return animalProduction("eggs", tier)!.capacity; }
export function chickenCycleMs(tier: FedChickenState["tier"]) { return animalProduction("eggs", tier)!.cycleMs; }
function domain(state: FedChickenState): FedAnimalState {
  return { feed: state.feed, output: state.eggs, outputCapacity: state.outputCapacity, nextAtMs: state.nextEggAtMs, updatedAtMs: state.updatedAtMs };
}
function presentation(base: FedChickenState, state: FedAnimalState): FedChickenState {
  return { ...base, feed: state.feed, eggs: state.output, nextEggAtMs: state.nextAtMs, updatedAtMs: state.updatedAtMs };
}
export function advanceFedChicken(input: FedChickenState, nowMs: number): FedChickenState {
  if (!Number.isSafeInteger(nowMs) || nowMs < input.updatedAtMs) return input;
  return presentation(input, advanceAnimal(domain(input), nowMs, animalProduction("eggs", input.tier)!));
}
export function feedChicken(input: FedChickenState, tomatoes: number, nowMs: number) {
  const result = feedAnimal(domain(input), tomatoes, nowMs, animalProduction("eggs", input.tier)!);
  return { state: presentation(input, result.state), consumed: result.consumed };
}
export function collectChickenEggs(input: FedChickenState, capacity: number, nowMs: number) {
  const result = collectAnimal(domain(input), capacity, nowMs, animalProduction("eggs", input.tier)!);
  return { state: presentation(input, result.state), collected: result.collected };
}
export function upgradeFedChicken(input: FedChickenState, nowMs: number) {
  const state = advanceFedChicken(input, nowMs);
  if (state.tier === 3 || !Number.isSafeInteger(nowMs) || nowMs < input.updatedAtMs) return state;
  return { ...state, tier: (state.tier + 1) as FedChickenState["tier"] };
}
