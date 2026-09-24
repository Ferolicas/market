import { advanceSimulation, advanceWorld, applyGameAction, type WorldPathfinder } from "../engine";
import type { GameAction, GameEvent, GameState, WorldInteractionAction } from "../types";

/**
 * Everything that moves the authoritative state, in the order the client
 * applied it. The server folds the same commands over the previous revision
 * with the same engine and must land on the same snapshot; the snapshot the
 * client sends is then a cache of that result, not the source of truth.
 *
 * Keys are short on purpose: a tick every 200 ms adds up.
 */
export type GameCommand =
  | { k: "a"; a: GameAction }
  | { k: "t"; d: number; i?: WorldInteractionAction[]; m?: number; n: 0 | 1 }
  | { k: "s"; m: number };

/** Ten minutes of ticks at 5 Hz. Past this the log is dropped and the save
 * falls back to snapshot validation, which the server records. */
export const COMMAND_LOG_LIMIT = 3_000;

export function tickCommand(deltaMs: number, interactions: readonly WorldInteractionAction[], playerDistanceMeters: number, navigationReady: boolean): GameCommand {
  const command: GameCommand = { k: "t", d: deltaMs, n: navigationReady ? 1 : 0 };
  if (interactions.length) command.i = [...interactions];
  if (playerDistanceMeters > 0) command.m = playerDistanceMeters;
  return command;
}

export interface CommandReplayResult {
  state: GameState;
  events: GameEvent[];
  applied: number;
}

/** Folds the commands over `initial` exactly as the store does: a refused
 * action leaves the state alone, a tick always advances. `pathfinder` must be
 * the same navigation the client had when `n` is 1; when it is 0 the client
 * had none and the engine's fallback lanes are what happened. */
export function replayCommands(initial: GameState, commands: readonly GameCommand[], pathfinder?: WorldPathfinder): CommandReplayResult {
  let state = initial;
  const events: GameEvent[] = [];
  let applied = 0;
  for (const command of commands) {
    if (command.k === "a") {
      const result = applyGameAction(state, command.a);
      if (!result.ok) continue;
      state = result.state;
      events.push(...result.events);
    } else if (command.k === "t") {
      const result = advanceWorld(state, command.d, command.n ? pathfinder : undefined, { interactions: command.i ?? [], playerDistanceMeters: command.m ?? 0 });
      state = result.state;
      events.push(...result.events);
    } else {
      const result = advanceSimulation(state, command.m);
      state = result.state;
      events.push(...result.events);
    }
    applied += 1;
  }
  return { state, events, applied };
}

/** JSON with sorted keys: two states built in different key order (a parsed
 * snapshot versus a mutated live object) still compare equal. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/** First path where two snapshots differ, for a telemetry line a person can
 * act on without the two dumps. */
export function firstDifference(a: unknown, b: unknown, path = "$"): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return `${path}: ${short(a)} ≠ ${short(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array ≠ object`;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) {
    if (left[key] === undefined && right[key] === undefined) continue;
    const difference = firstDifference(left[key], right[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
}

function short(value: unknown) {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** Same fold, with the navigation resolved per tick from the state it is
 * about to advance: the server builds a mesh per unlocked-area signature and
 * hands back the pathfinder the client would have used. */
export async function replayCommandsAsync(initial: GameState, commands: readonly GameCommand[], resolvePathfinder: (state: GameState) => Promise<WorldPathfinder | undefined>): Promise<CommandReplayResult> {
  let state = initial;
  const events: GameEvent[] = [];
  let applied = 0;
  for (const command of commands) {
    if (command.k === "t") {
      const pathfinder = command.n ? await resolvePathfinder(state) : undefined;
      const result = advanceWorld(state, command.d, pathfinder, { interactions: command.i ?? [], playerDistanceMeters: command.m ?? 0 });
      state = result.state;
      events.push(...result.events);
      applied += 1;
      continue;
    }
    const step = replayCommands(state, [command]);
    state = step.state;
    events.push(...step.events);
    applied += step.applied;
  }
  return { state, events, applied };
}
