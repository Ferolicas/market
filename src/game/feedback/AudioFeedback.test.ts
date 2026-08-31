import { describe, expect, it } from "vitest";
import { feedbackChannel } from "./AudioFeedback";

describe("canales de feedback", () => {
  it("aísla el enfriamiento de pasos por actor", () => {
    const player = feedbackChannel({ cue: "footstep", source: "player", actorId: "player" });
    const cashier = feedbackChannel({ cue: "footstep", source: "npc", actorId: "cashier-1" });
    const stocker = feedbackChannel({ cue: "footstep", source: "npc", actorId: "stocker-1" });

    expect(new Set([player, cashier, stocker]).size).toBe(3);
  });

  it("mantiene estable un canal de sistema cuando no hay actor", () => {
    expect(feedbackChannel({ cue: "door", source: "system" })).toBe("door:system:system");
  });
});
