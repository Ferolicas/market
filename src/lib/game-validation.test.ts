import { describe, expect, it } from "vitest";
import { applyGameAction, createInitialGame } from "../game/engine";
import { savePayloadSchema } from "./game-validation";

describe("game save validation", () => {
  it("requires the stamped franchise origin on every ledger event", () => {
    const initial = createInitialGame("ES");
    const ordered = applyGameAction(initial, { type: "ORDER", supplierId: "campo", productId: "wheat", quantity: 1 });
    const payload = {
      expectedRevision: 4,
      sessionId: "11111111-1111-4111-8111-111111111111",
      state: ordered.state,
      events: ordered.events,
    };

    expect(savePayloadSchema.safeParse(payload).success).toBe(true);

    const missingOrigin = structuredClone(payload) as unknown as { events: { franchiseId?: string }[] };
    delete missingOrigin.events[0].franchiseId;

    expect(savePayloadSchema.safeParse(missingOrigin).success).toBe(false);
  });
});
