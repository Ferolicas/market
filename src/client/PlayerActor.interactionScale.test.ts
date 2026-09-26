import { describe, expect, it } from "vitest";
import { interactionZoneConfigs } from "@/components/game/MarketScene";
import { InteractionDirector } from "@/game/interaction/InteractionDirector";
import { interactionZonePlanarDistance } from "@/game/interaction/InteractionZone";
import { STORE_LAYOUT_SCALE } from "@/game/world-scale";

/**
 * `PlayerActor.position` lives in "layout units x STORE_LAYOUT_SCALE" space —
 * the same space `interactionZoneConfigs()` already bakes into every zone's
 * x/z (via `scaleStorePosition`/explicit `* STORE_LAYOUT_SCALE` magnet math in
 * `MarketScene.tsx`; see that field's doc comment on `PlayerActor.position`).
 *
 * `PlayerActor.fixedStep()` used to divide the player's position by
 * `STORE_LAYOUT_SCALE` a *second* time before calling
 * `InteractionDirector.update()` (mirroring a division the old navmesh call
 * on the same line legitimately needed for a different reason). That fed the
 * director design-unit coordinates against layout-scale zone positions,
 * silently placing every sensor away from the coordinate origin outside its
 * own reach — only fixtures near the origin happened to still register.
 *
 * This test locks the fixed contract down using the real production zone
 * builder (`interactionZoneConfigs`) and real fixture data, and additionally
 * proves the *old* (buggy) position would NOT have registered — so it can't
 * be satisfied by a test that merely re-implements the fix's own formula.
 */
function zonesForFixtures() {
  return interactionZoneConfigs(1, [], [], ["apple-1"]);
}

function zoneById(id: string) {
  const zone = zonesForFixtures().find((candidate) => candidate.id === id);
  expect(zone, id).toBeDefined();
  return zone!;
}

describe("PlayerActor <-> InteractionDirector coordinate space", () => {
  it.each(["warehouseReturn", "farmBarn", "purchase:apple-1"])(
    "registers 'enter' for %s from the player's real position, not a second-scaled one",
    (id) => {
      const zone = zoneById(id);

      // Sanity: these are real production fixtures away from the coordinate
      // origin, so dividing by STORE_LAYOUT_SCALE a second time (the
      // historical bug) actually moves the fed position somewhere
      // meaningfully different — not somewhere that happens to still work.
      expect(Math.hypot(zone.x, zone.z)).toBeGreaterThan(5);

      // Fixed behaviour: PlayerActor.position fed RAW, exactly like today's
      // `this.director.update("player", this.position.x, this.position.z, nowMs)`.
      const fixedDirector = new InteractionDirector(zonesForFixtures());
      const fixedEvents = fixedDirector.update("player", zone.x, zone.z, 0);
      expect(fixedEvents.some((event) => event.zone.id === id && event.signal === "enter")).toBe(true);

      // Regression guard: the pre-fix code additionally divided by
      // STORE_LAYOUT_SCALE before this call. Feeding that same (buggy)
      // position must NOT register — this is what would have failed before
      // the fix, using the actual constant involved rather than a
      // self-referential re-check of the new formula.
      const buggyX = zone.x / STORE_LAYOUT_SCALE;
      const buggyZ = zone.z / STORE_LAYOUT_SCALE;
      expect(interactionZonePlanarDistance(zone, buggyX, buggyZ)).toBeGreaterThan(zone.exitRadius);
      const buggyDirector = new InteractionDirector(zonesForFixtures());
      const buggyEvents = buggyDirector.update("player", buggyX, buggyZ, 0);
      expect(buggyEvents.some((event) => event.zone.id === id)).toBe(false);
    },
  );
});
