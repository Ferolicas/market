import { describe, expect, it } from "vitest";
import { advanceWorld, applyGameAction, createInitialGame } from "../engine";
import { InteractionZoneState } from "../interaction/InteractionZone";
import { playerMotionForTier } from "../player/PlayerController";
import { STORE_ELEMENT_SCALE } from "../world-scale";
import { FARM_HARVEST_SENSOR, scaledFarmHarvestSensor } from "./farm-layout";

describe("walk-through farm harvest", () => {
  it.each(Array.from({ length: 10 }, (_, index) => index + 1))("collects the full available batch in one level-%i speed pass", (speedTier) => {
    let state = createInitialGame();
    for (let second = 0; second < 4; second += 1) state = advanceWorld(state, 1_000).state;
    expect(state.franchises[0].crops[0]).toMatchObject({ status: "READY", available: 3 });

    const radii = scaledFarmHarvestSensor(STORE_ELEMENT_SCALE);
    const zone = new InteractionZoneState({
      id: "farm:crop-tomato-1",
      type: "farm-plot",
      x: 0,
      z: 0,
      enterRadius: radii.enterRadius,
      exitRadius: radii.exitRadius,
      actorMask: ["player"],
      priority: 92,
      dwellMs: FARM_HARVEST_SENSOR.dwellMs,
      repeatEveryMs: FARM_HARVEST_SENSOR.repeatEveryMs,
      exitGraceMs: FARM_HARVEST_SENSOR.exitGraceMs,
      channel: "transfer",
    });
    const frameMs = 1_000 / 60;
    const speed = playerMotionForTier(speedTier).walkSpeed;
    let x = -radii.enterRadius - 0.08;
    let nowMs = 0;
    let sensorTicks = 0;
    let harvestActions = 0;

    while (x <= radii.exitRadius + 0.12) {
      for (const event of zone.update("player", x, 0, nowMs)) {
        if (event.signal !== "tick") continue;
        sensorTicks += 1;
        const crop = state.franchises[0].crops[0];
        if (crop.status !== "READY") continue;
        const quantity = Math.min(crop.available, state.franchises[0].carry.capacity);
        const result = applyGameAction(state, { type: "HARVEST", cropId: crop.id, productId: crop.productId, quantity });
        expect(result.ok, result.message).toBe(true);
        state = result.state;
        harvestActions += 1;
      }
      x += speed * frameMs / 1_000;
      nowMs += frameMs;
    }

    expect(sensorTicks).toBeGreaterThanOrEqual(1);
    expect(harvestActions).toBe(1);
    expect(state.franchises[0].carry.items.tomatoes).toBe(3);
    expect(state.franchises[0].crops[0]).toMatchObject({ status: "GROWING", available: 0 });
    expect(state.franchises[0].crops[0].readyAt).toBeGreaterThan(state.simulationTimeMs);
  });
});
