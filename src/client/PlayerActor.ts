import * as THREE from "three";
import type { AvatarConfig, CarryState, CharacterId } from "@/game/types";
import { InstanceRegistry, PartsInstancer, mergeStaticParts } from "@/game/render/CrowdParts";
import { loadCrowdAnimation, type CrowdAnimationSet } from "@/game/render/CrowdSkinning";
import { advanceCrowdPose, createCrowdPose, crowdGaitTimeScale, crowdPoseRows, type CrowdPoseState } from "@/game/render/CrowdPose";
import type { CrowdClipName } from "@/game/render/CrowdAnimation";
import { BODY_SCALE, HAT_FIT_SCALE, HAT_FILES, LOCOMOTION_CLIPS, PRODUCT_CAPACITY, PROP_CAPACITY, createCrowdBody, firstSkinnedMesh, productPartDefinitions, pushProduct, scratch, socketMatrix, type CrowdBody, type PartsRegistry } from "@/game/render/CrowdSystems";
import { CLIP_NATURAL_SPEED, LocomotionController } from "@/game/animation/LocomotionController";
import { CHARACTER_PALM_OFFSETS, HARVEST_BASKET_GRIP_HEIGHT, HARVEST_BASKET_GRIP_REACH } from "@/game/animation/CarrySocket";
import { characterSceneScale } from "@/game/animation/CharacterScale";
import { cameraRelativeMovement, moveVelocity, playerMotionForTier, smoothYaw, type PlayerMotionConfig } from "@/game/player/PlayerController";
import { carriedProductIds, carryQuantity, carryTotal, MAX_WAREHOUSE_PICKUP_BATCH } from "@/game/player/CarrySystem";
import { inputManager, type InputVector } from "@/game/input/InputManager";
import { InteractionDirector } from "@/game/interaction/InteractionDirector";
import type { InteractionZoneConfig } from "@/game/interaction/InteractionZone";
import { WorkstationController } from "@/game/interaction/WorkstationController";
import { isWorkstationId, WORKSTATION_IDS, WORKSTATIONS, type WorkstationId } from "@/game/stations/workstation-layout";
import { isProductionWorkstationId } from "@/game/stations/production-layout";
import { storeClosestNavigationPoint } from "@/game/navigation/NavMeshService";
import { STORE_LAYOUT_SCALE } from "@/game/world-scale";
import { buildPlayerPhysics, ensureRapierReady, type PlayerPhysicsHandle } from "./PlayerPhysics";
import { GROUND_SHADOW_PARTS, HARVEST_BASKET_PARTS, accessoryParts, deliveredProductParts, harvestProductSlot } from "@/components/game/CrowdProps";
import { CameraRig } from "./CameraRig";
import { budgetPath, loadGltf } from "./WorldAssets";

/**
 * The owner in the plain-three client: a one-instance crowd body (baked
 * animation texture, GPU skinning) with hair, hat and harvest basket as
 * instanced parts, moved as a kinematic capsule along the navmesh surface.
 * Interaction zones and workstations are the same pure controllers the
 * React scene used; there is no physics engine.
 */
const OWNER_BODY_KEY: Record<CharacterId, string> = { "adult-man": "owner_man", "adult-woman": "owner_woman", boy: "owner_boy", girl: "owner_girl" };
// Hair authored on the previous cast, fitted like `Avatar` does (skull width and crown height).
const HAIR_FIT: Record<CharacterId, { scale: [number, number, number]; position: [number, number, number] }> = {
  "adult-man": { scale: [0.38, 0.43, 0.39], position: [0, 0, 0.028] },
  "adult-woman": { scale: [0.38, 0.43, 0.39], position: [0, 0, 0.028] },
  boy: { scale: [0.5, 0.53, 0.5], position: [0, 0, 0.028] },
  girl: { scale: [0.5, 0.53, 0.5], position: [0, 0, 0.028] },
};
const PHYSICS_STEP = 1 / 60;

export interface PlayerHooks {
  onInteract: (id: string) => void;
  onDistance: (meters: number) => void;
  onDoorPresence: (active: boolean) => void;
  onCheckoutFocus: (focused: boolean) => void;
}

export class PlayerActor {
  readonly group = new THREE.Group();
  /** Layout units (design × STORE_LAYOUT_SCALE), like every crowd actor. */
  readonly position = new THREE.Vector3();
  yaw = Math.PI;
  private angularVelocity = 0;
  private readonly velocity = new THREE.Vector2();
  private body: CrowdBody | null = null;
  private animation: CrowdAnimationSet | null = null;
  private pose: CrowdPoseState = createCrowdPose("Idle");
  private readonly locomotion = new LocomotionController();
  private readonly props: PartsRegistry = new InstanceRegistry();
  private readonly delivered: PartsRegistry = new InstanceRegistry();
  private hat: PartsInstancer | null = null;
  private hair: PartsInstancer | null = null;
  private motion: PlayerMotionConfig = playerMotionForTier(0, true);
  private director = new InteractionDirector([]);
  private physics: PlayerPhysicsHandle | null = null;
  private doorProgress = { storefront: 0, rear: 0 };
  private readonly workstation = new WorkstationController();
  private unreportedDistance = 0;
  private accumulator = 0;
  private checkoutFocused = false;
  private lastInput: InputVector = { x: 0, y: 0, magnitude: 0 };
  private rootScale = 1;
  private readonly hairFit = new THREE.Matrix4();
  private avatar: AvatarConfig | null = null;
  carry: CarryState | null = null;
  speedTier = 0;
  campaign = true;
  /** Presented speed in layout units per second (drives the walk clip). */
  private presentedSpeed = 0;
  readonly basketWorld = new THREE.Vector3();

  constructor(private readonly hooks: PlayerHooks) {
    this.group.name = "client:player";
  }

  async load(avatar: AvatarConfig, startX: number, startZ: number) {
    this.avatar = avatar;
    this.position.set(startX, 0, startZ);
    const key = OWNER_BODY_KEY[avatar.body];
    // `unlockedAreas` isn't known yet here — built empty and immediately
    // rebuilt by the first real `setZones()` call `ClientRuntime.load()`
    // makes right after this resolves, before anything is ever rendered.
    const [gltf, animation] = await Promise.all([loadGltf(budgetPath("characters", key)), loadCrowdAnimation(key), ensureRapierReady()]);
    this.physics = buildPlayerPhysics([], startX, startZ);
    const skinned = firstSkinnedMesh(gltf.scene);
    if (!skinned) throw new Error(`player body ${key} has no skinned mesh`);
    this.animation = animation;
    this.body = createCrowdBody(skinned, animation, `player:${key}`);
    this.body.mesh.frustumCulled = false;
    this.group.add(this.body.mesh);
    this.rootScale = characterSceneScale(avatar.body) * BODY_SCALE[avatar.body];
    // Props: shadow, basket and product units; hair and hat from their budget GLBs.
    const definitions = { shadow: { parts: GROUND_SHADOW_PARTS, capacity: 1 }, basket: { parts: mergeStaticParts(HARVEST_BASKET_PARTS), capacity: 1 }, ...productPartDefinitions() };
    for (const [name, definition] of Object.entries(definitions)) {
      const instancer = new PartsInstancer(definition.parts, Math.min(definition.capacity, PRODUCT_CAPACITY), `player-prop:${name}`);
      instancer.attach(this.group);
      this.props.set(name, instancer);
    }
    const accessories = await Promise.all([
      avatar.hat !== "none" ? loadGltf(budgetPath("hats", HAT_FILES[avatar.hat as keyof typeof HAT_FILES] ?? avatar.hat, avatar.body)).catch(() => null) : Promise.resolve(null),
      loadGltf(budgetPath("hair", avatar.hair, avatar.body)).catch(() => null),
    ]);
    if (accessories[0]) { this.hat = new PartsInstancer(accessoryParts(accessories[0].scene), 1, "player-hat"); this.hat.attach(this.group); }
    // Hair shows only without a hat, tinted with the avatar's colour.
    if (accessories[1] && avatar.hat === "none") {
      const parts = accessoryParts(accessories[1].scene).map((part) => {
        const material = (Array.isArray(part.material) ? part.material[0] : part.material).clone() as THREE.MeshStandardMaterial;
        if (material.color) material.color.set(avatar.hairColor);
        return { ...part, material };
      });
      this.hair = new PartsInstancer(parts, 1, "player-hair");
      this.hair.attach(this.group);
    }
    const fit = HAIR_FIT[avatar.body];
    this.hairFit.compose(new THREE.Vector3(...fit.position), new THREE.Quaternion(), new THREE.Vector3(...fit.scale));
    for (const id of ["milk", "cheese", "egg"] as const) {
      const delivered = await loadGltf(budgetPath("delivered", id)).catch(() => null);
      if (!delivered) continue;
      const instancer = new PartsInstancer(deliveredProductParts(delivered.scene), PROP_CAPACITY, `player-delivered:${id}`);
      instancer.attach(this.group);
      this.delivered.set(id === "egg" ? "eggs" : id, instancer);
    }
  }

  setZones(configs: readonly InteractionZoneConfig[], unlockedAreas: readonly string[]) {
    this.director = new InteractionDirector(configs);
    this.physics?.setUnlockedAreas(unlockedAreas);
  }

  /** Call once per rendered frame, before `step()`, with each door's current visual progress. */
  setDoorProgress(storefront: number, rear: number) {
    this.doorProgress.storefront = storefront;
    this.doorProgress.rear = rear;
  }

  setSpeedTier(tier: number, campaign: boolean) {
    this.speedTier = tier;
    this.campaign = campaign;
    this.motion = playerMotionForTier(tier, campaign);
  }

  /** Fixed-step locomotion and interactions; call once per frame with the frame delta. */
  step(delta: number, nowMs: number) {
    this.accumulator = Math.min(0.25, this.accumulator + delta);
    const gamepad = typeof navigator !== "undefined" ? navigator.getGamepads?.()[0] : null;
    if (gamepad) inputManager.setGamepad(gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0);
    while (this.accumulator >= PHYSICS_STEP) {
      this.accumulator -= PHYSICS_STEP;
      this.fixedStep(PHYSICS_STEP, nowMs);
    }
  }

  private fixedStep(step: number, nowMs: number) {
    const input = inputManager.sample();
    this.lastInput = input;
    const workLocked = this.workstation.updateInput(input.magnitude);
    const intention = workLocked ? { x: 0, y: 0 } : cameraRelativeMovement(input, CameraRig.GROUND_FORWARD);
    // Motion config is in layout units per second (the React scene multiplied
    // it by WORLD_SCALE because its physics ran in world units).
    const next = workLocked ? { x: 0, y: 0 } : moveVelocity({ x: this.velocity.x, y: this.velocity.y }, intention, step, this.motion);
    this.velocity.set(next.x, next.y);
    const dx = this.velocity.x * step;
    const dz = this.velocity.y * step;
    if (this.physics) {
      // Real Rapier collision (`PlayerPhysics.ts`), not the navmesh: a
      // pre-baked navmesh cannot reproduce production's sub-half-unit contact
      // reach for the tightest magnets (see that file's doc comment for the
      // full diagnosis). `resolveMovement` already operates in the same
      // "layout units × STORE_LAYOUT_SCALE" space `this.position` is in, so
      // its returned movement needs no conversion in either direction —
      // unlike the old navmesh call, which had to drop to raw design units
      // and convert back.
      this.physics.updateDoors(this.doorProgress.storefront, this.doorProgress.rear);
      const movement = this.physics.resolveMovement(dx, dz);
      this.position.x += movement.x;
      this.position.z += movement.z;
      const travelled = Math.hypot(movement.x, movement.z);
      // Matches production's own calibration (`unreportedDistance.current +=
      // hypot(movement) / WORLD_SCALE`, i.e. layout-scale units, not raw
      // design meters) — `playerDistanceMeters` is a real `advanceWorld()`
      // input, not just telemetry, so this has to agree with `/`, not with
      // the navmesh-era code's own (uncalibrated) raw-design-unit count.
      this.unreportedDistance += travelled;
      if (this.unreportedDistance >= 1) { const meters = this.unreportedDistance; this.unreportedDistance = 0; this.hooks.onDistance(meters); }
      this.presentedSpeed = travelled / step;
    } else {
      this.presentedSpeed = 0;
    }

    // `interactionZoneConfigs()` bakes STORE_LAYOUT_SCALE into every zone's
    // x/z (via `scaleStorePosition`/explicit `* STORE_LAYOUT_SCALE` magnet
    // math in `MarketScene.tsx`) — the same "layout units × STORE_LAYOUT_SCALE"
    // space `this.position` is already in (see the field doc above). The
    // production scene's own director call confirms this: it only divides by
    // WORLD_SCALE (`logicalPosition.x / WORLD_SCALE`), never by
    // STORE_LAYOUT_SCALE. Dividing by STORE_LAYOUT_SCALE here a second time —
    // as this line previously did, mirroring the navmesh conversion just
    // above (which correctly needs raw design units for a different reason)
    // — fed the director design-unit coordinates against layout-scale zone
    // positions, silently placing every non-origin sensor's real trigger
    // point outside the reachable store (confirmed empirically: farm crops
    // and purchase markers require a navmesh point outside the walkable
    // area; only fixtures near the origin happened to still register).
    const events = this.director.update("player", this.position.x, this.position.z, nowMs);
    const selected = this.director.selectedZoneIds();
    const activeWorkstation = WORKSTATION_IDS.find((id) => id !== "shelf" && !isProductionWorkstationId(id) && selected.includes(id)) ?? null;
    this.workstation.sync(activeWorkstation, input.magnitude);
    for (const event of events) {
      if (event.zone.id === "door" && (event.signal === "enter" || event.signal === "exit")) this.hooks.onDoorPresence(event.signal === "enter");
      // The orders counter opens its panel only for someone who stops at it.
      if (event.zone.id === "orders" && input.magnitude > 0.05) continue;
      const locksMovement = isWorkstationId(event.zone.id) && event.zone.id !== "shelf" && !isProductionWorkstationId(event.zone.id);
      if (event.signal === "tick" && (!locksMovement || this.workstation.canPerform(event.zone.id))) this.hooks.onInteract(event.zone.id);
    }
    const focused = this.workstation.performingZoneId() === "checkout";
    if (focused !== this.checkoutFocused) { this.checkoutFocused = focused; this.hooks.onCheckoutFocus(focused); }
  }

  get isMoving() { return this.velocity.length() > 0.12; }
  get input() { return this.lastInput; }
  get performingWorkstation() { return this.workstation.performingZoneId() as WorkstationId | null; }

  /** Presentation: heading, clip, pose, sockets and props for this frame. */
  present(delta: number) {
    const body = this.body;
    const animation = this.animation;
    if (!body || !animation || !this.avatar) return;
    const speed = this.velocity.length();
    const workstation = this.performingWorkstation;
    const workHeading = workstation ? WORKSTATIONS[workstation].facing : null;
    if (workstation && workHeading !== null) {
      const turn = smoothYaw(this.yaw, workHeading, this.angularVelocity, delta, this.motion);
      this.yaw = turn.yaw; this.angularVelocity = turn.angularVelocity;
    } else if (speed > 0.08) {
      const turn = smoothYaw(this.yaw, Math.atan2(this.velocity.x, this.velocity.y), this.angularVelocity, delta, this.motion);
      this.yaw = turn.yaw; this.angularVelocity = turn.angularVelocity;
    }
    const carrying = Boolean(this.carry && carryTotal(this.carry) > 0);
    const rootScale = this.rootScale;
    const walkFloor = CLIP_NATURAL_SPEED[carrying ? "CarryWalk" : "Walk"] * rootScale;
    const clip = (workstation ? WORKSTATION_CLIP[workstation] ?? "Idle" : this.locomotion.select(this.presentedSpeed, 0, carrying, walkFloor)) as CrowdClipName;
    const timeScale = LOCOMOTION_CLIPS.has(clip) ? crowdGaitTimeScale(clip, this.presentedSpeed, CLIP_NATURAL_SPEED[clip], rootScale) : 1;
    this.pose = advanceCrowdPose(this.pose, clip, delta, timeScale, animation.manifest);
    const rows = crowdPoseRows(this.pose, animation.manifest);

    scratch.yaw.setFromAxisAngle(scratch.yAxis, this.yaw);
    scratch.world.compose(this.position, scratch.yaw, scratch.one);
    scratch.body.multiplyMatrices(scratch.world, scratch.local.makeScale(rootScale, rootScale, rootScale));
    body.mesh.setMatrixAt(0, scratch.body);
    body.pose.setXYZ(0, rows.rowA, rows.rowB, rows.blend);
    body.mesh.count = 1;
    body.mesh.instanceMatrix.needsUpdate = true;
    body.pose.needsUpdate = true;

    for (const instancer of this.props.values()) instancer.begin();
    for (const instancer of this.delivered.values()) instancer.begin();
    this.hat?.begin();
    this.hair?.begin();
    this.props.get("shadow")?.push(scratch.body);

    socketMatrix(animation, "Head", rows.rowA, scratch.prop);
    scratch.slot.multiplyMatrices(scratch.body, scratch.prop);
    const fit = HAT_FIT_SCALE[this.avatar.body];
    if (this.hair) this.hair.push(scratch.local.multiplyMatrices(scratch.slot, this.hairFit));
    if (this.hat) this.hat.push(scratch.local.copy(scratch.slot).multiply(scratch.bone.makeScale(fit, fit, fit)));

    const baskets = this.props.get("basket");
    if (carrying && baskets && this.carry) {
      const palms = CHARACTER_PALM_OFFSETS[this.avatar.body];
      socketMatrix(animation, "Hand_L", rows.rowA, scratch.prop);
      scratch.leftHand.fromArray(palms.left as unknown as number[]).applyMatrix4(scratch.prop);
      socketMatrix(animation, "Hand_R", rows.rowA, scratch.prop);
      scratch.rightHand.fromArray(palms.right as unknown as number[]).applyMatrix4(scratch.prop);
      scratch.point.addVectors(scratch.leftHand, scratch.rightHand).multiplyScalar(0.5);
      scratch.point.set(0, scratch.point.y - HARVEST_BASKET_GRIP_HEIGHT, scratch.point.z + HARVEST_BASKET_GRIP_REACH);
      scratch.slot.multiplyMatrices(scratch.body, scratch.local.compose(scratch.point, scratch.quaternion.identity(), scratch.one));
      baskets.push(scratch.slot);
      this.basketWorld.setFromMatrixPosition(scratch.slot);
      const carry = this.carry;
      const visible = carriedProductIds(carry).flatMap((productId) => Array.from({ length: carryQuantity(carry, productId) }, () => productId)).slice(0, MAX_WAREHOUSE_PICKUP_BATCH);
      visible.forEach((productId, unit) => {
        pushProduct(this.props, this.delivered, productId, scratch.bone.multiplyMatrices(scratch.slot, harvestProductSlot(unit, scratch.local)));
      });
    } else {
      this.basketWorld.set(this.position.x, this.position.y + 1.05, this.position.z);
    }
    for (const instancer of this.props.values()) instancer.end();
    for (const instancer of this.delivered.values()) instancer.end();
    this.hat?.end();
    this.hair?.end();
  }

  dispose() {
    this.body?.dispose();
    for (const instancer of this.props.values()) { instancer.detach(); instancer.dispose(); }
    for (const instancer of this.delivered.values()) { instancer.detach(); instancer.dispose(); }
    this.hat?.dispose();
    this.hair?.dispose();
    this.physics?.dispose();
    this.group.removeFromParent();
  }

  /** Puts the owner back on the walkable surface (after a load). Only a
   * one-time initial-placement safety net — the navmesh here is a coarse
   * "is this roughly clear" check, not the movement/collision system (that's
   * `PlayerPhysics.ts` now); keeping the physics capsule's own position in
   * sync avoids a stale first `resolveMovement()` call. */
  snapToNavmesh() {
    const closest = storeClosestNavigationPoint([this.position.x / STORE_LAYOUT_SCALE, this.position.z / STORE_LAYOUT_SCALE]);
    if (closest) {
      this.position.set(closest[0] * STORE_LAYOUT_SCALE, 0, closest[1] * STORE_LAYOUT_SCALE);
      this.physics?.setPosition(this.position.x, this.position.z);
    }
  }
}

const WORKSTATION_CLIP: Partial<Record<string, CrowdClipName>> = { mill: "LiftBox", bakery: "StockHigh", chicken: "PickupLow", cow: "PickupLow", cheese: "LiftBox", juice: "LiftBox", checkout: "ScanItem", warehouseReturn: "StockLow", door: "Enter" };

