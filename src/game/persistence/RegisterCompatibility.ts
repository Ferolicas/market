import type { GameState } from "../types";

/** Inspect the stored/raw snapshot, BEFORE normalization fills new fields. */
export function isPreRegisterSnapshot(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const franchises = (input as { franchises?: unknown }).franchises;
  return Array.isArray(franchises) && franchises.length > 0 && franchises.every((franchise) =>
    franchise !== null && typeof franchise === "object" && !Object.hasOwn(franchise, "registerCashMinor"));
}

/** Reconstruct only the previous shape for an already accepted operation's
 * checksum. Never use this stripped snapshot for a new write or gameplay. */
export function preRegisterChecksumState(state: GameState) {
  return { ...state, franchises: state.franchises.map((franchise) => {
    const copy: Partial<typeof franchise> = { ...franchise };
    delete copy.registerCashMinor;
    return copy;
  }) };
}
