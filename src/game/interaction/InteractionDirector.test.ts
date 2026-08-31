import { describe, expect, it } from "vitest";
import { InteractionDirector } from "./InteractionDirector";
import type { InteractionZoneConfig } from "./InteractionZone";

const zone = (id: string, priority: number, channel: InteractionZoneConfig["channel"] = "transfer"): InteractionZoneConfig => ({
  id, type: id, x: 0, z: 0, enterRadius: 0.75, exitRadius: 0.9, actorMask: ["player"], priority, dwellMs: 80, repeatEveryMs: 180, exitGraceMs: 120, channel,
});

describe("InteractionDirector", () => {
  it("uses dwell, cadence, hysteresis and channel priority", () => {
    const director = new InteractionDirector([zone("near", 2), zone("priority", 8)]);
    expect(director.update("player", 0, 0, 0).filter((event) => event.signal === "tick")).toHaveLength(0);
    expect(director.update("player", 0, 0, 80).filter((event) => event.signal === "tick").map((event) => event.zone.id)).toEqual(["priority"]);
    expect(director.update("player", 0, 0, 100).filter((event) => event.signal === "tick")).toHaveLength(0);
    expect(director.update("player", 0.8, 0, 150).some((event) => event.signal === "exit")).toBe(false);
    expect(director.update("player", 1, 0, 280).filter((event) => event.signal === "exit")).toHaveLength(0);
    expect(director.update("player", 1, 0, 400).filter((event) => event.signal === "exit")).toHaveLength(2);
  });
});
