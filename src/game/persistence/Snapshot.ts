import { z } from "zod";
import { normalizeGameState } from "../engine";
import type { GameEvent, GameState } from "../types";

export const domainEventSchema = z.object({
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
  return { ...structuredClone(state), schemaVersion: 3 as const, lastSavedAt: now.toISOString() };
}

export function chooseRecovery(server: RecoveryEnvelope, local: RecoveryEnvelope) {
  if (local.saveRevision !== server.saveRevision || local.state.revision <= server.state.revision) return { source: "server" as const, envelope: server };
  const serverEvents = new Set(server.state.processedEventIds);
  if (local.pendingEvents.some((event) => event.eventId && serverEvents.has(event.eventId))) return { source: "server" as const, envelope: server };
  return { source: "local" as const, envelope: { ...local, state: normalizeGameState(local.state) } };
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
