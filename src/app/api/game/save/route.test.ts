import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeGameState } from "@/game/engine";
import { replayCommands, type GameCommand } from "@/game/persistence/CommandLog";
import { runCampaignBot } from "@/game/testing/CampaignBot";
import { CAMPAIGN_RELEASE, CAMPAIGN_SAVE_SLOT } from "@/game/persistence/CampaignRelease";
import type { GameEvent, GameState } from "@/game/types";

/**
 * The save route against an in-memory Prisma stand-in: enough of the client
 * surface to run the real handler, the real validators and the real replay.
 */
interface SaveRow { userId: string; slot: number; revision: number; state: unknown; checksum: string; updatedAt: Date }
const rows: { save: SaveRow | null; operations: Record<string, unknown>[]; telemetry: Record<string, unknown>[]; batches: Record<string, unknown>[]; ledger: Record<string, unknown>[] } = { save: null, operations: [], telemetry: [], batches: [], ledger: [] };

const fakeDb = {
  gameSave: {
    findUnique: vi.fn(async () => rows.save),
    upsert: vi.fn(async ({ create }: { create: Omit<SaveRow, "updatedAt"> }) => (rows.save ??= { ...create, updatedAt: new Date() })),
    updateMany: vi.fn(async ({ where, data }: { where: { revision: number }; data: Partial<SaveRow> }) => {
      if (!rows.save || rows.save.revision !== where.revision) return { count: 0 };
      Object.assign(rows.save, data, { updatedAt: new Date() });
      return { count: 1 };
    }),
  },
  saveOperation: {
    findUnique: vi.fn(async ({ where }: { where: { operationId: string } }) => rows.operations.find((operation) => operation.operationId === where.operationId) ?? null),
    findFirst: vi.fn(async () => rows.operations.at(-1) ?? null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { rows.operations.push({ ...data, createdAt: new Date() }); return data; }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
  playerProfile: { upsert: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
  ledgerEntry: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { rows.ledger.push(data); }), createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => { rows.ledger.push(...data); return { count: data.length }; }) },
  clientTelemetry: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { rows.telemetry.push(data); return data; }) },
  saveCommandBatch: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { rows.batches.push(data); return data; }), deleteMany: vi.fn(async () => ({ count: 0 })), count: vi.fn(async () => rows.batches.filter((batch) => batch.baseState).length) },
  $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(fakeDb)),
  $queryRaw: vi.fn(async () => [{ count: BigInt(6) }]),
};

vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn(async () => ({ user: { id: "user-1" } })) } } }));
vi.mock("@/lib/api-rate-limit", () => ({ consumeApiRateLimit: vi.fn(async () => ({ allowed: true })), rateLimitExceeded: () => Response.json({ error: "RATE" }, { status: 429 }) }));

const { GET, PUT } = await import("./route");

function put(body: unknown, headers: Record<string, string> = {}) {
  return PUT(new Request("http://localhost/api/game/save", { method: "PUT", headers: { "content-type": "application/json", "x-market-release": CAMPAIGN_RELEASE, ...headers }, body: JSON.stringify(body) }));
}

async function playedStretch(base: GameState) {
  const run = runCampaignBot(base, { targetLevel: 2, maxTicks: 160 });
  const replayed = replayCommands(base, run.commands);
  expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(run.state));
  expect(replayed.events.length).toBeLessThanOrEqual(200);
  return { state: { ...run.state, lastSavedAt: new Date().toISOString() }, events: replayed.events as GameEvent[], commands: run.commands, baseNormalized: true };
}

const ids = { operationId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222", sessionId: "33333333-3333-4333-8333-333333333333" };

describe("save route replay", () => {
  beforeEach(async () => {
    rows.save = null; rows.operations = []; rows.telemetry = []; rows.batches = []; rows.ledger = [];
    vi.stubEnv("MARKET_REPLAY_MODE", "shadow");
    const created = await GET(new Request("http://localhost/api/game/save"));
    expect(created.status).toBe(201);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("accepts a played stretch whose commands replay to the submitted snapshot and keeps the batch", async () => {
    const base = normalizeGameState(rows.save!.state);
    const stretch = await playedStretch(base);
    const response = await put({ ...ids, expectedRevision: 1, ...stretch });
    expect(await response.json()).toMatchObject({ ok: true, saveRevision: 2 });
    expect(rows.telemetry).toEqual([]);
    expect(rows.batches).toHaveLength(1);
    expect(rows.batches[0]).toMatchObject({ userId: "user-1", slot: CAMPAIGN_SAVE_SLOT, fromRevision: 1, toRevision: 2, verdict: "match", commandCount: stretch.commands.length });
    expect(rows.batches[0].baseState).toBeUndefined();
    expect(rows.save!.revision).toBe(2);
  });

  it("records a mismatch in shadow mode and refuses it in strict mode", async () => {
    const base = normalizeGameState(rows.save!.state);
    const stretch = await playedStretch(base);
    const forged = JSON.parse(JSON.stringify(stretch.state)) as GameState;
    // An inventory the authority cannot disprove, but the replay can.
    forged.franchises[0].warehouse.tomatoes += 1;
    const shadow = await put({ ...ids, expectedRevision: 1, ...stretch, state: forged });
    expect(shadow.status).toBe(200);
    expect(rows.telemetry).toHaveLength(1);
    expect(rows.telemetry[0]).toMatchObject({ kind: "replay", name: "mismatch", severity: "warning", deviceId: ids.deviceId });
    expect(String(rows.telemetry[0].message)).toMatch(/^\$\.franchises\.0\.warehouse\.tomatoes: /);
    expect(rows.batches[0]).toMatchObject({ verdict: "mismatch", baseNormalized: true });
    // Both ends of a mismatching stretch are kept so it can be replayed offline.
    expect((rows.batches[0].baseState as { revision: number }).revision).toBe(base.revision);
    expect((rows.batches[0].submittedState as { balanceMinor: number }).balanceMinor).toBe(forged.balanceMinor);

    vi.stubEnv("MARKET_REPLAY_MODE", "strict");
    const strict = await put({ ...ids, operationId: "44444444-4444-4444-8444-444444444444", expectedRevision: 2, ...stretch, state: { ...forged, revision: forged.revision + 1 }, events: [], commands: [{ k: "t", d: 200, n: 0 }] as GameCommand[] });
    expect(strict.status).toBe(422);
    expect(await strict.json()).toMatchObject({ error: "REPLAY_MISMATCH" });
    expect(rows.save!.revision).toBe(2);
  });

  it("notes an absent log without refusing the save, and skips replay when switched off", async () => {
    const base = normalizeGameState(rows.save!.state);
    const stretch = await playedStretch(base);
    const absent = await put({ ...ids, expectedRevision: 1, ...stretch, commands: null });
    expect(absent.status).toBe(200);
    expect(rows.telemetry).toHaveLength(1);
    expect(rows.telemetry[0]).toMatchObject({ kind: "replay", name: "absent", severity: "info" });
    expect(rows.batches).toHaveLength(0);

    vi.stubEnv("MARKET_REPLAY_MODE", "off");
    const next = await playedStretch(normalizeGameState(rows.save!.state));
    const off = await put({ ...ids, operationId: "55555555-5555-4555-8555-555555555555", expectedRevision: 2, ...next });
    expect(off.status).toBe(200);
    expect(rows.telemetry).toHaveLength(1);
    expect(rows.batches).toHaveLength(0);
  });

  it("still rejects what the authority rejects before any replay runs", async () => {
    const base = normalizeGameState(rows.save!.state);
    const stretch = await playedStretch(base);
    const richer = { ...stretch.state, balanceMinor: stretch.state.balanceMinor + 1_000 };
    const response = await put({ ...ids, expectedRevision: 1, ...stretch, state: richer });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "INVALID_BALANCE_DELTA" });
    expect(rows.batches).toHaveLength(0);
  });
});
