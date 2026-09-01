import { describe, expect, it } from "vitest";
import { interactionZonePlanarDistance, interactionZoneSensorPrimitives, InteractionZoneState, type InteractionZoneConfig } from "./InteractionZone";

function fixtureZone(): InteractionZoneConfig {
  return {
    id: "stock:produce",
    type: "stock:produce",
    x: 10,
    z: -4,
    halfExtents: [2, 1],
    enterRadius: 0.8,
    exitRadius: 1,
    actorMask: ["player"],
    priority: 80,
    dwellMs: 0,
    repeatEveryMs: 180,
    exitGraceMs: 0,
    channel: "transfer",
  };
}

describe("InteractionZoneState", () => {
  it.each([
    ["left", 7.21, -4],
    ["right", 12.79, -4],
    ["back", 10, -5.79],
    ["front", 10, -2.21],
  ])("enters the same fixture magnet from its %s side", (_side, x, z) => {
    const zone = new InteractionZoneState(fixtureZone());

    expect(zone.update("player", x, z, 0).map((event) => event.signal)).toEqual(["enter", "tick"]);
  });

  it("uses a rounded perimeter and preserves exit hysteresis around the footprint", () => {
    const zone = new InteractionZoneState(fixtureZone());

    expect(zone.update("player", 12.5, -4.5, 0).map((event) => event.signal)).toEqual(["enter", "tick"]);
    expect(zone.update("player", 12.9, -4.5, 20).some((event) => event.signal === "exit")).toBe(false);
    expect(zone.update("player", 13.01, -5.01, 40).map((event) => event.signal)).toEqual(["exit"]);
  });

  it("builds a physical compound sensor equal to the logical rounded rectangle", () => {
    const config = fixtureZone();
    const primitives = interactionZoneSensorPrimitives(config);
    const physicalContains = (x: number, z: number) => primitives.some((primitive) => {
      const localX = x - config.x;
      const localZ = z - config.z;
      if (primitive.kind === "box") {
        return Math.abs(localX) <= primitive.halfX && Math.abs(localZ) <= primitive.halfZ;
      }
      return Math.hypot(localX - primitive.offsetX, localZ - primitive.offsetZ) <= primitive.radius;
    });

    [
      [10, -4],
      [12.79, -4],
      [10, -2.21],
      [12.55, -2.45],
      [12.6, -2.4],
      [13, -5],
    ].forEach(([x, z]) => {
      expect(physicalContains(x, z), `${x},${z}`).toBe(interactionZonePlanarDistance(config, x, z) <= config.enterRadius);
    });
  });
});
