import { describe, expect, it } from "vitest";
import { applyGameAction, createInitialGame, normalizeGameState } from "../engine";
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

  it("validates event origins and migrates the explicit active-franchise fallback for legacy recovery", () => {
    const serverState = createInitialGame("ES");
    const ordered = applyGameAction(serverState, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 1 });
    expect(validatePendingEvents(ordered.events)).toBe(true);

    const legacyEvent = structuredClone(ordered.events[0]) as unknown as Record<string, unknown>;
    delete legacyEvent.franchiseId;
    const legacyEvents = [legacyEvent] as unknown as typeof ordered.events;
    expect(validatePendingEvents(legacyEvents)).toBe(false);

    const selected = chooseRecovery(
      { state: serverState, saveRevision: 4, pendingEvents: [] },
      { state: ordered.state, saveRevision: 4, pendingEvents: legacyEvents },
    );

    expect(selected.source).toBe("local");
    expect(selected.envelope.pendingEvents[0].franchiseId).toBe(ordered.state.currentFranchiseId);
    expect(validatePendingEvents(selected.envelope.pendingEvents)).toBe(true);
  });
});
