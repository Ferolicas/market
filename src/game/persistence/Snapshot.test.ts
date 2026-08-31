import { describe, expect, it } from "vitest";
import { createInitialGame, normalizeGameState } from "../engine";
import { cappedOfflineElapsed, chooseRecovery, createSnapshot, validatePendingEvents } from "./Snapshot";

describe("snapshot persistence", () => {
  it("migrates, snapshots and caps offline time without dropping in-flight state", () => {
    const legacy = createInitialGame() as unknown as { schemaVersion: number; progression?: unknown };
    legacy.schemaVersion = 2; delete legacy.progression;
    const migrated = normalizeGameState(legacy);
    migrated.franchises[0].productionMachines[0].status = "PROCESSING";
    expect(createSnapshot(migrated).franchises[0].productionMachines[0].status).toBe("PROCESSING");
    expect(cappedOfflineElapsed(0, 24 * 60 * 60 * 1_000)).toBe(6 * 60 * 60 * 1_000);
  });

  it("recovers only a strictly newer non-replayed local revision", () => {
    const serverState = createInitialGame();
    const localState = structuredClone(serverState); localState.revision = 2;
    const server = { state: serverState, saveRevision: 4, pendingEvents: [] };
    const local = { state: localState, saveRevision: 4, pendingEvents: [] };
    expect(chooseRecovery(server, local).source).toBe("local");
    expect(validatePendingEvents([])).toBe(true);
  });
});
