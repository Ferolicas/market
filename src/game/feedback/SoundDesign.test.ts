import { describe, expect, it } from "vitest";
import type { FeedbackCue } from "./FeedbackBus";
import { cuePlayback, EFFECT_SAMPLES, feedbackChannel, SOUND_SAMPLE_URLS } from "./SoundDesign";

describe("diseño de sonido", () => {
  it("asigna cada archivo entregado a su momento del juego", () => {
    expect(cuePlayback({ cue: "mission", source: "system" }).sample).toBe("mission");
    expect(cuePlayback({ cue: "payment", source: "system" }).sample).toBe("cashier");
    expect(cuePlayback({ cue: "upgrade", source: "system" }).sample).toBe("cashier");
    expect(cuePlayback({ cue: "money", source: "player" })).toMatchObject({ sample: "money", loop: true });
    expect(cuePlayback({ cue: "stock", source: "player" }).sample).toBe("stock");
    expect(cuePlayback({ cue: "machine", source: "player" }).sample).toBe("machine");
    expect(cuePlayback({ cue: "pickup", source: "player" }).sample).toBe("machine");
  });
  it("alterna dos pisadas con tono variable y deja a los clientes como murmullo", () => {
    const first = cuePlayback({ cue: "footstep", source: "player", actorId: "player" }, () => 0.1);
    const second = cuePlayback({ cue: "footstep", source: "player", actorId: "player" }, () => 0.9);
    expect(first.sample).toBe("step-1");
    expect(second.sample).toBe("step-2");
    expect(first.rate).toBeLessThan(second.rate);
    const crowd = cuePlayback({ cue: "footstep", source: "npc", actorId: "customer-3" }, () => 0.5);
    expect(crowd.gain).toBeLessThan(first.gain / 3);
    expect(crowd.cooldownMs).toBeGreaterThan(first.cooldownMs);
  });
  it("vibra solo en cobros, mejoras y misiones", () => {
    const withVibration = (Object.keys(SOUND_SAMPLE_URLS) as string[]).length && (["footstep", "harvest", "pickup", "stock", "machine", "scanner", "door", "payment", "upgrade", "mission", "money"] as FeedbackCue[])
      .filter((cue) => cuePlayback({ cue, source: "system" }).vibration);
    expect(withVibration).toEqual(["payment", "upgrade", "mission"]);
  });
  it("sintetiza escáner y puerta sin archivo y precarga solo efectos cortos", () => {
    expect(cuePlayback({ cue: "scanner", source: "player" })).toMatchObject({ sample: null, tone: 920 });
    expect(cuePlayback({ cue: "door", source: "system" })).toMatchObject({ sample: null, tone: 230 });
    expect(EFFECT_SAMPLES).not.toContain("music");
    for (const sample of EFFECT_SAMPLES) expect(SOUND_SAMPLE_URLS[sample]).toMatch(/^\/audio\/.+\.mp3$/);
  });
});

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
