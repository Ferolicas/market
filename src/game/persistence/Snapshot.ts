import { z } from "zod";
import { normalizeGameState } from "../engine";
import type { GameEvent, GameState } from "../types";

export const domainEventSchema = z.object({
  franchiseId: z.string().min(1).max(80),
  eventId: z.string().uuid(),
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  type: z.string().min(1).max(80),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(1).max(120),
  category: z.string().min(1).max(40),
  description: z.string().min(1).max(160),
  amountMinor: z.number().int(),
});

export interface RecoveryEnvelope { state: GameState; saveRevision: number; pendingEvents: GameEvent[]; }

export function createSnapshot(state: GameState, now = new Date()) {
  return { ...structuredClone(state), schemaVersion: 4 as const, lastSavedAt: now.toISOString() };
}

export function chooseRecovery(server: RecoveryEnvelope, local: RecoveryEnvelope) {
  if (local.saveRevision !== server.saveRevision || local.state.revision <= server.state.revision) return { source: "server" as const, envelope: server };
  const pendingEvents = restorePendingEventOrigins(local.pendingEvents, local.state.currentFranchiseId);
  const serverEvents = new Set(server.state.processedEventIds);
  if (pendingEvents.some((event) => event.eventId && serverEvents.has(event.eventId))) return { source: "server" as const, envelope: server };
  return { source: "local" as const, envelope: { ...local, state: normalizeGameState(local.state), pendingEvents } };
}

/**
 * Pending events written by builds predating per-franchise attribution cannot
 * recover their original branch. The active branch stored in that same local
 * snapshot is the only deterministic fallback; newly stamped events always
 * carry their real source and never pass through this branch.
 */
export function restorePendingEventOrigins(events: GameEvent[], fallbackFranchiseId: string) {
  return events.map((event) => event.franchiseId ? event : { ...event, franchiseId: fallbackFranchiseId });
}

export function validatePendingEvents(events: GameEvent[]) {
  const seen = new Set<string>();
  for (const event of events) {
    const parsed = domainEventSchema.safeParse(event);
    if (!parsed.success || seen.has(parsed.data.idempotencyKey)) return false;
    seen.add(parsed.data.idempotencyKey);
  }
  return true;
}

export function cappedOfflineElapsed(lastServerTime: number, now: number, maximumMs = 6 * 60 * 60 * 1_000) {
  return Math.min(maximumMs, Math.max(0, now - lastServerTime));
}
