import * as pc from "playcanvas";
import { OVERVIEW_CAMERA_OFFSET } from "@/game/render/overview-camera";
import { WORLD_SCALE, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE, scaleStorePosition, scaleStorePoint } from "@/game/world-scale";
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
import { CHECKOUT_LANE_IDS, CHECKOUT_LANES, checkoutAreaForLane, type CheckoutLane } from "@/game/stations/checkout-layout";
import { STORE_PRODUCTION_FIXTURES, PRODUCTION_FIXTURE_IDS, isProductionWorkstationId, type ProductionFixtureId } from "@/game/stations/production-layout";
import { STORE_SERVICE_FIXTURES } from "@/game/stations/store-service-layout";
import { WAREHOUSE_RETURN_STATION } from "@/game/stations/warehouse-layout";
import { FARM_PLOTS, FARM_BARN, FARM_ANIMAL_STATIONS, FARM_FIELD, FARM_ANIMAL_FOOTPRINTS, type FarmPlotLayout } from "@/game/stations/farm-layout";
import { isWorkstationId, WORKSTATION_IDS } from "@/game/stations/workstation-layout";
import { InteractionDirector } from "@/game/interaction/InteractionDirector";
import type { InteractionZoneConfig } from "@/game/interaction/InteractionZone";
import { WorkstationController } from "@/game/interaction/WorkstationController";
import { interactionZoneConfigs } from "@/game/interaction/interactionZoneConfigsPure";
import { useMarketStore } from "@/game/store";
import { WORLD_TICK_INTERVAL_MS } from "@/game/core/timing";
import type { AvatarHatId, CharacterId, HairId } from "@/game/types";
import { characterSceneScale } from "@/game/animation/CharacterScale";

/**
 * Phase 2 of the PlayCanvas port: a controllable player capsule with real
 * Rapier collision (reusing `/runtime`'s already-verified `PlayerPhysics.ts`,
 * which has no Three.js dependency and operates in the same "layout units ×
 * STORE_LAYOUT_SCALE" space this file already uses for every other
 * position), the overview camera's real follow/zoom formula
 * (`src/client/CameraRig.ts`), both real doors (storefront + rear farm door,
 * driven by real game state / player-proximity, ported the same way
 * `/runtime`'s `storefrontDoor.ts`/`rearFarmDoor.ts` do), real "MINI MARKET"/
 * "GRANJA" signage via `pc.CanvasFont`, simplified (box-volume, but
 * real-position/real-size/real-color) retail/checkout/production/farm
 * fixtures gated by `fixtureAvailable()`/real crop status, and a real
 * fixed-200ms world-tick driver (`setExternalWorldTickDriver` +
 * `useMarketStore.getState().tickWorld`) so the simulation actually advances.
 * See the phase 3 report for what remains (crowd, real character mesh, HUD
 * input wiring, save/load).
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
  /** Real `GameState.avatar.body` — selects which owner GLB to load for the
   * real player character (phase 4). */
  avatarBody: CharacterId;
  /** Real `GameState.avatar.hair`/`hairColor`/`hat` (phase 5). `skin`/`shirt`
   * are intentionally not read here: production's own `PlayerActor.ts` never
   * applies them either (see `AvatarCustomizer.tsx`'s doc comment — the
   * delivered owner bodies carry one baked texture atlas with no separate
   * skin/shirt material), so leaving them unused matches the real reference,
   * not a PlayCanvas-specific gap. */
  avatarHair: HairId;
  avatarHairColor: string;
  avatarHat: AvatarHatId;
  unlockedAreas: string[];
  doorState: DoorState;
  doorProgress: number;
  open: boolean;
  playerSpeedTier: number;
  /** Real `franchise.checkoutLevel` — rebuilds the checkout lane's real
   * interaction dwell/repeat timing, exactly like `InteractionSensors`'s own
   * `checkoutLevel` dependency in `MarketScene.tsx`. */
  checkoutLevel: number;
  /** Real available-purchase ids (`purchaseMarkers.map((m) => m.id)`,
   * already filtered to `available: true` by `GameShell.tsx`) — only these
   * purchase-marker interaction zones exist, matching production's own
   * `availablePurchaseIds` gate in `interactionZoneConfigs()`. */
  availablePurchaseIds: string[];
  /** Real interaction dispatch — see `InteractionDirector`'s doc comment and
   * `PlayerActor.ts`'s `fixedStep()` for the exact call contract this phase
   * reproduces. */
  onInteract: (id: string) => void;
  onDistance: (meters: number) => void;
  onDoorPresence: (active: boolean) => void;
  /** Real crop status from `franchise.crops` — only `id`/`status` are needed
   * to reproduce `KitFarm`'s exact per-plot gating (`kitFarm.ts`'s
   * `gated = unlockedAreas.includes("purchase-campaign") && (!crop || crop.status === "LOCKED")`). */
  crops: Array<{ id: string; status: string }>;
  /** Real `franchise.customers` positions (layout units, same space as
   * `CrowdSystems.ts`'s `scaleStorePoint([customer.x, customer.z])`). */
  customers: Array<{ id: string; x: number; z: number; state: string }>;
  /** Real `franchise.employees` runtime positions — only entries with a
   * live `runtime` (spawned/working) are included, mirroring how the crowd
   * bodies only exist for actors the sim has actually placed on the floor. */
  employees: Array<{ id: string; x: number; z: number; role: string }>;
}

const DEFAULT_PROPS: PlayCanvasSceneProps = { avatarBody: "adult-man", avatarHair: "fade", avatarHairColor: "#3a2a1e", avatarHat: "none", unlockedAreas: [], doorState: "CLOSED", doorProgress: 0, open: false, playerSpeedTier: 0, checkoutLevel: 1, availablePurchaseIds: [], crops: [], customers: [], employees: [], onInteract: () => {}, onDistance: () => {}, onDoorPresence: () => {} };

// Mirrors `PlayerActor.ts`'s `OWNER_BODY_KEY` — the real owner GLB filenames.
const OWNER_BODY_KEY: Record<CharacterId, string> = { "adult-man": "owner_man", "adult-woman": "owner_woman", boy: "owner_boy", girl: "owner_girl" };
// Mirrors `CrowdSystems.ts`'s `BODY_SCALE` (per-body calibration on top of
// `characterSceneScale()`). Copied verbatim rather than importing that module
// (it pulls in Three.js, which this PlayCanvas-only file must not depend on).
const OWNER_BODY_SCALE: Record<CharacterId, number> = { "adult-man": 1.264, "adult-woman": 1.302, boy: 1.322, girl: 1.264 };
// The "lod1" tier (not the crowd `budgetPath` tier, which strips embedded
// AnimationClips for the GPU-baked-texture crowd pipeline — see
// `CrowdSkinning.ts`) is the smallest real owner GLB that still carries every
// named clip (`Idle`, `Walk`, ...) glTF-embedded, which is what PlayCanvas's
// own `anim` component needs (no equivalent to the baked-texture pipeline is
// built for this phase — see the phase 4 report). Every real owner GLB in
// this repo (budget/lod1/lod2/full) is authored with `EXT_meshopt_compression`
// (`extensionsRequired`), which the PlayCanvas engine build here does not
// implement (confirmed empirically: `instantiateRenderEntity()` throws
// `RangeError: Invalid typed array length` trying to read the fallback
// buffer) — so `characters/playcanvas-lod1/*.glb` is a one-time, byte-lossless
// (geometry/animation-preserving) `gltf-transform copy` of the real lod1
// asset with meshopt decoded back to plain accessors (still
// `EXT_texture_webp`, which PlayCanvas's own GLB parser does support
// natively). Regenerate with:
//   npx gltf-transform copy characters/lod1/<file>.glb characters/playcanvas-lod1/<file>.glb
// if the source lod1 asset changes. This does not touch any file `/`,
// `/play2` or `/runtime` reads.
const OWNER_MODEL_ROOT = "/models/market/characters/playcanvas-lod1";
// Phase 8 wires Idle/Walk/Run by presented speed, plus one real work pose
// while `WorkstationController` reports the player locked onto a
// movement-locking workstation (checkout/farm animal stations — see that
// controller's doc comment). Every other named clip in the GLB (Browse,
// Harvest*, Plant*, checkout-scan sub-poses, ...) is still not wired — those
// are per-crop/per-fixture presentation states with no dispatch hook in this
// port yet.
const WALK_TRANSITION_SECONDS = 0.15;
// Mirrors `LocomotionController.ts`'s `select()` thresholds and
// `CLIP_NATURAL_SPEED.Walk` (copied verbatim, not imported — that module
// pulls in Three.js for its `transition()` method, which this PlayCanvas-only
// file must not depend on). Same calibration production's own
// `PlayerActor.ts` feeds its `LocomotionController` instance.
const LOCOMOTION_MOVING_START = 0.12;
const LOCOMOTION_MOVING_STOP = 0.07;
const LOCOMOTION_WALK_NATURAL_SPEED = 0.35;
const LOCOMOTION_RUN_GAIT_RATIO = { start: 2.4, stop: 2.12 };
type PlayerAnimClip = "Idle" | "Walk" | "Run" | "ScanItem" | "PickupLow";
// Mirrors `PlayerActor.ts`'s `WORKSTATION_CLIP` table, restricted to the ids
// `WorkstationController` can ever report as `performingZoneId()` in this
// port (checkout + the two chicken stations + cow — see `fixedStepPlayer()`'s
// `activeWorkstation` computation). `chicken2` has no entry in the real table
// either, so it deliberately falls back to "Idle", matching production.
const PLAYER_WORKSTATION_CLIP: Partial<Record<string, PlayerAnimClip>> = { checkout: "ScanItem", chicken: "PickupLow", cow: "PickupLow" };

// Same "meshopt is EXT_meshopt_compression, PlayCanvas's own GLB parser
// doesn't implement it" problem as `OWNER_MODEL_ROOT`'s doc comment
// describes, for the budget hat/hair GLBs (`budgetPath("hats"|"hair", ...)`
// in `/runtime`'s `PlayerActor.ts`) — every one is decoded byte-losslessly
// (geometry-preserving; these are static, unskinned meshes, so there is no
// animation data to lose) the same way:
//   npx gltf-transform copy public/models/market/budget/hats/<body>/<file>.glb public/models/market/playcanvas-accessories/hats/<body>/<file>.glb
//   npx gltf-transform copy public/models/market/budget/hair/<body>/<file>.glb public/models/market/playcanvas-accessories/hair/<body>/<file>.glb
// Regenerate the same way if the source budget assets change. This does not
// touch any file `/`, `/play2` or `/runtime` reads.
const ACCESSORY_ROOT = "/models/market/playcanvas-accessories";

// Real static fixture GLBs `/runtime`'s own WorldKit modules load for these
// exact fixtures — not every filename under `public/models/market/environment`
// is actually wired into the live renderer (e.g. `equipment_checkout_counter`
// is catalogued in `AssetRegistry.ts` but `checkout/checkoutKit.ts` builds the
// real checkout counter procedurally, no GLB), so only fixtures confirmed
// real-GLB-driven in `/runtime` are ported here:
//  - `chicken_coop`/`cow_station`: `animalStation.ts`'s `loadEnvironmentProp()`
//    (the coop/station shell, loaded at the "budget" tier — matching that,
//    not the full/lod tier, since this is a static background prop).
//  - `equipment_cheese_maker`: `machines.ts`'s `buildProcessMachine("cheese")`.
// None of these three require `EXT_meshopt_compression` (confirmed via
// `gltf-transform inspect`: `extensionsRequired: none`), so they load as-is,
// unlike `OWNER_MODEL_ROOT`'s owner GLBs.
const ENVIRONMENT_MODEL_ROOT = "/models/market/environment";
// Real machine GLBs `machines.ts` loads via `attachModel("delivered", ...)`
// for the flour mill / bread oven / juice machine (`delivered/mill.glb`,
// `oven.glb`, `juicer.glb`). Every one requires `EXT_meshopt_compression`
// (PlayCanvas's GLB parser doesn't implement it — same problem
// `OWNER_MODEL_ROOT`'s doc comment describes) AND `KHR_mesh_quantization`
// (not referenced anywhere in this engine build's own source, unlike
// `EXT_texture_webp`/`KHR_materials_specular`, which every already-working
// owner GLB requires — dequantizing rather than trusting unconfirmed support
// is the same conservative call `OWNER_MODEL_ROOT` made), so both are
// stripped with:
//   npx gltf-transform copy delivered/<file>.glb playcanvas-production/<file>.glb
//   npx gltf-transform dequantize playcanvas-production/<file>.glb playcanvas-production/<file>.glb
// Regenerate the same way if the source `delivered` assets change. This does
// not touch any file `/`, `/play2` or `/runtime` reads.
const PRODUCTION_MODEL_ROOT = "/models/market/playcanvas-production";
// Mirrors `CrowdSystems.ts`'s `HAT_FIT_SCALE` (copied verbatim — that module
// pulls in Three.js).
const HAT_FIT_SCALE: Record<CharacterId, number> = { "adult-man": 0.49, "adult-woman": 0.49, boy: 0.64, girl: 0.68 };
// Mirrors `PlayerActor.ts`'s `HAIR_FIT` (copied verbatim, same reason).
const HAIR_FIT: Record<CharacterId, { scale: [number, number, number]; position: [number, number, number] }> = {
  "adult-man": { scale: [0.38, 0.43, 0.39], position: [0, 0, 0.028] },
  "adult-woman": { scale: [0.38, 0.43, 0.39], position: [0, 0, 0.028] },
  boy: { scale: [0.5, 0.53, 0.5], position: [0, 0, 0.028] },
  girl: { scale: [0.5, 0.53, 0.5], position: [0, 0, 0.028] },
};

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
  private playerCharacterAsset: pc.Asset | null = null;
  private playerCharacterEntity: pc.Entity | null = null;
  private playerAnimEntity: pc.Entity | null = null;
  private playerCapsule: pc.Entity | null = null;
  private playerHatEntity: pc.Entity | null = null;
  private playerHairEntity: pc.Entity | null = null;
  private playerAnimTarget: PlayerAnimClip = "Idle";
  private readonly playerAnimAvailable = new Set<PlayerAnimClip>();
  // Real per-body root scale (`characterSceneScale(body) * OWNER_BODY_SCALE[body]`,
  // deliberately excluding `WORLD_SCALE` — see `loadPlayerCharacter()`'s
  // assignment) used to convert the walk clip's authored floor speed into the
  // same "layout units × STORE_LAYOUT_SCALE" space `this.velocity` is in,
  // exactly like `PlayerActor.ts`'s own `rootScale`/`walkFloor`.
  private playerAnimRootScale = 1;
  private playerAnimMoving = false;
  private playerAnimRunning = false;
  private physics: PlayerPhysicsHandle | null = null;
  private readonly playerPosition = { x: PLAYER_START[0], z: PLAYER_START[2] };
  private readonly velocity = { x: 0, y: 0 };
  private yaw = Math.PI;
  private angularVelocity = 0;
  private motion: PlayerMotionConfig = playerMotionForTier(0, false);
  private physicsAccumulator = 0;
  private readonly keysDown = new Set<string>();

  // ---- interaction zones (phase 6) ----
  // Rebuilt (`rebuildInteractionZones()`) only when the real zone-determining
  // state changes — checkoutLevel/unlockedAreas/active crop ids/available
  // purchase ids — exactly like `ClientRuntime.syncStatic()`'s own
  // `zoneSignature` dirty-check, so a fresh `InteractionDirector` (which
  // starts every zone's dwell/cooldown timers from zero) is never created on
  // an unrelated prop update (crowd movement, door progress, ...).
  private director = new InteractionDirector([]);
  private readonly workstation = new WorkstationController();
  private zoneSignature = "";
  private unreportedDistance = 0;
  private currentZoneConfigs: InteractionZoneConfig[] = [];
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

  // ---- world tick driver (mirrors ClientRuntime.tick's fixed 200ms accumulator) ----
  private tickAccumulatorMs = 0;
  private lastFrameMs = 0;

  // ---- crowd (customers + employees) ----
  // A pooled, unskinned capsule per live actor (real count/position, no GPU
  // per-texture skinning à la CrowdSystems.ts — see the phase 3 report for
  // why a simplified approach was chosen for this phase). Keyed by real id
  // so an entity is only created/destroyed when an actor actually
  // spawns/despawns; every other update just moves the existing capsule.
  private crowdRoot: pc.Entity | null = null;
  private readonly customerEntities = new Map<string, pc.Entity>();
  private readonly employeeEntities = new Map<string, pc.Entity>();

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
    this.buildFurniture(worldRoot, this.props.unlockedAreas, this.props.crops);

    // Player entity lives directly under app.root, at world scale, exactly
    // like production's own RigidBody (`worldStart = PLAYER_START * WORLD_SCALE`).
    this.buildPlayerVisual();
    void this.initPlayerPhysics();
    this.rebuildInteractionZones(this.props);

    this.crowdRoot = new pc.Entity("perf:crowd");
    this.app.root.addChild(this.crowdRoot);
    this.syncCrowd(this.props.customers, this.props.employees);

    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("keyup", this.keyupHandler);

    // Real world-tick driver: mirrors ClientRuntime.tick's fixed 200ms
    // accumulator, driven from this engine's own render loop instead of a
    // setInterval/setTimeout, so simulation cadence matches production
    // exactly regardless of frame rate. Who owns the tick (this loop vs.
    // `GameRuntime`'s own `setInterval`) is decided synchronously by
    // `GameShell`'s `useLayoutEffect`, before any component's mount effect
    // runs — setting it again here, from this constructor, used to race that
    // same decision on `/runtime`'s plain-three client (`ClientRuntime`,
    // fixed 2026-09-27) and would race it here too, since this constructor
    // still only runs once `PlayCanvasCanvas` mounts, after `GameRuntime`'s
    // own mount effect has already fired.
    this.lastFrameMs = performance.now();

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
    if (unlockedChanged) this.physics?.setUnlockedAreas(nextProps.unlockedAreas);
    this.rebuildInteractionZones(nextProps);
    const worldRoot = this.app.root.findByName("world-scale-root") as pc.Entity | null;
    // buildFurniture() itself dirty-checks the combined unlockedAreas+crops
    // signature and no-ops when nothing relevant changed, so it is safe to
    // call on every prop update (crops advance every world tick).
    if (worldRoot) this.buildFurniture(worldRoot, nextProps.unlockedAreas, nextProps.crops);
    this.syncCrowd(nextProps.customers, nextProps.employees);
  }

  /** Rebuilds the real `InteractionDirector` (`interactionZoneConfigsPure`'s
   * engine-agnostic re-derivation of `interactionZoneConfigs()`) whenever
   * checkoutLevel/unlockedAreas/active crop ids/available purchase ids
   * actually change — the same signature-dirty-check
   * `ClientRuntime.syncStatic()`'s `zoneSignature` uses, so a brand-new
   * director (which resets every zone's dwell/cooldown state) is never
   * constructed on an unrelated prop tick. */
  private rebuildInteractionZones(props: PlayCanvasSceneProps) {
    const activeCropIds = props.crops.filter((crop) => crop.status !== "LOCKED").map((crop) => crop.id);
    const signature = `${props.checkoutLevel}|${props.unlockedAreas.join(",")}|${activeCropIds.join(",")}|${props.availablePurchaseIds.join(",")}`;
    if (signature === this.zoneSignature) return;
    this.zoneSignature = signature;
    this.currentZoneConfigs = interactionZoneConfigs(props.checkoutLevel, props.unlockedAreas, activeCropIds, props.availablePurchaseIds);
    this.director = new InteractionDirector(this.currentZoneConfigs);
  }

  /** Real customer/employee count and position from `franchise.customers`/
   * `franchise.employees`, pooled by id so a capsule is created once per
   * live actor and just repositioned on every later update — the same
   * "cheap position sync, no rebuild" rule `kitFurniture.ts`'s own
   * per-fixture `update()` calls follow. */
  private syncCrowd(customers: PlayCanvasSceneProps["customers"], employees: PlayCanvasSceneProps["employees"]) {
    if (!this.crowdRoot) return;
    this.syncCrowdGroup(this.customerEntities, customers, "#c97b52");
    this.syncCrowdGroup(this.employeeEntities, employees, "#4f8f6b");
  }

  private syncCrowdGroup(pool: Map<string, pc.Entity>, actors: Array<{ id: string; x: number; z: number }>, color: string) {
    const seen = new Set<string>();
    for (const actor of actors) {
      seen.add(actor.id);
      let entity = pool.get(actor.id);
      if (!entity) {
        entity = this.buildCrowdCapsule(color);
        this.crowdRoot!.addChild(entity);
        pool.set(actor.id, entity);
      }
      const [x, z] = scaleStorePoint([actor.x, actor.z]);
      entity.setLocalPosition(x * WORLD_SCALE, 0, z * WORLD_SCALE);
    }
    for (const [id, entity] of pool) {
      if (seen.has(id)) continue;
      entity.destroy();
      pool.delete(id);
    }
  }

  private buildCrowdCapsule(color: string): pc.Entity {
    // Same simplified-capsule treatment as the player placeholder (real
    // capsule collider proportions from PlayerPhysics.ts, scaled to
    // PlayCanvas's default capsule primitive), one size down so customers/
    // employees read as distinct from the owner at a glance.
    const root = new pc.Entity("crowd-actor");
    const body = new pc.Entity("body");
    body.addComponent("render", { type: "capsule", material: this.material(color) });
    body.setLocalScale(0.42, 0.62, 0.42);
    body.setLocalPosition(0, 0.62 * WORLD_SCALE, 0);
    root.addChild(body);
    return root;
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
    // Capsule placeholder, shown until the real GLB (`loadPlayerCharacter`)
    // finishes loading — matches real capsule collider dimensions
    // (halfHeight 0.45, radius 0.24 — `PlayerPhysics.ts`'s
    // `ColliderDesc.capsule(0.45, 0.24)`), scaled to PlayCanvas's default
    // capsule primitive (height 2, radius 0.5).
    const capsule = new pc.Entity("player-capsule");
    capsule.addComponent("render", { type: "capsule", material: this.material("#3f6f9a") });
    capsule.setLocalScale(0.48, 0.69, 0.48);
    capsule.setLocalPosition(0, 0.69 * WORLD_SCALE, 0);
    this.playerCapsule = capsule;
    const root = new pc.Entity("perf:player");
    root.addChild(capsule);
    root.setLocalPosition(PLAYER_START[0] * WORLD_SCALE, 0, PLAYER_START[2] * WORLD_SCALE);
    this.app.root.addChild(root);
    this.playerEntity = root;
    void this.loadPlayerCharacter(this.props.avatarBody);
  }

  /**
   * Loads the real rigged/animated owner GLB (see `OWNER_MODEL_ROOT`'s doc
   * comment for why this is a different tier than `budgetPath`'s crowd
   * assets), instantiates it as a real render+anim entity under the player
   * root, and removes the capsule placeholder. Ported from `PlayerActor.ts`'s
   * `load()` METHOD (load the body GLB, size it with
   * `characterSceneScale() * BODY_SCALE[body]`) — not its GPU-instanced
   * baked-texture skinning (that pipeline is built for hundreds of crowd
   * actors sharing one draw call; a single player entity uses PlayCanvas's
   * own native `anim` component directly on the glTF-embedded clips instead,
   * which is the natural equivalent for a non-instanced entity in this
   * engine). Idle/Walk clip switching by presented speed is wired in
   * `updatePlayerAnimation()`; every other named clip (Run, checkout/farm
   * work poses, ...) is deferred — see the phase 4 report.
   */
  private async loadPlayerCharacter(body: CharacterId) {
    const key = OWNER_BODY_KEY[body];
    const url = `${OWNER_MODEL_ROOT}/${key}.glb`;
    const asset = new pc.Asset(`player-character:${key}`, "container", { url, filename: `${key}.glb` });
    this.app.assets.add(asset);
    const loaded = await new Promise<boolean>((resolve) => {
      asset.once("load", () => resolve(true));
      asset.once("error", (message: string) => {
        console.error(`[playcanvas] failed to load player character ${url}: ${message}`);
        resolve(false);
      });
      this.app.assets.load(asset);
    });
    if (this.disposed || !loaded || !this.playerEntity) return;
    this.playerCharacterAsset = asset;
    // `ContainerResource`'s public .d.ts omits `.animations` (the real GLB
    // parser — `GlbContainerResource` — does expose it, as an `Asset[]`
    // wrapping each embedded `AnimTrack`; see
    // `node_modules/playcanvas/build/playcanvas.dbg.mjs`'s
    // `glb-container-resource.js`).
    const resource = asset.resource as pc.ContainerResource & { animations: pc.Asset[] };
    const characterEntity = resource.instantiateRenderEntity();
    characterEntity.addComponent("anim", { activate: true, speed: 1 });
    // Same "layout units × STORE_LAYOUT_SCALE" root as every other body in
    // this file — this entity sits directly under `playerEntity`, which
    // already carries `PLAYER_START * WORLD_SCALE` as an explicit literal
    // (not a parent scale), so WORLD_SCALE has to be baked into this child's
    // own scale too, exactly like the capsule placeholder's dimensions were.
    const bodyRootScale = characterSceneScale(body) * OWNER_BODY_SCALE[body];
    const rootScale = bodyRootScale * WORLD_SCALE;
    characterEntity.setLocalScale(rootScale, rootScale, rootScale);
    this.playerEntity.addChild(characterEntity);
    this.playerAnimEntity = characterEntity;
    this.playerAnimRootScale = bodyRootScale;

    const animAssets = resource.animations;
    const findClip = (name: string) => animAssets.find((clipAsset) => (clipAsset.resource as pc.AnimTrack | undefined)?.name === name)?.resource as pc.AnimTrack | undefined;
    const idle = findClip("Idle");
    const walk = findClip("Walk");
    const run = findClip("Run");
    const scanItem = findClip("ScanItem");
    const pickupLow = findClip("PickupLow");
    const anim = characterEntity.anim;
    this.playerAnimAvailable.clear();
    if (anim && idle) {
      const states: Array<{ name: string; speed?: number; loop?: boolean }> = [{ name: "START" }, { name: "Idle", speed: 1, loop: true }];
      this.playerAnimAvailable.add("Idle");
      if (walk) { states.push({ name: "Walk", speed: 1, loop: true }); this.playerAnimAvailable.add("Walk"); }
      if (run) { states.push({ name: "Run", speed: 1, loop: true }); this.playerAnimAvailable.add("Run"); }
      if (scanItem) { states.push({ name: "ScanItem", speed: 1, loop: true }); this.playerAnimAvailable.add("ScanItem"); }
      if (pickupLow) { states.push({ name: "PickupLow", speed: 1, loop: true }); this.playerAnimAvailable.add("PickupLow"); }
      anim.loadStateGraph({
        layers: [{ name: "locomotion", states, transitions: [{ from: "START", to: "Idle" }] }],
        parameters: {},
      });
      anim.assignAnimation("Idle", idle, "locomotion");
      if (walk) anim.assignAnimation("Walk", walk, "locomotion");
      if (run) anim.assignAnimation("Run", run, "locomotion");
      if (scanItem) anim.assignAnimation("ScanItem", scanItem, "locomotion");
      if (pickupLow) anim.assignAnimation("PickupLow", pickupLow, "locomotion");
    }

    if (this.playerCapsule) {
      this.playerCapsule.destroy();
      this.playerCapsule = null;
    }

    void this.loadPlayerAccessories(characterEntity, body, this.props.avatarHair, this.props.avatarHairColor, this.props.avatarHat);
  }

  /**
   * Real hair (GLB + `hairColor` tint) and hat (GLB) accessories, ported from
   * `PlayerActor.ts`'s `load()` — same real assets (converted for PlayCanvas,
   * see `ACCESSORY_ROOT`'s doc comment), same "hair shows only without a
   * hat" rule, same per-body fit constants. Parented directly to the real
   * `Head` bone entity in the glTF-embedded skeleton (confirmed present in
   * every owner GLB) instead of Three's per-frame socket-matrix push — an
   * entity reparented under a skinned bone follows its animated transform
   * automatically in PlayCanvas, so this needs no per-frame code at all.
   * Loaded once from the initial avatar (like the body itself — `update()`
   * does not yet hot-swap the body/accessories if the avatar changes
   * mid-session; see the report).
   */
  private async loadPlayerAccessories(characterEntity: pc.Entity, body: CharacterId, hair: HairId, hairColor: string, hat: AvatarHatId) {
    const headBone = characterEntity.findByName("Head") as pc.Entity | null;
    if (!headBone) return;
    if (hat !== "none") {
      const hatEntity = await this.loadAccessoryEntity(`${ACCESSORY_ROOT}/hats/${body}/${hat}.glb`, `player-hat:${hat}`);
      if (this.disposed || !hatEntity) return;
      const scale = HAT_FIT_SCALE[body];
      hatEntity.setLocalScale(scale, scale, scale);
      hatEntity.setLocalPosition(0, 0, 0);
      headBone.addChild(hatEntity);
      this.playerHatEntity = hatEntity;
    } else {
      const hairEntity = await this.loadAccessoryEntity(`${ACCESSORY_ROOT}/hair/${body}/${hair}.glb`, `player-hair:${hair}`);
      if (this.disposed || !hairEntity) return;
      const fit = HAIR_FIT[body];
      hairEntity.setLocalScale(fit.scale[0], fit.scale[1], fit.scale[2]);
      hairEntity.setLocalPosition(fit.position[0], fit.position[1], fit.position[2]);
      this.tintRenderEntity(hairEntity, hairColor);
      headBone.addChild(hairEntity);
      this.playerHairEntity = hairEntity;
    }
  }

  /** Loads a small static (unskinned) accessory GLB and returns its
   * instantiated render entity, or `null` on failure (missing/unsupported
   * asset — never fatal to the rest of the scene). */
  private async loadAccessoryEntity(url: string, assetName: string): Promise<pc.Entity | null> {
    const asset = new pc.Asset(assetName, "container", { url, filename: `${assetName}.glb` });
    this.app.assets.add(asset);
    const loaded = await new Promise<boolean>((resolve) => {
      asset.once("load", () => resolve(true));
      asset.once("error", (message: string) => {
        console.error(`[playcanvas] failed to load accessory ${url}: ${message}`);
        resolve(false);
      });
      this.app.assets.load(asset);
    });
    if (this.disposed || !loaded) return null;
    const resource = asset.resource as pc.ContainerResource;
    return resource.instantiateRenderEntity();
  }

  /** Attaches a real static fixture GLB under `parent` at local origin,
   * scaled by `scale` (`STORE_ELEMENT_SCALE`, matching `makeStoreElement()`'s
   * own uniform scale in `/runtime` — see `ENVIRONMENT_MODEL_ROOT`'s doc
   * comment for why this file's own `element` entities don't carry that
   * scale themselves the way `/runtime`'s groups do). Fire-and-forget (like
   * `attachModel()`/`loadEnvironmentProp()` in `/runtime`'s own WorldKit): an
   * immediately-returned empty anchor entity that fills in once the GLB
   * loads, guarded against a furniture rebuild (`buildFurniture()`'s
   * destroy-and-recreate on a real state-signature change) or dispose()
   * racing ahead of the load — `ownerGroup` is the `furnitureGroup` this
   * fixture belongs to at call time; if that's since been replaced, the
   * loaded entity is simply dropped instead of attached to a torn-down tree. */
  private attachFixtureModel(parent: pc.Entity, ownerGroup: pc.Entity, url: string, assetName: string, scale: number): pc.Entity {
    const anchor = new pc.Entity(assetName);
    anchor.setLocalScale(scale, scale, scale);
    parent.addChild(anchor);
    void this.loadAccessoryEntity(url, assetName).then((entity) => {
      if (this.disposed || this.furnitureGroup !== ownerGroup || !entity) return;
      anchor.addChild(entity);
    });
    return anchor;
  }

  /** Tints every render mesh's diffuse colour — mirrors `PlayerActor.ts`'s
   * hair tint, which clones and recolors every part of the accessory
   * uniformly (both the "Hair" and "HairScalp" materials in the real asset),
   * not just a material named "Hair". */
  private tintRenderEntity(entity: pc.Entity, hex: string) {
    const color = hexToColor(hex);
    for (const render of entity.findComponents("render") as pc.RenderComponent[]) {
      for (const meshInstance of render.meshInstances) {
        const material = meshInstance.material as pc.StandardMaterial;
        material.diffuse = color;
        material.update();
      }
    }
  }

  /** Real Idle/Walk/Run selection — same hysteresis thresholds and floor-speed
   * ratio `LocomotionController.select()` uses in `PlayerActor.ts`'s own
   * `present()` (see `LOCOMOTION_MOVING_START`'s doc comment for why the
   * logic is copied rather than imported), with carrying always `false` (this
   * port tracks no carry state) — so this never selects a Carry* clip, only
   * plain Idle/Walk/Run. */
  private selectLocomotionClip(speed: number): PlayerAnimClip {
    this.playerAnimMoving = this.playerAnimMoving ? speed >= LOCOMOTION_MOVING_STOP : speed > LOCOMOTION_MOVING_START;
    if (!this.playerAnimMoving) return "Idle";
    const floor = Math.max(1e-5, LOCOMOTION_WALK_NATURAL_SPEED * this.playerAnimRootScale);
    this.playerAnimRunning = this.playerAnimRunning
      ? speed >= LOCOMOTION_RUN_GAIT_RATIO.stop * floor
      : speed > LOCOMOTION_RUN_GAIT_RATIO.start * floor;
    return this.playerAnimRunning ? "Run" : "Walk";
  }

  /** Switches the real character's Idle/Walk/Run/work-pose state. While
   * `WorkstationController` reports the player locked onto a real
   * movement-locking workstation (checkout or a farm animal station), plays
   * the same real work pose `PlayerActor.ts`'s `WORKSTATION_CLIP` table maps
   * for that id (see `PLAYER_WORKSTATION_CLIP`'s doc comment); otherwise
   * falls back to real speed-based locomotion. Skips to "Idle" for any target
   * clip this body's GLB didn't actually have (defensive — every current
   * owner GLB has every clip this file uses). No-ops until the GLB/anim graph
   * is ready. */
  private updatePlayerAnimation(presentedSpeed: number) {
    const anim = this.playerAnimEntity?.anim;
    const layer = anim?.baseLayer;
    if (!anim || !layer) return;
    const workstationId = this.workstation.performingZoneId();
    let target: PlayerAnimClip = workstationId ? (PLAYER_WORKSTATION_CLIP[workstationId] ?? "Idle") : this.selectLocomotionClip(presentedSpeed);
    if (!this.playerAnimAvailable.has(target)) target = "Idle";
    if (target !== this.playerAnimTarget && this.playerAnimAvailable.has(target)) {
      this.playerAnimTarget = target;
      layer.transition(target, WALK_TRANSITION_SECONDS);
    }
  }

  /** Single render loop tick. */
  private onUpdate(dt: number) {
    this.stepWorldTick();
    this.stepPlayer(dt, performance.now());
    this.stepDoors(dt);
    this.updateCamera();
  }

  /** Fixed 200ms world-tick steps, driven off wall-clock time exactly like
   * `ClientRuntime.tick` (never off PlayCanvas's own possibly-clamped `dt`),
   * so the pure simulation in `src/game/engine.ts`/`store.ts` advances on
   * the same real cadence production uses. Capped at 3 steps/frame with the
   * same catch-up-then-drop-the-rest behavior as the reference. */
  private stepWorldTick() {
    const now = performance.now();
    this.tickAccumulatorMs += now - this.lastFrameMs;
    this.lastFrameMs = now;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    let steps = 0;
    while (this.tickAccumulatorMs >= WORLD_TICK_INTERVAL_MS && steps < 3) {
      this.tickAccumulatorMs -= WORLD_TICK_INTERVAL_MS;
      steps += 1;
      useMarketStore.getState().tickWorld(WORLD_TICK_INTERVAL_MS);
    }
    if (this.tickAccumulatorMs > WORLD_TICK_INTERVAL_MS * 3) this.tickAccumulatorMs = 0;
  }

  private stepPlayer(dt: number, nowMs: number) {
    if (!this.physics || !this.playerEntity) return;
    this.physicsAccumulator = Math.min(0.25, this.physicsAccumulator + dt);
    while (this.physicsAccumulator >= PHYSICS_STEP_SECONDS) {
      this.physicsAccumulator -= PHYSICS_STEP_SECONDS;
      this.fixedStepPlayer(PHYSICS_STEP_SECONDS, nowMs);
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
    this.updatePlayerAnimation(speed);
  }

  private fixedStepPlayer(step: number, nowMs: number) {
    if (!this.physics) return;
    const gamepad = typeof navigator !== "undefined" ? navigator.getGamepads?.()[0] : null;
    if (gamepad) inputManager.setGamepad(gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0);
    const input = inputManager.sample();
    // Same "entering a workstation consumes the movement that brought you
    // there" rule `PlayerActor.ts`'s `fixedStep()` applies: while locked onto
    // a movement-locking workstation (checkout — not shelf/production/farm,
    // see `WorkstationController`'s doc comment), input is zeroed for
    // locomotion until the player releases and re-presses a deliberate move.
    const workLocked = this.workstation.updateInput(input.magnitude);
    const intention = workLocked ? { x: 0, y: 0 } : cameraRelativeMovement(input, { x: -OVERVIEW_CAMERA_OFFSET.x, y: -OVERVIEW_CAMERA_OFFSET.z });
    const next = workLocked ? { x: 0, y: 0 } : moveVelocity(this.velocity, intention, step, this.motion);
    this.velocity.x = next.x;
    this.velocity.y = next.y;
    const dx = this.velocity.x * step;
    const dz = this.velocity.y * step;
    this.physics.updateDoors(this.storefrontProgress, this.rearMotion.progress);
    const movement = this.physics.resolveMovement(dx, dz);
    this.playerPosition.x += movement.x;
    this.playerPosition.z += movement.z;

    // Real distance reporting — `PlayerActor.ts`'s own calibration: layout-
    // scale units (`hypot(movement)`), never divided by STORE_LAYOUT_SCALE
    // (this.playerPosition is already in "layout units × STORE_LAYOUT_SCALE"
    // space, the same space `interactionZoneConfigs()` bakes into every
    // zone's x/z).
    const travelled = Math.hypot(movement.x, movement.z);
    this.unreportedDistance += travelled;
    if (this.unreportedDistance >= 1) {
      const meters = this.unreportedDistance;
      this.unreportedDistance = 0;
      this.props.onDistance(meters);
    }

    // Real interaction-zone detection: same coordinate space, same director,
    // same dispatch rules as `PlayerActor.ts`'s `fixedStep()` (door presence,
    // the orders counter's "only while stopped" rule, and movement-locking
    // workstations only firing once `WorkstationController` confirms the
    // player has actually settled onto that zone).
    const events = this.director.update("player", this.playerPosition.x, this.playerPosition.z, nowMs);
    const selected = this.director.selectedZoneIds();
    const activeWorkstation = WORKSTATION_IDS.find((id) => id !== "shelf" && !isProductionWorkstationId(id) && selected.includes(id)) ?? null;
    this.workstation.sync(activeWorkstation, input.magnitude);
    for (const event of events) {
      if (event.zone.id === "door" && (event.signal === "enter" || event.signal === "exit")) this.props.onDoorPresence(event.signal === "enter");
      if (event.zone.id === "orders" && input.magnitude > 0.05) continue;
      const locksMovement = isWorkstationId(event.zone.id) && event.zone.id !== "shelf" && !isProductionWorkstationId(event.zone.id);
      if (event.signal === "tick" && (!locksMovement || this.workstation.canPerform(event.zone.id))) this.props.onInteract(event.zone.id);
    }
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

  /** QA/debug-only accessor: the player's real position in the same "layout
   * units × STORE_LAYOUT_SCALE" space `interactionZoneConfigs()` uses — lets
   * headless verification confirm real keyboard-driven movement (not
   * teleporting) reaches a real interaction zone. Exposed on
   * `window.__MARKET_PC_RUNTIME__` by `PlayCanvasCanvas.tsx`. */
  getPlayerPosition() {
    return { x: this.playerPosition.x, z: this.playerPosition.z };
  }

  /** QA/debug-only accessor: every currently-active real interaction zone's
   * id/position/radius/footprint (the same list `InteractionDirector` was
   * constructed from), so headless verification can steer the player to a
   * real zone's exact coordinates instead of guessing. `halfExtents` is
   * included because several real zones (stocking magnets, production
   * machines, ...) are fixture-footprint boxes, not points — a zone's real
   * activation rule (`interactionZonePlanarDistance()` in
   * `InteractionZone.ts`) measures `enterRadius` outward from that box's
   * surface, not from `x`/`z`, so a walker that only knew the center could
   * aim at a point inside the solid fixture and never arrive. */
  getInteractionZones() {
    return this.currentZoneConfigs.map((zone) => ({ id: zone.id, x: zone.x, z: zone.z, enterRadius: zone.enterRadius, halfExtents: zone.halfExtents ?? null }));
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
    // The tick-driver flag itself is owned by `GameShell`'s `useLayoutEffect`
    // (its lifetime matches the route, not this instance's) — nothing to
    // reset here.
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
   * Also builds checkout lanes, production machines, always-on service
   * fixtures and the farm estate (see the three private methods below) —
   * stock-level/machine-status/transaction detail on top of these box
   * volumes is deferred (see the report).
   */
  private buildFurniture(worldRoot: pc.Entity, unlockedAreas: string[], crops: Array<{ id: string; status: string }>) {
    const signature = `${unlockedAreas.slice().sort().join("|")}::${crops.map((crop) => `${crop.id}:${crop.status}`).join(",")}`;
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

    this.buildCheckoutLanes(group, unlockedAreas);
    this.buildProductionMachines(group, unlockedAreas);
    this.buildServiceFixtures(group);
    this.buildFarmEstate(group, unlockedAreas, crops);
  }

  /** Box-volume port of `kitFurniture.ts`'s checkout loop (real counter/
   * cashier positions from `CHECKOUT_LANES`, real per-lane gating via
   * `checkoutAreaForLane`, real closed-lane fallback while the campaign is
   * unlocked but that lane isn't yet). Transaction/handoff visuals (the
   * belt items, cashier animation) are deferred — see the phase 3 report. */
  private buildCheckoutLanes(parent: pc.Entity, unlockedAreas: string[]) {
    for (const lane of CHECKOUT_LANE_IDS as readonly CheckoutLane[]) {
      const open = lane === 0 || unlockedAreas.includes(checkoutAreaForLane(lane));
      const layout = CHECKOUT_LANES[lane];
      const counter = new pc.Entity(`checkout-counter-${lane}`);
      const counterScaled = scaleStorePosition([...layout.counter] as [number, number, number]);
      counter.setLocalPosition(counterScaled[0], counterScaled[1], counterScaled[2]);
      parent.addChild(counter);
      const body = new pc.Entity("body");
      body.addComponent("render", { type: "box", material: this.material(open ? "#d8d2c2" : "#8a8478") });
      body.setLocalScale(1.05 * STORE_ELEMENT_SCALE, 0.92 * STORE_ELEMENT_SCALE, 0.55 * STORE_ELEMENT_SCALE);
      body.setLocalPosition(0, 0.46 * STORE_ELEMENT_SCALE, 0);
      counter.addChild(body);
      const belt = new pc.Entity("belt");
      belt.addComponent("render", { type: "box", material: this.material(open ? "#3f4a44" : "#5a564d") });
      belt.setLocalScale(0.85 * STORE_ELEMENT_SCALE, 0.06 * STORE_ELEMENT_SCALE, 0.42 * STORE_ELEMENT_SCALE);
      belt.setLocalPosition(0, 0.95 * STORE_ELEMENT_SCALE, 0);
      counter.addChild(belt);
      if (!open) continue;
      const cashierScaled = scaleStorePosition([...layout.cashierWork] as [number, number, number]);
      const cashierSpot = new pc.Entity(`checkout-cashier-${lane}`);
      cashierSpot.setLocalPosition(cashierScaled[0], cashierScaled[1], cashierScaled[2]);
      parent.addChild(cashierSpot);
      const mat = new pc.Entity("mat");
      mat.addComponent("render", { type: "box", material: this.material("#4b6f5f") });
      mat.setLocalScale(0.5 * STORE_ELEMENT_SCALE, 0.03 * STORE_ELEMENT_SCALE, 0.5 * STORE_ELEMENT_SCALE);
      cashierSpot.addChild(mat);
    }
  }

  /** Port of `kitFurniture.ts`'s production machines (real positions from
   * `STORE_PRODUCTION_FIXTURES`, real per-machine gating via
   * `fixtureAvailable(fixture.obstacleId, unlockedAreas)`). Four of the five
   * fixtures now load the same real static GLB `machines.ts`'s
   * `buildBakeryKit()`/`buildMillMachine()`/`buildProcessMachine()` attach for
   * that exact machine (see `PRODUCTION_MODEL_ROOT`/`ENVIRONMENT_MODEL_ROOT`'s
   * doc comments); the corn canner stays a box volume because `machines.ts`'s
   * own `buildCornCanner()` is built entirely from primitives too — there is
   * no real canner GLB to port. Machine status/queue text overlays (the
   * illuminated board `buildMachineIdentity()` draws) are still deferred. */
  private buildProductionMachines(parent: pc.Entity, unlockedAreas: string[]) {
    if (fixtureAvailable("fixture:production-cubicle-shell", unlockedAreas)) {
      const shell = new pc.Entity("production-cubicle-shell");
      const scaled = scaleStorePosition([-9, 0, -5.9]);
      shell.setLocalPosition(scaled[0], scaled[1], scaled[2]);
      parent.addChild(shell);
      const floor = new pc.Entity("floor");
      floor.addComponent("render", { type: "box", material: this.material("#c7bfa9") });
      floor.setLocalScale(5 * STORE_ELEMENT_SCALE, 0.04 * STORE_ELEMENT_SCALE, 5.3 * STORE_ELEMENT_SCALE);
      floor.setLocalPosition(0, 0.02 * STORE_ELEMENT_SCALE, 0);
      shell.addChild(floor);
    }
    // Mirrors `machines.ts`'s own real per-machine model + vertical offset
    // (`attachModel("delivered", "mill"|"oven"|"juicer", [0, 0.175, centerZ])`
    // / `attachModel("environment", "equipment_cheese_maker", [0, 0, 0])`).
    const MODEL_BY_WORKSTATION: Partial<Record<string, { root: string; file: string; y: number }>> = {
      mill: { root: PRODUCTION_MODEL_ROOT, file: "mill", y: 0.175 },
      bakery: { root: PRODUCTION_MODEL_ROOT, file: "oven", y: 0.175 },
      juice: { root: PRODUCTION_MODEL_ROOT, file: "juicer", y: 0.175 },
      cheese: { root: ENVIRONMENT_MODEL_ROOT, file: "equipment_cheese_maker", y: 0 },
    };
    const ownerGroup = parent;
    for (const id of PRODUCTION_FIXTURE_IDS as ProductionFixtureId[]) {
      const fixture = STORE_PRODUCTION_FIXTURES[id];
      if (!fixtureAvailable(fixture.obstacleId, unlockedAreas)) continue;
      const scaled = scaleStorePosition([...fixture.position] as [number, number, number]);
      const element = new pc.Entity(`fixture:${fixture.obstacleId}`);
      element.setLocalPosition(scaled[0], scaled[1], scaled[2]);
      element.setEulerAngles(0, fixture.yaw ?? 0, 0);
      parent.addChild(element);
      const { halfX, halfZ, centerX, centerZ } = fixture.localFootprint;
      const model = MODEL_BY_WORKSTATION[fixture.workstationId];
      if (model) {
        const anchor = this.attachFixtureModel(element, ownerGroup, `${model.root}/${model.file}.glb`, `fixture-model:${fixture.obstacleId}`, STORE_ELEMENT_SCALE);
        anchor.setLocalPosition(centerX * STORE_ELEMENT_SCALE, model.y * STORE_ELEMENT_SCALE, centerZ * STORE_ELEMENT_SCALE);
        continue;
      }
      const body = new pc.Entity("machine");
      body.addComponent("render", { type: "box", material: this.material(fixture.accent) });
      body.setLocalScale(halfX * 2 * STORE_ELEMENT_SCALE, 1.1 * STORE_ELEMENT_SCALE, halfZ * 2 * STORE_ELEMENT_SCALE);
      body.setLocalPosition(centerX * STORE_ELEMENT_SCALE, 0.55 * STORE_ELEMENT_SCALE, centerZ * STORE_ELEMENT_SCALE);
      element.addChild(body);
    }
  }

  /** Ungated service furniture (`STORE_SERVICE_FIXTURES` + the warehouse
   * return crate) — always present in the base game, box-volume only. */
  private buildServiceFixtures(parent: pc.Entity) {
    for (const [key, color] of [["orders", "#5c7ba0"], ["returns", "#a05c6f"], ["cartBay", "#7d8a5c"]] as const) {
      const fixture = STORE_SERVICE_FIXTURES[key];
      const scaled = scaleStorePosition([...fixture.position] as [number, number, number]);
      const element = new pc.Entity(`fixture:${fixture.obstacleId}`);
      element.setLocalPosition(scaled[0], scaled[1], scaled[2]);
      parent.addChild(element);
      const body = new pc.Entity("body");
      body.addComponent("render", { type: "box", material: this.material(color) });
      body.setLocalScale(fixture.footprint.halfX * 2 * STORE_ELEMENT_SCALE, 1 * STORE_ELEMENT_SCALE, fixture.footprint.halfZ * 2 * STORE_ELEMENT_SCALE);
      body.setLocalPosition(0, 0.5 * STORE_ELEMENT_SCALE, 0);
      element.addChild(body);
    }
    {
      const scaled = scaleStorePosition([...WAREHOUSE_RETURN_STATION.position] as [number, number, number]);
      const element = new pc.Entity(`fixture:${WAREHOUSE_RETURN_STATION.obstacleId}`);
      element.setLocalPosition(scaled[0], scaled[1], scaled[2]);
      parent.addChild(element);
      const body = new pc.Entity("body");
      body.addComponent("render", { type: "box", material: this.material("#6b6153") });
      body.setLocalScale(WAREHOUSE_RETURN_STATION.footprint.halfX * 2 * STORE_ELEMENT_SCALE, 0.9 * STORE_ELEMENT_SCALE, WAREHOUSE_RETURN_STATION.footprint.halfZ * 2 * STORE_ELEMENT_SCALE);
      body.setLocalPosition(0, 0.45 * STORE_ELEMENT_SCALE, 0);
      element.addChild(body);
    }
  }

  /** Box-volume port of `kitFarm.ts`: garden floor, barn, eight crop plots
   * (real position/accent from `FARM_PLOTS`, real per-plot gating from the
   * real `CropState.status`) and the three animal paddocks (real position/
   * footprint from `FARM_ANIMAL_STATIONS`/`FARM_ANIMAL_FOOTPRINTS`, real
   * gating via `fixtureAvailable`). Crop growth stage / animal-station work
   * visuals are deferred (see the report). */
  private buildFarmEstate(parent: pc.Entity, unlockedAreas: string[], crops: Array<{ id: string; status: string }>) {
    const cropsById = new Map(crops.map((crop) => [crop.id, crop]));

    // Garden floor.
    {
      const scaled = scaleStorePosition([...FARM_FIELD.center] as [number, number, number]);
      const floor = new pc.Entity("farm-garden-floor");
      floor.setLocalPosition(scaled[0], scaled[1], scaled[2]);
      parent.addChild(floor);
      const body = new pc.Entity("body");
      body.addComponent("render", { type: "box", material: this.material("#7fa15c") });
      body.setLocalScale(FARM_FIELD.size[0] * STORE_ELEMENT_SCALE, 0.03 * STORE_ELEMENT_SCALE, FARM_FIELD.size[2] * STORE_ELEMENT_SCALE);
      body.setLocalPosition(0, 0.015 * STORE_ELEMENT_SCALE, 0);
      floor.addChild(body);
    }

    // Barn (always present — the intake point, ungated in the source).
    {
      const scaled = scaleStorePosition([...FARM_BARN.position] as [number, number, number]);
      const element = new pc.Entity(`fixture:${FARM_BARN.obstacleId}`);
      element.setLocalPosition(scaled[0], scaled[1], scaled[2]);
      parent.addChild(element);
      const body = new pc.Entity("body");
      body.addComponent("render", { type: "box", material: this.material("#8a5a3a") });
      body.setLocalScale(FARM_BARN.footprint.halfX * 2 * STORE_ELEMENT_SCALE, 1.9 * STORE_ELEMENT_SCALE, FARM_BARN.footprint.halfZ * 2 * STORE_ELEMENT_SCALE);
      body.setLocalPosition(0, 0.95 * STORE_ELEMENT_SCALE, 0);
      element.addChild(body);
      const roof = new pc.Entity("roof");
      roof.addComponent("render", { type: "box", material: this.material("#5a3a28") });
      roof.setLocalScale(FARM_BARN.footprint.halfX * 2.15 * STORE_ELEMENT_SCALE, 0.22 * STORE_ELEMENT_SCALE, FARM_BARN.footprint.halfZ * 2.15 * STORE_ELEMENT_SCALE);
      roof.setLocalPosition(0, 2 * STORE_ELEMENT_SCALE, 0);
      element.addChild(roof);
    }

    // Eight crop plots — gated exactly like `kitFarm.ts`'s `buildFarmPlot.update`.
    for (const plot of FARM_PLOTS as readonly FarmPlotLayout[]) {
      const crop = cropsById.get(plot.id);
      const gated = unlockedAreas.includes("purchase-campaign") && (!crop || crop.status === "LOCKED");
      if (gated) continue;
      const isDormant = !crop || crop.status === "LOCKED";
      const scaled = scaleStorePosition([...plot.position] as [number, number, number]);
      const element = new pc.Entity(`farm-plot:${plot.id}`);
      element.setLocalPosition(scaled[0], scaled[1], scaled[2]);
      parent.addChild(element);
      const bed = new pc.Entity("bed");
      bed.addComponent("render", { type: "box", material: this.material("#5f4530") });
      bed.setLocalScale(1.92 * STORE_ELEMENT_SCALE, 0.16 * STORE_ELEMENT_SCALE, 1.18 * STORE_ELEMENT_SCALE);
      bed.setLocalPosition(0, 0.08 * STORE_ELEMENT_SCALE, 0);
      element.addChild(bed);
      if (!isDormant && crop) {
        const growth = crop.status === "READY" ? 1 : crop.status === "GROWING" ? 0.55 : crop.status === "HARVESTING" ? 0.8 : 0.15;
        const plants = new pc.Entity("plants");
        plants.addComponent("render", { type: "box", material: this.material(plot.accent) });
        plants.setLocalScale(1.55 * STORE_ELEMENT_SCALE, (0.1 + growth * 0.5) * STORE_ELEMENT_SCALE, 0.85 * STORE_ELEMENT_SCALE);
        plants.setLocalPosition(0, (0.16 + (0.1 + growth * 0.5) / 2) * STORE_ELEMENT_SCALE, 0);
        element.addChild(plants);
      }
    }

    // Three animal paddocks — real position/footprint, real gating. The
    // procedural fence stays a box volume (`animalStation.ts`'s own
    // `buildAnimalPaddock()` is primitives too — posts/rails/trough, no GLB);
    // the plain "animal" box is replaced with the real coop/station shell GLB
    // `animalStation.ts`'s `loadEnvironmentProp()` loads for this exact
    // fixture (see `ENVIRONMENT_MODEL_ROOT`'s doc comment). The live skinned
    // chicken/cow character itself (`FarmAnimal`'s `AnimationMixer`) is a
    // separate, still-deferred piece — this only ports the static shell.
    const stations: Array<[keyof typeof FARM_ANIMAL_FOOTPRINTS, readonly [number, number, number], string, string]> = [
      ["chicken", FARM_ANIMAL_STATIONS.chicken.position, "fixture:chicken-coop", "chicken_coop"],
      ["cow", FARM_ANIMAL_STATIONS.cow.position, "fixture:cow-station", "cow_station"],
      ["chicken2", FARM_ANIMAL_STATIONS.chicken2.position, "fixture:chicken-coop-2", "chicken_coop"],
    ];
    const ownerGroup = parent;
    for (const [footprintId, position, obstacleId, glbFile] of stations) {
      if (!fixtureAvailable(obstacleId, unlockedAreas)) continue;
      const footprint = FARM_ANIMAL_FOOTPRINTS[footprintId];
      const scaled = scaleStorePosition([...position] as [number, number, number]);
      const element = new pc.Entity(`fixture:${obstacleId}`);
      element.setLocalPosition(scaled[0], scaled[1], scaled[2]);
      parent.addChild(element);
      const fence = new pc.Entity("fence");
      fence.addComponent("render", { type: "box", material: this.material("#b89a6a", 0.85) });
      fence.setLocalScale(footprint.halfX * 2 * STORE_ELEMENT_SCALE, 0.5 * STORE_ELEMENT_SCALE, footprint.halfZ * 2 * STORE_ELEMENT_SCALE);
      fence.setLocalPosition(0, 0.25 * STORE_ELEMENT_SCALE, 0);
      element.addChild(fence);
      // Sits at the element's own local origin — `animalStation.ts`'s
      // `buildAnimalStation()` adds its coop/station `shell` group with no
      // offset, inside a `group` also positioned at `[0, 0, 0]` relative to
      // the real `makeStoreElement()` anchor this fixture's `element` mirrors.
      this.attachFixtureModel(element, ownerGroup, `${ENVIRONMENT_MODEL_ROOT}/${glbFile}.glb`, `fixture-model:${obstacleId}`, STORE_ELEMENT_SCALE);
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
