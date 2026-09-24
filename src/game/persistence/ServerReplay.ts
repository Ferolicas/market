import { createHash } from "node:crypto";
import type { GameState } from "../types";
import { normalizeGameState } from "../engine";
import { serverPathfinderFor } from "../navigation/ServerNavigation";
import { canonicalJson, firstDifference, replayCommandsAsync, type GameCommand } from "./CommandLog";

export type ReplayMode = "off" | "shadow" | "strict";

export interface ReplayVerdict {
  status: "match" | "mismatch" | "absent" | "error";
  /** Commands folded before the verdict. */
  applied: number;
  /** Where the replayed snapshot first departs from the submitted one. */
  difference?: string;
  durationMs: number;
}

/** `MARKET_REPLAY_MODE`: `shadow` (default) replays and records a mismatch
 * without refusing the save; `strict` refuses it; `off` skips the replay. */
export function replayMode(env: NodeJS.ProcessEnv = process.env): ReplayMode {
  const value = env.MARKET_REPLAY_MODE;
  return value === "strict" || value === "off" ? value : "shadow";
}

/** Snapshot digest that ignores key order and the wall-clock save stamp. */
export function replayChecksum(state: GameState) {
  return createHash("sha256").update(canonicalJson({ ...state, lastSavedAt: "" })).digest("hex");
}

/**
 * Folds the client's commands over the stored revision with the same engine
 * and compares the result with the snapshot the client sent.
 */
export async function verifyReplay(base: GameState, submitted: GameState, commands: GameCommand[] | null | undefined, baseNormalized = true): Promise<ReplayVerdict> {
  const started = performance.now();
  if (!commands) return { status: "absent", applied: 0, durationMs: 0 };
  try {
    // After a load the client plays on the normalised snapshot; after an
    // acknowledged save it plays on the very object it sent, which
    // normalisation would alter (employee runtimes are rebuilt on load).
    const replayed = await replayCommandsAsync(baseNormalized ? normalizeGameState(base) : base, commands, serverPathfinderFor);
    const durationMs = Math.round(performance.now() - started);
    if (replayChecksum(replayed.state) === replayChecksum(submitted)) return { status: "match", applied: replayed.applied, durationMs };
    const difference = firstDifference(JSON.parse(canonicalJson({ ...replayed.state, lastSavedAt: "" })), JSON.parse(canonicalJson({ ...submitted, lastSavedAt: "" }))) ?? "unknown";
    return { status: "mismatch", applied: replayed.applied, difference, durationMs };
  } catch (cause) {
    return { status: "error", applied: 0, difference: cause instanceof Error ? cause.message.slice(0, 200) : String(cause).slice(0, 200), durationMs: Math.round(performance.now() - started) };
  }
}
