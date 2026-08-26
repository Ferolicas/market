import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createInitialGame, normalizeGameState } from "@/game/engine";
import { savePayloadSchema, type ValidSavePayload } from "@/lib/game-validation";
import type { GameState } from "@/game/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const existing = await db.gameSave.findUnique({ where: { userId_slot: { userId: session.user.id, slot: 1 } } });
  if (existing) return Response.json({ state: normalizeGameState(existing.state), saveRevision: existing.revision, savedAt: existing.updatedAt });

  const initial = createInitialGame("ES");
  const saved = await db.$transaction(async (tx) => {
    await tx.playerProfile.upsert({
      where: { userId: session.user.id },
      update: {},
      create: { userId: session.user.id },
    });
    return tx.gameSave.create({
      data: { userId: session.user.id, slot: 1, revision: 1, state: JSON.parse(JSON.stringify(initial)), checksum: checksum(initial) },
    });
  });
  return Response.json({ state: saved.state, saveRevision: saved.revision, savedAt: saved.updatedAt }, { status: 201 });
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

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
  const stateJson = JSON.parse(JSON.stringify(payload.state));
  const nextRevision = payload.expectedRevision + 1;

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.gameSave.updateMany({
      where: { userId: session.user.id, slot: 1, revision: payload.expectedRevision },
      data: { revision: nextRevision, state: stateJson, checksum: checksum(payload.state) },
    });
    if (updated.count !== 1) return { conflict: true as const };

    if (payload.events.length) {
      await tx.ledgerEntry.createMany({
        data: payload.events.map((event) => ({
          userId: session.user.id,
          saveRevision: nextRevision,
          day: payload.state.day,
          franchiseId: payload.state.currentFranchiseId,
          category: event.category,
          description: event.description,
          amountMinor: BigInt(event.amountMinor),
          currency: payload.state.currency,
        })),
      });
    }
    await tx.playerProfile.update({
      where: { userId: session.user.id },
      data: { countryCode: payload.state.countryCode, currency: payload.state.currency, avatarSkin: payload.state.avatar.skin, avatarShirt: payload.state.avatar.shirt, avatarHat: payload.state.avatar.hat },
    });
    return { conflict: false as const };
  });

  if (result.conflict) {
    const current = await db.gameSave.findUnique({ where: { userId_slot: { userId: session.user.id, slot: 1 } } });
    return Response.json({ error: "SAVE_CONFLICT", state: current?.state, saveRevision: current?.revision }, { status: 409 });
  }
  return Response.json({ ok: true, saveRevision: nextRevision, savedAt: new Date().toISOString() });
}

function checksum(state: GameState) {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}
