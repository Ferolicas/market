import { describe, expect, it } from "vitest";
import { applyGameAction, createInitialGame } from "../game/engine";
import { savePayloadSchema } from "./game-validation";

describe("game save validation", () => {
  it("requires the stamped franchise origin on every ledger event", () => {
    const initial = createInitialGame("ES");
    const ordered = applyGameAction(initial, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 1 });
    const payload = {
      expectedRevision: 4,
      operationId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
      sessionId: "11111111-1111-4111-8111-111111111111",
      state: ordered.state,
      events: ordered.events,
    };

    expect(savePayloadSchema.safeParse(payload).success).toBe(true);

    const missingOrigin = structuredClone(payload) as unknown as { events: { franchiseId?: string }[] };
    delete missingOrigin.events[0].franchiseId;

    expect(savePayloadSchema.safeParse(missingOrigin).success).toBe(false);
  });

  it("rejects malformed nested franchises before they reach the engine", () => {
    const initial = createInitialGame("ES");
    const payload = {
      expectedRevision: 1,
      operationId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
      sessionId: "11111111-1111-4111-8111-111111111111",
      state: initial,
      events: [],
    };

    const nullFranchise = structuredClone(payload) as unknown as { state: { franchises: unknown[] } };
    nullFranchise.state.franchises[0] = null;
    expect(savePayloadSchema.safeParse(nullFranchise).success).toBe(false);

    const invalidInventory = structuredClone(payload);
    (invalidInventory.state.franchises[0].warehouse as Record<string, unknown>).wheat = "unlimited";
    expect(savePayloadSchema.safeParse(invalidInventory).success).toBe(false);
  });
});
