import { describe, expect, it } from "vitest";
import { buildPlayerPhysics, ensureRapierReady, type PlayerPhysicsHandle } from "./PlayerPhysics";
import { WAREHOUSE_RETURN_STATION } from "@/game/stations/warehouse-layout";
import { FARM_BARN } from "@/game/stations/farm-layout";
import { ALL_PURCHASED_AREAS } from "@/game/stations/fixture-availability";
import { STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE } from "@/game/world-scale";
import { CONTACT_MAGNET_REACH, interactionZonePlanarDistance } from "@/game/interaction/InteractionZone";

const PHYSICS_STEP = 1 / 60;
// A realistic walking pace in layout-scale units/sec — `DEFAULT_PLAYER_MOTION.walkSpeed`
// (`PlayerController.ts`) is 2.2 at the slowest multiplier; this is in the same range.
const WALK_SPEED = 3;
// 4 simulated seconds: generous for the ~2-3 layout-unit walks below, well
// short of a runaway loop if `resolveMovement` ever regresses to never converging.
const MAX_STEPS = 240;

/**
 * Drives `resolveMovement` in a straight line toward `target`, exactly like
 * `PlayerActor.fixedStep()` feeds a per-tick `dx`/`dz` from the player's
 * intention vector, until movement stalls (the capsule is blocked by real
 * geometry) or the step budget runs out. Returns where the capsule actually
 * ends up.
 */
function walkToward(physics: PlayerPhysicsHandle, start: { x: number; z: number }, target: { x: number; z: number }, maxSteps = MAX_STEPS) {
  let x = start.x;
  let z = start.z;
  for (let step = 0; step < maxSteps; step += 1) {
    const dx = target.x - x;
    const dz = target.z - z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-4) break;
    const travel = Math.min(distance, WALK_SPEED * PHYSICS_STEP);
    const movement = physics.resolveMovement((dx / distance) * travel, (dz / distance) * travel);
    x += movement.x;
    z += movement.z;
  }
  return { x, z };
}

/**
 * Regression guard for the navmesh-precision bug: `warehouseReturn` and
 * `farmBarn`'s magnets are calibrated to the player's own capsule radius
 * (0.24) plus a ~0.14 brushing buffer — `CONTACT_MAGNET_REACH.enter = 0.38`
 * in "scaled simulation" (layout x STORE_LAYOUT_SCALE) units
 * (`InteractionZone.ts`). A live-browser test on the pre-fix, navmesh-based
 * player movement found these unreachable. Replaying the *same* navmesh call
 * the old `PlayerActor.fixedStep()` used (`storeMoveAlongSurface`, still used
 * unchanged for customer/employee AI) from `WAREHOUSE_RETURN_STATION.workerPosition`
 * toward its target confirms the closest that navmesh-only approach could
 * ever get was ~1.93 layout-scale units away from the crate — about 5x the
 * enter radius, not a near-miss a looser assertion might paper over.
 *
 * `buildPlayerPhysics()` (added 2026-09-26) replaces that call with real
 * Rapier collision at `1/WORLD_SCALE` of production's physics scale. This
 * test is what would have caught the regression if that replacement broke.
 */
describe("PlayerPhysics reaches contact-precision magnets (navmesh regression guard)", () => {
  it("walks within CONTACT_MAGNET_REACH.enter of the warehouse return crate", async () => {
    await ensureRapierReady();
    const start = {
      x: WAREHOUSE_RETURN_STATION.workerPosition[0] * STORE_LAYOUT_SCALE,
      z: WAREHOUSE_RETURN_STATION.workerPosition[1] * STORE_LAYOUT_SCALE,
    };
    const target = {
      x: WAREHOUSE_RETURN_STATION.position[0] * STORE_LAYOUT_SCALE,
      z: WAREHOUSE_RETURN_STATION.position[2] * STORE_LAYOUT_SCALE,
    };
    const halfExtents = [
      WAREHOUSE_RETURN_STATION.footprint.halfX * STORE_ELEMENT_SCALE,
      WAREHOUSE_RETURN_STATION.footprint.halfZ * STORE_ELEMENT_SCALE,
    ] as const;

    const physics = buildPlayerPhysics(ALL_PURCHASED_AREAS, start.x, start.z);
    const end = walkToward(physics, start, target);
    physics.dispose();

    const finalDistance = interactionZonePlanarDistance({ x: target.x, z: target.z, halfExtents }, end.x, end.z);
    expect(finalDistance).toBeLessThanOrEqual(CONTACT_MAGNET_REACH.enter);
  });

  it("walks within CONTACT_MAGNET_REACH.enter of the farm barn", async () => {
    await ensureRapierReady();
    const start = { x: FARM_BARN.workerPosition[0] * STORE_LAYOUT_SCALE, z: FARM_BARN.workerPosition[1] * STORE_LAYOUT_SCALE };
    const target = { x: FARM_BARN.position[0] * STORE_LAYOUT_SCALE, z: FARM_BARN.position[2] * STORE_LAYOUT_SCALE };
    const halfExtents = [FARM_BARN.footprint.halfX * STORE_ELEMENT_SCALE, FARM_BARN.footprint.halfZ * STORE_ELEMENT_SCALE] as const;

    const physics = buildPlayerPhysics(ALL_PURCHASED_AREAS, start.x, start.z);
    const end = walkToward(physics, start, target);
    physics.dispose();

    const finalDistance = interactionZonePlanarDistance({ x: target.x, z: target.z, halfExtents }, end.x, end.z);
    expect(finalDistance).toBeLessThanOrEqual(CONTACT_MAGNET_REACH.enter);
  });
});

/**
 * Regression guard for a second bug found while verifying the fix above: the
 * first draft of `buildPlayerPhysics()`'s `addRawCuboid` helper forgot
 * `* STORE_LAYOUT_SCALE` on the ground slab, both outer side walls, and both
 * door frames/leaves (unlike the real fixture colliders from
 * `storeObstaclesForAreas()`, which already carried it correctly) — every one
 * of those sat at exactly HALF its intended distance from the origin,
 * trapping the player in a sliver of the store near spawn. Neither test above
 * would have caught this: both walk a short (~2-3 unit) hop that never
 * approaches a wall. This test walks far enough in a straight line to hit the
 * real east side wall and asserts the stop point sits meaningfully PAST where
 * the halved (buggy) wall would have stopped it, while still short of the
 * store's outer navigation bounds — a two-sided bound that fails both if the
 * scale bug reappears (stops too early) and if the wall collider vanished
 * entirely (never stops, in which case `MAX_STEPS` would exhaust with the
 * player still short of `target.x`, also failing the same assertion).
 */
describe("PlayerPhysics collider scale (wall regression guard)", () => {
  it("stops against the real east wall, not the halved-scale regression's phantom wall", async () => {
    await ensureRapierReady();
    // z=-0.7 (layout-scale) is the outer walls' own z-center
    // (`-0.35 * STORE_LAYOUT_SCALE` in `PlayerPhysics.ts`) — a corridor
    // confirmed obstacle-free out to the wall for x > 15 (no entry in
    // `storeObstaclesForAreas(ALL_PURCHASED_AREAS)` there), unlike a walk
    // straight from spawn, which runs into the real cart-bay/returns
    // fixtures long before any wall. Teleporting close in and walking the
    // last stretch avoids depending on a long obstacle-free path elsewhere
    // in the store layout.
    const start = { x: 20, z: -0.7 };
    const target = { x: 100, z: start.z }; // far past any real wall
    const physics = buildPlayerPhysics(ALL_PURCHASED_AREAS, start.x, start.z);
    physics.setPosition(start.x, start.z);
    const end = walkToward(physics, start, target, 120);
    physics.dispose();

    // The regression put the wall at half its real distance (side wall raw
    // x=11.35, meant to become 11.35 * STORE_LAYOUT_SCALE = ~22.7 but left
    // unscaled). Bounds comfortably either side of both the buggy (~11.35,
    // already behind `start.x`) and correct (~22.7) values, and short of
    // `STORE_NAVIGATION_BOUNDS.maxX * STORE_LAYOUT_SCALE` (~26).
    expect(end.x).toBeGreaterThan(21);
    expect(end.x).toBeLessThan(24);
  });
});
