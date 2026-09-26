import RAPIER from "@dimforge/rapier3d-compat";
import { STOREFRONT_LAYOUT, STORE_REAR_DOOR, storefrontDoorLeafCenter, rearDoorLeafCenter, rearDoorWallSegments } from "@/game/stations/storefront-layout";
import { storeObstaclesForAreas, STORE_LAYOUT_SCALE, WORLD_SCALE } from "@/game/world-scale";

/**
 * Real Rapier collision for the plain-three player, ported from `/`'s own
 * `StoreColliders`/character-controller setup (`MarketScene.tsx`). Added
 * 2026-09-26 after `PlayerActor.ts`'s navmesh-based movement was found unable
 * to reproduce production's reachability for several small (0.38-unit)
 * contact-style magnets (warehouse return, farm barn, some purchase/stock
 * fixtures): a pre-baked Recast navmesh — with its own hand-tuned obstacle
 * padding, a *separate* `walkableRadius` erosion pass, and discrete grid
 * quantization — cannot reproduce the sub-half-unit precision Rapier's
 * continuous capsule-vs-cuboid collision achieves. That is a structural
 * property of navmesh-based movement, not a fixable unit bug, so the owner
 * decided to use the real collision system here too — the same authored
 * geometry (walls, obstacle footprints, both door frames/leaves) and the
 * same character-controller tuning, just replayed without React/R3F.
 *
 * Every one of `/`'s collider numbers below carries an explicit
 * `* STORE_LAYOUT_SCALE * WORLD_SCALE` factor on X/Z in `StoreColliders`
 * (`* WORLD_SCALE` only on Y — production's ground plane is not stretched by
 * STORE_LAYOUT_SCALE, only by it and the render-only WORLD_SCALE together on
 * the horizontal plane), because production's physics world lives in the same
 * fully-scaled space as the rendered scene. `PlayerActor.position` (and
 * everything downstream of it: presentation, the camera rig, doors, magnet
 * bursts) is instead expressed in "layout units × STORE_LAYOUT_SCALE" —
 * `layoutRoot` supplies WORLD_SCALE separately as a Three.js scene-graph
 * scale. This module's whole physics world is therefore built at
 * `1 / WORLD_SCALE` of production's scale: every raw literal copied from
 * `StoreColliders` below keeps its `* STORE_LAYOUT_SCALE` (applied by the
 * `addRawCuboid`/door-leaf helpers below, on X/Z only — never on Y) and simply
 * drops `* WORLD_SCALE`, so `PlayerActor.position` keeps its existing
 * contract untouched. `storeObstaclesForAreas()`'s own output is already in
 * this same "layout-scale" space (`STORE_OBSTACLES`'s own `.map()` already
 * bakes in `* STORE_LAYOUT_SCALE`/`* STORE_ELEMENT_SCALE` — see
 * `src/game/world-scale.ts`) — it must NOT be scaled again, which is why it
 * goes through the separate `addScaledCuboid` helper instead. (A first draft
 * of this file scaled neither raw literal set correctly — it left the ground
 * slab, both outer walls, and both door frames/leaves at their bare raw-design
 * magnitudes, which put every one of them roughly `STORE_LAYOUT_SCALE`× too
 * close to the origin. That silently walled the player into a tiny sliver of
 * the real store — confirmed by a live-gameplay verification pass that found
 * the player plateaus against a phantom wall long before reaching any real
 * fixture. Fixed by scaling X/Z on every raw literal, not just the ones that
 * happened to already flow through an already-scaled helper.)
 *
 * Uniform scaling does not change collision *behaviour* — but every length
 * parameter, not just collider geometry, has to shrink by the same factor:
 * the character-controller `offset`, `enableAutostep`'s two distances, and
 * `enableSnapToGround`'s distance are physical margins tied to the capsule's
 * own (unscaled-by-STORE_LAYOUT_SCALE) intrinsic dimensions, so they are
 * divided by WORLD_SCALE only below, exactly like the capsule's own
 * radius/height are never multiplied by STORE_LAYOUT_SCALE either. Angles
 * (`setMaxSlopeClimbAngle`/`setMinSlopeSlideAngle`) and friction coefficients
 * are scale-invariant and copied verbatim.
 *
 * The navmesh/worker system (`NavMeshService.ts`) is completely untouched —
 * customer/employee AI still paths on it exactly as before. This module only
 * replaces how the PLAYER resolves movement against solid geometry.
 */

let initPromise: Promise<void> | null = null;
/** Call once (from `PlayerActor.load()`) before constructing a `PlayerPhysics`. */
export function ensureRapierReady(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

const CHARACTER_OFFSET = 0.03 / WORLD_SCALE;
const AUTOSTEP_MAX_HEIGHT = 0.25 / WORLD_SCALE;
const AUTOSTEP_MIN_WIDTH = 0.18 / WORLD_SCALE;
const SNAP_TO_GROUND_DISTANCE = 0.18 / WORLD_SCALE;
/** `lastRequestedMovement`'s constant downward bias in `MarketScene.tsx` — gives
 * `enableSnapToGround` something to press against every step, not real gravity. */
const DOWNWARD_BIAS = -0.025 / WORLD_SCALE;

export interface PlayerPhysicsHandle {
  /** Resolves `desired` (layout-scale units, one physics step's worth of
   * requested XZ movement) against the real store geometry and returns the
   * movement the capsule can actually make this step. */
  resolveMovement(desiredX: number, desiredZ: number): { x: number; y: number; z: number };
  /** Teleports the character capsule (e.g. after `snapToNavmesh()`/initial spawn). */
  setPosition(x: number, z: number): void;
  /** Moves the four door-leaf colliders to match the doors' current visual progress. */
  updateDoors(storefrontProgress: number, rearProgress: number): void;
  /** Rebuilds the fixed obstacle set for a real `unlockedAreas` change (rare). */
  setUnlockedAreas(unlockedAreas: readonly string[]): void;
  dispose(): void;
}

export function buildPlayerPhysics(unlockedAreas: readonly string[], startX: number, startZ: number): PlayerPhysicsHandle {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  let fixedBody: RAPIER.RigidBody | null = null;
  let storefrontLeafColliders: [RAPIER.Collider, RAPIER.Collider] | null = null;
  let rearLeafColliders: [RAPIER.Collider, RAPIER.Collider] | null = null;

  function buildFixedColliders(areas: readonly string[]) {
    if (fixedBody) world.removeRigidBody(fixedBody);
    fixedBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    // Raw literals copied straight from `StoreColliders`' JSX (design units on
    // X/Z, exactly like every other layout constant in this codebase) — these
    // need the `* STORE_LAYOUT_SCALE` this world's X/Z axes are built at. Y is
    // never touched: production only ever multiplies Y by WORLD_SCALE, which
    // this whole module already omits.
    const addRawCuboid = (hx: number, hy: number, hz: number, x: number, y: number, z: number, friction = 0.5) => {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx * STORE_LAYOUT_SCALE, hy, hz * STORE_LAYOUT_SCALE).setTranslation(x * STORE_LAYOUT_SCALE, y, z * STORE_LAYOUT_SCALE).setFriction(friction),
        fixedBody!,
      );
    };
    // `storeObstaclesForAreas()` output is already layout-scale (its own
    // `.map()` in `world-scale.ts` bakes in `* STORE_LAYOUT_SCALE`/
    // `* STORE_ELEMENT_SCALE`) — used as-is, never through `addRawCuboid`.
    const addScaledCuboid = (hx: number, hy: number, hz: number, x: number, y: number, z: number, friction = 0.5) => {
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction), fixedBody!);
    };

    // Ground slab.
    addRawCuboid(13.35, 0.08, 17.15, 0, -0.08, -1.25, 0.8);

    // Purchase-gated obstacle footprints.
    for (const obstacle of storeObstaclesForAreas(areas)) addScaledCuboid(obstacle.halfX, 0.9, obstacle.halfZ, obstacle.x, 0.9, obstacle.z);

    // Outer side walls.
    const wallHalfHeight = STOREFRONT_LAYOUT.wallHeight / 2;
    addRawCuboid(0.17, wallHalfHeight, 8.25, -11.35, wallHalfHeight, -0.35);
    addRawCuboid(0.17, wallHalfHeight, 8.25, 11.35, wallHalfHeight, -0.35);

    // Rear wall segments either side of the farm door opening.
    for (const segment of rearDoorWallSegments()) {
      addRawCuboid(segment.width * 0.5, wallHalfHeight, STORE_REAR_DOOR.wallDepth * 0.5, segment.centerX, wallHalfHeight, STORE_REAR_DOOR.wallCenterZ);
    }
    const rearDoor = STORE_REAR_DOOR.door;
    const rearFrameHalfHeight = (rearDoor.leafHeight + 0.18) / 2;
    for (const side of [-1, 1] as const) {
      addRawCuboid(rearDoor.postWidth * 0.5, rearFrameHalfHeight, rearDoor.frameDepth * 0.5, STORE_REAR_DOOR.x + side * rearDoor.outerPostOffset, rearFrameHalfHeight, STORE_REAR_DOOR.z);
    }
    addRawCuboid(rearDoor.outerPostOffset + rearDoor.postWidth * 0.5, 0.09, rearDoor.frameDepth * 0.55, STORE_REAR_DOOR.x, rearDoor.leafHeight + 0.09, STORE_REAR_DOOR.z);

    // Storefront wall panels either side of the door opening.
    addRawCuboid(4.765, wallHalfHeight, 0.12, -6.585, wallHalfHeight, STOREFRONT_LAYOUT.z - 0.02);
    addRawCuboid(4.765, wallHalfHeight, 0.12, 6.585, wallHalfHeight, STOREFRONT_LAYOUT.z - 0.02);
    const door = STOREFRONT_LAYOUT.door;
    const frameHalfHeight = (door.leafHeight + 0.16) / 2;
    for (const side of [-1, 1] as const) {
      addRawCuboid(door.postWidth * 0.5, frameHalfHeight, door.frameDepth * 0.5, side * door.outerPostX, frameHalfHeight, STOREFRONT_LAYOUT.z);
    }
    addRawCuboid(door.outerPostX + door.postWidth * 0.5, 0.07, door.frameDepth * 0.55, 0, door.leafHeight + 0.07, STOREFRONT_LAYOUT.z);

    // Moving door leaves: created here (still children of the one fixed body,
    // matching the source), tracked separately so `updateDoors()` can slide
    // them without touching anything else. `storefrontDoorLeafCenter`/
    // `rearDoorLeafCenter` and the `*_LAYOUT.z`/`STORE_REAR_DOOR.z` constants
    // are raw design units too, so they get the same `* STORE_LAYOUT_SCALE`.
    const doorHalfHeight = door.leafHeight / 2;
    storefrontLeafColliders = [-1, 1].map((side) =>
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(door.leafWidth * 0.5 * STORE_LAYOUT_SCALE, doorHalfHeight, door.leafDepth * 0.5 * STORE_LAYOUT_SCALE).setTranslation(storefrontDoorLeafCenter(side as -1 | 1, 0) * STORE_LAYOUT_SCALE, doorHalfHeight, STOREFRONT_LAYOUT.z * STORE_LAYOUT_SCALE),
        fixedBody!,
      ),
    ) as [RAPIER.Collider, RAPIER.Collider];
    const rearDoorHalfHeight = rearDoor.leafHeight / 2;
    rearLeafColliders = [-1, 1].map((side) =>
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(rearDoor.leafWidth * 0.5 * STORE_LAYOUT_SCALE, rearDoorHalfHeight, rearDoor.leafDepth * 0.5 * STORE_LAYOUT_SCALE).setTranslation(rearDoorLeafCenter(side as -1 | 1, 0) * STORE_LAYOUT_SCALE, rearDoorHalfHeight, STORE_REAR_DOOR.z * STORE_LAYOUT_SCALE),
        fixedBody!,
      ),
    ) as [RAPIER.Collider, RAPIER.Collider];
  }

  buildFixedColliders(unlockedAreas);

  const characterBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(startX, 0, startZ));
  const characterCollider = world.createCollider(RAPIER.ColliderDesc.capsule(0.45, 0.24).setTranslation(0, 0.69, 0).setFriction(0), characterBody);
  const controller = world.createCharacterController(CHARACTER_OFFSET);
  controller.enableAutostep(AUTOSTEP_MAX_HEIGHT, AUTOSTEP_MIN_WIDTH, true);
  controller.enableSnapToGround(SNAP_TO_GROUND_DISTANCE);
  controller.setMaxSlopeClimbAngle(Math.PI / 4);
  controller.setMinSlopeSlideAngle(Math.PI / 3);

  const desired = { x: 0, y: DOWNWARD_BIAS, z: 0 };

  function resolveMovement(desiredX: number, desiredZ: number) {
    desired.x = desiredX;
    desired.z = desiredZ;
    controller.computeColliderMovement(characterCollider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const movement = controller.computedMovement();
    const next = characterBody.translation();
    const nextX = next.x + movement.x;
    const nextY = Math.max(0, next.y + movement.y);
    const nextZ = next.z + movement.z;
    characterBody.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ });
    world.step();
    return { x: movement.x, y: movement.y, z: movement.z };
  }

  function setPosition(x: number, z: number) {
    const current = characterBody.translation();
    characterBody.setTranslation({ x, y: current.y, z }, true);
  }

  function updateDoors(storefrontProgress: number, rearProgress: number) {
    if (storefrontLeafColliders) {
      const door = STOREFRONT_LAYOUT.door;
      const doorHalfHeight = door.leafHeight / 2;
      const z = STOREFRONT_LAYOUT.z * STORE_LAYOUT_SCALE;
      storefrontLeafColliders[0].setTranslationWrtParent({ x: storefrontDoorLeafCenter(-1, storefrontProgress) * STORE_LAYOUT_SCALE, y: doorHalfHeight, z });
      storefrontLeafColliders[1].setTranslationWrtParent({ x: storefrontDoorLeafCenter(1, storefrontProgress) * STORE_LAYOUT_SCALE, y: doorHalfHeight, z });
    }
    if (rearLeafColliders) {
      const rearDoor = STORE_REAR_DOOR.door;
      const rearDoorHalfHeight = rearDoor.leafHeight / 2;
      const z = STORE_REAR_DOOR.z * STORE_LAYOUT_SCALE;
      rearLeafColliders[0].setTranslationWrtParent({ x: rearDoorLeafCenter(-1, rearProgress) * STORE_LAYOUT_SCALE, y: rearDoorHalfHeight, z });
      rearLeafColliders[1].setTranslationWrtParent({ x: rearDoorLeafCenter(1, rearProgress) * STORE_LAYOUT_SCALE, y: rearDoorHalfHeight, z });
    }
  }

  return {
    resolveMovement,
    setPosition,
    updateDoors,
    setUnlockedAreas: buildFixedColliders,
    dispose() { world.free(); },
  };
}
