import type { ProductId } from "../types";

/** Original cow balance; chicken values follow the supplied opening document. */
export const ANIMAL_PRODUCTION = {
  eggs: { species: "chicken", input: "tomatoes", capacity: [4, 4, 6], cycleMs: [2_000, 1_000, 1_000] },
  milk: { species: "cow", input: "wheat", capacity: [6, 6, 8], cycleMs: [6_000, 4_000, 3_000] },
} as const;

export function animalProduction(product: ProductId, tier: number) {
  if (product !== "eggs" && product !== "milk") return null;
  const definition = ANIMAL_PRODUCTION[product];
  const multiplier = 1 + Math.min(4, Math.max(0, Math.floor(tier) - 1)) * 0.25;
  return { species: definition.species, input: definition.input, capacity: Math.round(definition.capacity[0] * multiplier), cycleMs: Math.round(definition.cycleMs[0] / multiplier) };
}

export interface FedAnimalState {
  feed: number;
  output: number;
  outputCapacity: number;
  nextAtMs: number | null;
  updatedAtMs: number;
}
type Policy = NonNullable<ReturnType<typeof animalProduction>>;

function start(state: FedAnimalState, now: number, policy: Policy) {
  if (state.nextAtMs !== null || state.feed < 1 || state.output >= state.outputCapacity) return;
  state.feed -= 1;
  state.nextAtMs = now + policy.cycleMs;
}

export function advanceAnimal(input: FedAnimalState, now: number, policy: Policy): FedAnimalState {
  if (!Number.isSafeInteger(now) || now < input.updatedAtMs) return input;
  const state = { ...input };
  while (state.nextAtMs !== null && state.nextAtMs <= now) {
    const completedAt = state.nextAtMs;
    state.output += 1;
    state.nextAtMs = null;
    start(state, completedAt, policy);
  }
  state.updatedAtMs = now;
  return state;
}

export function feedAnimal(input: FedAnimalState, quantity: number, now: number, policy: Policy) {
  const state = advanceAnimal(input, now, policy);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(now) || now < input.updatedAtMs) return { state, consumed: 0 };
  const consumed = Math.min(quantity, Math.max(0, policy.capacity - state.feed - Number(state.nextAtMs !== null)));
  if (!consumed) return { state, consumed: 0 };
  const next = { ...state, feed: state.feed + consumed };
  start(next, now, policy);
  return { state: next, consumed };
}

export function collectAnimal(input: FedAnimalState, capacity: number, now: number, policy: Policy) {
  const state = advanceAnimal(input, now, policy);
  if (!Number.isSafeInteger(capacity) || capacity <= 0 || !Number.isSafeInteger(now) || now < input.updatedAtMs) return { state, collected: 0 };
  const collected = Math.min(capacity, state.output);
  const next = { ...state, output: state.output - collected };
  start(next, now, policy);
  return { state: next, collected };
}
