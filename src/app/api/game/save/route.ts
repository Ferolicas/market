import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createCampaignGame, normalizeGameState } from "@/game/engine";
import { savePayloadSchema, type ValidSavePayload } from "@/lib/game-validation";
import { validateSaveTransition } from "@/game/persistence/SaveAuthority";
import { isPreRegisterSnapshot, preRegisterChecksumState } from "@/game/persistence/RegisterCompatibility";
import { Prisma } from "@/generated/prisma/client";
import { consumeApiRateLimit, rateLimitExceeded } from "@/lib/api-rate-limit";
import { replayMode, verifyReplay, type ReplayVerdict } from "@/game/persistence/ServerReplay";

import { CAMPAIGN_RELEASE, CAMPAIGN_SAVE_SLOT } from "@/game/persistence/CampaignRelease";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const rateLimit = await consumeApiRateLimit({ scope: "save:read", subject: session.user.id, limit: 120, windowSeconds: 60 });
  if (!rateLimit.allowed) return rateLimitExceeded(rateLimit);

  const existing = await db.gameSave.findUnique({ where: { userId_slot: { userId: session.user.id, slot: CAMPAIGN_SAVE_SLOT } } });
  if (existing) {
    const latestOperation = await db.saveOperation.findFirst({ where: { userId: session.user.id, slot: CAMPAIGN_SAVE_SLOT }, orderBy: { appliedRevision: "desc" } });
    return Response.json({
      state: normalizeGameState(existing.state),
      saveRevision: existing.revision,
      savedAt: existing.updatedAt,
      recoveryScope: recoveryScope(session.user.id),
      lastOperationId: latestOperation?.operationId ?? null,
    });
  }

  const initial = createCampaignGame("ES");
  let saved;
  try {
    saved = await db.$transaction(async (tx) => {
      await tx.playerProfile.upsert({
        where: { userId: session.user.id },
        update: {},
        create: { userId: session.user.id },
      });
      return tx.gameSave.upsert({
        where: { userId_slot: { userId: session.user.id, slot: CAMPAIGN_SAVE_SLOT } },
        update: {},
        create: { userId: session.user.id, slot: CAMPAIGN_SAVE_SLOT, revision: 1, state: JSON.parse(JSON.stringify(initial)), checksum: checksum(initial) },
      });
    });
  } catch (cause) {
    if (!isUniqueConstraintError(cause)) throw cause;
    saved = await db.gameSave.findUnique({ where: { userId_slot: { userId: session.user.id, slot: CAMPAIGN_SAVE_SLOT } } });
    if (!saved) throw cause;
  }
  return Response.json({ state: saved.state, saveRevision: saved.revision, savedAt: saved.updatedAt, recoveryScope: recoveryScope(session.user.id), lastOperationId: null }, { status: 201 });
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (request.headers.get("x-market-release") !== CAMPAIGN_RELEASE) return Response.json({ error: "CLIENT_UPDATE_REQUIRED" }, { status: 409 });
  const rateLimit = await consumeApiRateLimit({ scope: "save:write", subject: session.user.id, limit: 30, windowSeconds: 60 });
  if (!rateLimit.allowed) return rateLimitExceeded(rateLimit);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 600_000) return Response.json({ error: "SAVE_TOO_LARGE" }, { status: 413 });

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (!rawBody) return Response.json({ error: "EMPTY_SAVE" }, { status: 400 });
    if (new TextEncoder().encode(rawBody).byteLength > 600_000) return Response.json({ error: "SAVE_TOO_LARGE" }, { status: 413 });
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = savePayloadSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "INVALID_SAVE", issues: parsed.error.issues.slice(0, 4) }, { status: 400 });
  const payload = parsed.data as unknown as ValidSavePayload;
  const legacyRequest = isPreRegisterSnapshot((body as { state?: unknown }).state);
  // Adoption: the owner resolved a device conflict in favour of this copy.
  // Its event chain cannot be replayed, so the snapshot is normalised and
  // stored as the next revision; the wealth jump is booked in the ledger.
  const adoptLocal = payload.adoptLocal === true;
  if (adoptLocal && payload.events.length) return Response.json({ error: "INVALID_EVENTS" }, { status: 422 });
  const adoptedState = adoptLocal ? normalizeGameState(payload.state) : null;
  const stateJson = JSON.parse(JSON.stringify(adoptedState ?? payload.state));
  const nextRevision = payload.expectedRevision + 1;
  const extendedLedger = await hasExtendedLedger();

  // Replay the client's command stream over the stored revision with the same
  // engine. The revision lock inside the transaction guarantees the base read
  // here is the one the client played from, or the save conflicts anyway.
  const mode = replayMode();
  let replay: ReplayVerdict | null = null;
  if (mode !== "off" && !adoptedState) {
    const base = await db.gameSave.findUnique({ where: { userId_slot: { userId: session.user.id, slot: CAMPAIGN_SAVE_SLOT } } });
    if (base && base.revision === payload.expectedRevision) {
      replay = await verifyReplay(normalizeGameState(base.state), payload.state, payload.commands);
      if (mode === "strict" && replay.status === "mismatch") return Response.json({ error: "REPLAY_MISMATCH", difference: replay.difference }, { status: 422 });
    }
  }

  const result = await db.$transaction(async (tx) => {
    const existingOperation = await tx.saveOperation.findUnique({ where: { operationId: payload.operationId } });
    if (existingOperation) {
      const exactReplay = existingOperation.userId === session.user.id
        && existingOperation.slot === CAMPAIGN_SAVE_SLOT
        && existingOperation.expectedRevision === payload.expectedRevision
        && existingOperation.deviceId === payload.deviceId
        && (existingOperation.stateChecksum === checksum(payload.state)
          || (legacyRequest && existingOperation.stateChecksum === checksum(preRegisterChecksumState(payload.state))));
      if (!exactReplay) {
        return { conflict: false as const, replay: false as const, invalid: "INVALID_OPERATION" as const, appliedRevision: null, savedAt: null };
      }
      return { conflict: false as const, replay: true as const, invalid: null, appliedRevision: existingOperation.appliedRevision, savedAt: existingOperation.createdAt };
    }
    const current = await tx.gameSave.findUnique({ where: { userId_slot: { userId: session.user.id, slot: CAMPAIGN_SAVE_SLOT } } });
    if (!current || current.revision !== payload.expectedRevision) return { conflict: true as const, replay: false as const, invalid: null, appliedRevision: null, savedAt: null };
    const currentState = normalizeGameState(current.state);
    if (!adoptedState) {
      const authority = validateSaveTransition(currentState, payload.state, payload.events, { allowLegacyWalletSales: isPreRegisterSnapshot(current.state) });
      if (!authority.ok) return { conflict: false as const, replay: false as const, invalid: authority.code, appliedRevision: null, savedAt: null };
      const acceptedIds = new Set(currentState.processedEventIds);
      if (payload.events.some((event) => event.eventId && acceptedIds.has(event.eventId))) {
        return { conflict: true as const, replay: true as const, invalid: null, appliedRevision: null, savedAt: null };
      }
    }
    const updated = await tx.gameSave.updateMany({
      where: { userId: session.user.id, slot: CAMPAIGN_SAVE_SLOT, revision: payload.expectedRevision },
      data: { revision: nextRevision, state: stateJson, checksum: checksum(payload.state) },
    });
    if (updated.count !== 1) return { conflict: true as const, replay: false as const, invalid: null, appliedRevision: null, savedAt: null };

    await tx.saveOperation.create({
      data: {
        operationId: payload.operationId,
        userId: session.user.id,
        slot: CAMPAIGN_SAVE_SLOT,
        expectedRevision: payload.expectedRevision,
        appliedRevision: nextRevision,
        deviceId: payload.deviceId,
        sessionId: payload.sessionId,
        stateChecksum: checksum(payload.state),
      },
    });
    if (nextRevision % 120 === 0) {
      await tx.saveOperation.deleteMany({
        where: {
          userId: session.user.id,
          createdAt: { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1_000) },
          operationId: { not: payload.operationId },
        },
      });
    }

    if (adoptedState) {
      const wealth = (state: typeof adoptedState) => state.balanceMinor + state.franchises.reduce((sum, franchise) => sum + (franchise.registerCashMinor ?? []).reduce((lanes, amount) => lanes + amount, 0), 0);
      await tx.ledgerEntry.create({
        data: {
          userId: session.user.id,
          saveRevision: nextRevision,
          day: adoptedState.day,
          franchiseId: adoptedState.currentFranchiseId,
          category: "adoption",
          description: "Copia local adoptada como partida oficial",
          amountMinor: BigInt(wealth(adoptedState) - wealth(currentState)),
          currency: adoptedState.currency,
          ...(extendedLedger ? { sessionId: payload.sessionId, type: "adopt_local_copy", payload: { fromRevision: current.revision, deviceId: payload.deviceId } } : {}),
        },
      });
    }
    if (payload.events.length) {
      await tx.ledgerEntry.createMany({
        data: payload.events.map((event) => ({
          userId: session.user.id,
          saveRevision: nextRevision,
          day: payload.state.day,
          franchiseId: event.franchiseId,
          category: event.category,
          description: event.description,
          amountMinor: BigInt(event.amountMinor),
          currency: payload.state.currency,
          ...(extendedLedger ? {
            eventId: event.eventId,
            sessionId: payload.sessionId,
            sequence: event.sequence,
            type: event.type,
            payload: event.payload ? JSON.parse(JSON.stringify(event.payload)) : undefined,
            idempotencyKey: event.idempotencyKey,
          } : {}),
        })),
        skipDuplicates: true,
      });
    }
    await tx.playerProfile.update({
      where: { userId: session.user.id },
      data: { countryCode: payload.state.countryCode, currency: payload.state.currency, avatarSkin: payload.state.avatar.skin, avatarShirt: payload.state.avatar.shirt, avatarHat: payload.state.avatar.hat },
    });
    return { conflict: false as const, replay: false as const, invalid: null, appliedRevision: nextRevision, savedAt: new Date() };
  });

  if (result.invalid) return Response.json({ error: result.invalid }, { status: 422 });

  if (replay && result.appliedRevision !== null && !result.replay) {
    await recordReplay(session.user.id, payload, replay, result.appliedRevision, mode).catch(() => undefined);
  }

  if (result.replay) {
    return Response.json({ ok: true, replay: true, saveRevision: result.appliedRevision, savedAt: result.savedAt });
  }

  if (result.conflict) {
    // A concurrent identical request can miss the receipt at the transaction's
    // first read and see the advanced revision. Recheck after the winner commits.
    const receipt = await db.saveOperation.findUnique({ where: { operationId: payload.operationId } });
    if (receipt?.userId === session.user.id && receipt.slot === CAMPAIGN_SAVE_SLOT) {
      return Response.json({ ok: true, replay: true, saveRevision: receipt.appliedRevision, savedAt: receipt.createdAt });
    }
    const current = await db.gameSave.findUnique({ where: { userId_slot: { userId: session.user.id, slot: CAMPAIGN_SAVE_SLOT } } });
    const latestWriter = await db.saveOperation.findFirst({ where: { userId: session.user.id, slot: CAMPAIGN_SAVE_SLOT }, orderBy: { appliedRevision: "desc" } });
    return Response.json({
      error: result.replay ? "EVENT_REPLAY" : "SAVE_CONFLICT",
      state: current?.state,
      saveRevision: current?.revision,
      conflict: latestWriter ? { deviceId: latestWriter.deviceId, sessionId: latestWriter.sessionId, savedAt: latestWriter.createdAt } : null,
    }, { status: 409 });
  }
  return Response.json({ ok: true, saveRevision: result.appliedRevision, savedAt: result.savedAt });
}

/** Shadow mode learns from production: a mismatch, an absent log or a replay
 * error becomes a telemetry line (never the snapshot), and the stream itself
 * is kept two weeks for offline reproduction. */
async function recordReplay(userId: string, payload: ValidSavePayload, replay: ReplayVerdict, appliedRevision: number, mode: string) {
  if (replay.status !== "match") {
    await db.clientTelemetry.create({
      data: {
        userId, kind: "replay", name: replay.status, severity: replay.status === "mismatch" ? "warning" : "info",
        message: replay.difference?.slice(0, 1_000) ?? null, deviceId: payload.deviceId, sessionId: payload.sessionId,
        payload: { mode, applied: replay.applied, commands: payload.commands?.length ?? null, fromRevision: payload.expectedRevision, toRevision: appliedRevision, durationMs: replay.durationMs },
      },
    });
  }
  if (payload.commands?.length) {
    await db.saveCommandBatch.create({
      data: { userId, slot: CAMPAIGN_SAVE_SLOT, fromRevision: payload.expectedRevision, toRevision: appliedRevision, commandCount: payload.commands.length, verdict: replay.status, commands: JSON.parse(JSON.stringify(payload.commands)) },
    });
  }
  if (appliedRevision % 120 === 0) {
    await db.saveCommandBatch.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1_000) } } });
  }
}

function checksum(state: unknown) {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function recoveryScope(userId: string) {
  return createHash("sha256").update(`market-recovery:${CAMPAIGN_RELEASE}:${userId}`).digest("hex");
}

function isUniqueConstraintError(cause: unknown) {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "P2002";
}

let extendedLedgerSupport: Promise<boolean> | null = null;

function hasExtendedLedger() {
  extendedLedgerSupport ??= db.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'LedgerEntry'
      AND column_name IN ('eventId', 'sessionId', 'sequence', 'type', 'payload', 'idempotencyKey')
  `).then((rows) => Number(rows[0]?.count ?? 0) === 6).catch(() => {
    extendedLedgerSupport = null;
    return false;
  });
  return extendedLedgerSupport;
}
