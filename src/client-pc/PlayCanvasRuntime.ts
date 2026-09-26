import * as pc from "playcanvas";
import { OVERVIEW_CAMERA_OFFSET } from "@/game/render/overview-camera";
import { WORLD_SCALE, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE, scaleStorePosition } from "@/game/world-scale";
import {
  STOREFRONT_LAYOUT,
  STORE_REAR_DOOR,
  rearDoorWallSegments,
  rearDoorWallPanels,
  storefrontDoorProgress,
  storefrontDoorLeafCenter,
  rearDoorLeafCenter,
  rearDoorActorPresent,
  advanceRearDoorMotion,
  CLOSED_REAR_DOOR_MOTION,
  type RearDoorMotionState,
} from "@/game/stations/storefront-layout";
import { frameDelta } from "@/game/locomotion";
import { inputManager } from "@/game/input/InputManager";
import { cameraRelativeMovement, moveVelocity, playerMotionForTier, smoothYaw, type PlayerMotionConfig } from "@/game/player/PlayerController";
import { buildPlayerPhysics, ensureRapierReady, type PlayerPhysicsHandle } from "@/client/PlayerPhysics";
import { fixtureAvailable } from "@/game/stations/fixture-availability";
import { RETAIL_DEPARTMENTS, RETAIL_DEPARTMENT_IDS, retailFixtureDisplayPositions, type RetailDepartmentId } from "@/game/stations/retail-layout";

/**
 * Phase 2 of the PlayCanvas port: a controllable player capsule with real
 * Rapier collision (reusing `/runtime`'s already-verified `PlayerPhysics.ts`,
 * which has no Three.js dependency and operates in the same "layout units ×
 * STORE_LAYOUT_SCALE" space this file already uses for every other
 * position), the overview camera's real follow/zoom formula
 * (`src/client/CameraRig.ts`), both real doors (storefront + rear farm door,
 * driven by real game state / player-proximity, ported the same way
 * `/runtime`'s `storefrontDoor.ts`/`rearFarmDoor.ts` do), real "MINI MARKET"/
 * "GRANJA" signage via `pc.CanvasFont`, and simplified (box-volume, but
 * real-position/real-size/real-color) retail department fixtures gated by
 * `fixtureAvailable()`. See the phase 2 report for what remains (checkout,
 * production, farm, crowd, real character mesh, HUD input wiring).
 *
 * Every dimension/color below is copied from the real source of truth, never
 * approximated — see each section's comment for its exact origin.
 */

// Mirrors src/game/animation/CharacterScale.ts (CHILD_CHARACTER_SCENE_SCALE).
// Only used to reproduce the overview camera's initial look-at height.
const CHILD_CHARACTER_SCENE_SCALE = 1.65;

// Mirrors the constants next to OverviewCamera in MarketScene.tsx / CameraRig.ts.
const CAMERA_DISTANCE_FACTOR = 1.15;
const CAMERA_PROXIMITY_FACTOR = 1.3;
const CAMERA_FRAME_WIDTH = 32;
const CAMERA_FRAME_HEIGHT = 28.5;
const TARGET_HEIGHT = 0.9 * CHILD_CHARACTER_SCENE_SCALE;

// Mirrors MarketScene.tsx's PLAYER_START = scaleStorePosition([0, 0, 6.25]).
// Already in "layout units × STORE_LAYOUT_SCALE" space (matches PlayerPhysics's space).
const PLAYER_START = scaleStorePosition([0, 0, 6.25]);

// Mirrors the DAY preset in src/game/time/BusinessDay.ts. Phase 1 renders a
// fixed daytime look; the day/night cycle is a later phase.
const DAYLIGHT_DAY = { background: "#b8dfce", ambientIntensity: 1.15, keyIntensity: 2.3, keyColor: "#fff6df" };

// src/client/PlayerActor.ts's PHYSICS_STEP.
const PHYSICS_STEP_SECONDS = 1 / 60;
// src/client/WorldKit/storefrontDoor.ts's STOREFRONT_DOOR_TRAVEL_MS.
const STOREFRONT_DOOR_TRAVEL_MS = 450;

function hexToColor(hex: string): pc.Color {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return new pc.Color(r, g, b);
}

interface BoxSpec {
  size: [number, number, number];
  pos: [number, number, number];
  color: string;
  opacity?: number;
  name?: string;
}

export type DoorState = "CLOSED" | "OPENING" | "OPEN" | "CLOSING" | "BLOCKED";

/** The subset of `FranchiseState`/`GameState` this phase actually reads.
 * Fed in from React (`PlayCanvasIntegralClient`), which subscribes to
 * `useMarketStore` and calls `update()` on change — the same "props" seam
 * `/runtime`'s `ClientRuntime.update()` uses. */
export interface PlayCanvasSceneProps {
  unlockedAreas: string[];
  doorState: DoorState;
  doorProgress: number;
  open: boolean;
  playerSpeedTier: number;
}

const DEFAULT_PROPS: PlayCanvasSceneProps = { unlockedAreas: [], doorState: "CLOSED", doorProgress: 0, open: false, playerSpeedTier: 0 };

export class PlayCanvasRuntime {
  readonly app: pc.Application;
  private readonly canvas: HTMLCanvasElement;
  private readonly cameraEntity: pc.Entity;
  private readonly materials = new Map<string, pc.StandardMaterial>();
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;

  // ---- player ----
  private props: PlayCanvasSceneProps = DEFAULT_PROPS;
  private playerEntity: pc.Entity | null = null;
  private physics: PlayerPhysicsHandle | null = null;
  private readonly playerPosition = { x: PLAYER_START[0], z: PLAYER_START[2] };
  private readonly velocity = { x: 0, y: 0 };
  private yaw = Math.PI;
  private angularVelocity = 0;
  private motion: PlayerMotionConfig = playerMotionForTier(0, false);
  private physicsAccumulator = 0;
  private readonly keysDown = new Set<string>();
  private keydownHandler = (event: KeyboardEvent) => this.onKey(event, true);
  private keyupHandler = (event: KeyboardEvent) => this.onKey(event, false);

  // ---- camera follow ----
  private readonly focus = { x: PLAYER_START[0], z: PLAYER_START[2] };

  // ---- doors ----
  private storefrontDoorGroup: pc.Entity | null = null;
  private storefrontLeaves: [pc.Entity, pc.Entity] | null = null;
  private storefrontIndicatorEntity: pc.Entity | null = null;
  private storefrontProgress = 0;
  private rearDoorGroup: pc.Entity | null = null;
  private rearLeaves: [pc.Entity, pc.Entity] | null = null;
  private rearIndicatorEntity: pc.Entity | null = null;
  private rearMotion: RearDoorMotionState = { ...CLOSED_REAR_DOOR_MOTION };

  // ---- furniture ----
  private furnitureGroup: pc.Entity | null = null;
  private furnitureSignature = "";

  constructor(canvas: HTMLCanvasElement, initialProps?: Partial<PlayCanvasSceneProps>) {
    this.canvas = canvas;
    if (initialProps) this.props = { ...DEFAULT_PROPS, ...initialProps };
    this.motion = playerMotionForTier(this.props.playerSpeedTier, this.props.unlockedAreas.includes("purchase-campaign"));

    this.app = new pc.Application(canvas, {
      graphicsDeviceOptions: { antialias: true },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_NONE);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);

    this.app.scene.ambientLight = new pc.Color(
      Math.min(1, DAYLIGHT_DAY.ambientIntensity),
      Math.min(1, DAYLIGHT_DAY.ambientIntensity),
      Math.min(1, DAYLIGHT_DAY.ambientIntensity),
    );

    const keyLight = new pc.Entity("key-light");
    keyLight.addComponent("light", {
      type: "directional",
      color: hexToColor(DAYLIGHT_DAY.keyColor),
      intensity: DAYLIGHT_DAY.keyIntensity,
      castShadows: false,
    });
    // Real position from MarketKeyLight: [8, 13, 7] * WORLD_SCALE, targeting
    // the origin (three's DirectionalLight default target).
    keyLight.setPosition(8 * WORLD_SCALE, 13 * WORLD_SCALE, 7 * WORLD_SCALE);
    keyLight.lookAt(0, 0, 0);
    this.app.root.addChild(keyLight);

    this.cameraEntity = new pc.Entity("overview-camera");
    this.cameraEntity.addComponent("camera", {
      projection: pc.PROJECTION_ORTHOGRAPHIC,
      nearClip: 0.1 * WORLD_SCALE,
      farClip: 120 * WORLD_SCALE,
      clearColor: hexToColor(DAYLIGHT_DAY.background),
    });
    this.app.root.addChild(this.cameraEntity);
    this.positionCameraInitial();

    const worldRoot = new pc.Entity("world-scale-root");
    worldRoot.setLocalScale(WORLD_SCALE, WORLD_SCALE, WORLD_SCALE);
    this.app.root.addChild(worldRoot);

    const groundGroup = new pc.Entity("perf:ground");
    groundGroup.setLocalScale(STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE);
    worldRoot.addChild(groundGroup);
    this.buildGround(groundGroup);

    const cityGroup = new pc.Entity("perf:city");
    cityGroup.setLocalScale(STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE);
    worldRoot.addChild(cityGroup);
    this.buildCityPerimeter(cityGroup);

    const buildingGroup = new pc.Entity("perf:building");
    buildingGroup.setLocalScale(STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE);
    worldRoot.addChild(buildingGroup);
    this.buildBuilding(buildingGroup);
    this.buildSignage(buildingGroup);

    // Doors and furniture live directly under worldRoot (WORLD_SCALE only —
    // their own build functions already bake `* STORE_LAYOUT_SCALE` via
    // `makeStoreElement`/explicit door-group scale, matching the real
    // source's two-level nesting documented in storefrontDoor.ts/rearFarmDoor.ts).
    this.buildStorefrontDoor(worldRoot);
    this.buildRearFarmDoor(worldRoot);
    this.buildFurniture(worldRoot, this.props.unlockedAreas);

    // Player entity lives directly under app.root, at world scale, exactly
    // like production's own RigidBody (`worldStart = PLAYER_START * WORLD_SCALE`).
    this.buildPlayerVisual();
    void this.initPlayerPhysics();

    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("keyup", this.keyupHandler);

    this.app.on("update", (dt: number) => this.onUpdate(dt));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  /** Called from React whenever the store's relevant fields change. */
  update(nextProps: PlayCanvasSceneProps) {
    const unlockedChanged = nextProps.unlockedAreas.join("|") !== this.props.unlockedAreas.join("|");
    const speedChanged = nextProps.playerSpeedTier !== this.props.playerSpeedTier || nextProps.unlockedAreas.includes("purchase-campaign") !== this.props.unlockedAreas.includes("purchase-campaign");
    this.props = nextProps;
    if (speedChanged) this.motion = playerMotionForTier(nextProps.playerSpeedTier, nextProps.unlockedAreas.includes("purchase-campaign"));
    if (unlockedChanged) {
      this.physics?.setUnlockedAreas(nextProps.unlockedAreas);
      const worldRoot = this.app.root.findByName("world-scale-root") as pc.Entity | null;
      if (worldRoot) this.buildFurniture(worldRoot, nextProps.unlockedAreas);
    }
  }

  private onKey(event: KeyboardEvent, down: boolean) {
    const key = event.key.toLowerCase();
    const tracked = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];
    if (!tracked.includes(key)) return;
    if (down) this.keysDown.add(key); else this.keysDown.delete(key);
    let x = 0;
    let y = 0;
    if (this.keysDown.has("a") || this.keysDown.has("arrowleft")) x -= 1;
    if (this.keysDown.has("d") || this.keysDown.has("arrowright")) x += 1;
    if (this.keysDown.has("w") || this.keysDown.has("arrowup")) y += 1;
    if (this.keysDown.has("s") || this.keysDown.has("arrowdown")) y -= 1;
    inputManager.setKeyboard(x, y);
  }

  private async initPlayerPhysics() {
    await ensureRapierReady();
    if (this.disposed) return;
    this.physics = buildPlayerPhysics(this.props.unlockedAreas, PLAYER_START[0], PLAYER_START[2]);
  }

  private buildPlayerVisual() {
    const entity = new pc.Entity("player");
    // Simple capsule placeholder standing in for the real character mesh
    // (a later phase — see the report). Real capsule collider dimensions
    // (halfHeight 0.45, radius 0.24 — `CapsuleCollider` args in `Player`'s
    // JSX / `PlayerPhysics.ts`'s `ColliderDesc.capsule(0.45, 0.24)`), scaled
    // to PlayCanvas's default capsule primitive (height 2, radius 0.5).
    entity.addComponent("render", { type: "capsule", material: this.material("#3f6f9a") });
    entity.setLocalScale(0.48, 0.69, 0.48);
    entity.setLocalPosition(0, 0.69 * WORLD_SCALE, 0);
    const root = new pc.Entity("perf:player");
    root.addChild(entity);
    root.setLocalPosition(PLAYER_START[0] * WORLD_SCALE, 0, PLAYER_START[2] * WORLD_SCALE);
    this.app.root.addChild(root);
    this.playerEntity = root;
  }

  /** Single render loop tick. */
  private onUpdate(dt: number) {
    this.stepPlayer(dt);
    this.stepDoors(dt);
    this.updateCamera();
  }

  private stepPlayer(dt: number) {
    if (!this.physics || !this.playerEntity) return;
    this.physicsAccumulator = Math.min(0.25, this.physicsAccumulator + dt);
    while (this.physicsAccumulator >= PHYSICS_STEP_SECONDS) {
      this.physicsAccumulator -= PHYSICS_STEP_SECONDS;
      this.fixedStepPlayer(PHYSICS_STEP_SECONDS);
    }
    // Heading turns with real frame delta (presentation only), same as production.
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const turnDelta = frameDelta(dt);
    if (speed > 0.08) {
      const heading = Math.atan2(this.velocity.x, this.velocity.y);
      const turn = smoothYaw(this.yaw, heading, this.angularVelocity, turnDelta, this.motion);
      this.yaw = turn.yaw;
      this.angularVelocity = turn.angularVelocity;
    }
    this.playerEntity.setLocalPosition(this.playerPosition.x * WORLD_SCALE, 0, this.playerPosition.z * WORLD_SCALE);
    this.playerEntity.setEulerAngles(0, (this.yaw * 180) / Math.PI, 0);
    this.focus.x = this.playerPosition.x;
    this.focus.z = this.playerPosition.z;
  }

  private fixedStepPlayer(step: number) {
    if (!this.physics) return;
    const gamepad = typeof navigator !== "undefined" ? navigator.getGamepads?.()[0] : null;
    if (gamepad) inputManager.setGamepad(gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0);
    const input = inputManager.sample();
    const intention = cameraRelativeMovement(input, { x: -OVERVIEW_CAMERA_OFFSET.x, y: -OVERVIEW_CAMERA_OFFSET.z });
    const next = moveVelocity(this.velocity, intention, step, this.motion);
    this.velocity.x = next.x;
    this.velocity.y = next.y;
    const dx = this.velocity.x * step;
    const dz = this.velocity.y * step;
    this.physics.updateDoors(this.storefrontProgress, this.rearMotion.progress);
    const movement = this.physics.resolveMovement(dx, dz);
    this.playerPosition.x += movement.x;
    this.playerPosition.z += movement.z;
  }

  private stepDoors(dt: number) {
    // Storefront door: target from real doorState/doorProgress (franchise.doorState/doorProgress).
    if (this.storefrontLeaves && this.storefrontIndicatorEntity) {
      const { doorState, doorProgress, open } = this.props;
      const target = doorState === "OPENING" || doorState === "OPEN"
        ? 1
        : doorState === "CLOSING" || doorState === "CLOSED"
          ? 0
          : storefrontDoorProgress(doorProgress);
      const step = (frameDelta(dt) * 1_000) / STOREFRONT_DOOR_TRAVEL_MS;
      this.storefrontProgress = this.storefrontProgress < target
        ? Math.min(target, this.storefrontProgress + step)
        : Math.max(target, this.storefrontProgress - step);
      this.storefrontLeaves[0].setLocalPosition(storefrontDoorLeafCenter(-1, this.storefrontProgress), 0, 0);
      this.storefrontLeaves[1].setLocalPosition(storefrontDoorLeafCenter(1, this.storefrontProgress), 0, 0);
      const indicatorRender = this.storefrontIndicatorEntity.render;
      if (indicatorRender) indicatorRender.material = this.material(open ? "#72e8a9" : "#f08d73");
    }

    // Rear farm door: opens automatically for anyone near it (player only for now — no crowd yet).
    if (this.rearLeaves && this.rearIndicatorEntity) {
      const playerPresent = rearDoorActorPresent([this.playerPosition.x / STORE_LAYOUT_SCALE, this.playerPosition.z / STORE_LAYOUT_SCALE]);
      this.rearMotion = advanceRearDoorMotion(this.rearMotion, playerPresent, frameDelta(dt) * 1_000);
      const progress = this.rearMotion.progress;
      this.rearLeaves[0].setLocalPosition(rearDoorLeafCenter(-1, progress), STORE_REAR_DOOR.door.leafHeight / 2, STORE_REAR_DOOR.z);
      this.rearLeaves[1].setLocalPosition(rearDoorLeafCenter(1, progress), STORE_REAR_DOOR.door.leafHeight / 2, STORE_REAR_DOOR.z);
      const open = progress > 0.98;
      const indicatorRender = this.rearIndicatorEntity.render;
      if (indicatorRender) indicatorRender.material = this.material(open ? "#79ecad" : "#f0bd66");
    }
  }

  /** Ported from `CameraRig.update` (`src/client/CameraRig.ts`), skipping
   * the checkout-composition blend (checkout is not built yet in this
   * phase — `checkoutBlend` stays 0, matching production before a checkout
   * focus starts). */
  private updateCamera() {
    const lookAtX = this.focus.x;
    const lookAtZ = this.focus.z;
    const camX = (this.focus.x + OVERVIEW_CAMERA_OFFSET.x) * WORLD_SCALE;
    const camY = (TARGET_HEIGHT + OVERVIEW_CAMERA_OFFSET.y) * WORLD_SCALE;
    const camZ = (this.focus.z + OVERVIEW_CAMERA_OFFSET.z) * WORLD_SCALE;
    this.cameraEntity.setPosition(camX, camY, camZ);
    this.cameraEntity.lookAt(lookAtX * WORLD_SCALE, TARGET_HEIGHT * WORLD_SCALE, lookAtZ * WORLD_SCALE);
  }

  start() {
    this.app.start();
  }

  resize() {
    const width = this.canvas.clientWidth || this.canvas.width || 1;
    const height = this.canvas.clientHeight || this.canvas.height || 1;
    this.app.resizeCanvas(width, height);
    this.updateOrthoHeight(width, height);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.keydownHandler);
    window.removeEventListener("keyup", this.keyupHandler);
    inputManager.clearAll();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.physics?.dispose();
    this.app.destroy();
  }

  private positionCameraInitial() {
    // Initial framing before the player's physics has resolved a first
    // position — same fixed 23.9-height shot phase 1 used.
    const x = (PLAYER_START[0] + OVERVIEW_CAMERA_OFFSET.x) * WORLD_SCALE;
    const y = 23.9 * WORLD_SCALE;
    const z = (PLAYER_START[2] + OVERVIEW_CAMERA_OFFSET.z) * WORLD_SCALE;
    this.cameraEntity.setPosition(x, y, z);
    const targetY = 0.9 * CHILD_CHARACTER_SCENE_SCALE * WORLD_SCALE;
    const targetX = PLAYER_START[0] * WORLD_SCALE;
    const targetZ = PLAYER_START[2] * WORLD_SCALE;
    this.cameraEntity.lookAt(targetX, targetY, targetZ);
  }

  /**
   * Direct algebraic port of OverviewCamera's zoom formula:
   *   zoom = min(w/32, h/28.5) / CAMERA_DISTANCE_FACTOR * CAMERA_PROXIMITY_FACTOR
   *   visibleHeight = canvasHeightPx / zoom   (three's ortho zoom convention:
   *     1 CSS pixel == 1 world unit at zoom=1, drei's default frustum)
   * PlayCanvas's orthoHeight is half that visible height.
   */
  private updateOrthoHeight(width: number, height: number) {
    const zoom = (Math.min(width / CAMERA_FRAME_WIDTH, height / CAMERA_FRAME_HEIGHT) / CAMERA_DISTANCE_FACTOR) * CAMERA_PROXIMITY_FACTOR;
    const visibleHeight = height / Math.max(zoom, 1e-6);
    const camera = this.cameraEntity.camera;
    if (camera) camera.orthoHeight = visibleHeight / 2;
  }

  private material(color: string, opacity = 1): pc.StandardMaterial {
    const key = `${color}|${opacity}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const material = new pc.StandardMaterial();
    material.diffuse = hexToColor(color);
    if (opacity < 1) {
      material.opacity = opacity;
      material.blendType = pc.BLEND_NORMAL;
      material.depthWrite = false;
    }
    material.update();
    this.materials.set(key, material);
    return material;
  }

  private box(parent: pc.Entity, spec: BoxSpec) {
    const entity = new pc.Entity(spec.name ?? "box");
    entity.addComponent("render", { type: "box", material: this.material(spec.color, spec.opacity ?? 1) });
    entity.setLocalScale(spec.size[0], spec.size[1], spec.size[2]);
    entity.setLocalPosition(spec.pos[0], spec.pos[1], spec.pos[2]);
    parent.addChild(entity);
    return entity;
  }

  // ---- MarketGround (src/components/game/MarketScene.tsx, lines ~1896-1909) ----
  private buildGround(parent: pc.Entity) {
    this.box(parent, { size: [23, 0.16, 17], pos: [0, -0.08, -0.35], color: "#eee8dc", name: "floor" });
    for (const x of [-7.6, -3.8, 0, 3.8, 7.6]) {
      this.box(parent, { size: [0.018, 0.008, 16.7], pos: [x, 0.012, -0.35], color: "#d9d2c5", name: "floor-seam-x" });
    }
    for (const z of [-6.8, -3.4, 0, 3.4, 6.8]) {
      this.box(parent, { size: [22.7, 0.008, 0.018], pos: [0, 0.013, z - 0.35], color: "#d9d2c5", name: "floor-seam-z" });
    }
    this.box(parent, { size: [23, 0.14, 7.5], pos: [0, -0.1, 11.9], color: "#d7e3db", name: "front-apron" });
    this.box(parent, { size: [25, 0.12, 1.2], pos: [0, -0.09, 16.15], color: "#566a62", name: "sidewalk-strip" });
    for (const x of [-6, 0, 6]) {
      this.box(parent, { size: [2.7, 0.02, 0.1], pos: [x, -0.015, 16.1], color: "#f4d58d", name: "sidewalk-mark" });
    }
    this.box(parent, { size: [2.58, 0.08, 2.2], pos: [STORE_REAR_DOOR.x, -0.015, -9.61], color: "#b8ab8f", name: "rear-door-mat" });
    for (const offset of [-0.72, 0, 0.72]) {
      this.box(parent, { size: [0.035, 0.018, 2.08], pos: [STORE_REAR_DOOR.x + offset, 0.03, -9.61], color: "#dfd3b8", name: "rear-path-inlay" });
    }
  }

  // ---- MarketBuilding (src/components/game/MarketScene.tsx, lines ~1911-1966) ----
  // Static shell only. The door LEAVES themselves are now built/driven
  // dynamically by buildStorefrontDoor()/buildRearFarmDoor() below — the
  // closed-progress boxes phase 1 drew here for the leaves are removed to
  // avoid double geometry; frames/posts/signage backing stay static.
  private buildBuilding(parent: pc.Entity) {
    const wallHeight = STOREFRONT_LAYOUT.wallHeight;

    for (const segment of rearDoorWallSegments()) {
      this.box(parent, { size: [segment.width, wallHeight, STORE_REAR_DOOR.wallDepth], pos: [segment.centerX, wallHeight / 2, STORE_REAR_DOOR.wallCenterZ], color: "#eee8dc", name: "rear-wall-segment" });
      this.box(parent, { size: [Math.max(0.01, segment.width - 0.08), 1.25, 0.12], pos: [segment.centerX, 0.68, -8.34], color: "#2f6958", name: "rear-wall-accent" });
    }
    for (const panel of rearDoorWallPanels()) {
      this.box(parent, { size: [panel.width, wallHeight * 0.57, 0.08], pos: [panel.centerX, wallHeight * 0.54, -8.35], color: "#f7f2e8", name: "rear-wall-panel" });
    }
    this.box(parent, { size: [5.6, 0.78, 0.18], pos: [0, wallHeight - 0.82, -8.28], color: "#173f35", name: "rear-sign-backing" });

    // Rear farm door frame (STORE_REAR_DOOR) — frame/posts/threshold only, leaves built dynamically.
    const rearDoor = STORE_REAR_DOOR.door;
    const rx = STORE_REAR_DOOR.x;
    const rz = STORE_REAR_DOOR.z;
    for (const side of [-1, 1] as const) {
      this.box(parent, { size: [rearDoor.postWidth, rearDoor.leafHeight + 0.18, rearDoor.frameDepth], pos: [rx + side * rearDoor.outerPostOffset, (rearDoor.leafHeight + 0.18) / 2, rz + 0.02], color: "#294a41", name: "rear-frame-post" });
    }
    this.box(parent, { size: [rearDoor.outerPostOffset * 2 + rearDoor.postWidth, 0.18, rearDoor.frameDepth], pos: [rx, rearDoor.leafHeight + 0.09, rz + 0.02], color: "#294a41", name: "rear-frame-top" });
    this.box(parent, { size: [2.18, 0.5, 0.16], pos: [rx, rearDoor.leafHeight + 0.48, rz + 0.035], color: "#173f35", name: "rear-frame-sign" });
    this.box(parent, { size: [rearDoor.outerPostOffset * 2, 0.07, 0.54], pos: [rx, 0.035, rz], color: "#8e9894", name: "rear-frame-threshold" });

    this.box(parent, { size: [0.34, wallHeight, 16.5], pos: [-11.35, wallHeight / 2, -0.35], color: "#e5ded2", name: "side-wall-left" });
    this.box(parent, { size: [0.34, wallHeight, 16.5], pos: [11.35, wallHeight / 2, -0.35], color: "#e5ded2", name: "side-wall-right" });

    const frontGlassHeight = wallHeight - 0.6;
    const frontGlassCenterY = frontGlassHeight / 2 + 0.3;
    for (const x of [-6.585, 6.585]) {
      this.box(parent, { size: [9.53, 0.6, 0.3], pos: [x, 0.3, 7.78], color: "#e7dfd2", name: "storefront-pillar" });
      this.box(parent, { size: [9.34, frontGlassHeight, 0.07], pos: [x, frontGlassCenterY, 7.78], color: "#c7e4df", opacity: 0.12, name: "storefront-glass" });
      for (const edge of [-4.67, 0, 4.67]) {
        this.box(parent, { size: [0.1, frontGlassHeight, 0.12], pos: [x + edge, frontGlassCenterY, 7.84], color: "#37564d", name: "storefront-mullion" });
      }
    }
    this.box(parent, { size: [3.75, 0.055, 1.05], pos: [0, 0.035, 7.02], color: "#2b4b43", name: "entrance-mat" });

    // Storefront (front) door frame — posts/beam/sign only, leaves built dynamically.
    const door = STOREFRONT_LAYOUT.door;
    const doorGroupY = door.leafHeight / 2;
    const doorZ = STOREFRONT_LAYOUT.z;
    for (const x of [-door.outerPostX, door.outerPostX]) {
      this.box(parent, { size: [door.postWidth, door.leafHeight + 0.16, door.frameDepth], pos: [x, doorGroupY, doorZ + 0.08], color: "#294a41", name: "storefront-post" });
    }
    this.box(parent, { size: [door.outerPostX * 2 + door.postWidth * 2, 0.14, 0.15], pos: [0, doorGroupY + door.leafHeight / 2 + 0.07, doorZ + 0.08], color: "#294a41", name: "storefront-top-beam" });
    this.box(parent, { size: [0.62, 0.24, 0.2], pos: [0, doorGroupY + door.leafHeight / 2 + 0.38, doorZ + 0.02], color: "#203a33", name: "storefront-sign" });
  }

  /** "MINI MARKET" / "GRANJA" world-space text, via `pc.CanvasFont` +
   * an `element` component with no `ScreenComponent` ancestor (renders like
   * any other entity, in the parent's local units — see ElementComponent's
   * own doc comment in playcanvas.d.ts). Positions/sizes/colors copied from
   * the real `<Text>` elements in MarketScene.tsx (lines 1935, 1940). */
  private buildSignage(buildingGroup: pc.Entity) {
    const wallHeight = STOREFRONT_LAYOUT.wallHeight;
    this.buildText(buildingGroup, "mini-market-sign", "MINI MARKET", 0.43, [0, wallHeight - 0.82, -8.17]);

    const rearDoor = STORE_REAR_DOOR.door;
    const rearSign = new pc.Entity("rear-farm-door-sign-anchor");
    rearSign.setLocalPosition(STORE_REAR_DOOR.x, 0, STORE_REAR_DOOR.z);
    buildingGroup.addChild(rearSign);
    this.buildText(rearSign, "granja-sign", "GRANJA", 0.22, [0, rearDoor.leafHeight + 0.49, 0.13]);
  }

  private buildText(parent: pc.Entity, name: string, text: string, fontSize: number, position: [number, number, number], color = "#fff3ce") {
    const font = new pc.CanvasFont(this.app, { fontName: "Arial", fontWeight: "bold", fontSize: 64, color: hexToColor(color) });
    font.createTextures(text);
    const fontAsset = new pc.Asset(`font:${name}`, "font", { url: "" });
    fontAsset.resource = font;
    fontAsset.loaded = true;
    this.app.assets.add(fontAsset);
    const entity = new pc.Entity(name);
    entity.addComponent("element", {
      type: pc.ELEMENTTYPE_TEXT,
      text,
      fontAsset,
      fontSize,
      color: hexToColor(color),
      anchor: new pc.Vec4(0.5, 0.5, 0.5, 0.5),
      pivot: new pc.Vec2(0.5, 0.5),
      autoWidth: true,
      autoHeight: true,
    });
    entity.setLocalPosition(position[0], position[1], position[2]);
    parent.addChild(entity);
    return entity;
  }

  /** Ported from `src/client/WorldKit/storefrontDoor.ts` (visual leaves +
   * indicator only — no glass transmission pass in this phase). Nested the
   * same two-level way the source documents (a STORE_LAYOUT_SCALE wrapper,
   * then a group at the door's local position), directly under worldRoot so
   * it lines up with `perf:building`'s own nesting. */
  private buildStorefrontDoor(worldRoot: pc.Entity) {
    const door = STOREFRONT_LAYOUT.door;
    const wrapper = new pc.Entity("dynamic:storefront-door");
    wrapper.setLocalScale(STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE);
    worldRoot.addChild(wrapper);
    const group = new pc.Entity("storefront-door-group");
    group.setLocalPosition(0, door.leafHeight / 2, STOREFRONT_LAYOUT.z);
    wrapper.addChild(group);

    const leaves: pc.Entity[] = [];
    for (const side of [-1, 1] as const) {
      const leaf = new pc.Entity(`storefront-leaf-${side}`);
      leaf.setLocalPosition(storefrontDoorLeafCenter(side, 0), 0, 0);
      const panel = new pc.Entity("panel");
      panel.addComponent("render", { type: "box", material: this.material("#c9e9e3", 0.28) });
      panel.setLocalScale(door.leafWidth, door.leafHeight, door.leafDepth);
      leaf.addChild(panel);
      for (const edge of [-door.leafWidth / 2, door.leafWidth / 2]) {
        const post = new pc.Entity("edge");
        post.addComponent("render", { type: "box", material: this.material("#294a41") });
        post.setLocalScale(0.075, door.leafHeight + 0.02, 0.1);
        post.setLocalPosition(edge, 0, 0.07);
        leaf.addChild(post);
      }
      group.addChild(leaf);
      leaves.push(leaf);
    }

    const indicator = new pc.Entity("storefront-indicator");
    indicator.addComponent("render", { type: "box", material: this.material("#f08d73") });
    indicator.setLocalScale(0.13, 0.13, 0.02);
    indicator.setLocalPosition(0, door.leafHeight / 2 + 0.38, 0.14);
    group.addChild(indicator);

    this.storefrontDoorGroup = wrapper;
    this.storefrontLeaves = [leaves[0], leaves[1]];
    this.storefrontIndicatorEntity = indicator;
    this.storefrontProgress = storefrontDoorProgress(this.props.doorProgress);
  }

  /** Ported from `src/client/WorldKit/rearFarmDoor.ts`. */
  private buildRearFarmDoor(worldRoot: pc.Entity) {
    const door = STORE_REAR_DOOR.door;
    const doorHalfHeight = door.leafHeight / 2;
    const group = new pc.Entity("dynamic:rear-farm-door");
    group.setLocalScale(STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE);
    worldRoot.addChild(group);

    const leaves: pc.Entity[] = [];
    for (const side of [-1, 1] as const) {
      const leaf = new pc.Entity(`rear-leaf-${side}`);
      leaf.setLocalPosition(rearDoorLeafCenter(side, 0), doorHalfHeight, STORE_REAR_DOOR.z);
      const panel = new pc.Entity("panel");
      panel.addComponent("render", { type: "box", material: this.material("#cbe8de", 0.42) });
      panel.setLocalScale(door.leafWidth, door.leafHeight, door.leafDepth);
      leaf.addChild(panel);
      for (const edge of [-door.leafWidth / 2, door.leafWidth / 2]) {
        const post = new pc.Entity("edge");
        post.addComponent("render", { type: "box", material: this.material("#294a41") });
        post.setLocalScale(0.065, door.leafHeight + 0.02, 0.1);
        post.setLocalPosition(edge, 0, 0.055);
        leaf.addChild(post);
      }
      const handle = new pc.Entity("handle");
      handle.addComponent("render", { type: "box", material: this.material("#e4b95f") });
      handle.setLocalScale(0.055, 0.6, 0.055);
      handle.setLocalPosition(side * -0.27, 0, 0.075);
      leaf.addChild(handle);
      group.addChild(leaf);
      leaves.push(leaf);
    }

    const indicatorGroup = new pc.Entity("rear-indicator");
    indicatorGroup.setLocalPosition(STORE_REAR_DOOR.x, door.leafHeight + 0.38, STORE_REAR_DOOR.z + 0.035);
    const housing = new pc.Entity("housing");
    housing.addComponent("render", { type: "box", material: this.material("#203a33") });
    housing.setLocalScale(0.58, 0.22, 0.18);
    indicatorGroup.addChild(housing);
    const light = new pc.Entity("light");
    light.addComponent("render", { type: "box", material: this.material("#f0bd66") });
    light.setLocalScale(0.11, 0.11, 0.01);
    light.setLocalPosition(0, 0, 0.105);
    indicatorGroup.addChild(light);
    group.addChild(indicatorGroup);

    this.rearDoorGroup = group;
    this.rearLeaves = [leaves[0], leaves[1]];
    this.rearIndicatorEntity = light;
  }

  /**
   * Simplified (box-volume, real position/size/color/gating) port of
   * `KitFurniture`'s retail departments (`src/components/game/MarketKit.tsx`,
   * `/runtime`'s `src/client/WorldKit/kitFurniture.ts`). Positioned via
   * `makeStoreElement`'s exact formula (`scaleStorePosition` + yaw +
   * `STORE_ELEMENT_SCALE`), sized from each department's real
   * `fixtureHalfExtents`, gated by the real `fixtureAvailable()` check.
   * Checkout, production, farm and stock-level detail are deferred (see the
   * report) — this covers "the retail shelving/departments visible and
   * correctly gated", the task's stated minimum for this phase.
   */
  private buildFurniture(worldRoot: pc.Entity, unlockedAreas: string[]) {
    const signature = unlockedAreas.slice().sort().join("|");
    if (signature === this.furnitureSignature && this.furnitureGroup) return;
    this.furnitureSignature = signature;
    if (this.furnitureGroup) {
      this.furnitureGroup.destroy();
      this.furnitureGroup = null;
    }
    const group = new pc.Entity("worldkit:furniture");
    worldRoot.addChild(group);
    this.furnitureGroup = group;

    for (const id of RETAIL_DEPARTMENT_IDS as RetailDepartmentId[]) {
      const department = RETAIL_DEPARTMENTS[id];
      // Produce/pantry can have more than one physical fixture; every other
      // department is a single fixture gated by "fixture:retail-<id>-1"
      // (preserves uses its own preserves-supply-only rule inside
      // `fixtureAvailable`). Matches `kitFurniture.ts`'s exact gating.
      // Produce is base-game (ungated); its second fixture is gated
      // internally by `retailFixtureDisplayPositions` itself
      // (`fixture:retail-produce-2` / expansion-side). Every other
      // department — including pantry, whose own display-position helper
      // does NOT gate internally — needs the outer `fixture:retail-<id>-1`
      // check `kitFurniture.ts` applies before rendering ANY of its fixtures.
      if (id !== "produce" && !fixtureAvailable(`fixture:retail-${id}-1`, unlockedAreas)) continue;
      if (id === "produce" || id === "pantry") {
        retailFixtureDisplayPositions(id, unlockedAreas).forEach((position) => {
          this.buildDepartmentFixture(group, department, [...position] as [number, number, number], department.yaw ?? 0);
        });
        continue;
      }
      this.buildDepartmentFixture(group, department, [...department.display] as [number, number, number], department.yaw ?? 0);
    }
  }

  private buildDepartmentFixture(parent: pc.Entity, department: (typeof RETAIL_DEPARTMENTS)[RetailDepartmentId], position: [number, number, number], yawDeg: number) {
    // Mirrors `makeStoreElement`: scaleStorePosition (bakes STORE_LAYOUT_SCALE
    // — this group already lives under `worldRoot`, WORLD_SCALE only), yaw,
    // then a uniform STORE_ELEMENT_SCALE on the fixture itself.
    const scaled = scaleStorePosition(position);
    const element = new pc.Entity(`fixture:${department.id}`);
    element.setLocalPosition(scaled[0], scaled[1], scaled[2]);
    element.setEulerAngles(0, yawDeg, 0);
    parent.addChild(element);

    const [halfX, halfZ] = department.fixtureHalfExtents;
    const body = new pc.Entity("body");
    body.addComponent("render", { type: "box", material: this.material(department.color) });
    body.setLocalScale(halfX * 2 * STORE_ELEMENT_SCALE, 0.95 * STORE_ELEMENT_SCALE, halfZ * 2 * STORE_ELEMENT_SCALE);
    body.setLocalPosition(0, 0.475 * STORE_ELEMENT_SCALE, 0);
    element.addChild(body);
    const base = new pc.Entity("base");
    base.addComponent("render", { type: "box", material: this.material("#3a3f38") });
    base.setLocalScale(halfX * 2.05 * STORE_ELEMENT_SCALE, 0.08 * STORE_ELEMENT_SCALE, halfZ * 2.05 * STORE_ELEMENT_SCALE);
    base.setLocalPosition(0, 0.04 * STORE_ELEMENT_SCALE, 0);
    element.addChild(base);
  }

  // ---- CityPerimeter (src/components/game/CityPerimeter.tsx) ----
  private buildCityPerimeter(parent: pc.Entity) {
    this.box(parent, { size: [54, 0.1, 64], pos: [0, -0.2, -2], color: "#abc7a6", name: "city-block" });
    this.road(parent, [36, 0.09, 3.8], [0, -0.125, -21.8], true);
    this.road(parent, [36, 0.09, 3.8], [0, -0.125, 18.25], true);
    this.road(parent, [3.8, 0.09, 43.9], [-15.85, -0.12, -1.75], false);
    this.road(parent, [3.8, 0.09, 43.9], [15.85, -0.12, -1.75], false);

    this.box(parent, { size: [26.8, 0.1, 1.1], pos: [0, -0.07, -19.4], color: "#d9d7c9", name: "sidewalk" });
    this.box(parent, { size: [26.8, 0.1, 1.1], pos: [0, -0.07, 16.05], color: "#d9d7c9", name: "sidewalk" });
    this.box(parent, { size: [1.1, 0.1, 35.4], pos: [-13.45, -0.07, -1.65], color: "#d9d7c9", name: "sidewalk" });
    this.box(parent, { size: [1.1, 0.1, 35.4], pos: [13.45, -0.07, -1.65], color: "#d9d7c9", name: "sidewalk" });

    this.crosswalk(parent, [0, -0.065, 17.95], false);
    this.crosswalk(parent, [-15.55, -0.065, 9.2], true);

    for (const x of [-11, -5.5, 5.5, 11]) this.parkingSpace(parent, x);

    const buildingColors = ["#d9a27d", "#d7c28d", "#9eb9b0", "#b79ab3", "#9cafc7", "#c9a58c"];
    const buildings: Array<[number, number, number, number, number, number]> = [
      [-10.5, 0, -26.1, 5.2, 5.3, 3.6],
      [-4.4, 0, -26.5, 4.7, 4.5, 3.2],
      [1.3, 0, -26.3, 5.1, 6.1, 3.5],
      [7.3, 0, -26, 5, 4.9, 3.4],
      [19.2, 0, -7.1, 4.6, 5.5, 3.1],
      [19.4, 0, -0.8, 4.8, 4.2, 3.2],
      [19.1, 0, 5.2, 4.5, 5.9, 3],
      [-19.1, 0, -6.2, 4.4, 4.8, 3.2],
      [-19.3, 0, 0.1, 4.8, 5.8, 3],
      [-19.1, 0, 6.7, 4.5, 4.4, 3.2],
    ];
    buildings.forEach(([x, , z, width, height, depth], index) => {
      const rotationY = Math.abs(x) > 15 ? (x > 0 ? -90 : 90) : 0;
      this.cityBuilding(parent, [x, 0, z], [width, height, depth], buildingColors[index % buildingColors.length], rotationY);
    });
  }

  private road(parent: pc.Entity, size: [number, number, number], pos: [number, number, number], horizontal: boolean) {
    const group = new pc.Entity("road");
    group.setLocalPosition(pos[0], pos[1], pos[2]);
    parent.addChild(group);
    this.box(group, { size, pos: [0, 0, 0], color: "#65716f", name: "road-surface" });
    const roadLength = horizontal ? size[0] : size[2];
    const markCount = Math.max(1, Math.floor(roadLength / 4.5));
    for (let index = 0; index < markCount; index += 1) {
      const offset = (index - (markCount - 1) / 2) * 4.5;
      if (horizontal) this.box(group, { size: [2.2, 0.018, 0.08], pos: [offset, 0.055, 0], color: "#f1df9b", name: "road-mark" });
      else this.box(group, { size: [0.08, 0.018, 2.2], pos: [0, 0.055, offset], color: "#f1df9b", name: "road-mark" });
    }
  }

  private crosswalk(parent: pc.Entity, pos: [number, number, number], rotated: boolean) {
    const group = new pc.Entity("crosswalk");
    group.setLocalPosition(pos[0], pos[1], pos[2]);
    if (rotated) group.setEulerAngles(0, 90, 0);
    parent.addChild(group);
    for (const x of [-1.25, -0.75, -0.25, 0.25, 0.75, 1.25]) {
      this.box(group, { size: [0.28, 0.025, 2.3], pos: [x, 0, 0], color: "#ecebe2", name: "crosswalk-stripe" });
    }
  }

  private parkingSpace(parent: pc.Entity, x: number) {
    const group = new pc.Entity("parking-space");
    group.setLocalPosition(x, -0.06, 20.55);
    parent.addChild(group);
    this.box(group, { size: [2.4, 0.04, 0.07], pos: [0, 0, -1.15], color: "#f2eee0", name: "parking-line" });
    this.box(group, { size: [0.07, 0.04, 2.3], pos: [-1.2, 0, 0], color: "#f2eee0", name: "parking-line" });
    this.box(group, { size: [0.07, 0.04, 2.3], pos: [1.2, 0, 0], color: "#f2eee0", name: "parking-line" });
  }

  private cityBuilding(parent: pc.Entity, pos: [number, number, number], size: [number, number, number], color: string, rotationYDeg: number) {
    const [width, height, depth] = size;
    const group = new pc.Entity("city-building");
    group.setLocalPosition(pos[0], pos[1], pos[2]);
    group.setEulerAngles(0, rotationYDeg, 0);
    parent.addChild(group);
    this.box(group, { size: [width, height, depth], pos: [0, height / 2, 0], color, name: "building-volume" });
    this.box(group, { size: [width + 0.18, 0.18, depth + 0.18], pos: [0, height + 0.09, 0], color: "#5c6965", name: "building-roof-cap" });
    this.box(group, { size: [width * 0.22, height * 0.25, 0.08], pos: [0, height * 0.125, depth / 2 + 0.05], color: "#50635d", name: "building-door" });
    this.box(group, { size: [width * 0.52, 0.16, 0.5], pos: [0, height * 0.82, depth / 2 + 0.26], color: "#efe2bd", name: "building-awning" });
  }
}
