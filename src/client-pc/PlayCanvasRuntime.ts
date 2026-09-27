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
import {
  RETAIL_DEPARTMENTS,
  RETAIL_DEPARTMENT_IDS,
  retailFixtureDisplayPositions,
  distributedFixtureQuantity,
  retailStockLandingLocalPosition,
  retailStockFixtureSlot,
  RETAIL_VISUAL_CAPACITY,
  PRODUCT_RETAIL_DEPARTMENT,
  RETAIL_FIXTURE_LEVELS,
  PRODUCE_BIN_COLUMNS,
  PRODUCE_BIN_PITCH,
  PRODUCE_DECK,
  produceDeckLocalPoint,
  type RetailDepartmentId,
} from "@/game/stations/retail-layout";
import { CHECKOUT_LANE_IDS, CHECKOUT_LANES, checkoutAreaForLane, activeCheckoutForLane, checkoutHandoffForLane, checkoutBagLocation, type CheckoutLane } from "@/game/stations/checkout-layout";
import { STORE_PRODUCTION_FIXTURES, PRODUCTION_FIXTURE_IDS, isProductionWorkstationId, type ProductionFixtureId, type ProductionFixtureLayout } from "@/game/stations/production-layout";
import { machineInputCapacity } from "@/game/stations/StationSystem";
import { PRODUCT_CONFIG } from "@/game/economy/products";
import { shelfCapacityForTier } from "@/game/engine";
import { PRODUCTS } from "@/game/catalog";
import { STORE_SERVICE_FIXTURES, type StoreServiceFixture } from "@/game/stations/store-service-layout";
import { WAREHOUSE_RETURN_STATION } from "@/game/stations/warehouse-layout";
import { PURCHASE_MARKER } from "@/game/stations/purchase-marker";
import { PURCHASE_POSITIONS } from "@/game/stations/purchase-layout";
import { REGISTER_INTERACTION_IDS, registerLane, registerPickupPosition, type RegisterInteractionId } from "@/game/stations/register-layout";
import { CASH_BUNDLE_RENDER_CAP, cashBundleCount } from "@/game/economy/cash-bundles";
import { FARM_PLOTS, FARM_BARN, FARM_ANIMAL_STATIONS, FARM_FIELD, FARM_ANIMAL_FOOTPRINTS, farmPlotById, type FarmPlotLayout } from "@/game/stations/farm-layout";
import { animalMotion, type FarmAnimalClip, type FarmAnimalKind } from "@/game/animation/AnimalMotion";
import { isWorkstationId, WORKSTATION_IDS } from "@/game/stations/workstation-layout";
import { InteractionDirector } from "@/game/interaction/InteractionDirector";
import type { InteractionZoneConfig } from "@/game/interaction/InteractionZone";
import { WorkstationController } from "@/game/interaction/WorkstationController";
import { interactionZoneConfigs } from "@/game/interaction/interactionZoneConfigsPure";
import { useMarketStore } from "@/game/store";
import { WORLD_TICK_INTERVAL_MS } from "@/game/core/timing";
import type { AvatarHatId, CharacterId, HairId, ProductId, CheckoutTransaction, ProductionMachineState } from "@/game/types";
import { characterSceneScale } from "@/game/animation/CharacterScale";
import type { OpeningPurchaseId } from "@/game/progression/MartCampaign";

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

/**
 * Simplified per-SKU shelf-stock visual — one dominant primitive per unit
 * (box/sphere/cylinder), sized/colored from the REAL numbers in
 * `/runtime`'s `src/client/WorldKit/retailProducts.ts` (`retailStockParts()`)
 * and `src/client/WorldKit/retail/basketProduct.ts` for the three delivered-
 * GLB SKUs (milk/cheese/eggs, which have no procedural shelf geometry in the
 * source — see that file's own doc comment). Secondary garnish parts (tomato
 * crown, apple stem/leaf, corn husks, bread score marks, can label band,
 * package label) are intentionally dropped: `RETAIL_VISUAL_CAPACITY` reaches
 * up to 75 units for a single SKU (milk/cheese), so multiplying part count
 * per unit would multiply live entity/draw-call count store-wide — a real
 * mobile-perf risk (see `mobile-performance-profile` project memory: the
 * ground alone was 90% of mobile draw cost). One faithful-color, faithful-
 * size, faithful-position primitive per unit is the trade made here; see the
 * phase-11 handoff for restoring full multi-part fidelity behind real GPU
 * instancing if a future pass wants it.
 */
interface RetailProductVisualSpec {
  shape: "box" | "sphere" | "cylinder";
  /** Local scale applied to the unit primitive, pre-STORE_ELEMENT_SCALE
   * (matches every other fixture-child transform in this file — see
   * `buildDepartmentFixture`'s own doc comment). */
  size: [number, number, number];
  color: string;
}

const RETAIL_PRODUCT_VISUAL: Record<ProductId, RetailProductVisualSpec> = {
  oranges: { shape: "sphere", size: [0.18, 0.18, 0.18], color: "#D58236" },
  tomatoes: { shape: "sphere", size: [0.18, 0.1548, 0.18], color: "#d94838" },
  apples: { shape: "sphere", size: [0.1564, 0.17, 0.1564], color: "#bd3432" },
  corn: { shape: "sphere", size: [0.093, 0.183, 0.093], color: "#f0bf36" },
  juice: { shape: "cylinder", size: [0.119, 0.22, 0.119], color: "#ee8643" },
  bread: { shape: "box", size: [0.22, 0.16, 0.15], color: "#b97336" },
  cannedCorn: { shape: "cylinder", size: [0.156, 0.2, 0.156], color: "#b9c3c0" },
  coffee: { shape: "box", size: [0.17, 0.24, 0.12], color: "#6b3d2d" },
  flour: { shape: "box", size: [0.17, 0.24, 0.12], color: "#eee4cc" },
  wheat: { shape: "box", size: [0.17, 0.24, 0.12], color: "#d5ab42" },
  eggs: { shape: "sphere", size: [0.1037, 0.1469, 0.1037], color: "#f5ead1" },
  milk: { shape: "cylinder", size: [0.097, 0.18, 0.097], color: "#f7f3e9" },
  cheese: { shape: "cylinder", size: [0.17, 0.105, 0.17], color: "#efbd3d" },
};

/** Mirrors `retail/stockScreen.ts`'s own `PRODUCTS_LABELS` (copied verbatim
 * — that module also builds a permanent `THREE.Scene`/camera at module scope
 * for its one-shot product-photo render, which this file has no reason to
 * import just for a label string map). */
const STOCK_SCREEN_PRODUCT_LABELS: Record<ProductId, string> = {
  cannedCorn: "MAÍZ EN LATA",
  tomatoes: "TOMATES",
  apples: "MANZANAS",
  oranges: "NARANJAS",
  corn: "MAÍZ",
  eggs: "HUEVOS",
  milk: "LECHE",
  cheese: "QUESO",
  juice: "ZUMOS",
  bread: "PAN",
  flour: "HARINA",
  wheat: "TRIGO",
  coffee: "CAFÉ",
};

// ─── Transfer-effect magnet bursts (phase 12 port of `/runtime`'s
// `src/client/WorldKit/transferEffects/bursts.ts` +
// `transferEffects/productParticle.ts`) ─────────────────────────────────────
// Every stagger, duration, easing curve and per-particle offset/spin number
// below is copied verbatim from that source (`HarvestMagnetBurst`/
// `StockMagnetBurst`/`ReturnMagnetBurst`/`PayMagnetBurst` in the real
// `MarketScene.tsx`), not re-derived. Two intentional, documented
// simplifications from the source's Three.js geometry, both reusing
// approximations this file already makes elsewhere:
//  - Carried product bodies reuse `RETAIL_PRODUCT_VISUAL` (one primitive per
//    unit, already the real per-SKU dimensions — several entries are an exact
//    match to `basketProduct.ts`'s own carried-scale numbers, e.g. eggs'
//    0.1037×0.1469×0.1037 sphere) instead of the source's multi-part carried
//    mesh, the same "one faithful-color/size/position primitive" trade
//    `growRetailStockPool`'s own doc comment documents for shelf stock.
//  - The small tumbling "sparkle" octahedron each unit wears becomes a small
//    diamond-oriented box at the exact same position/rotation/color/opacity —
//    this engine has no octahedron primitive and this file never builds
//    custom vertex-buffer geometry (every render entity in it is box/sphere/
//    cylinder/capsule/plane), so a box is the faithful-parameters substitute.
// `basketWorld` (the flight source/destination for stock/return/pay bursts,
// and the harvest burst's landing point) has no real basket-carry rig in this
// port yet (no PlayCanvas equivalent to `PlayerActor.ts`'s `baskets` prop
// instancer) — `stepTransferBursts()` uses the exact same fallback the real
// source itself falls back to while not holding a basket prop:
// `this.position.x, this.position.y + 1.05, this.position.z` (`PlayerActor.ts`
// line 368), not an invented number.
const MAX_VISUAL_TRANSFER_DELTA = 0.25;
function visualTransferDelta(delta: number): number {
  return Math.min(MAX_VISUAL_TRANSFER_DELTA, Math.max(0, Number.isFinite(delta) ? delta : 0));
}
function clampTransferParticleCount(quantity: number, cap: number): number {
  return Math.min(cap, Math.max(1, Math.floor(quantity)));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

type TransferBurstKind = "harvest" | "stock" | "return" | "pay";

/** Structural subset of `InteractionVisualEvent` (`MarketScene.tsx`) this
 * port's burst renderer reads — see `PlayCanvasSceneProps.transferEvents`'s
 * doc comment for why this is a local type, not an import. `kind` includes
 * the source type's non-transfer `"work"` variant too (structural
 * compatibility with the real `InteractionVisualEvent[]` array `GameShell`
 * passes in unfiltered) even though `spawnTransferBurst` never produces a
 * burst for it. */
export interface TransferVisualEvent {
  sequence: number;
  kind: "work" | TransferBurstKind;
  cropId?: string;
  purchaseId?: OpeningPurchaseId;
  productId?: ProductId;
  quantity?: number;
  shelfStart?: number;
}

/** One flying unit. `sourceX/Y/Z` are only used by stock/return/pay (captured
 * from the live basket anchor the instant the unit's stagger delay elapses,
 * exactly like the source's own `sources[index] ??= basketWorld.clone()`);
 * harvest instead flies FROM a fixed crop-plot source TO the live basket
 * anchor, so it never populates them. `spinA`/`spinB` are the two
 * accumulating rotation channels each burst kind drives (harvest: y then a
 * per-frame-recomputed z; stock/return: x and y; pay: x and z) — kept generic
 * because which Euler axis each represents differs by kind (see
 * `tickTransferBurst`). */
interface TransferParticle {
  entity: pc.Entity;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  sourceX: number | null;
  sourceY: number | null;
  sourceZ: number | null;
  spinA: number;
  spinB: number;
  landed: boolean;
}

interface TransferBurst {
  sequence: number;
  kind: TransferBurstKind;
  group: pc.Entity;
  particles: TransferParticle[];
  particleCount: number;
  elapsed: number;
  publishedRemaining: number;
  /** Harvest-only fixed flight source (the crop plot); unused by the other
   * three kinds, which fly from the live basket anchor instead. */
  sourceX: number;
  sourceY: number;
  sourceZ: number;
}

/** One product's pooled shelf-unit entities for one physical fixture
 * (a department may have several — produce/pantry — each getting its own
 * `distributedFixtureQuantity()` share of `franchise.shelves[productId]`,
 * exactly like `kitFurniture.ts`'s own produce/pantry stock split). Pool
 * grows lazily up to `RETAIL_VISUAL_CAPACITY[productId]` and never shrinks;
 * `stepRetailStock()` just toggles `.enabled` and repositions. */
interface RetailStockActor {
  productId: ProductId;
  fixtureIndex: number;
  fixtureCount: number;
  group: pc.Entity;
  units: pc.Entity[];
  /** Real per-SKU stock-screen readout (port of `stockScreen.ts`'s dynamic
   * `count`/`status` text — see `buildStockScreenFace()`'s own doc comment).
   * Not every actor gets one (produce has no screen, matching the source). */
  screen?: { countText: pc.Entity; statusText: pc.Entity };
}

/** One checkout bag (`buildCheckoutBag()` in `checkout/checkoutKit.ts`):
 * a body box + a static handle box (no torus primitive in PlayCanvas — a box
 * is the same faithful-parameters substitute this file already uses for the
 * corn canner/transfer-burst "sparkle") + a content box shown once the bag
 * has any items. `update()` mirrors the source's fill/position/visibility. */
interface CheckoutBagEntry {
  group: pc.Entity;
  content: pc.Entity;
  update(fill: number, position: [number, number, number], visible: boolean): void;
}

/** One product unit riding a checkout belt, sliding towards its `target`
 * local position every frame (`stepCheckout()`'s own exponential-lerp,
 * mirroring `checkoutKit.ts`'s `animate()`). */
interface CheckoutLiveUnit {
  entity: pc.Entity;
  target: pc.Vec3;
}

/** One open checkout lane's dynamic detail (phase 15 port of
 * `checkout/checkoutKit.ts`'s `update()`/`animate()`): the belt point light
 * + belt-light strip emissive, the register screen glow + its "LISTA"/
 * "bagged/total" text, the card-reader glow, the three bags and the sliding
 * belt product units. Built only for OPEN lanes — closed lanes keep the
 * placeholder `buildClosedCheckoutKit()` geometry with no dynamic detail. */
interface CheckoutLaneEntry {
  lane: CheckoutLane;
  beltLightMaterial: pc.StandardMaterial;
  scanningLight: pc.Entity;
  scanningLightOnIntensity: number;
  screenGlowMaterial: pc.StandardMaterial;
  screenText: pc.Entity;
  cardGlowMaterial: pc.StandardMaterial;
  bagA: CheckoutBagEntry;
  bagB: CheckoutBagEntry;
  bagC: CheckoutBagEntry;
  unitsGroup: pc.Entity;
  liveUnits: Map<string, CheckoutLiveUnit>;
}

/** One production fixture's dynamic status board (phase 15 port of
 * `production/machines.ts`'s `buildMachineIdentity()`'s `update()`), plus
 * (for bakery/cheese/juice) the processing point light and (for cheese/
 * juice/corn-canner) the `dynamic:machine-output` slot visibility this file
 * had not built at all before this phase. Keyed by `fixture.machineId`,
 * matching `ProductionMachineState.id` — the same key `kitFurniture.ts`'s own
 * `machineFinder()` uses. */
interface MachineBoardEntry {
  machineId: string;
  outputText: pc.Entity;
  ingredientText: pc.Entity;
  queuedText: pc.Entity;
  statusLabelText: pc.Entity;
  statusDotMaterial: pc.StandardMaterial;
  processingLight: pc.Entity | null;
  processingLightOnIntensity: number;
  outputSlots: pc.Entity[];
  cannerIndicatorMaterial: pc.StandardMaterial | null;
}

/** Faithful port of `checkoutKit.ts`'s own `computeUnits()` — flattens a
 * transaction's `pendingItems` lines into one entry per physical unit
 * (loaded/scanned/bagged booleans), exactly like the source. */
function computeCheckoutUnits(transaction?: CheckoutTransaction): { productId: ProductId; loaded: boolean; scanned: boolean; bagged: boolean }[] {
  return (
    transaction?.pendingItems.flatMap((line) =>
      Array.from({ length: line.quantity }, (_, unit) => ({
        productId: line.productId,
        loaded: unit < line.loaded,
        scanned: unit < line.scanned,
        bagged: unit < line.bagged,
      })),
    ) ?? []
  );
}

/** Faithful port of `machines.ts`'s own `machineStatus()` — kept as a local
 * pure duplicate (rather than an import) so this file never pulls in
 * `production/machines.ts`'s THREE.js module graph. */
function machineStatusOf(machine?: ProductionMachineState): { label: string; color: string } {
  if (!machine || machine.status === "LOCKED") return { label: "BLOQUEADA", color: "#9ea7a3" };
  if (machine.output > 0 || machine.status === "OUTPUT_READY" || machine.status === "FULL") return { label: "RECOGER", color: "#54d998" };
  if (machine.status === "PROCESSING") return { label: "EN PROCESO", color: "#f0ad55" };
  return { label: "CARGAR", color: "#7fc8e8" };
}

/** `machines.ts`'s own `outputItemPosition()` — the 2×2 grid a process
 * machine's four output slots (cheese/juice/corn-canner) sit at. */
function machineOutputSlotPosition(index: number): [number, number, number] {
  return [0.34 + (index % 2) * 0.13, 0.16 + Math.floor(index / 2) * 0.12, 0.45];
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
  /** Real `purchaseMarkers` (`GameShell.tsx`'s own array, the same one
   * `availablePurchaseIds` above is derived from) — the pulsing floor square
   * + funded-progress fill (phase 10) plus the standing sign board with its
   * name/remaining-amount text (phase 14), both reconciled by `id` exactly
   * like `purchaseMarkers.ts`'s own `update()`. */
  purchaseMarkers: Array<{ id: string; funded: number; highlighted: boolean; label: string; remainingLabel: string }>;
  /** Real `franchise.registerCashMinor` (per-lane, matching `CheckoutLane`
   * index) and the real `cashBundleMinor(countryMoneyScale(...))` unit value
   * `GameShell.tsx` already computes for `MarketScene` — phase 10 reuses both
   * unchanged to render the real stacked cash-bundle pile at each open lane
   * (`registerCashMarkers.ts`'s doc comment). The "RECOGER" label above the
   * stack is deferred with the same text-pipeline gap as `purchaseMarkers`. */
  registerCashMinor: [number, number, number];
  cashBundleMinor: number;
  /** Real presentation-side transfer flights (`GameShell.tsx`'s own
   * `transferEvents` state, the same ledger `MarketScene.tsx`'s
   * `HarvestMagnetBurst`/`StockMagnetBurst`/`ReturnMagnetBurst`/`PayMagnetBurst`
   * read) — a structural subset of `InteractionVisualEvent` (that type lives
   * in a Three.js-importing file this PlayCanvas-only module must not depend
   * on, per this file's own convention — see `OWNER_BODY_SCALE`'s doc
   * comment for the same rule applied elsewhere). `GameShell` passes its real
   * `InteractionVisualEvent[]` array here unchanged; only the fields this
   * port's burst renderer actually reads are declared. */
  transferEvents: readonly TransferVisualEvent[];
  /** Real `GameShell.updateTransferProgress` — retires the presentation
   * ledger exactly like `/runtime`'s own `transferEffects.ts` calls it. */
  onTransferProgress: (sequence: number, remainingQuantity: number) => void;
}

const DEFAULT_PROPS: PlayCanvasSceneProps = { avatarBody: "adult-man", avatarHair: "fade", avatarHairColor: "#3a2a1e", avatarHat: "none", unlockedAreas: [], doorState: "CLOSED", doorProgress: 0, open: false, playerSpeedTier: 0, checkoutLevel: 1, availablePurchaseIds: [], crops: [], customers: [], employees: [], purchaseMarkers: [], registerCashMinor: [0, 0, 0], cashBundleMinor: 1000, onInteract: () => {}, onDistance: () => {}, onDoorPresence: () => {}, transferEvents: [], onTransferProgress: () => {} };

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
// Mirrors `CrowdPose.ts`'s `crowdGaitTimeScale()`/`CROWD_TIME_SCALE_RANGE` —
// the same continuous retiming `PlayerActor.ts` (the real third-person
// renderer, not the GPU crowd texture pipeline) applies every frame so a
// Walk/Run clip's stride cadence matches the body's actual presented speed
// instead of snapping between two fixed playback rates. Copied verbatim
// (not imported — that module pulls in `CrowdAnimation.ts`'s three-adjacent
// types) for the same reason `LOCOMOTION_MOVING_START` is copied.
const LOCOMOTION_RUN_NATURAL_SPEED = 1.07;
const CROWD_TIME_SCALE_RANGE = { min: 0.55, max: 2.8 };
type PlayerAnimClip = "Idle" | "Walk" | "Run" | "ScanItem" | "PickupLow";
const LOCOMOTION_CLIP_NATURAL_SPEED: Partial<Record<PlayerAnimClip, number>> = { Walk: LOCOMOTION_WALK_NATURAL_SPEED, Run: LOCOMOTION_RUN_NATURAL_SPEED };
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

/** One live farm-animal character (phase 10 — see `ANIMAL_MODEL_ROOT`'s doc
 * comment). `stationGroup` is the sub-entity `animalStation.ts`'s
 * `station.group` corresponds to (sign/coop-shell/animal/output-tray),
 * enabled only while `unlockedAreas.includes(areaId) && Boolean(machine)`
 * — the exact `showStation` condition `kitFarm.ts`'s
 * `buildAnimalStationGroup.update()` applies (see `buildFarmEstate()`'s call
 * site for why the port previously missed this second condition). `entity`/
 * `animAvailable` are `null`/empty until the converted GLB finishes loading;
 * `stepFarmAnimals()` no-ops per-actor until then. */
/** One live purchase-marker floor square (`purchaseMarkers.ts`'s
 * `MarkerEntry`, minus the label text — see `PlayCanvasSceneProps.purchaseMarkers`'s
 * doc comment for why the sign board's text is deferred). `pulse` wraps only
 * the floor-square entities, matching the source's own breathing-pulse
 * group (the sign, when added, is never scaled by it). */
interface PurchaseMarkerEntry {
  group: pc.Entity;
  pulse: pc.Entity;
  topMaterial: pc.StandardMaterial;
  fillEntity: pc.Entity;
  highlighted: boolean;
  labelEntity: pc.Entity;
  remainingEntity: pc.Entity;
  label: string;
  remainingLabel: string;
}

/** One open checkout lane's stacked real cash-bundle pile
 * (`registerCashMarkers.ts`'s `LaneEntry`, minus the "RECOGER" label text —
 * same deferral as `PurchaseMarkerEntry`). */
interface RegisterCashEntry {
  group: pc.Entity;
  bundles: pc.Entity[];
  bundleCount: number;
  label: pc.Entity;
}

interface FarmAnimalActor {
  kind: FarmAnimalKind;
  machineId: string;
  areaId: string;
  stationGroup: pc.Entity;
  characterGroup: pc.Entity;
  entity: pc.Entity | null;
  animAvailable: Set<FarmAnimalClip>;
  currentClip: FarmAnimalClip | null;
  time: number;
  lastTickMs: number;
}

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
// Real live chicken/cow character GLBs (`animalStation.ts`'s
// `buildAnimalCharacter()` loads `budgetPath("delivered", kind)` — the same
// `public/models/market/budget/delivered/{chicken,cow}.glb` `machine`
// production reads for its `output`/`status`). Both require
// `EXT_meshopt_compression` AND `KHR_mesh_quantization` (confirmed via
// `gltf-transform inspect`, same problem as `PRODUCTION_MODEL_ROOT`'s doc
// comment), so both are stripped the identical way into this repo's
// `playcanvas-production/` directory (co-located with the other converted
// production-machine GLBs, not a separate directory, since both come from
// the same conversion pipeline and requirement set):
//   npx gltf-transform copy budget/delivered/<file>.glb playcanvas-production/<file>.glb
//   npx gltf-transform dequantize playcanvas-production/<file>.glb playcanvas-production/<file>.glb
// Regenerate the same way if the source budget asset changes. This does not
// touch any file `/`, `/play2` or `/runtime` reads.
const ANIMAL_MODEL_ROOT = PRODUCTION_MODEL_ROOT;
// Mirrors `purchaseMarkers.ts`'s own `HIGHLIGHT_COLOR`/`NORMAL_COLOR`.
const PURCHASE_MARKER_HIGHLIGHT_COLOR = "#ffd75e";
const PURCHASE_MARKER_NORMAL_COLOR = "#e8ca6b";
// Mirrors `registerCashMarkers.ts`'s own `CASH_BUNDLE_SIZE`/`CASH_STACK_PER_LAYER`.
const CASH_BUNDLE_SIZE: [number, number, number] = [0.2, 0.05, 0.1];
const CASH_STACK_PER_LAYER = 9;
// Mirrors `registerCashMarkers.ts`'s own `stackHeightFor()`.
function registerCashStackHeight(bundles: number): number {
  return Math.ceil(bundles / CASH_STACK_PER_LAYER) * (CASH_BUNDLE_SIZE[1] + 0.004);
}
// Mirrors `purchaseMarkers.ts`'s own (unexported) `FLOOR_LABEL_YAW` constant —
// the yaw that squares a floor label with the fixed isometric camera.
const FLOOR_LABEL_YAW = Math.atan2(OVERVIEW_CAMERA_OFFSET.x, OVERVIEW_CAMERA_OFFSET.z);
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

  // ---- farm animals (real live chicken/cow characters, phase 10) ----
  // Rebuilt with the rest of `furnitureGroup` on a signature change; driven
  // every render frame from `stepFarmAnimals()` (real `animalMotion()`, same
  // as `animalStation.ts`'s own `update()`).
  private readonly farmAnimalActors: FarmAnimalActor[] = [];

  // ---- retail shelf-stock visuals (phase 11) ----
  // Rebuilt with the rest of `furnitureGroup` on a signature change (each
  // fixture gets one actor per SKU it stocks); driven every render frame
  // from `stepRetailStock()` reading `franchise.shelves` directly, like
  // `stepFarmAnimals()` reads `productionMachines`.
  private readonly retailStockActors: RetailStockActor[] = [];

  // ---- decorative ceiling lamps (storeUtilities.ts port) ----
  // Rebuilt with the rest of `furnitureGroup` on a signature change; driven
  // every render frame from `stepCeilingLamps()` reading `franchise.lightsOn`
  // directly, like `stepFarmAnimals()`/`stepRetailStock()` above.
  private readonly ceilingLampActors: { light: pc.Entity; modelMaterials: pc.StandardMaterial[] }[] = [];

  // ---- checkout lane / production machine dynamic detail (phase 15) ----
  // Rebuilt with the rest of `furnitureGroup` on a signature change; driven
  // every render frame from `stepCheckout()`/`stepProductionMachines()`
  // reading `franchise.checkoutTransactions`/`franchise.productionMachines`
  // directly off the store, exactly like `stepFarmAnimals()`/
  // `stepRetailStock()` above.
  private readonly checkoutLaneEntries = new Map<CheckoutLane, CheckoutLaneEntry>();
  private readonly machineBoardEntries = new Map<string, MachineBoardEntry>();
  private checkoutElapsedMs = 0;

  // ---- returns cubicle / cart bay dynamic detail (phase 15) ----
  private returnsUnitsGroup: pc.Entity | null = null;
  private returnsBinSignature = "";
  private readonly cartBayEntities: pc.Entity[] = [];

  // ---- purchase markers / register cash (phase 10 — real visuals, see
  // `purchaseMarkers.ts`/`registerCashMarkers.ts`'s doc comments) ----
  private purchaseMarkersGroup: pc.Entity | null = null;
  private readonly purchaseMarkerEntries = new Map<string, PurchaseMarkerEntry>();
  private purchaseMarkersElapsedSeconds = 0;
  // Shared dynamic-label font (phase 14) — see `ensureDynamicFont()`'s doc comment.
  private dynamicFont: pc.CanvasFont | null = null;
  private dynamicFontAsset: pc.Asset | null = null;
  private registerCashGroup: pc.Entity | null = null;
  private readonly registerCashEntries = new Map<CheckoutLane, RegisterCashEntry>();

  // ---- transfer-effect magnet bursts (phase 12, see the table above `RETAIL_PRODUCT_VISUAL` for the full doc comment) ----
  private transferEffectsGroup: pc.Entity | null = null;
  private readonly transferBursts = new Map<number, TransferBurst>();
  private transferOnProgress: (sequence: number, remainingQuantity: number) => void = () => {};

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

    this.purchaseMarkersGroup = new pc.Entity("dynamic:purchase-markers");
    worldRoot.addChild(this.purchaseMarkersGroup);
    this.syncPurchaseMarkers(this.props.purchaseMarkers);
    this.registerCashGroup = new pc.Entity("dynamic:register-cash");
    worldRoot.addChild(this.registerCashGroup);
    this.syncRegisterCash(this.props.registerCashMinor, this.props.cashBundleMinor);
    this.transferEffectsGroup = new pc.Entity("dynamic:transfer-effects");
    worldRoot.addChild(this.transferEffectsGroup);
    this.syncTransferBursts(this.props.transferEvents, this.props.unlockedAreas, this.props.onTransferProgress);

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
    this.syncPurchaseMarkers(nextProps.purchaseMarkers);
    this.syncRegisterCash(nextProps.registerCashMinor, nextProps.cashBundleMinor);
    this.syncTransferBursts(nextProps.transferEvents, nextProps.unlockedAreas, nextProps.onTransferProgress);
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

  /** Real pulsing purchase-marker floor squares plus the standing sign board
   * (`purchaseMarkers.ts`'s `update()` — reconciled by id the same way: an id
   * still present gets its fill/highlight/label text patched in place, a new
   * id gets a freshly built marker, a dropped id gets torn down). Sign text
   * is dirty-checked per entry (`entry.label !== marker.label`, mirroring the
   * real source) before the shared dynamic-label font's charset is refreshed
   * and `entity.element.text` is written — see `refreshDynamicFontCharset()`'s
   * doc comment for why the font refresh itself is safe to call unconditionally. */
  private syncPurchaseMarkers(markers: PlayCanvasSceneProps["purchaseMarkers"]) {
    if (!this.purchaseMarkersGroup) return;
    const seen = new Set<string>();
    let textDirty = false;
    for (const marker of markers) {
      seen.add(marker.id);
      const position = (PURCHASE_POSITIONS as Record<string, readonly [number, number, number]>)[marker.id];
      if (!position) continue;
      let entry = this.purchaseMarkerEntries.get(marker.id);
      if (!entry) {
        entry = this.buildPurchaseMarkerEntry(marker.id, position, marker.highlighted, marker.label, marker.remainingLabel);
        this.purchaseMarkersGroup.addChild(entry.group);
        this.purchaseMarkerEntries.set(marker.id, entry);
        textDirty = true;
      }
      if (entry.highlighted !== marker.highlighted) {
        entry.highlighted = marker.highlighted;
        entry.topMaterial.diffuse = hexToColor(marker.highlighted ? PURCHASE_MARKER_HIGHLIGHT_COLOR : PURCHASE_MARKER_NORMAL_COLOR);
        entry.topMaterial.update();
      }
      const clamped = Math.max(0, Math.min(1, marker.funded));
      entry.fillEntity.enabled = clamped > 0;
      entry.fillEntity.setLocalScale(clamped, 1, clamped);
      if (entry.label !== marker.label) {
        entry.label = marker.label;
        textDirty = true;
      }
      if (entry.remainingLabel !== marker.remainingLabel) {
        entry.remainingLabel = marker.remainingLabel;
        textDirty = true;
      }
    }
    for (const [id, entry] of this.purchaseMarkerEntries) {
      if (seen.has(id)) continue;
      entry.group.destroy();
      entry.topMaterial.destroy();
      this.purchaseMarkerEntries.delete(id);
    }
    if (textDirty) {
      this.refreshDynamicFontCharset();
      for (const entry of this.purchaseMarkerEntries.values()) {
        if (entry.labelEntity.element!.text !== entry.label) entry.labelEntity.element!.text = entry.label;
        if (entry.remainingEntity.element!.text !== entry.remainingLabel) entry.remainingEntity.element!.text = entry.remainingLabel;
      }
    }
  }

  /** Shared across every purchase-marker sign's label + remaining-amount
   * text (per the phase-14 handoff: "use ONE shared `CanvasFont` for all
   * dynamic labels in this port"). Bakes plain white glyphs so each text
   * entity's own `element.color` tints it to the real per-field colour
   * (`#2a4a3e` for the name, `#1f5c3b` for the remaining amount) without
   * needing a separate font per colour. */
  private ensureDynamicFont(): pc.Asset {
    if (!this.dynamicFontAsset) {
      const font = new pc.CanvasFont(this.app, { fontName: "Arial", fontWeight: "800", fontSize: 64, color: hexToColor("#ffffff") });
      const asset = new pc.Asset("font:dynamic-labels", "font", { url: "" });
      asset.resource = font;
      asset.loaded = true;
      this.app.assets.add(asset);
      this.dynamicFont = font;
      this.dynamicFontAsset = asset;
    }
    return this.dynamicFontAsset;
  }

  /** Grows the shared dynamic-label font's glyph atlas to also cover `text`,
   * without dropping any character already in use by another live dynamic
   * text entity. `CanvasFont.createTextures()` (see `canvas-font.js`)
   * replaces the ENTIRE atlas with only the given text's own character set —
   * it is not additive — so calling it per-entity (as this codebase's own
   * checkout/machine-board/stock-screen/purchase-marker update sites all
   * used to) races every other simultaneously-displayed dynamic text over
   * one shared atlas: whichever text last called `createTextures()` wins,
   * and every other live text glyph outside that one string's own charset
   * goes missing until IT happens to update too. `CanvasFont.updateTextures()`
   * is the real additive form (diffs against `this.data.chars`, only
   * re-renders when new characters actually appear), so every call site
   * routes through this helper instead — except the very first text this
   * font ever sees in the session, before `this.data.chars` exists at all
   * (a fresh `CanvasFont`'s `this.data = {}`), which still needs the
   * one-time `createTextures()` bootstrap. */
  private growDynamicFontCharset(text: string) {
    const font = this.dynamicFont;
    if (!font) return;
    // `CanvasFont.data` is typed as `{}` (its real shape is only known once
    // `_createJson()` has run at least once) — cast to check the field
    // `updateTextures()` itself depends on before ever calling it.
    if ((font.data as { chars?: unknown }).chars) font.updateTextures(text);
    else font.createTextures(text);
  }

  /** Purchase-marker-specific corpus refresh — folds every live marker's
   * label/remaining-label characters into the shared atlas via the same
   * additive `growDynamicFontCharset()` every other dynamic text uses. */
  private refreshDynamicFontCharset() {
    let corpus = "";
    for (const entry of this.purchaseMarkerEntries.values()) corpus += entry.label + entry.remainingLabel;
    this.growDynamicFontCharset(corpus);
  }

  /** Builds one dynamic (font-shared, dirty-checked) text entity — the
   * purchase-marker sign's counterpart to `buildText()`'s build-time-constant
   * signage. `maxWidth`, when given, reproduces the source's
   * `labelText.maxWidth`/`textAlign = "center"` centred word-wrap.
   *
   * `anchorX` (phase 15, for `production/machines.ts`'s identity board, whose
   * source `<Text anchorX="left"|"right">` calls keep a field's text growing
   * away from its label instead of centred on a fixed point) reproduces the
   * source's horizontal anchor without word-wrap: `"left"` pins the pivot/
   * anchor/alignment to the entity's own local position and grows text
   * rightward; `"right"` grows it leftward; `"center"` (the default, and the
   * only mode every call site before this phase used) is unchanged. */
  private buildDynamicText(parent: pc.Entity, name: string, text: string, fontSize: number, position: [number, number, number], color: string, maxWidth?: number, anchorX: "left" | "center" | "right" = "center"): pc.Entity {
    const fontAsset = this.ensureDynamicFont();
    // A freshly constructed `CanvasFont` has no glyph atlas at all yet
    // (`this.data = {}` in its constructor) — attaching an `element`
    // component whose `fontAsset` resolves to it before the atlas exists at
    // all throws deep inside `ElementComponent`'s text layout (`data.chars`
    // is undefined). Seeding via the additive `growDynamicFontCharset()`
    // keeps that first frame valid without dropping any character every
    // OTHER already-live dynamic text on screen still needs (see that
    // method's own doc comment for why the raw, per-entity
    // `CanvasFont.createTextures()` call this used to make here was unsafe).
    this.growDynamicFontCharset(text);
    const anchorValue = anchorX === "left" ? 0 : anchorX === "right" ? 1 : 0.5;
    const entity = new pc.Entity(name);
    entity.addComponent("element", {
      type: pc.ELEMENTTYPE_TEXT,
      text,
      fontAsset,
      fontSize,
      color: hexToColor(color),
      anchor: new pc.Vec4(anchorValue, 0.5, anchorValue, 0.5),
      pivot: new pc.Vec2(anchorValue, 0.5),
      autoWidth: maxWidth === undefined,
      autoHeight: true,
      wrapLines: maxWidth !== undefined,
      alignment: new pc.Vec2(anchorValue, 0.5),
    });
    if (maxWidth !== undefined) entity.element!.width = maxWidth;
    entity.setLocalPosition(position[0], position[1], position[2]);
    parent.addChild(entity);
    return entity;
  }

  private buildPurchaseMarkerEntry(id: string, position: readonly [number, number, number], highlighted: boolean, label: string, remainingLabel: string): PurchaseMarkerEntry {
    const size = PURCHASE_MARKER.halfSize * 2;
    const innerSize = size - 0.1;
    const group = new pc.Entity(`purchase-marker:${id}`);
    const scaled = scaleStorePosition([...position] as [number, number, number]);
    group.setLocalPosition(scaled[0], scaled[1], scaled[2]);
    group.setLocalScale(STORE_ELEMENT_SCALE, STORE_ELEMENT_SCALE, STORE_ELEMENT_SCALE);

    const pulse = new pc.Entity("pulse");
    group.addChild(pulse);

    // Not `this.material()` — that cache is keyed by colour/opacity and
    // shared across every caller, but this material's colour is mutated
    // in place per-marker as `highlighted` toggles (see `syncPurchaseMarkers()`),
    // so each marker needs its own dedicated instance.
    const topMaterial = new pc.StandardMaterial();
    topMaterial.diffuse = hexToColor(highlighted ? PURCHASE_MARKER_HIGHLIGHT_COLOR : PURCHASE_MARKER_NORMAL_COLOR);
    topMaterial.opacity = 0.95;
    topMaterial.blendType = pc.BLEND_NORMAL;
    topMaterial.depthWrite = false;
    topMaterial.update();
    const top = new pc.Entity("top");
    top.addComponent("render", { type: "plane", material: topMaterial });
    top.setLocalEulerAngles(0, 0, 0);
    top.setLocalScale(size, 1, size);
    top.setLocalPosition(0, 0.012, 0);
    pulse.addChild(top);

    const base = new pc.Entity("base");
    base.addComponent("render", { type: "plane", material: this.material("#2e4a3f", 0.85) });
    base.setLocalScale(innerSize, 1, innerSize);
    base.setLocalPosition(0, 0.018, 0);
    pulse.addChild(base);

    const fillEntity = new pc.Entity("fill");
    fillEntity.addComponent("render", { type: "plane", material: this.material("#7fba63", 0.9) });
    fillEntity.setLocalScale(innerSize, 1, innerSize);
    fillEntity.setLocalPosition(0, 0.024, 0);
    fillEntity.enabled = false;
    pulse.addChild(fillEntity);

    // Standing sign (phase 14) — real dimensions from `purchaseMarkers.ts`
    // (`boardGeometry`/`faceGeometry`/`postGeometry`), squared to the fixed
    // isometric camera by `FLOOR_LABEL_YAW` exactly like the source's
    // `signRoot`. PlayCanvas's `box`/`plane` primitives are natively
    // horizontal (unlike Three's, which needed the `-Math.PI/2` X rotation
    // already applied to `top`/`base`/`fill` above), so `face` — the only
    // plane that must stand vertical, facing +Z — gets the complementary
    // +90° X rotation instead.
    const signRoot = new pc.Entity("sign-root");
    signRoot.setLocalPosition(0, 0, PURCHASE_MARKER.signOffsetZ);
    signRoot.setLocalEulerAngles(0, FLOOR_LABEL_YAW * (180 / Math.PI), 0);
    group.addChild(signRoot);

    const post = new pc.Entity("post");
    post.addComponent("render", { type: "box", material: this.material("#4b5b56") });
    post.setLocalScale(0.06, PURCHASE_MARKER.signHeight, 0.06);
    post.setLocalPosition(0, PURCHASE_MARKER.signHeight / 2, 0);
    signRoot.addChild(post);

    const sign = new pc.Entity("sign");
    sign.setLocalPosition(0, PURCHASE_MARKER.signHeight + 0.34, 0);
    sign.setLocalEulerAngles((-0.2 * 180) / Math.PI, 0, 0);
    signRoot.addChild(sign);

    const board = new pc.Entity("board");
    board.addComponent("render", { type: "box", material: this.material("#f4e4ad") });
    board.setLocalScale(1.76, 0.84, 0.06);
    sign.addChild(board);

    const face = new pc.Entity("face");
    face.addComponent("render", { type: "plane", material: this.material("#fff8e1") });
    face.setLocalScale(1.64, 1, 0.72);
    face.setLocalEulerAngles(90, 0, 0);
    face.setLocalPosition(0, 0, 0.031);
    sign.addChild(face);

    const labelEntity = this.buildDynamicText(sign, "sign-label", label, 0.15, [0, 0.2, 0.036], "#2a4a3e", 1.56);
    const remainingEntity = this.buildDynamicText(sign, "sign-remaining", remainingLabel, 0.27, [0, -0.18, 0.036], "#1f5c3b", 1.56);

    return { group, pulse, topMaterial, fillEntity, highlighted, labelEntity, remainingEntity, label, remainingLabel };
  }

  /** Breathing-pulse animation (`purchaseMarkers.ts`'s own `animate()`),
   * driven every render frame — the same sine formula, keyed off an
   * internally accumulated clock. */
  private stepPurchaseMarkersAnimation(dt: number) {
    if (this.purchaseMarkerEntries.size === 0) return;
    this.purchaseMarkersElapsedSeconds += dt;
    for (const entry of this.purchaseMarkerEntries.values()) {
      const breath = 1 + Math.sin(this.purchaseMarkersElapsedSeconds * 3.1) * (entry.highlighted ? 0.12 : 0.07);
      entry.pulse.setLocalScale(breath, 1, breath);
    }
  }

  /** Real stacked cash-bundle piles at each open checkout lane
   * (`registerCashMarkers.ts`'s `update()` — a lane with money waiting gets
   * its box count refreshed in place, a lane that drops to zero has its
   * group torn down). The "RECOGER" label text is not built here — see
   * `PlayCanvasSceneProps.registerCashMinor`'s doc comment. */
  private syncRegisterCash(amounts: readonly [number, number, number], bundleMinor: number) {
    if (!this.registerCashGroup) return;
    for (const id of REGISTER_INTERACTION_IDS as readonly RegisterInteractionId[]) {
      const lane = registerLane(id);
      const bundles = Math.min(CASH_BUNDLE_RENDER_CAP, cashBundleCount(amounts[lane], bundleMinor));
      const entry = this.registerCashEntries.get(lane);
      if (bundles <= 0) {
        if (entry) {
          entry.group.destroy();
          this.registerCashEntries.delete(lane);
        }
        continue;
      }
      if (!entry) {
        this.registerCashEntries.set(lane, this.buildRegisterCashEntry(lane, bundles));
        continue;
      }
      if (entry.bundleCount !== bundles) this.applyRegisterCashBundles(entry, bundles);
    }
  }

  private buildRegisterCashEntry(lane: CheckoutLane, bundles: number): RegisterCashEntry {
    const group = new pc.Entity(`register-cash:${lane}`);
    this.registerCashGroup!.addChild(group);
    const scaled = scaleStorePosition([...registerPickupPosition(lane)] as [number, number, number]);
    group.setLocalPosition(scaled[0], scaled[1], scaled[2]);
    group.setLocalScale(STORE_ELEMENT_SCALE, STORE_ELEMENT_SCALE, STORE_ELEMENT_SCALE);

    const ring = new pc.Entity("ring");
    ring.addComponent("render", { type: "plane", material: this.material("#e8ca6b") });
    ring.setLocalScale(0.96, 1, 0.96);
    group.addChild(ring);

    // "RECOGER" is a constant string across every lane's lifetime — built
    // once here, matching `registerCashMarkers.ts`'s own label (source line
    // 69: `anchorX: "center", anchorY: "middle"`, which `buildText()`'s
    // fixed center/center anchor+pivot already reproduces). Only its local Y
    // position needs to track the stack height as bundles are added/removed.
    const label = this.buildText(group, "recoger", "RECOGER", 0.13, [0, 0.3, 0], "#28483e");
    const entry: RegisterCashEntry = { group, bundles: [], bundleCount: 0, label };
    this.applyRegisterCashBundles(entry, bundles);
    return entry;
  }

  /** Mirrors `registerCashMarkers.ts`'s `bundleTransforms()`/`applyInstanceTransforms`
   * layout exactly (3×3 layers of individual bundle boxes) — this port uses
   * plain child entities instead of an `InstancedMesh`, appropriate at this
   * scale (`CASH_BUNDLE_RENDER_CAP` is a real ceiling on register cash, not a
   * typical count — a handful of bundles is the common case). */
  private applyRegisterCashBundles(entry: RegisterCashEntry, bundles: number) {
    for (const box of entry.bundles) box.destroy();
    entry.bundles = [];
    const [sizeX, sizeY, sizeZ] = CASH_BUNDLE_SIZE;
    for (let index = 0; index < bundles; index += 1) {
      const layer = Math.floor(index / CASH_STACK_PER_LAYER);
      const slot = index % CASH_STACK_PER_LAYER;
      const box = new pc.Entity(`bundle-${index}`);
      box.addComponent("render", { type: "box", material: this.material("#79b063") });
      box.setLocalScale(sizeX, sizeY, sizeZ);
      box.setLocalPosition(
        ((slot % 3) - 1) * (sizeX + 0.02),
        sizeY / 2 + layer * (sizeY + 0.004),
        (Math.floor(slot / 3) - 1) * (sizeZ + 0.02),
      );
      entry.group.addChild(box);
      entry.bundles.push(box);
    }
    entry.bundleCount = bundles;
    entry.label.setLocalPosition(0, registerCashStackHeight(bundles) + 0.3, 0);
  }

  /** Spawns/retires bursts for the current `transferEvents` snapshot — the
   * "which bursts exist" half of the split, matching `/runtime`'s own
   * `TransferEffectsHandle.sync()` (see that file's doc comment: React
   * reconciling the `transferEvents` array drives which bursts exist; the
   * render loop, in `stepTransferBursts()` below, drives how they move). */
  private syncTransferBursts(events: readonly TransferVisualEvent[], unlockedAreas: readonly string[], onProgress: (sequence: number, remainingQuantity: number) => void) {
    if (!this.transferEffectsGroup) return;
    this.transferOnProgress = onProgress;
    const seen = new Set<number>();
    for (const event of events) {
      seen.add(event.sequence);
      if (this.transferBursts.has(event.sequence)) continue;
      const burst = this.spawnTransferBurst(event, unlockedAreas);
      if (!burst) continue;
      this.transferBursts.set(event.sequence, burst);
      this.transferEffectsGroup.addChild(burst.group);
    }
    for (const [sequence, burst] of this.transferBursts) {
      if (seen.has(sequence)) continue;
      burst.group.destroy();
      this.transferBursts.delete(sequence);
    }
  }

  private spawnTransferBurst(event: TransferVisualEvent, unlockedAreas: readonly string[]): TransferBurst | null {
    if (event.kind === "harvest") return this.spawnHarvestBurst(event);
    if (event.kind === "stock") return this.spawnStockBurst(event, unlockedAreas);
    if (event.kind === "return") return this.spawnReturnBurst(event);
    if (event.kind === "pay") return this.spawnPayBurst(event);
    return null;
  }

  // ─── Harvest: crop plot → player basket (`createHarvestBurst`) ───────────
  private spawnHarvestBurst(event: TransferVisualEvent): TransferBurst | null {
    if (!event.cropId || !event.productId) return null;
    const plot = farmPlotById(event.cropId);
    if (!plot) return null;
    const particleCount = clampTransferParticleCount(event.quantity ?? 1, 20);
    const source = scaleStorePosition([...plot.position] as [number, number, number]);
    const group = new pc.Entity(`transfer:harvest:${event.sequence}`);
    const particles: TransferParticle[] = [];
    for (let index = 0; index < particleCount; index += 1) {
      const entity = new pc.Entity(`transfer-particle:${event.sequence}:${index}`);
      entity.enabled = false;
      this.addTransferParticleBody(entity, event.productId, 1.22);
      this.addTransferParticleSparkle(entity, "harvest");
      group.addChild(entity);
      particles.push({
        entity,
        offsetX: ((index % 3) - 1) * 0.28,
        offsetY: 0.06 + Math.floor(index / 3) * 0.025,
        offsetZ: (Math.floor(index / 3) - (Math.ceil(particleCount / 3) - 1) / 2) * 0.22,
        targetX: 0, targetY: 0, targetZ: 0,
        sourceX: null, sourceY: null, sourceZ: null,
        spinA: 0, spinB: 0, landed: false,
      });
    }
    return { sequence: event.sequence, kind: "harvest", group, particles, particleCount, elapsed: 0, publishedRemaining: particleCount, sourceX: source[0], sourceY: source[1], sourceZ: source[2] };
  }

  // ─── Stock: player basket → shelf/department fixture (`createStockBurst`) ─
  private spawnStockBurst(event: TransferVisualEvent, unlockedAreas: readonly string[]): TransferBurst | null {
    if (!event.productId) return null;
    const particleCount = clampTransferParticleCount(event.quantity ?? 1, 20);
    const departmentId = PRODUCT_RETAIL_DEPARTMENT[event.productId];
    const displayYaw = ((RETAIL_DEPARTMENTS[departmentId].yaw ?? 0) * Math.PI) / 180;
    const shelfStart = event.shelfStart ?? 0;
    const displayPositions = retailFixtureDisplayPositions(departmentId, unlockedAreas);
    const group = new pc.Entity(`transfer:stock:${event.sequence}`);
    const particles: TransferParticle[] = [];
    for (let index = 0; index < particleCount; index += 1) {
      const slot = retailStockFixtureSlot(departmentId, shelfStart + index, shelfStart + particleCount, unlockedAreas);
      const displayPosition = displayPositions[slot.fixtureIndex];
      const landing = retailStockLandingLocalPosition(event.productId, slot.localOrdinal, slot.localEnd);
      const localX = landing[0] * Math.cos(displayYaw) + landing[2] * Math.sin(displayYaw);
      const localZ = -landing[0] * Math.sin(displayYaw) + landing[2] * Math.cos(displayYaw);
      const entity = new pc.Entity(`transfer-particle:${event.sequence}:${index}`);
      entity.enabled = false;
      this.addTransferParticleBody(entity, event.productId, 1.16);
      this.addTransferParticleSparkle(entity, "stock");
      group.addChild(entity);
      particles.push({
        entity,
        offsetX: 0, offsetY: 0, offsetZ: 0,
        targetX: displayPosition[0] * STORE_LAYOUT_SCALE + localX * STORE_ELEMENT_SCALE,
        targetY: landing[1] * STORE_ELEMENT_SCALE,
        targetZ: displayPosition[2] * STORE_LAYOUT_SCALE + localZ * STORE_ELEMENT_SCALE,
        sourceX: null, sourceY: null, sourceZ: null,
        spinA: 0, spinB: 0, landed: false,
      });
    }
    return { sequence: event.sequence, kind: "stock", group, particles, particleCount, elapsed: 0, publishedRemaining: particleCount, sourceX: 0, sourceY: 0, sourceZ: 0 };
  }

  // ─── Return: player basket → warehouse return crate (`createReturnBurst`) ─
  private spawnReturnBurst(event: TransferVisualEvent): TransferBurst | null {
    if (!event.productId) return null;
    const particleCount = clampTransferParticleCount(event.quantity ?? 1, 20);
    const landingX = WAREHOUSE_RETURN_STATION.position[0] * STORE_LAYOUT_SCALE;
    const landingY = 0.3 * STORE_ELEMENT_SCALE;
    const landingZ = WAREHOUSE_RETURN_STATION.position[2] * STORE_LAYOUT_SCALE;
    const group = new pc.Entity(`transfer:return:${event.sequence}`);
    const particles: TransferParticle[] = [];
    for (let index = 0; index < particleCount; index += 1) {
      const entity = new pc.Entity(`transfer-particle:${event.sequence}:${index}`);
      entity.enabled = false;
      this.addTransferParticleBody(entity, event.productId, 1.16);
      this.addTransferParticleSparkle(entity, "stock");
      group.addChild(entity);
      particles.push({
        entity,
        offsetX: 0, offsetY: 0, offsetZ: 0,
        targetX: landingX + ((index % 4) - 1.5) * 0.09 * STORE_ELEMENT_SCALE,
        targetY: landingY,
        targetZ: landingZ,
        sourceX: null, sourceY: null, sourceZ: null,
        spinA: 0, spinB: 0, landed: false,
      });
    }
    return { sequence: event.sequence, kind: "return", group, particles, particleCount, elapsed: 0, publishedRemaining: particleCount, sourceX: 0, sourceY: 0, sourceZ: 0 };
  }

  // ─── Pay: player hands → purchase marker square (`createPayBurst`) ───────
  private spawnPayBurst(event: TransferVisualEvent): TransferBurst | null {
    if (!event.purchaseId) return null;
    const particleCount = clampTransferParticleCount(event.quantity ?? 1, 8);
    const targetPosition = scaleStorePosition([...PURCHASE_POSITIONS[event.purchaseId]] as [number, number, number]);
    const group = new pc.Entity(`transfer:pay:${event.sequence}`);
    const particles: TransferParticle[] = [];
    for (let index = 0; index < particleCount; index += 1) {
      const entity = new pc.Entity(`transfer-particle:${event.sequence}:${index}`);
      entity.enabled = false;
      this.addTransferCashBundle(entity);
      group.addChild(entity);
      particles.push({
        entity,
        offsetX: 0, offsetY: 0, offsetZ: 0,
        targetX: targetPosition[0] + ((index % 3) - 1) * 0.12 * STORE_ELEMENT_SCALE,
        targetY: targetPosition[1] + 0.06,
        targetZ: targetPosition[2] + ((index % 2) - 0.5) * 0.1 * STORE_ELEMENT_SCALE,
        sourceX: null, sourceY: null, sourceZ: null,
        spinA: 0, spinB: 0, landed: false,
      });
    }
    return { sequence: event.sequence, kind: "pay", group, particles, particleCount, elapsed: 0, publishedRemaining: particleCount, sourceX: 0, sourceY: 0, sourceZ: 0 };
  }

  /** One carried-unit body: reuses `RETAIL_PRODUCT_VISUAL` (see the doc
   * comment above that table for why) scaled by the source's own
   * `attachProductParticle` scale argument (1.22 harvest, 1.16 stock/return —
   * a real meters multiplier on top of the already-real primitive size, not a
   * `STORE_ELEMENT_SCALE`-space quantity, matching `buildBasketProductMesh`'s
   * own `mesh.scale.setScalar(scale)`). */
  private addTransferParticleBody(host: pc.Entity, productId: ProductId, scale: number) {
    const spec = RETAIL_PRODUCT_VISUAL[productId];
    const body = new pc.Entity(`particle-body:${productId}`);
    body.addComponent("render", { type: spec.shape, material: this.material(spec.color) });
    body.setLocalScale(spec.size[0] * scale, spec.size[1] * scale, spec.size[2] * scale);
    host.addChild(body);
  }

  /** The small tumbling "sparkle" every carried/stocked unit wears
   * (`buildHarvestSparkle`/`buildStockSparkle`) — see the doc comment above
   * `RETAIL_PRODUCT_VISUAL` for why this is a box, not an octahedron. Real
   * position/rotation/color/opacity numbers, verbatim. */
  private addTransferParticleSparkle(host: pc.Entity, kind: "harvest" | "stock") {
    const half = kind === "harvest" ? 0.035 : 0.03;
    const opacity = kind === "harvest" ? 0.9 : 0.82;
    const sparkle = new pc.Entity(`particle-sparkle:${kind}`);
    sparkle.addComponent("render", { type: "box", material: this.material("#fff1a6", opacity) });
    sparkle.setLocalScale(half * 2, half * 2, half * 2);
    if (kind === "harvest") {
      sparkle.setLocalPosition(0.1, 0.1, 0);
      sparkle.setLocalEulerAngles(0, 0, 45);
    } else {
      sparkle.setLocalPosition(0, 0.1, 0);
    }
    host.addChild(sparkle);
  }

  /** `PayMagnetBurst`'s flying unit (`buildCashBundleMesh`): a bundle box +
   * its paper band, both scaled by `STORE_ELEMENT_SCALE` (baked directly into
   * each child's own local scale here, equivalent to the source's group-level
   * `scale.setScalar(STORE_ELEMENT_SCALE)` since no rotation sits between
   * them). */
  private addTransferCashBundle(host: pc.Entity) {
    const bundle = new pc.Entity("cash-bundle");
    bundle.addComponent("render", { type: "box", material: this.material("#79b063") });
    bundle.setLocalScale(0.2 * STORE_ELEMENT_SCALE, 0.05 * STORE_ELEMENT_SCALE, 0.1 * STORE_ELEMENT_SCALE);
    host.addChild(bundle);
    const band = new pc.Entity("cash-band");
    band.addComponent("render", { type: "box", material: this.material("#efe3b8") });
    band.setLocalScale(0.07 * STORE_ELEMENT_SCALE, (0.05 + 0.006) * STORE_ELEMENT_SCALE, (0.1 + 0.006) * STORE_ELEMENT_SCALE);
    host.addChild(band);
  }

  /** Advances every active burst by one rendered frame — the "how they move"
   * half of the split (see `syncTransferBursts`'s doc comment). `basketWorld`
   * is the no-basket-rig fallback described in the doc comment above
   * `MAX_VISUAL_TRANSFER_DELTA`. */
  private stepTransferBursts(dt: number) {
    if (this.transferBursts.size === 0) return;
    const rawDeltaSeconds = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const basketWorld = { x: this.playerPosition.x, y: 1.05, z: this.playerPosition.z };
    for (const burst of this.transferBursts.values()) this.tickTransferBurst(burst, rawDeltaSeconds, basketWorld);
  }

  private tickTransferBurst(burst: TransferBurst, rawDeltaSeconds: number, basketWorld: { x: number; y: number; z: number }) {
    burst.elapsed += visualTransferDelta(rawDeltaSeconds);
    const stagger = burst.kind === "harvest" ? 0.045 : burst.kind === "pay" ? 0.04 : 0.065;
    const duration = burst.kind === "harvest" ? 0.52 : burst.kind === "pay" ? 0.32 : 0.5;
    const RAD_TO_DEG = 180 / Math.PI;
    for (let index = 0; index < burst.particleCount; index += 1) {
      const particle = burst.particles[index];
      const startAt = index * stagger;
      const t = Math.min(1, Math.max(0, (burst.elapsed - startAt) / duration));
      if (t >= 1) particle.landed = true;

      if (burst.kind === "harvest") {
        const visible = t < 1 && burst.elapsed >= startAt;
        particle.entity.enabled = visible;
        if (visible) {
          const eased = 1 - Math.pow(1 - t, 3);
          const x = lerp(burst.sourceX + particle.offsetX * STORE_ELEMENT_SCALE, basketWorld.x, eased);
          const y = lerp(0.72 * STORE_ELEMENT_SCALE + particle.offsetY, basketWorld.y, eased) + Math.sin(Math.PI * t) * 1.35;
          const z = lerp(burst.sourceZ + particle.offsetZ * STORE_ELEMENT_SCALE, basketWorld.z, eased);
          particle.entity.setLocalPosition(x, y, z);
          particle.spinA += rawDeltaSeconds * (5.5 + index);
          const spinZ = Math.sin(t * Math.PI * 3 + index) * 0.28;
          particle.entity.setEulerAngles(0, particle.spinA * RAD_TO_DEG, spinZ * RAD_TO_DEG);
          const scale = (0.86 + Math.sin(Math.PI * t) * 0.24) * (1 - t * 0.18);
          particle.entity.setLocalScale(scale, scale, scale);
        }
        continue;
      }

      const started = burst.elapsed >= startAt;
      if (started && particle.sourceX === null) {
        particle.sourceX = basketWorld.x;
        particle.sourceY = basketWorld.y;
        particle.sourceZ = basketWorld.z;
      }
      const visible = t < 1 && started;
      particle.entity.enabled = visible;
      if (!visible) continue;
      const eased = t * t * (3 - 2 * t);
      const sx = particle.sourceX ?? basketWorld.x;
      const sy = particle.sourceY ?? basketWorld.y;
      const sz = particle.sourceZ ?? basketWorld.z;

      if (burst.kind === "pay") {
        const x = lerp(sx, particle.targetX, eased);
        const y = lerp(sy, particle.targetY, eased) + Math.sin(Math.PI * t) * 0.7;
        const z = lerp(sz, particle.targetZ, eased);
        particle.entity.setLocalPosition(x, y, z);
        particle.spinA += rawDeltaSeconds * (6 + index);
        particle.spinB += rawDeltaSeconds * 4;
        particle.entity.setEulerAngles(particle.spinA * RAD_TO_DEG, 0, particle.spinB * RAD_TO_DEG);
        continue;
      }

      // stock / return
      const x = lerp(sx, particle.targetX, eased);
      const y = lerp(sy, particle.targetY, eased) + Math.sin(Math.PI * t) * 0.82;
      const z = lerp(sz, particle.targetZ, eased);
      particle.entity.setLocalPosition(x, y, z);
      particle.spinA += rawDeltaSeconds * (3.5 + index * 0.3);
      particle.spinB += rawDeltaSeconds * (5.2 + index * 0.45);
      particle.entity.setEulerAngles(particle.spinA * RAD_TO_DEG, particle.spinB * RAD_TO_DEG, 0);
      const scale = 0.94 + Math.sin(Math.PI * t) * 0.18;
      particle.entity.setLocalScale(scale, scale, scale);
    }
    this.settleTransferBurst(burst);
  }

  /** Only calls `onProgress` when the landed-unit count actually changed —
   * exactly the source's own `createLandingTracker().settle()` gate. */
  private settleTransferBurst(burst: TransferBurst) {
    let landedCount = 0;
    for (const particle of burst.particles) if (particle.landed) landedCount += 1;
    const remaining = burst.particleCount - landedCount;
    if (remaining === burst.publishedRemaining) return;
    burst.publishedRemaining = remaining;
    this.transferOnProgress(burst.sequence, remaining);
  }

  /** QA/debug-only accessor (phase 12): every currently-active burst's
   * sequence/kind/particle count and remaining-in-flight count, plus the
   * first particle's live position (enough to verify a burst is actually
   * moving from source to destination without a screenshot). */
  getTransferBurstDebug(): Array<{ sequence: number; kind: TransferBurstKind; particleCount: number; remaining: number; firstParticle: { enabled: boolean; x: number; y: number; z: number } | null }> {
    return Array.from(this.transferBursts.values()).map((burst) => {
      const first = burst.particles[0] ?? null;
      const position = first?.entity.getLocalPosition();
      return {
        sequence: burst.sequence,
        kind: burst.kind,
        particleCount: burst.particleCount,
        remaining: burst.publishedRemaining,
        firstParticle: first && position ? { enabled: first.entity.enabled, x: position.x, y: position.y, z: position.z } : null,
      };
    });
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
    // Continuous gait retiming (mirrors `crowdGaitTimeScale()` — see
    // `LOCOMOTION_CLIP_NATURAL_SPEED`'s doc comment): every frame, not just on
    // a clip switch, so foot-plant cadence scales smoothly with the body's
    // actual presented speed instead of snapping between Walk/Run's authored
    // playback rate of 1. `AnimComponent.speed` is a single multiplier over
    // the whole component's `update(dt)` (`component.js`: `layers[i].update(dt
    // * this.speed)`), which is exactly the right knob here because this
    // entity's anim graph has only one active layer/state at a time — setting
    // it while a work-pose plays would misspeed that pose, so it is pinned to
    // 1 whenever the active target isn't a locomotion clip.
    const natural = LOCOMOTION_CLIP_NATURAL_SPEED[this.playerAnimTarget];
    if (natural !== undefined) {
      const floor = natural * Math.max(1e-5, this.playerAnimRootScale);
      anim.speed = Math.min(CROWD_TIME_SCALE_RANGE.max, Math.max(CROWD_TIME_SCALE_RANGE.min, presentedSpeed / floor));
    } else {
      anim.speed = 1;
    }
  }

  /** Single render loop tick. */
  private onUpdate(dt: number) {
    this.stepWorldTick();
    this.stepPlayer(dt, performance.now());
    this.stepDoors(dt);
    this.stepFarmAnimals();
    this.stepRetailStock();
    this.stepCeilingLamps();
    this.stepCheckout(dt);
    this.stepProductionMachines();
    this.stepCartBay();
    this.stepReturnsCubicle();
    this.stepPurchaseMarkersAnimation(dt);
    this.stepTransferBursts(dt);
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

  /** QA/debug-only accessor (phase 10): the real gait `timeScale`
   * (`AnimComponent.speed`, see `updatePlayerAnimation()`'s doc comment) and
   * current clip currently applied to the player's own anim component, so
   * headless verification can confirm continuous retiming instead of only
   * the discrete Idle/Walk/Run switch. */
  getPlayerAnimDebug() {
    return { clip: this.playerAnimTarget, speed: this.playerAnimEntity?.anim?.speed ?? null };
  }

  /** QA/debug-only accessor (phase 10): every real farm-animal actor's live
   * state — whether its `stationGroup` (coop/station shell + animal) is
   * currently shown, whether the real GLB has finished loading, and its
   * current clip/local position — so headless verification can confirm the
   * live chicken/cow character (not just the static paddock/coop) without
   * screenshot-diffing. */
  /** QA/debug-only accessor (phase 10): every currently-rendered purchase
   * marker's real funded/highlighted/enabled-fill state, so headless
   * verification can confirm the visual floor square without
   * screenshot-diffing. */
  getPurchaseMarkerDebug() {
    return Array.from(this.purchaseMarkerEntries.entries()).map(([id, entry]) => ({
      id,
      highlighted: entry.highlighted,
      fillVisible: entry.fillEntity.enabled,
      fillScale: entry.fillEntity.getLocalScale().x,
      label: entry.label,
      remainingLabel: entry.remainingLabel,
      labelText: entry.labelEntity.element!.text,
      remainingText: entry.remainingEntity.element!.text,
    }));
  }

  /** QA/debug-only accessor (phase 10): every open lane's real rendered
   * cash-bundle count, plus (phase 14) the "RECOGER" label's local Y
   * position, so headless verification can confirm it tracks the stack
   * height without screenshot-diffing. */
  getRegisterCashDebug() {
    return Array.from(this.registerCashEntries.entries()).map(([lane, entry]) => ({ lane, bundleCount: entry.bundleCount, labelText: entry.label.element!.text, labelY: entry.label.getLocalPosition().y }));
  }

  getFarmAnimalDebug() {
    return this.farmAnimalActors.map((actor) => {
      const position = actor.characterGroup.getLocalPosition();
      return {
        kind: actor.kind,
        machineId: actor.machineId,
        areaId: actor.areaId,
        stationVisible: actor.stationGroup.enabled,
        loaded: actor.entity !== null,
        clip: actor.currentClip,
        localPosition: { x: position.x, y: position.y, z: position.z },
      };
    });
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
    this.transferBursts.clear();
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
    // Every farm animal actor lives under the furniture group being torn
    // down above — drop the stale list so `stepFarmAnimals()` never touches
    // a destroyed entity while `buildFarmEstate()` below repopulates it.
    this.farmAnimalActors.length = 0;
    // Same story for retail stock actors — every pooled unit entity lives
    // under a fixture `element` inside the group being torn down above.
    this.retailStockActors.length = 0;
    // Same story for checkout-lane/production-machine dynamic entries — every
    // material/text/light/pooled unit they reference lives under the group
    // being torn down above.
    this.checkoutLaneEntries.clear();
    this.machineBoardEntries.clear();
    // Same story for the returns-cubicle unit pool and cart-bay entries.
    this.returnsUnitsGroup = null;
    this.returnsBinSignature = "";
    this.cartBayEntities.length = 0;
    // Same story for the decorative ceiling-lamp actors — every lamp entity
    // lives under the group being torn down above.
    this.ceilingLampActors.length = 0;
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
        const positions = retailFixtureDisplayPositions(id, unlockedAreas);
        positions.forEach((position, fixtureIndex) => {
          const { element, screens } = this.buildDepartmentFixture(group, department, [...position] as [number, number, number], department.yaw ?? 0);
          this.attachRetailStockPools(element, department, fixtureIndex, positions.length, screens);
        });
        continue;
      }
      const { element, screens } = this.buildDepartmentFixture(group, department, [...department.display] as [number, number, number], department.yaw ?? 0);
      this.attachRetailStockPools(element, department, 0, 1, screens);
    }

    this.buildCheckoutLanes(group, unlockedAreas);
    this.buildProductionMachines(group, unlockedAreas);
    this.buildServiceFixtures(group);
    this.buildFarmEstate(group, unlockedAreas, crops);
    this.buildDecorativeFixtures(group);
  }

  /**
   * Real port of `WorldKit/production/storeUtilities.ts`'s `buildWallClock`,
   * `buildSecurityCamera`, `buildHangingSign` and (structurally)
   * `buildCeilingLamp` — the wall clock, two security cameras, "CAJAS"/
   * "DESPENSA" hanging signs and four ceiling lamps, none of which had any
   * PlayCanvas equivalent before this pass. The ceiling lamps get a real
   * `pc.Entity` point light (toggled by `stepCeilingLamps()`, reading
   * `franchise.lightsOn` every frame exactly like `stepFarmAnimals()`/
   * `stepRetailStock()` read their own store fields) plus the real
   * `equipment_ceiling_light` GLB with every one of its materials' emissive
   * toggled — same on/off behavior as the source's
   * `applyEmissive`/`syncLight` (see the ceiling-lamp loop's own doc comment
   * below for the GLB conversion pipeline). Every position/dimension below is
   * copied verbatim from the source (`storeUtilities.ts` lines ~22-64,
   * ~150-176), via the same scaleStorePosition + STORE_ELEMENT_SCALE
   * `makeStoreElement()` convention every other fixture in this file uses.
   */
  private buildDecorativeFixtures(parent: pc.Entity) {
    const S = STORE_ELEMENT_SCALE;
    const element = (name: string, position: [number, number, number], yawDeg = 0) => {
      const scaled = scaleStorePosition(position);
      const el = new pc.Entity(name);
      el.setLocalPosition(scaled[0], scaled[1], scaled[2]);
      el.setEulerAngles(0, yawDeg, 0);
      el.setLocalScale(S, S, S);
      parent.addChild(el);
      return el;
    };

    // Wall clock.
    const clock = element("wall-clock", [STORE_REAR_DOOR.adjacentRackPosition[0], 2.2, -8.34]);
    const face = new pc.Entity("clock-face");
    face.addComponent("render", { type: "cylinder", material: this.material("#f7f2e2") });
    face.setLocalScale(0.68, 0.08, 0.68);
    clock.addChild(face);
    const minuteHand = new pc.Entity("clock-minute-hand");
    minuteHand.addComponent("render", { type: "box", material: this.material("#303735") });
    minuteHand.setLocalScale(0.025, 0.25, 0.025);
    minuteHand.setLocalPosition(0, -0.045, 0.05);
    minuteHand.setEulerAngles(90, 0, 0);
    clock.addChild(minuteHand);
    const hourHand = new pc.Entity("clock-hour-hand");
    hourHand.addComponent("render", { type: "box", material: this.material("#303735") });
    hourHand.setLocalScale(0.02, 0.18, 0.02);
    hourHand.setLocalPosition(0.09, 0.02, 0.055);
    hourHand.setEulerAngles(90, 0, (-0.85 * 180) / Math.PI);
    clock.addChild(hourHand);

    // Security cameras.
    const buildCamera = (name: string, position: [number, number, number], yawDeg: number) => {
      const cam = element(name, position, yawDeg);
      const body = new pc.Entity("camera-body");
      body.addComponent("render", { type: "box", material: this.material("#e6e9e3") });
      body.setLocalScale(0.42, 0.22, 0.2);
      cam.addChild(body);
      const lens = new pc.Entity("camera-lens");
      lens.addComponent("render", { type: "cylinder", material: this.material("#202725") });
      lens.setLocalScale(0.12, 0.01, 0.12);
      lens.setLocalPosition(0, 0, 0.12);
      lens.setEulerAngles(90, 0, 0);
      cam.addChild(lens);
      const mount = new pc.Entity("camera-mount");
      mount.addComponent("render", { type: "box", material: this.material("#303a36") });
      mount.setLocalScale(0.06, 0.35, 0.06);
      mount.setLocalPosition(0, 0.22, -0.05);
      cam.addChild(mount);
    };
    buildCamera("security-camera-left", [-10.75, 2.55, -8.05], 0);
    buildCamera("security-camera-right", [10.65, 2.55, 7.2], 180);

    // Hanging signs.
    const buildHangingSign = (name: string, label: string, position: [number, number, number]) => {
      const sign = element(name, position);
      const board = new pc.Entity("sign-board");
      board.addComponent("render", { type: "box", material: this.material("#344c3e") });
      board.setLocalScale(1.55, 0.46, 0.09);
      sign.addChild(board);
      this.buildText(sign, "sign-label-front", label, 0.175, [0, 0, 0.052], "#fff1cc");
      const back = this.buildText(sign, "sign-label-back", label, 0.175, [0, 0, -0.052], "#fff1cc");
      back.setEulerAngles(0, 180, 0);
      for (const x of [-0.56, 0.56]) {
        const post = new pc.Entity("sign-post");
        post.addComponent("render", { type: "box", material: this.material("#303a36") });
        post.setLocalScale(0.025, 0.55, 0.025);
        post.setLocalPosition(x, 0.45, 0);
        sign.addChild(post);
      }
    };
    buildHangingSign("hanging-sign-checkout", "CAJAS", [7.25, 2.45, 1.65]);
    buildHangingSign("hanging-sign-pantry", "DESPENSA", [-3.8, 2.45, -3.35]);

    // Ceiling lamps — real point light + real `equipment_ceiling_light` GLB
    // (port of `storeUtilities.ts`'s `buildCeilingLamp`: the source clones
    // the loaded GLB per lamp and toggles EVERY MeshStandardMaterial's
    // emissive, not a single named bulb mesh — `stepCeilingLamps()` mirrors
    // that over `modelMaterials`). The source's GLB requires
    // `EXT_meshopt_compression` + `KHR_mesh_quantization` (confirmed via
    // `gltf-transform inspect`, same problem `PRODUCTION_MODEL_ROOT`'s doc
    // comment describes), so it's stripped the identical way into this
    // repo's own `playcanvas-production/` directory (co-located with the
    // other converted GLBs, not a separate `environment` directory, matching
    // `ANIMAL_MODEL_ROOT`'s own precedent for a budget-tier asset moved
    // there for the same reason):
    //   npx gltf-transform copy budget/environment/equipment_ceiling_light.glb playcanvas-production/equipment_ceiling_light.glb
    //   npx gltf-transform dequantize playcanvas-production/equipment_ceiling_light.glb playcanvas-production/equipment_ceiling_light.glb
    // `loadAccessoryEntity()` creates a fresh `pc.Asset`/container per call
    // (no cross-lamp caching), so each lamp's instantiated materials are
    // already isolated from every other lamp's — no explicit per-instance
    // material clone needed the way the source's Three.js path requires one.
    for (const x of [-7.2, -2.4, 2.4, 7.2]) {
      const lampElement = element(`ceiling-lamp:${x}`, [x, 2.85, -0.6]);
      const modelAnchor = new pc.Entity("lamp-model");
      lampElement.addChild(modelAnchor);
      const modelMaterials: pc.StandardMaterial[] = [];
      void this.loadAccessoryEntity(`${PRODUCTION_MODEL_ROOT}/equipment_ceiling_light.glb`, `fixture-model:ceiling-lamp:${x}`).then((entity) => {
        if (this.disposed || this.furnitureGroup !== parent || !entity) return;
        modelAnchor.addChild(entity);
        for (const render of entity.findComponents("render") as pc.RenderComponent[]) {
          for (const meshInstance of render.meshInstances) {
            const material = meshInstance.material as pc.StandardMaterial;
            modelMaterials.push(material);
          }
        }
      });
      const light = new pc.Entity("lamp-light");
      light.addComponent("light", { type: "point", color: hexToColor("#fff2c9"), intensity: 0, range: 4 });
      light.setLocalPosition(0, -0.15, 0);
      lampElement.addChild(light);
      this.ceilingLampActors.push({ light, modelMaterials });
    }
  }

  /** Real per-frame ceiling-lamp on/off — reads `franchise.lightsOn` directly
   * off the store (like `stepFarmAnimals()` reads `productionMachines`),
   * toggling each lamp's emissive bulb material and point-light intensity
   * exactly like the source's `applyEmissive`/`syncLight`. */
  private stepCeilingLamps() {
    if (this.ceilingLampActors.length === 0) return;
    const game = useMarketStore.getState().game;
    const franchise = game?.franchises.find((item) => item.id === game.currentFranchiseId) ?? game?.franchises[0];
    const on = franchise?.lightsOn ?? false;
    for (const actor of this.ceilingLampActors) {
      for (const material of actor.modelMaterials) {
        material.emissive = hexToColor(on ? "#fff0b8" : "#000000");
        material.emissiveIntensity = on ? 1.1 : 0;
        material.update();
      }
      if (actor.light.light) actor.light.light.intensity = on ? 0.18 : 0;
    }
  }

  /** Procedural (real box/plate/roller-primitive assembly, not a box-volume
   * placeholder) port of `checkout/checkoutKit.ts`'s real counter housing —
   * `buildCheckoutKit()` for an open lane, `buildClosedCheckoutKit()` for a
   * closed one. That Three.js source itself builds the counter entirely from
   * primitives (no GLB exists for it), so this reproduces the same shapes —
   * body, top plate, conveyor mat, belt rollers, bagging shelf, register
   * housing + screen, card reader + glow plate, bagging counter, sign
   * pole/board — at the same real local dimensions (`STORE_ELEMENT_SCALE`
   * applied the same way every other fixture in this file applies it, since
   * `checkoutKit.ts`'s own numbers are already in `makeStoreElement`'s
   * pre-scale local-unit convention — confirmed against `BASE_STORE_OBSTACLES`'s
   * checkout halfX/halfZ (2.25/0.65) in `world-scale.ts`, which match this
   * body's 4.45×1.18 footprint exactly).
   *
   * Phase 15: an open lane also gets the belt point light (toggled by
   * `intensity`, never `.visible` — same crowd-recompile-safety rule as every
   * other point light this file toggles, see `buildBakeryKit`'s doc comment
   * in `machines.ts` for why), the belt-light strip's emissive glow, the
   * register screen glow + its dynamic "LISTA"/"bagged/total" text, the
   * card-reader glow, the three checkout bags and the sliding belt product
   * units — all registered into `checkoutLaneEntries` for `stepCheckout()` to
   * drive every frame/transaction change, exactly mirroring
   * `checkoutKit.ts`'s own `update()`/`animate()`. The static "CAJA N" board
   * text is build-time constant (the lane number never changes), so it uses
   * `buildText()`, not the dynamic pipeline. */
  private buildCheckoutLanes(parent: pc.Entity, unlockedAreas: string[]) {
    for (const lane of CHECKOUT_LANE_IDS as readonly CheckoutLane[]) {
      const open = lane === 0 || unlockedAreas.includes(checkoutAreaForLane(lane));
      const layout = CHECKOUT_LANES[lane];
      const counter = new pc.Entity(`checkout-counter-${lane}`);
      const counterScaled = scaleStorePosition([...layout.counter] as [number, number, number]);
      counter.setLocalPosition(counterScaled[0], counterScaled[1], counterScaled[2]);
      parent.addChild(counter);
      const s = STORE_ELEMENT_SCALE;

      this.box(counter, { size: [4.45 * s, 0.92 * s, 1.18 * s], pos: [0, 0.46 * s, 0], color: open ? "#344c3e" : "#8a8478", name: "body" });
      this.box(counter, { size: [4.24 * s, 0.16 * s, 1.08 * s], pos: [0, 0.98 * s, 0], color: "#d8dedb", name: "top-plate" });

      if (!open) {
        // `buildClosedCheckoutKit()`: dark strip + blank sign backing, no belt/register/card-reader detail.
        this.box(counter, { size: [3.72 * s, 0.13 * s, 0.42 * s], pos: [0, 1.1 * s, 0], color: "#26332f", name: "closed-strip" });
        this.box(counter, { size: [1.74 * s, 0.46 * s, 0.08 * s], pos: [0, 1.48 * s, 0.04 * s], color: "#f1dfad", name: "closed-sign" });
        continue;
      }

      this.box(counter, { size: [2.55 * s, 0.08 * s, 0.82 * s], pos: [-0.66 * s, 1.08 * s, 0], color: "#252d2b", name: "conveyor-mat" });
      for (let index = 0; index < 9; index += 1) {
        this.box(counter, { size: [0.025 * s, 0.018 * s, 0.78 * s], pos: [(-1.7 + index * 0.28) * s, 1.125 * s, 0], color: "#68726f", name: "belt-roller" });
      }
      this.box(counter, { size: [0.52 * s, 0.11 * s, 0.94 * s], pos: [0.64 * s, 1.1 * s, 0], color: "#1f2a27", name: "bagging-shelf" });

      const beltLightMaterial = new pc.StandardMaterial();
      beltLightMaterial.diffuse = hexToColor("#8fe8c5");
      beltLightMaterial.emissive = hexToColor("#2d6553");
      beltLightMaterial.emissiveIntensity = 0.5;
      beltLightMaterial.update();
      const beltLight = new pc.Entity("belt-light");
      beltLight.addComponent("render", { type: "box", material: beltLightMaterial });
      beltLight.setLocalScale(0.27 * s, 0.018 * s, 0.57 * s);
      beltLight.setLocalPosition(0.64 * s, 1.165 * s, 0);
      counter.addChild(beltLight);

      this.box(counter, { size: [0.86 * s, 0.18 * s, 0.62 * s], pos: [1.28 * s, 1.13 * s, -0.18 * s], color: "#24302d", name: "register-housing" });

      // `mainLight`/`scanningLight` from `checkoutKit.ts` — real point lights,
      // always `enabled = true` and toggled only via `intensity` (never
      // `.visible`/`.enabled`), for the same reason every other toggled light
      // in this file stays always-on: flipping `enabled` changes the live
      // light COUNT the forward renderer's shader variant is keyed on, which
      // would force a synchronous shader recompile for every lit material in
      // the scene (crowd bodies worst of all) the instant a cashier starts
      // scanning. `intensity = 0` contributes exactly the same zero light.
      const mainLight = new pc.Entity("checkout-main-light");
      mainLight.addComponent("light", { type: "point", color: hexToColor("#fff0d2"), intensity: 0.72, range: 5.8 * s });
      mainLight.setLocalPosition(0, 2.7 * s, -1.7 * s);
      counter.addChild(mainLight);

      const scanningLightOnIntensity = 1.4;
      const scanningLight = new pc.Entity("checkout-scanning-light");
      scanningLight.addComponent("light", { type: "point", color: hexToColor("#64ffc2"), intensity: 0, range: 1.4 * s });
      scanningLight.setLocalPosition(0.64 * s, 1.35 * s, 0);
      counter.addChild(scanningLight);

      const screenBack = this.box(counter, { size: [0.72 * s, 0.62 * s, 0.1 * s], pos: [1.28 * s, 1.61 * s, -0.13 * s], color: "#25322f", name: "screen-back" });
      screenBack.setEulerAngles((-0.23 * 180) / Math.PI, 0, 0);
      const screenGlowMaterial = new pc.StandardMaterial();
      screenGlowMaterial.diffuse = hexToColor("#bde9d8");
      screenGlowMaterial.emissive = hexToColor("#27463d");
      screenGlowMaterial.emissiveIntensity = 0.8;
      screenGlowMaterial.update();
      const screenGlow = new pc.Entity("screen-glow");
      screenGlow.addComponent("render", { type: "plane", material: screenGlowMaterial });
      screenGlow.setLocalScale(0.56 * s, 1, 0.42 * s);
      screenGlow.setLocalPosition(1.28 * s, 1.62 * s, -0.07 * s);
      screenGlow.setLocalEulerAngles(90 - (0.23 * 180) / Math.PI, 0, 0);
      counter.addChild(screenGlow);
      const screenText = this.buildDynamicText(counter, "screen-text", "LISTA", 0.11 * s, [1.28 * s, 1.63 * s, -0.01 * s], "#173f35");
      screenText.setLocalEulerAngles((-0.23 * 180) / Math.PI, 0, 0);

      this.box(counter, { size: [0.32 * s, 0.13 * s, 0.5 * s], pos: [1.78 * s, 1.16 * s, 0.24 * s], color: "#e8ece7", name: "card-reader" });
      const cardGlowMaterial = new pc.StandardMaterial();
      cardGlowMaterial.diffuse = hexToColor("#77948a");
      cardGlowMaterial.emissive = hexToColor("#42a776");
      cardGlowMaterial.emissiveIntensity = 0.18;
      cardGlowMaterial.update();
      const cardGlow = new pc.Entity("card-glow");
      cardGlow.addComponent("render", { type: "plane", material: cardGlowMaterial });
      cardGlow.setLocalScale(0.21 * s, 1, 0.18 * s);
      cardGlow.setLocalPosition(1.78 * s, 1.26 * s, 0.26 * s);
      cardGlow.setLocalEulerAngles(90 - (0.42 * 180) / Math.PI, 0, 0);
      counter.addChild(cardGlow);

      this.box(counter, { size: [0.92 * s, 0.5 * s, 0.82 * s], pos: [1.67 * s, 0.48 * s, 0], color: "#eff1e8", name: "bag-counter" });

      const bagA = this.buildCheckoutBagEntry(counter, s);
      const bagB = this.buildCheckoutBagEntry(counter, s);
      const bagC = this.buildCheckoutBagEntry(counter, s);
      bagA.update(0, [1.67 * s, 1.02 * s, 0], false);
      bagB.update(0, [1.67 * s, 1.02 * s, 0], false);
      bagC.update(0, [1.67 * s, 1.02 * s, 0], false);

      const unitsGroup = new pc.Entity("checkout-units");
      counter.addChild(unitsGroup);

      this.box(counter, { size: [0.06 * s, 2.35 * s, 0.06 * s], pos: [-1.55 * s, 2.32 * s, -0.48 * s], color: "#4b5b56", name: "sign-pole" });
      this.box(counter, { size: [0.98 * s, 0.58 * s, 0.12 * s], pos: [-1.55 * s, 3.08 * s, -0.44 * s], color: "#f4e4ad", name: "sign-board" });
      this.buildText(counter, `checkout-sign-${lane}`, `CAJA ${lane + 1}`, 0.24 * s, [-1.55 * s, 3.09 * s, -0.36 * s], "#24453d");

      this.checkoutLaneEntries.set(lane, {
        lane,
        beltLightMaterial,
        scanningLight,
        scanningLightOnIntensity,
        screenGlowMaterial,
        screenText,
        cardGlowMaterial,
        bagA,
        bagB,
        bagC,
        unitsGroup,
        liveUnits: new Map(),
      });

      const cashierScaled = scaleStorePosition([...layout.cashierWork] as [number, number, number]);
      const cashierSpot = new pc.Entity(`checkout-cashier-${lane}`);
      cashierSpot.setLocalPosition(cashierScaled[0], cashierScaled[1], cashierScaled[2]);
      parent.addChild(cashierSpot);
      this.box(cashierSpot, { size: [0.5 * s, 0.03 * s, 0.5 * s], pos: [0, 0, 0], color: "#4b6f5f", name: "mat" });
    }
  }

  /** One checkout bag: body box + a static handle box (no torus primitive in
   * PlayCanvas) + a content box shown once `fill > 0`. Mirrors
   * `checkoutKit.ts`'s `buildCheckoutBag()`; `s` is `STORE_ELEMENT_SCALE`,
   * applied the same manual per-child way every other checkout-counter part
   * in this method applies it. */
  private buildCheckoutBagEntry(parent: pc.Entity, s: number): CheckoutBagEntry {
    const group = new pc.Entity("checkout-bag");
    parent.addChild(group);

    const bag = new pc.Entity("bag-body");
    bag.addComponent("render", { type: "box", material: this.material("#c7935e") });
    bag.setLocalScale(0.56 * s, 0.72 * s, 0.42 * s);
    group.addChild(bag);

    const handle = new pc.Entity("bag-handle");
    handle.addComponent("render", { type: "box", material: this.material("#8b623d") });
    handle.setLocalScale(0.36 * s, 0.05 * s, 0.05 * s);
    handle.setLocalPosition(0, 0.41 * s, 0);
    group.addChild(handle);

    const content = new pc.Entity("bag-content");
    content.addComponent("render", { type: "box", material: this.material("#e0b44a") });
    content.setLocalScale(0.4 * s, 0.12 * s, 0.3 * s);
    content.setLocalPosition(0, 0.26 * s, 0);
    content.enabled = false;
    group.addChild(content);

    function update(fill: number, position: [number, number, number], visible: boolean) {
      group.enabled = visible;
      group.setLocalPosition(position[0], position[1], position[2]);
      bag.setLocalScale(0.56 * s, (0.72 + fill * 0.28) * s, 0.42 * s);
      content.enabled = fill > 0;
    }
    return { group, content, update };
  }

  /** Faithful port of `machines.ts`'s `buildMachineIdentity()`: the plinth +
   * top plate every production fixture shares, plus the illuminated board
   * (front label/process-label, a mirrored back label, and the
   * `dynamic:machine-status` block — "LISTO", the output "x/y", the
   * ingredient name, the queued "x/y" and the status label + dot, all driven
   * every frame by `stepProductionMachines()`). Registers the dynamic text
   * entities + status-dot material into a `MachineBoardEntry`, keyed by
   * `fixture.machineId` — the caller (`buildProductionMachines()`) fills in
   * the per-kind `processingLight`/`outputSlots`/`cannerIndicatorMaterial`
   * fields and adds the entry to `machineBoardEntries`. */
  private buildMachineIdentityBoard(element: pc.Entity, fixture: ProductionFixtureLayout): Omit<MachineBoardEntry, "machineId" | "processingLight" | "processingLightOnIntensity" | "outputSlots" | "cannerIndicatorMaterial"> {
    const s = STORE_ELEMENT_SCALE;
    this.box(element, { size: [1.22 * s, 0.13 * s, 1.05 * s], pos: [0, 0.065 * s, -0.53 * s], color: "#55635f", name: "identity-plinth" });
    this.box(element, { size: [1.08 * s, 0.06 * s, 0.9 * s], pos: [0, 0.145 * s, -0.53 * s], color: "#c7ceca", name: "identity-plinth-top" });

    const board = new pc.Entity("identity-board");
    board.setLocalPosition(0, 2.3 * s, 0.12 * s);
    element.addChild(board);
    this.box(board, { size: [1.52 * s, 1.1 * s, 0.12 * s], pos: [0, 0, 0], color: "#223832", name: "board-back" });
    this.buildText(board, `machine-label:${fixture.obstacleId}`, fixture.label, 0.19 * s, [0, 0.39 * s, 0.068 * s], "#fff5d8");
    this.buildText(board, `machine-process:${fixture.obstacleId}`, fixture.processLabel, 0.082 * s, [0, 0.22 * s, 0.069 * s], fixture.accent);
    const backLabel = this.buildText(board, `machine-label-back:${fixture.obstacleId}`, fixture.label, 0.19 * s, [0, 0.39 * s, -0.068 * s], "#fff5d8");
    backLabel.setLocalEulerAngles(0, 180, 0);

    const statusGroup = new pc.Entity("dynamic-machine-status");
    board.addChild(statusGroup);
    this.buildDynamicText(statusGroup, "machine-ready", "LISTO", 0.13 * s, [-0.63 * s, 0, 0.07 * s], "#bcd9cc", undefined, "left");
    const outputText = this.buildDynamicText(statusGroup, "machine-output", "0/0", 0.26 * s, [0.63 * s, 0, 0.07 * s], "#ffffff", undefined, "right");
    const ingredientText = this.buildDynamicText(statusGroup, "machine-ingredient", "COLA", 0.11 * s, [-0.63 * s, -0.22 * s, 0.07 * s], "#bcd9cc", undefined, "left");
    const queuedText = this.buildDynamicText(statusGroup, "machine-queued", "0/0", 0.17 * s, [0.63 * s, -0.22 * s, 0.07 * s], "#ffffff", undefined, "right");
    const statusLabelText = this.buildDynamicText(statusGroup, "machine-status-label", "BLOQUEADA", 0.155 * s, [0.63 * s, -0.43 * s, 0.07 * s], "#9ea7a3", undefined, "right");

    const statusDotMaterial = new pc.StandardMaterial();
    statusDotMaterial.diffuse = hexToColor("#9ea7a3");
    statusDotMaterial.update();
    const statusDot = new pc.Entity("machine-status-dot");
    statusDot.addComponent("render", { type: "sphere", material: statusDotMaterial });
    statusDot.setLocalScale(0.1 * s, 0.1 * s, 0.1 * s);
    statusDot.setLocalPosition(-0.6 * s, -0.43 * s, 0.07 * s);
    statusGroup.addChild(statusDot);

    return { outputText, ingredientText, queuedText, statusLabelText, statusDotMaterial };
  }

  /** Port of `kitFurniture.ts`'s production machines (real positions from
   * `STORE_PRODUCTION_FIXTURES`, real per-machine gating via
   * `fixtureAvailable(fixture.obstacleId, unlockedAreas)`). Four of the five
   * fixtures now load the same real static GLB `machines.ts`'s
   * `buildBakeryKit()`/`buildMillMachine()`/`buildProcessMachine()` attach for
   * that exact machine (see `PRODUCTION_MODEL_ROOT`/`ENVIRONMENT_MODEL_ROOT`'s
   * doc comments); the corn canner is now a real procedural primitive
   * assembly too (see `buildCornCannerDetail()`), matching `machines.ts`'s own
   * `buildCornCanner()` — there is still no real canner GLB to port, but the
   * housing/hopper/pipe/indicator/can shapes are.
   *
   * Phase 15: every fixture now also gets the real illuminated status board
   * (`buildMachineIdentityBoard()` above), registered into
   * `machineBoardEntries` for `stepProductionMachines()` to drive; bakery/
   * cheese/juice get their real processing point light
   * (`intensity`-toggled — same crowd-recompile-safety rule as every other
   * toggled light in this file), and cheese/juice/corn-canner get their real
   * `dynamic:machine-output` slot primitives (cheese: a cheese-colored
   * cylinder per slot; juice: a juice-bottle cylinder; corn canner: a
   * canned-corn cylinder — all from `RETAIL_PRODUCT_VISUAL`, the same
   * "one faithful-color/size primitive" trade this file already makes for
   * retail shelf stock/belt units), gated by `machine.output` exactly like
   * `machines.ts`'s own `slots.forEach((slot, index) => slot.visible = ...)`. */
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
    // Real per-kind processing-light color/intensity from `machines.ts`'s
    // `buildBakeryKit()`/`buildProcessMachine()` (mill has no processing
    // light in the source — its `update()` only forwards to `identity.update`).
    const PROCESSING_LIGHT_BY_WORKSTATION: Partial<Record<string, { color: string; onIntensity: number }>> = {
      bakery: { color: "#df8b43", onIntensity: 0.8 },
      cheese: { color: "#ffd75c", onIntensity: 0.45 },
      juice: { color: "#ff6b43", onIntensity: 0.45 },
    };
    // Real per-kind output-slot visual + `outputItemPosition()` count from
    // `machines.ts`'s `buildProcessMachine()`/`buildCornCanner()` (mill/bakery
    // have no `dynamic:machine-output` group in the source).
    const OUTPUT_SLOT_BY_WORKSTATION: Partial<Record<string, ProductId>> = {
      cheese: "cheese",
      juice: "juice",
      canner: "cannedCorn",
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
      const s = STORE_ELEMENT_SCALE;

      const identity = this.buildMachineIdentityBoard(element, fixture);

      let processingLight: pc.Entity | null = null;
      let processingLightOnIntensity = 0;
      const processingSpec = PROCESSING_LIGHT_BY_WORKSTATION[fixture.workstationId];
      if (processingSpec) {
        // Same `intensity`-not-`enabled` toggle rule as every other point
        // light in this file (see the checkout main/scanning lights' doc
        // comment above for why): a light that turns on/off for a live
        // machine must stay `enabled = true` for the whole session.
        processingLight = new pc.Entity("machine-processing-light");
        processingLight.addComponent("light", { type: "point", color: hexToColor(processingSpec.color), intensity: 0, range: (fixture.workstationId === "bakery" ? 2.2 : 1.6) * s });
        processingLight.setLocalPosition(0, (fixture.workstationId === "bakery" ? 0.95 : 0.65) * s, (fixture.workstationId === "bakery" ? 0.52 : 0.45) * s);
        element.addChild(processingLight);
        processingLightOnIntensity = processingSpec.onIntensity;
      }

      let cannerIndicatorMaterial: pc.StandardMaterial | null = null;
      const outputSlots: pc.Entity[] = [];
      const outputProductId = OUTPUT_SLOT_BY_WORKSTATION[fixture.workstationId];

      const model = MODEL_BY_WORKSTATION[fixture.workstationId];
      if (model) {
        const anchor = this.attachFixtureModel(element, ownerGroup, `${model.root}/${model.file}.glb`, `fixture-model:${fixture.obstacleId}`, STORE_ELEMENT_SCALE);
        anchor.setLocalPosition(centerX * STORE_ELEMENT_SCALE, model.y * STORE_ELEMENT_SCALE, centerZ * STORE_ELEMENT_SCALE);
      } else if (fixture.workstationId === "canner") {
        this.buildCornCannerDetail(element);
        const indicatorMaterial = new pc.StandardMaterial();
        indicatorMaterial.diffuse = hexToColor("#d1ae56");
        indicatorMaterial.update();
        const indicator = new pc.Entity("canner-indicator");
        indicator.addComponent("render", { type: "sphere", material: indicatorMaterial });
        indicator.setLocalScale(0.09 * s, 0.09 * s, 0.09 * s);
        indicator.setLocalPosition(0.44 * s, 0.85 * s, 0.012 * s);
        element.addChild(indicator);
        cannerIndicatorMaterial = indicatorMaterial;
      } else {
        const body = new pc.Entity("machine");
        body.addComponent("render", { type: "box", material: this.material(fixture.accent) });
        body.setLocalScale(halfX * 2 * STORE_ELEMENT_SCALE, 1.1 * STORE_ELEMENT_SCALE, halfZ * 2 * STORE_ELEMENT_SCALE);
        body.setLocalPosition(centerX * STORE_ELEMENT_SCALE, 0.55 * STORE_ELEMENT_SCALE, centerZ * STORE_ELEMENT_SCALE);
        element.addChild(body);
      }

      if (outputProductId) {
        const outputGroup = new pc.Entity("dynamic-machine-output");
        element.addChild(outputGroup);
        const spec = RETAIL_PRODUCT_VISUAL[outputProductId];
        for (let index = 0; index < 4; index += 1) {
          const [ox, oy, oz] = machineOutputSlotPosition(index);
          const slot = new pc.Entity(`output-slot-${index}`);
          slot.addComponent("render", { type: spec.shape, material: this.material(spec.color) });
          slot.setLocalScale(spec.size[0] * 0.8 * s, spec.size[1] * 0.8 * s, spec.size[2] * 0.8 * s);
          slot.setLocalPosition(ox * s, oy * s, oz * s);
          slot.enabled = false;
          outputGroup.addChild(slot);
          outputSlots.push(slot);
        }
      }

      this.machineBoardEntries.set(fixture.machineId, {
        machineId: fixture.machineId,
        ...identity,
        processingLight,
        processingLightOnIntensity,
        outputSlots,
        cannerIndicatorMaterial,
      });
    }
  }

  /** Procedural (real box/cylinder/sphere-primitive assembly, not a box-
   * volume placeholder) port of `production/machines.ts`'s `buildCornCanner()`
   * — that Three.js source builds the canner entirely from primitives too (no
   * GLB exists for it), so this reproduces the same shapes at the same real
   * local dimensions relative to the fixture element (`STORE_ELEMENT_SCALE`
   * applied the same way every other production fixture in this file applies
   * it): the housing, its top plate, the intake hopper (pipe stem + lid box),
   * the vertical feed pipe (cylinder) and one static labelled can standing at
   * the outfeed. The status indicator sphere, the four dynamic output-slot
   * cans and the identity board are built by `buildProductionMachines()`
   * itself (phase 15) — see its own doc comment. */
  private buildCornCannerDetail(element: pc.Entity) {
    const s = STORE_ELEMENT_SCALE;
    this.box(element, { size: [1.2 * s, 0.85 * s, 1.1 * s], pos: [0, 0.6 * s, -0.55 * s], color: "#97aaa4", name: "canner-body" });
    this.box(element, { size: [1.1 * s, 0.12 * s, 0.7 * s], pos: [0, 1.09 * s, -0.48 * s], color: "#334840", name: "canner-top-plate" });
    this.box(element, { size: [0.14 * s, 0.65 * s, 0.14 * s], pos: [0.4 * s, 1.45 * s, -0.8 * s], color: "#65833d", name: "canner-hopper-stem" });
    this.box(element, { size: [0.65 * s, 0.15 * s, 0.4 * s], pos: [0.12 * s, 1.74 * s, -0.65 * s], color: "#65833d", name: "canner-hopper-lid" });

    const pipe = new pc.Entity("canner-feed-pipe");
    pipe.addComponent("render", { type: "cylinder", material: this.material("#c2cdca") });
    pipe.setLocalScale(0.2 * s, 0.35 * s, 0.2 * s);
    pipe.setLocalPosition(-0.03 * s, 1.47 * s, -0.55 * s);
    element.addChild(pipe);

    // The status indicator sphere is built by `buildProductionMachines()`
    // itself now (phase 15), as a dedicated per-instance material so
    // `stepProductionMachines()` can recolor it via `cannerIndicatorMaterial`
    // — not here, where `this.material()`'s shared cache would recolor every
    // canner (and anything else using that exact hex) at once.

    // `buildCannedCornGroup()`'s static can standing at the outfeed —
    // approximated with a tin-colored cylinder + a paler label band, matching
    // `CannedCornModel`'s real tin/label colors without importing its Three
    // geometry (this file has no THREE dependency).
    const can = new pc.Entity("canner-static-can");
    can.setLocalPosition(-0.03 * s, 1.26 * s, -0.55 * s);
    element.addChild(can);
    const tin = new pc.Entity("tin");
    tin.addComponent("render", { type: "cylinder", material: this.material("#c9cdd0") });
    tin.setLocalScale(0.14 * s, 0.16 * s, 0.14 * s);
    can.addChild(tin);
    const label = new pc.Entity("label");
    label.addComponent("render", { type: "cylinder", material: this.material("#e8c94a") });
    label.setLocalScale(0.142 * s, 0.09 * s, 0.142 * s);
    can.addChild(label);
  }

  /** Ungated service furniture (`STORE_SERVICE_FIXTURES` + the warehouse
   * return crate) — always present in the base game. "orders"/"returns"/
   * "cartBay" are now real procedural ports of
   * `production/supplierAndWarehouse.ts`'s `SupplierCorner` /
   * `checkout/returnsCubicle.ts` / `checkout/cartBay.ts` (see
   * `buildSupplierCornerDetail()`/`buildReturnsCubicleDetail()`/
   * `buildCartBayDetail()` below), each with the real dynamic detail (or, for
   * "orders", the real static PEDIDOS terminal + delivery-dock GLB + pallet/
   * parcels — the source itself gives it no live prop). */
  private buildServiceFixtures(parent: pc.Entity) {
    this.buildSupplierCornerDetail(parent, STORE_SERVICE_FIXTURES.orders);
    this.buildReturnsCubicleDetail(parent, STORE_SERVICE_FIXTURES.returns);
    this.buildCartBayDetail(parent, STORE_SERVICE_FIXTURES.cartBay);
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

  /** Procedural (real box/sphere/text-primitive assembly, + the real
   * `equipment_delivery_dock` GLB) port of `production/supplierAndWarehouse
   * .ts`'s `SupplierCorner` (`buildTerminalModel`/`buildPallet`/
   * `buildParcel`): the PEDIDOS terminal facing the sales floor, with the
   * delivery dock/pallet/parcels backing onto the rear wall behind it,
   * matching the source's own layout comment verbatim. Fully static — the
   * source gives `SupplierCorner` no live prop (`<MemoSupplierCorner
   * position={[0, 0, 0]} />` in `kitFurniture.ts`), so this needs no
   * `update()`. */
  private buildSupplierCornerDetail(parent: pc.Entity, fixture: StoreServiceFixture) {
    const s = STORE_ELEMENT_SCALE;
    const scaled = scaleStorePosition([...fixture.position] as [number, number, number]);
    const element = new pc.Entity(`fixture:${fixture.obstacleId}`);
    element.setLocalPosition(scaled[0], scaled[1], scaled[2]);
    parent.addChild(element);

    const terminal = new pc.Entity("orders-terminal");
    terminal.setLocalPosition(0, 0, 0.62 * s);
    element.addChild(terminal);
    this.box(terminal, { size: [1.18 * s, 0.82 * s, 0.62 * s], pos: [0, 0.41 * s, 0], color: "#173f35", name: "terminal-body" });
    this.box(terminal, { size: [1.38 * s, 0.12 * s, 0.76 * s], pos: [0, 0.86 * s, 0.04 * s], color: "#f1e8cf", name: "terminal-top" });
    this.box(terminal, { size: [0.76 * s, 0.1 * s, 0.48 * s], pos: [0, 0.96 * s, 0.08 * s], color: "#303b38", name: "terminal-slot" });
    for (const x of [-0.24, -0.08, 0.08, 0.24]) {
      const button = this.box(terminal, { size: [0.09 * s, 0.025 * s, 0.18 * s], pos: [x * s, 1.025 * s, 0.16 * s], color: "#85938d", name: "terminal-button" });
      button.setLocalEulerAngles(-14.32, 0, 0);
    }
    const hood = this.box(terminal, { size: [0.76 * s, 0.64 * s, 0.1 * s], pos: [0, 1.38 * s, 0.03 * s], color: "#202b28", name: "terminal-hood" });
    hood.setLocalEulerAngles(-8.02, 0, 0);
    const screenMaterial = new pc.StandardMaterial();
    screenMaterial.diffuse = hexToColor("#c7eadc");
    screenMaterial.emissive = hexToColor("#40806a");
    screenMaterial.emissiveIntensity = 0.34;
    screenMaterial.update();
    const screen = new pc.Entity("terminal-screen");
    screen.addComponent("render", { type: "plane", material: screenMaterial });
    screen.setLocalScale(0.62 * s, 1, 0.48 * s);
    screen.setLocalPosition(0, 1.39 * s, 0.091 * s);
    screen.setLocalEulerAngles(90 - 8.02, 0, 0);
    terminal.addChild(screen);
    const screenLabel = this.buildText(terminal, "terminal-screen-text", "PEDIDOS", 0.105 * s, [0, 1.42 * s, 0.101 * s], "#173f35");
    screenLabel.setLocalEulerAngles(-8.02, 0, 0);
    const indicatorMaterial = new pc.StandardMaterial();
    indicatorMaterial.emissive = hexToColor("#8ce0a6");
    indicatorMaterial.emissiveIntensity = 1;
    indicatorMaterial.update();
    const indicator = new pc.Entity("terminal-indicator");
    indicator.addComponent("render", { type: "sphere", material: indicatorMaterial });
    indicator.setLocalScale(0.07 * s, 0.07 * s, 0.07 * s);
    indicator.setLocalPosition(-0.48 * s, 0.63 * s, 0.32 * s);
    terminal.addChild(indicator);

    const dock = new pc.Entity("orders-dock");
    dock.setLocalPosition(0, 0.52 * s, -0.9 * s);
    dock.setLocalScale(0.72 * s, 0.72 * s, 0.72 * s);
    element.addChild(dock);
    void this.loadAccessoryEntity(`${ENVIRONMENT_MODEL_ROOT}/equipment_delivery_dock.glb`, `fixture-model:${fixture.obstacleId}:dock`).then((model) => {
      if (this.disposed || this.furnitureGroup !== parent) return;
      if (model) dock.addChild(model);
    });

    const pallet = new pc.Entity("orders-pallet");
    pallet.setLocalPosition(-0.05 * s, 0, -0.68 * s);
    element.addChild(pallet);
    for (const z of [-0.32, 0, 0.32]) this.box(pallet, { size: [1.1 * s, 0.09 * s, 0.18 * s], pos: [0, 0.09 * s, z * s], color: "#a9764a", name: "pallet-board" });
    for (const x of [-0.43, 0, 0.43]) this.box(pallet, { size: [0.16 * s, 0.11 * s, 0.82 * s], pos: [x * s, 0.02 * s, 0], color: "#754c2f", name: "pallet-runner" });

    const buildParcel = (pos: [number, number, number], small: boolean) => {
      const parcel = new pc.Entity("orders-parcel");
      parcel.setLocalPosition(pos[0] * s, pos[1] * s, pos[2] * s);
      const scale = (small ? 0.72 : 1) * s;
      parcel.setLocalScale(scale, scale, scale);
      element.addChild(parcel);
      this.box(parcel, { size: [0.52, 0.44, 0.46], pos: [0, 0.22, 0], color: "#ba8050", name: "parcel-box" });
      this.box(parcel, { size: [0.08, 0.45, 0.47], pos: [0, 0.23, 0], color: "#d5ad70", name: "parcel-tape" });
    };
    buildParcel([-0.3, 0.34, -0.68], false);
    buildParcel([0.25, 0.34, -0.68], true);
    buildParcel([0.05, 0.73, -0.68], false);
  }

  /** Procedural (real box-primitive assembly) port of
   * `checkout/returnsCubicle.ts`'s static shell: body/inner boxes, the
   * "DEVOLUCIONES" sign (build-time constant text). Registers
   * `this.returnsUnitsGroup` for `stepReturnsCubicle()` to fill from the real
   * `franchise.returnsBin`. The fixed 180° yaw matches the source's own
   * `group.rotation.set(0, Math.PI, 0)` (baked into the cubicle itself, not
   * applied by the caller — `kitFurniture.ts`'s `makeStoreElement` wraps it
   * with position only). */
  private buildReturnsCubicleDetail(parent: pc.Entity, fixture: StoreServiceFixture) {
    const s = STORE_ELEMENT_SCALE;
    const scaled = scaleStorePosition([...fixture.position] as [number, number, number]);
    const element = new pc.Entity(`fixture:${fixture.obstacleId}`);
    element.setLocalPosition(scaled[0], scaled[1], scaled[2]);
    element.setEulerAngles(0, 180, 0);
    parent.addChild(element);

    this.box(element, { size: [1.35 * s, 1.25 * s, 1.05 * s], pos: [0, 0.63 * s, 0], color: "#d5c3aa", name: "returns-body" });
    this.box(element, { size: [1.05 * s, 0.72 * s, 0.82 * s], pos: [0, 0.86 * s, 0.04 * s], color: "#735847", name: "returns-inner" });
    this.box(element, { size: [1.42 * s, 0.34 * s, 0.08 * s], pos: [0, 1.31 * s, 0.54 * s], color: "#e7bb62", name: "returns-sign" });
    this.buildText(element, "returns-sign-text", "DEVOLUCIONES", 0.15 * s, [0, 1.31 * s, 0.59 * s], "#493821");

    const unitsGroup = new pc.Entity("returns-units");
    element.addChild(unitsGroup);
    this.returnsUnitsGroup = unitsGroup;
  }

  /** Procedural (real box/cylinder-primitive assembly, not the source's full
   * tube-instanced lattice — see `buildSimplifiedCart()`'s own doc comment)
   * port of `checkout/cartBay.ts`'s static shell (base plate, two side
   * rails + trim + cap spheres, the "CARROS" sign) plus the four pooled cart
   * entities `syncCartBay()`/`stepCartBay()` show 2-4 of, driven from the
   * real `franchise.returnedCartCount`. */
  private buildCartBayDetail(parent: pc.Entity, fixture: StoreServiceFixture) {
    const s = STORE_ELEMENT_SCALE;
    const scaled = scaleStorePosition([...fixture.position] as [number, number, number]);
    const element = new pc.Entity(`fixture:${fixture.obstacleId}`);
    element.setLocalPosition(scaled[0], scaled[1], scaled[2]);
    parent.addChild(element);

    this.box(element, { size: [2.1 * s, 0.07 * s, 1.45 * s], pos: [0, 0.035 * s, 0], color: "#596864", name: "cartbay-base" });
    for (const x of [-0.96, 0.96]) {
      this.box(element, { size: [0.075 * s, 1.34 * s, 1.45 * s], pos: [x * s, 0.67 * s, 0], color: "#53645f", name: "cartbay-rail" });
      this.box(element, { size: [0.16 * s, 0.14 * s, 1.48 * s], pos: [x * s, 0.18 * s, 0], color: "#d6a745", name: "cartbay-rail-trim" });
      const cap = new pc.Entity("cartbay-cap");
      cap.addComponent("render", { type: "sphere", material: this.material("#f0c45e") });
      cap.setLocalScale(0.2 * s, 0.2 * s, 0.2 * s);
      cap.setLocalPosition(x * s, 1.35 * s, 0);
      element.addChild(cap);
    }
    this.box(element, { size: [2.08 * s, 0.4 * s, 0.12 * s], pos: [0, 1.5 * s, -0.66 * s], color: "#f1e8cf", name: "cartbay-sign" });
    this.buildText(element, "cartbay-sign-text", "CARROS", 0.16 * s, [0, 1.5 * s, -0.59 * s], "#28483e");

    const carts: pc.Entity[] = [];
    for (let index = 0; index < 4; index += 1) {
      const cart = this.buildSimplifiedCart();
      const cartScale = (1 - index * 0.055) * s;
      cart.setLocalScale(cartScale, cartScale, cartScale);
      cart.setLocalPosition(0, 0, (0.42 - index * 0.26) * s);
      element.addChild(cart);
      carts.push(cart);
    }
    this.cartBayEntities.length = 0;
    this.cartBayEntities.push(...carts);
    this.syncCartBay(2);
  }

  /** Orients a unit cylinder entity to span `from`→`to` at the given radius —
   * the PlayCanvas-entity equivalent of `checkout/cartBay.ts`'s
   * `cartTubeTransform` (which returns a matrix for an instanced mesh; this
   * returns a real child entity instead, since this file has no GPU-instanced
   * mesh helper). Falls back to an identity/180°-flip rotation in the
   * (unused by this cart, but kept for robustness) near-parallel-to-up case
   * so `Vec3.cross` never normalizes a zero vector. */
  private buildTubeSegment(parent: pc.Entity, from: [number, number, number], to: [number, number, number], radius: number, material: pc.StandardMaterial) {
    const start = new pc.Vec3(from[0], from[1], from[2]);
    const end = new pc.Vec3(to[0], to[1], to[2]);
    const direction = new pc.Vec3().sub2(end, start);
    const length = direction.length();
    if (length < 1e-6) return;
    direction.normalize();
    const up = new pc.Vec3(0, 1, 0);
    const dot = up.dot(direction);
    const entity = new pc.Entity("cart-tube");
    entity.addComponent("render", { type: "cylinder", material });
    if (dot > 1 - 1e-6) {
      entity.setLocalRotation(0, 0, 0, 1);
    } else if (dot < -1 + 1e-6) {
      entity.setLocalEulerAngles(180, 0, 0);
    } else {
      const axis = new pc.Vec3().cross(up, direction).normalize();
      const angle = Math.acos(dot) * pc.math.RAD_TO_DEG;
      entity.setLocalRotation(new pc.Quat().setFromAxisAngle(axis, angle));
    }
    const mid = new pc.Vec3().add2(start, end).mulScalar(0.5);
    entity.setLocalPosition(mid);
    entity.setLocalScale(radius, length, radius);
    parent.addChild(entity);
  }

  /** Real tube-instanced wire-lattice `ShoppingCart` from `MarketKit.tsx`,
   * ported via `checkout/cartBay.ts`'s own `buildShoppingCart()` — same
   * frame-member endpoints/radii, same basket-shelf/backrest boxes, same
   * wheel/fork transforms, just as real child entities (`buildTubeSegment()`
   * above) instead of the source's GPU-instanced mesh, since this file has no
   * instanced-mesh helper. Geometry is authored in the SAME raw (pre-
   * `STORE_ELEMENT_SCALE`) local units `checkout/cartBay.ts` uses, so the
   * caller's per-cart uniform `setLocalScale(STORE_ELEMENT_SCALE * shrink)`
   * reproduces the source's own `cart.scale.setScalar(1 - index * 0.055)`
   * composed with the fixture's usual element scale. */
  private buildSimplifiedCart(): pc.Entity {
    const cart = new pc.Entity("shopping-cart");

    const gripMaterial = this.material("#315f4d");
    const metalMaterial = this.material("#9aa5a2");
    const wheelOuterMaterial = this.material("#272d2c");
    const wheelInnerMaterial = this.material("#adb7b4");

    const topLeftBack: [number, number, number] = [-0.46, 0.88, -0.35];
    const topRightBack: [number, number, number] = [0.46, 0.88, -0.35];
    const topLeftFront: [number, number, number] = [-0.46, 0.88, 0.42];
    const topRightFront: [number, number, number] = [0.46, 0.88, 0.42];
    const bottomLeftBack: [number, number, number] = [-0.34, 0.43, -0.25];
    const bottomRightBack: [number, number, number] = [0.34, 0.43, -0.25];
    const bottomLeftFront: [number, number, number] = [-0.34, 0.43, 0.33];
    const bottomRightFront: [number, number, number] = [0.34, 0.43, 0.33];

    this.buildTubeSegment(cart, [-0.52, 1.02, -0.43], [0.52, 1.02, -0.43], 0.035, gripMaterial);

    this.buildTubeSegment(cart, [-0.44, 0.18, -0.28], topLeftBack, 0.022, metalMaterial);
    this.buildTubeSegment(cart, [0.44, 0.18, -0.28], topRightBack, 0.022, metalMaterial);
    const frame015: Array<[[number, number, number], [number, number, number]]> = [
      [topLeftBack, topRightBack],
      [topLeftFront, topRightFront],
      [topLeftBack, topLeftFront],
      [topRightBack, topRightFront],
      [bottomLeftBack, bottomRightBack],
      [bottomLeftFront, bottomRightFront],
      [bottomLeftBack, bottomLeftFront],
      [bottomRightBack, bottomRightFront],
      [topLeftBack, bottomLeftBack],
      [topRightBack, bottomRightBack],
      [topLeftFront, bottomLeftFront],
      [topRightFront, bottomRightFront],
    ];
    for (const [from, to] of frame015) this.buildTubeSegment(cart, from, to, 0.015, metalMaterial);
    for (const x of [-0.27, -0.09, 0.09, 0.27]) {
      this.buildTubeSegment(cart, [x, 0.43, -0.25], [x * 1.3, 0.88, 0.42], 0.009, metalMaterial);
    }
    for (const z of [-0.1, 0.08, 0.26]) {
      for (const side of [-1, 1]) {
        this.buildTubeSegment(cart, [side * 0.36, 0.48, z], [side * 0.45, 0.84, z + 0.05], 0.009, metalMaterial);
      }
    }
    for (const x of [-0.34, 0.34]) {
      this.buildTubeSegment(cart, [x, 0.13, -0.26], [x, 0.24, 0.32], 0.02, metalMaterial);
    }

    this.box(cart, { size: [0.72, 0.035, 0.58], pos: [0, 0.27, 0.04], color: "#9da8a5", name: "cart-shelf" });
    this.box(cart, { size: [0.74, 0.27, 0.045], pos: [0, 0.7, -0.29], color: "#466f60", name: "cart-backrest" });

    for (const x of [-0.33, 0.33]) {
      for (const z of [-0.23, 0.28]) {
        this.box(cart, { size: [0.045, 0.13, 0.045], pos: [x, 0.15, z], color: "#6d7774", name: "cart-fork" });
        const wheelOuter = new pc.Entity("cart-wheel-outer");
        wheelOuter.addComponent("render", { type: "cylinder", material: wheelOuterMaterial });
        wheelOuter.setLocalScale(0.15, 0.055, 0.15);
        wheelOuter.setLocalEulerAngles(0, 0, 90);
        wheelOuter.setLocalPosition(x, 0.085, z);
        cart.addChild(wheelOuter);
        const wheelInner = new pc.Entity("cart-wheel-inner");
        wheelInner.addComponent("render", { type: "cylinder", material: wheelInnerMaterial });
        wheelInner.setLocalScale(0.068, 0.058, 0.068);
        wheelInner.setLocalEulerAngles(0, 0, 90);
        wheelInner.setLocalPosition(x, 0.085, z);
        cart.addChild(wheelInner);
      }
    }
    return cart;
  }

  /** `checkout/cartBay.ts`'s own `update(count)`: shows 2-4 carts, never
   * fewer than 2 or more than 4. */
  private syncCartBay(count: number) {
    const visible = Math.max(2, Math.min(4, count));
    this.cartBayEntities.forEach((cart, index) => { cart.enabled = index < visible; });
  }

  /** Real per-frame cart-bay count, read off `franchise.returnedCartCount`
   * directly (like every other `step*()` in this file). */
  private stepCartBay() {
    if (this.cartBayEntities.length === 0) return;
    const game = useMarketStore.getState().game;
    const franchise = game?.franchises.find((item) => item.id === game.currentFranchiseId) ?? game?.franchises[0];
    if (!franchise) return;
    this.syncCartBay(franchise.returnedCartCount);
  }

  /** Real per-frame returns-bin contents, read off `franchise.returnsBin`
   * directly. Dirty-checked against a cheap signature string so the pool
   * isn't torn down and rebuilt every frame when nothing changed — the
   * source itself rebuilds unconditionally on every `update()` call, but its
   * `update()` is only ever invoked on a real React prop change, not every
   * render frame, so the dirty-check here reproduces the same real-world
   * update cadence without this file needing a React-level diff. */
  private stepReturnsCubicle() {
    const group = this.returnsUnitsGroup;
    if (!group) return;
    const game = useMarketStore.getState().game;
    const franchise = game?.franchises.find((item) => item.id === game.currentFranchiseId) ?? game?.franchises[0];
    if (!franchise) return;
    const entries = Object.entries(franchise.returnsBin) as [ProductId, number][];
    const signature = entries.map(([id, qty]) => `${id}:${qty}`).join(",");
    if (signature === this.returnsBinSignature) return;
    this.returnsBinSignature = signature;
    for (const child of group.children.slice()) child.destroy();
    const s = STORE_ELEMENT_SCALE;
    const units = entries.flatMap(([productId, quantity]) => Array.from({ length: Math.min(6, quantity) }, () => productId)).slice(0, 6);
    units.forEach((productId, index) => {
      const spec = RETAIL_PRODUCT_VISUAL[productId];
      const unit = new pc.Entity(`returns-unit:${index}`);
      unit.addComponent("render", { type: spec.shape, material: this.material(spec.color) });
      unit.setLocalScale(spec.size[0] * s, spec.size[1] * s, spec.size[2] * s);
      unit.setLocalPosition(((index % 3) - 1) * 0.24 * s, (0.62 + Math.floor(index / 3) * 0.2) * s, 0.48 * s);
      group.addChild(unit);
    });
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
    // `buildAnimalPaddock()` is primitives too — posts/rails/trough, no GLB).
    // `stationGroup` (coop/station shell + live animal) is a second, more
    // restrictive gate on top of the paddock fence — mirrors
    // `kitFarm.ts`'s `buildAnimalStationGroup.update()`'s own
    // `showStation = unlockedAreas.includes(areaId) && Boolean(machine)`,
    // which is why a fresh paddock (fence visible, no machine purchased yet)
    // shows no coop/animal in production either; `stepFarmAnimals()` (per
    // render frame — the machine can appear via `chicken-2`/`cow-1` purchases
    // without a furniture-signature change) re-evaluates this every frame,
    // not just at build time.
    const stations: Array<[keyof typeof FARM_ANIMAL_FOOTPRINTS, readonly [number, number, number], string, string, FarmAnimalKind, string, string]> = [
      ["chicken", FARM_ANIMAL_STATIONS.chicken.position, "fixture:chicken-coop", "chicken_coop", "chicken", "chicken-coop-1", "chicken-coop"],
      ["cow", FARM_ANIMAL_STATIONS.cow.position, "fixture:cow-station", "cow_station", "cow", "cow-station-1", "cow-station"],
      ["chicken2", FARM_ANIMAL_STATIONS.chicken2.position, "fixture:chicken-coop-2", "chicken_coop", "chicken", "chicken-coop-2", "chicken-coop-2"],
    ];
    const ownerGroup = parent;
    for (const [footprintId, position, obstacleId, glbFile, kind, machineId, areaId] of stations) {
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
      const stationGroup = new pc.Entity(`fixture-station:${obstacleId}`);
      stationGroup.enabled = false;
      element.addChild(stationGroup);
      this.attachFixtureModel(stationGroup, ownerGroup, `${ENVIRONMENT_MODEL_ROOT}/${glbFile}.glb`, `fixture-model:${obstacleId}`, STORE_ELEMENT_SCALE);

      const characterGroup = new pc.Entity(`fixture-animal:${obstacleId}`);
      // Real `buildAnimalCharacter()` local offset (`group.position.set(0, 0.08, 0.32)`).
      characterGroup.setLocalPosition(0, 0.08 * STORE_ELEMENT_SCALE, 0.32 * STORE_ELEMENT_SCALE);
      stationGroup.addChild(characterGroup);
      const actor: FarmAnimalActor = { kind, machineId, areaId, stationGroup, characterGroup, entity: null, animAvailable: new Set(), currentClip: null, time: kind === "cow" ? 4 : 0, lastTickMs: performance.now() };
      this.farmAnimalActors.push(actor);
      void this.loadFarmAnimalCharacter(actor);
    }
  }

  /** Loads the real skinned chicken/cow GLB (`ANIMAL_MODEL_ROOT`'s doc
   * comment), instantiates it under `actor.characterGroup`, and wires its
   * `Idle`/`Walk`/`Peck`(chicken)/`Graze`(cow) clips onto a plain anim state
   * graph — same "one entity, PlayCanvas's own `anim` component" approach
   * `loadPlayerCharacter()` uses, appropriate here too since there are at
   * most three animal stations on screen at once (see `animalStation.ts`'s
   * own doc comment for why a per-instance mixer, not the crowd GPU-skinning
   * pipeline, is the right port for this actor). `stepFarmAnimals()` drives
   * clip switching/position every frame once this resolves; no-ops until
   * then. Fire-and-forget, like every other WorldKit-adjacent GLB load in
   * this file. */
  private async loadFarmAnimalCharacter(actor: FarmAnimalActor) {
    const url = `${ANIMAL_MODEL_ROOT}/${actor.kind}.glb`;
    const asset = new pc.Asset(`farm-animal:${actor.kind}:${actor.machineId}`, "container", { url, filename: `${actor.kind}-${actor.machineId}.glb` });
    this.app.assets.add(asset);
    const loaded = await new Promise<boolean>((resolve) => {
      asset.once("load", () => resolve(true));
      asset.once("error", (message: string) => {
        console.error(`[playcanvas] failed to load farm animal ${url}: ${message}`);
        resolve(false);
      });
      this.app.assets.load(asset);
    });
    if (this.disposed || !loaded || !this.farmAnimalActors.includes(actor)) return;
    const resource = asset.resource as pc.ContainerResource & { animations: pc.Asset[] };
    const entity = resource.instantiateRenderEntity();
    entity.addComponent("anim", { activate: true, speed: 1 });
    actor.characterGroup.addChild(entity);
    actor.entity = entity;

    const animAssets = resource.animations;
    const findClip = (name: string) => animAssets.find((clipAsset) => (clipAsset.resource as pc.AnimTrack | undefined)?.name === name)?.resource as pc.AnimTrack | undefined;
    const idle = findClip("Idle");
    const walk = findClip("Walk");
    const workClipName: FarmAnimalClip = actor.kind === "cow" ? "Graze" : "Peck";
    const workClip = findClip(workClipName);
    const anim = entity.anim;
    if (anim && idle) {
      const states: Array<{ name: string; speed?: number; loop?: boolean }> = [{ name: "START" }, { name: "Idle", speed: 1, loop: true }];
      actor.animAvailable.add("Idle");
      if (walk) { states.push({ name: "Walk", speed: 1, loop: true }); actor.animAvailable.add("Walk"); }
      if (workClip) { states.push({ name: workClipName, speed: 1, loop: true }); actor.animAvailable.add(workClipName); }
      anim.loadStateGraph({ layers: [{ name: "locomotion", states, transitions: [{ from: "START", to: "Idle" }] }], parameters: {} });
      anim.assignAnimation("Idle", idle, "locomotion");
      if (walk) anim.assignAnimation("Walk", walk, "locomotion");
      if (workClip) anim.assignAnimation(workClipName, workClip, "locomotion");
    }
  }

  /** Real per-frame chicken/cow drive — the exact `animalMotion()` pure
   * function `animalStation.ts`'s own `update()` calls, fed the exact same
   * `machine.status === "PROCESSING"` `active` flag. Reads
   * `useMarketStore.getState()` directly (like `stepWorldTick()`'s
   * `tickWorld()` call) rather than through `PlayCanvasSceneProps`, since
   * `productionMachines` is raw store state with no React-side derivation —
   * this also means a machine purchased mid-session (e.g. `chicken-2`) shows
   * its coop/animal the very next frame, with no furniture rebuild needed. */
  private stepFarmAnimals() {
    if (this.farmAnimalActors.length === 0) return;
    const game = useMarketStore.getState().game;
    const franchise = game?.franchises.find((item) => item.id === game.currentFranchiseId) ?? game?.franchises[0];
    if (!franchise) return;
    const machineById = new Map(franchise.productionMachines.map((machine) => [machine.id, machine] as const));
    const nowMs = performance.now();
    for (const actor of this.farmAnimalActors) {
      const machine = machineById.get(actor.machineId);
      const showStation = franchise.unlockedAreas.includes(actor.areaId) && Boolean(machine);
      actor.stationGroup.enabled = showStation;
      const step = Math.min((nowMs - actor.lastTickMs) / 1000, 0.05);
      actor.lastTickMs = nowMs;
      if (!showStation || !actor.entity) continue;
      actor.time += step;
      const motion = animalMotion(actor.kind, actor.time, machine!.status === "PROCESSING");
      actor.characterGroup.setLocalPosition(motion.x * STORE_ELEMENT_SCALE, 0.08 * STORE_ELEMENT_SCALE, 0.32 * STORE_ELEMENT_SCALE);
      actor.characterGroup.setEulerAngles(0, (motion.yaw * 180) / Math.PI, 0);
      let target = motion.clip;
      if (!actor.animAvailable.has(target)) target = "Idle";
      if (target !== actor.currentClip && actor.animAvailable.has(target)) {
        actor.currentClip = target;
        actor.entity.anim?.baseLayer?.transition(target, 0.15);
      }
    }
  }

  /**
   * Real per-department fixture shell — ports `WorldKit/fixtureShell.ts`'s
   * shared pieces (`FixtureUprights`, `CommercialShelfBank`,
   * `CommercialBackPanel`, `DepartmentSign`, `ScreenRail`) plus
   * `WorldKit/retail/departments.ts`'s per-type assembly
   * (`Gondola`/`BakeryDisplay`/`DrinksDisplay`/`ProduceTable`), replacing the
   * former flat body/base placeholder. Every dimension below is the real
   * source's own number, x-scaled by this fixture's actual width vs. the
   * source's reference width (2.24 for the gondola/bakery family, 2.3 for
   * drinks) so a department whose `fixtureHalfExtents` differ slightly from
   * the literal source still gets proportional geometry; z dimensions are
   * used literally since the source shelf/back-panel depths are already
   * much shallower than the fixture footprint by design. Per-SKU dynamic
   * stock screens (`buildStockScreen` in the source, ported separately — see
   * `buildStockScreen()` below) and the dairy cooler's animated door swing
   * (see `buildChillerFixtureShell()`'s own doc comment) are the only
   * pieces still not 1:1; `dairy`/`eggs` now use the real GLB cooler case
   * (`buildChillerFixtureShell()`), same as every other department's real
   * static shelf/upright/back-panel/sign geometry. */
  private buildDepartmentFixture(parent: pc.Entity, department: (typeof RETAIL_DEPARTMENTS)[RetailDepartmentId], position: [number, number, number], yawDeg: number): { element: pc.Entity; screens: Map<ProductId, { countText: pc.Entity; statusText: pc.Entity }> } {
    // Mirrors `makeStoreElement`: scaleStorePosition (bakes STORE_LAYOUT_SCALE
    // — this group already lives under `worldRoot`, WORLD_SCALE only), yaw,
    // then a uniform STORE_ELEMENT_SCALE on the fixture itself.
    const scaled = scaleStorePosition(position);
    const element = new pc.Entity(`fixture:${department.id}`);
    element.setLocalPosition(scaled[0], scaled[1], scaled[2]);
    element.setEulerAngles(0, yawDeg, 0);
    parent.addChild(element);

    const [halfX, halfZ] = department.fixtureHalfExtents;
    const width = halfX * 2;
    const depth = halfZ * 2;

    const base = new pc.Entity("base");
    base.addComponent("render", { type: "box", material: this.material("#3a3f38") });
    base.setLocalScale(halfX * 2.05 * STORE_ELEMENT_SCALE, 0.08 * STORE_ELEMENT_SCALE, halfZ * 2.05 * STORE_ELEMENT_SCALE);
    base.setLocalPosition(0, 0.04 * STORE_ELEMENT_SCALE, 0);
    element.addChild(base);

    const screens = new Map<ProductId, { countText: pc.Entity; statusText: pc.Entity }>();
    switch (department.id) {
      case "pantry":
      case "preserves":
        this.buildGondolaFixtureShell(element, department, width, screens);
        break;
      case "bakery":
        this.buildBakeryFixtureShell(element, department, width, screens);
        break;
      case "drinks":
        this.buildDrinksFixtureShell(element, department, width, screens);
        break;
      case "produce":
        this.buildProduceFixtureShell(element, department);
        break;
      case "dairy":
      case "eggs":
        this.buildChillerFixtureShell(element, parent, department, width, depth, screens);
        break;
    }
    return { element, screens };
  }

  /** Real port of `fixtureShell.ts`'s `FixtureUprights`: two steel posts per
   * side (four total), spanning `height` centered on the fixture's own
   * vertical axis. */
  private buildFixtureUprights(parent: pc.Entity, width: number, height: number, z = -0.34) {
    const S = STORE_ELEMENT_SCALE;
    const steel = this.material("#222a2b");
    for (const side of [-1, 1] as const) {
      for (const postZ of [z - 0.03, z + 0.09]) {
        const post = new pc.Entity("upright");
        post.addComponent("render", { type: "box", material: steel });
        post.setLocalScale(0.07 * S, height * S, 0.07 * S);
        post.setLocalPosition(side * (width / 2 - 0.055) * S, (height / 2) * S, postZ * S);
        parent.addChild(post);
      }
    }
  }

  /** Real port of `fixtureShell.ts`'s `CommercialShelfBank`: one deck + lip +
   * color accent stripe + three price tags per level. */
  private buildCommercialShelfBank(parent: pc.Entity, levels: readonly number[], width: number, depth: number, z: number, front: 1 | -1, accent: string) {
    const S = STORE_ELEMENT_SCALE;
    const shelfMat = this.material("#d9dcda");
    const lipMat = this.material("#222a2b");
    const accentMat = this.material(accent);
    const tagMat = this.material("#fff8e7");
    for (const y of levels) {
      const deck = new pc.Entity("shelf-deck");
      deck.addComponent("render", { type: "box", material: shelfMat });
      deck.setLocalScale(width * S, 0.065 * S, depth * S);
      deck.setLocalPosition(0, y * S, z * S);
      parent.addChild(deck);

      const lip = new pc.Entity("shelf-lip");
      lip.addComponent("render", { type: "box", material: lipMat });
      lip.setLocalScale((width + 0.035) * S, 0.105 * S, 0.035 * S);
      lip.setLocalPosition(0, (y + 0.025) * S, (z + front * (depth / 2 - 0.006)) * S);
      parent.addChild(lip);

      const accentStripe = new pc.Entity("shelf-accent");
      accentStripe.addComponent("render", { type: "box", material: accentMat });
      accentStripe.setLocalScale(width * 0.92 * S, 0.062 * S, 0.018 * S);
      accentStripe.setLocalPosition(0, (y + 0.075) * S, (z + front * (depth / 2 + 0.017)) * S);
      parent.addChild(accentStripe);

      for (const offset of [-0.31, 0, 0.31]) {
        const tag = new pc.Entity("shelf-tag");
        tag.addComponent("render", { type: "box", material: tagMat });
        tag.setLocalScale(0.25 * S, 0.055 * S, 0.012 * S);
        tag.setLocalPosition(offset * width * S, (y + 0.075) * S, (z + front * (depth / 2 + 0.029)) * S);
        parent.addChild(tag);
      }
    }
  }

  /** Real port of `fixtureShell.ts`'s `CommercialBackPanel`: one panel plus
   * seven horizontal slats. */
  private buildCommercialBackPanel(parent: pc.Entity, width: number, height: number, z: number, color = "#c5cac7") {
    const S = STORE_ELEMENT_SCALE;
    const panel = new pc.Entity("back-panel");
    panel.addComponent("render", { type: "box", material: this.material(color) });
    panel.setLocalScale(width * S, height * S, 0.075 * S);
    panel.setLocalPosition(0, (height / 2) * S, z * S);
    parent.addChild(panel);

    const slatMat = this.material("#747d79");
    for (let index = 0; index < 7; index += 1) {
      const slat = new pc.Entity("back-panel-slat");
      slat.addComponent("render", { type: "box", material: slatMat });
      slat.setLocalScale(width * 0.86 * S, 0.012 * S, 0.012 * S);
      const y = 0.22 + index * Math.max(0.2, (height - 0.34) / 6);
      slat.setLocalPosition(0, y * S, (z + 0.042) * S);
      parent.addChild(slat);
    }
  }

  /** Real port of `fixtureShell.ts`'s `ScreenRail` — the structural mounting
   * rail every per-SKU stock screen (`buildStockScreenFace()`, below) sits
   * on. */
  private buildScreenRail(parent: pc.Entity, barY: number, railY: number, halfWidth: number, z: number) {
    const S = STORE_ELEMENT_SCALE;
    const steel = this.material("#222a2b");
    for (const x of [-halfWidth, halfWidth]) {
      const post = new pc.Entity("rail-post");
      post.addComponent("render", { type: "box", material: steel });
      post.setLocalScale(0.05 * S, (railY - barY) * S, 0.05 * S);
      post.setLocalPosition(x * S, ((barY + railY) / 2) * S, z * S);
      parent.addChild(post);
    }
    const bar = new pc.Entity("rail-bar");
    bar.addComponent("render", { type: "box", material: steel });
    bar.setLocalScale((halfWidth * 2 + 0.05) * S, 0.05 * S, 0.05 * S);
    bar.setLocalPosition(0, railY * S, z * S);
    parent.addChild(bar);
  }

  /**
   * Real port of `retail/stockScreen.ts`'s `buildStockScreen` — the live
   * per-SKU illuminated readout mounted on the `ScreenRail` above every
   * non-produce retail fixture. `stepRetailStock()` drives the two dynamic
   * texts (`countText`/`statusText`, the returned handles) every frame,
   * exactly mirroring the source's own `update(count, capacity)` (missing
   * units / "LLENO" logic copied verbatim).
   *
   * One intentional, documented simplification: the source's `photo` plane
   * is a ONE-SHOT `THREE.WebGLRenderTarget` render of a tiny lit
   * `BasketProductMesh` scene (`renderProductPhoto()`), rendered once per
   * screen and never updated again. Reproducing that exact render-to-texture
   * technique in PlayCanvas (a second offscreen camera/layer per screen,
   * rendered once at construction) is a real, doable feature — but for a
   * photo that never animates and is already redundant with the real
   * `RETAIL_PRODUCT_VISUAL` unit sitting physically on the shelf a few
   * centimeters below it, the juice isn't worth the extra camera/layer/
   * render-target bookkeeping per screen (same cost/benefit call this file
   * already made for milk/cheese/egg pooled units staying primitives). This
   * pass ports the actually-dynamic, actually-informative part — the live
   * count/capacity text — with a static accent-colored swatch (the same
   * `RETAIL_PRODUCT_VISUAL` color the shelf unit uses) standing in for the
   * one-shot photo.
   */
  private buildStockScreenFace(parent: pc.Entity, productId: ProductId, accentColor: string, position: [number, number, number], fixtureYawDeg: number): { countText: pc.Entity; statusText: pc.Entity } {
    const S = STORE_ELEMENT_SCALE;
    const anchor = new pc.Entity(`stock-screen:${productId}`);
    anchor.setLocalPosition(position[0] * S, position[1] * S, position[2] * S);
    const tiltDeg = (-0.35 * 180) / Math.PI;
    const yawDeg = (FLOOR_LABEL_YAW * 180) / Math.PI - fixtureYawDeg;
    anchor.setLocalEulerAngles(tiltDeg, yawDeg, 0);
    parent.addChild(anchor);

    const post = new pc.Entity("screen-post");
    post.addComponent("render", { type: "box", material: this.material("#3a4a4d") });
    post.setLocalScale(0.06 * S, 0.16 * S, 0.06 * S);
    post.setLocalPosition(0, -0.5 * S, -0.03 * S);
    anchor.addChild(post);

    const frame = new pc.Entity("screen-frame");
    frame.addComponent("render", { type: "box", material: this.material("#1a2325") });
    frame.setLocalScale(0.76 * S, 0.86 * S, 0.06 * S);
    frame.setLocalPosition(0, 0, -0.03 * S);
    anchor.addChild(frame);

    const backgroundMaterial = new pc.StandardMaterial();
    backgroundMaterial.diffuse = hexToColor("#0f1e23");
    backgroundMaterial.emissive = hexToColor("#12303a");
    backgroundMaterial.emissiveIntensity = 0.55;
    backgroundMaterial.update();
    const background = new pc.Entity("screen-background");
    background.addComponent("render", { type: "plane", material: backgroundMaterial });
    background.setLocalScale(0.68 * S, 1, 0.78 * S);
    background.setLocalPosition(0, 0, 0.004 * S);
    background.setLocalEulerAngles(90, 0, 0);
    anchor.addChild(background);

    const accentMaterial = new pc.StandardMaterial();
    accentMaterial.diffuse = hexToColor(accentColor);
    accentMaterial.emissive = hexToColor(accentColor);
    accentMaterial.emissiveIntensity = 0.35;
    accentMaterial.update();
    const accentBar = new pc.Entity("screen-accent");
    accentBar.addComponent("render", { type: "plane", material: accentMaterial });
    accentBar.setLocalScale(0.68 * S, 1, 0.06 * S);
    accentBar.setLocalPosition(0, 0.405 * S, 0.006 * S);
    accentBar.setLocalEulerAngles(90, 0, 0);
    anchor.addChild(accentBar);

    // Real per-SKU color swatch standing in for the source's one-shot
    // product-photo render — see this method's own doc comment above.
    const swatch = new pc.Entity("screen-photo-swatch");
    const swatchSpec = RETAIL_PRODUCT_VISUAL[productId];
    swatch.addComponent("render", { type: swatchSpec.shape, material: this.material(swatchSpec.color) });
    const swatchScale = 0.34 / Math.max(swatchSpec.size[0], swatchSpec.size[1], swatchSpec.size[2]);
    swatch.setLocalScale(swatchSpec.size[0] * swatchScale * S, swatchSpec.size[1] * swatchScale * S, swatchSpec.size[2] * swatchScale * S);
    swatch.setLocalPosition(0, 0.13 * S, 0.05 * S);
    anchor.addChild(swatch);

    this.buildText(anchor, "screen-label", STOCK_SCREEN_PRODUCT_LABELS[productId], 0.07 * S, [0, 0.34 * S, 0.01 * S], "#e9f6f2");

    const dynamic = new pc.Entity("dynamic:stock-screen");
    anchor.addChild(dynamic);
    const countText = this.buildDynamicText(dynamic, "stock-screen-count", "0/0", 0.15 * S, [0, -0.16 * S, 0.01 * S], "#ffffff");
    const statusText = this.buildDynamicText(dynamic, "stock-screen-status", "faltan 0", 0.082 * S, [0, -0.325 * S, 0.01 * S], "#ffcf6b");

    const indicatorMaterial = new pc.StandardMaterial();
    indicatorMaterial.emissive = hexToColor("#5bf08a");
    indicatorMaterial.emissiveIntensity = 1;
    indicatorMaterial.update();
    const indicator = new pc.Entity("screen-indicator");
    indicator.addComponent("render", { type: "sphere", material: indicatorMaterial });
    indicator.setLocalScale(0.028 * S, 0.028 * S, 0.028 * S);
    indicator.setLocalPosition(0.29 * S, 0.405 * S, 0.012 * S);
    anchor.addChild(indicator);

    return { countText, statusText };
  }

  /** Real port of `fixtureShell.ts`'s `DepartmentSign`: frame + colored panel
   * + real text label (via `buildText()`, same as the "RECOGER"/"MINI
   * MARKET" world-space text elsewhere in this file). */
  private buildDepartmentSignBoard(parent: pc.Entity, label: string, color: string, position: [number, number, number], width = 1.72) {
    const S = STORE_ELEMENT_SCALE;
    const anchor = new pc.Entity("sign-anchor");
    anchor.setLocalPosition(position[0] * S, position[1] * S, position[2] * S);
    parent.addChild(anchor);
    const frame = new pc.Entity("sign-frame");
    frame.addComponent("render", { type: "box", material: this.material("#303a36") });
    frame.setLocalScale((width + 0.1) * S, 0.42 * S, 0.07 * S);
    frame.setLocalPosition(0, -0.025 * S, -0.035 * S);
    anchor.addChild(frame);
    const panel = new pc.Entity("sign-panel");
    panel.addComponent("render", { type: "box", material: this.material(color) });
    panel.setLocalScale(width * S, 0.31 * S, 0.09 * S);
    anchor.addChild(panel);
    this.buildText(anchor, "sign-label", label, 0.135 * S, [0, 0, 0.052 * S], "#fffaf0");
  }

  /** Real port of `departments.ts`'s `Gondola` (pantry/preserves): back
   * panel, uprights, a double-sided shelf bank (service-facing side first,
   * matching the source's comment on stocking-magnet proximity), steel cap,
   * screen rail and department sign. */
  private buildGondolaFixtureShell(element: pc.Entity, department: (typeof RETAIL_DEPARTMENTS)[RetailDepartmentId], width: number, screens: Map<ProductId, { countText: pc.Entity; statusText: pc.Entity }>) {
    const S = STORE_ELEMENT_SCALE;
    const kx = width / 2.24;
    this.buildCommercialBackPanel(element, 2.08 * kx, 1.82, 0, "#b69a77");
    this.buildFixtureUprights(element, 2.18 * kx, 1.92, 0);
    for (const side of [1, -1] as const) {
      this.buildCommercialShelfBank(element, RETAIL_FIXTURE_LEVELS.pantry, 2.08 * kx, 0.52, side * 0.28, side, department.color);
    }
    const cap = new pc.Entity("cap");
    cap.addComponent("render", { type: "box", material: this.material("#222a2b") });
    cap.setLocalScale(2.3 * kx * S, 0.14 * S, 1.08 * S);
    cap.setLocalPosition(0, 1.88 * S, 0);
    element.addChild(cap);
    this.buildScreenRail(element, 1.95, 2.43, 1.1 * kx, 0.12);
    const productId = department.products[0];
    if (productId) screens.set(productId, this.buildStockScreenFace(element, productId, department.color, [0, 2.9, 0.12], department.yaw ?? 0));
    this.buildDepartmentSignBoard(element, department.label, department.color, [0, 2.15, 0], 2.02 * kx);
  }

  /** Real port of `departments.ts`'s `BakeryDisplay`. */
  private buildBakeryFixtureShell(element: pc.Entity, department: (typeof RETAIL_DEPARTMENTS)[RetailDepartmentId], width: number, screens: Map<ProductId, { countText: pc.Entity; statusText: pc.Entity }>) {
    const S = STORE_ELEMENT_SCALE;
    const kx = width / 2.24;
    this.buildCommercialBackPanel(element, 2.08 * kx, 1.9, -0.34, "#d8c3a2");
    this.buildFixtureUprights(element, 2.18 * kx, 2, -0.34);
    this.buildCommercialShelfBank(element, RETAIL_FIXTURE_LEVELS.bakery, 2.08 * kx, 0.52, 0.02, 1, department.color);
    const cap = new pc.Entity("cap");
    cap.addComponent("render", { type: "box", material: this.material("#222a2b") });
    cap.setLocalScale(2.3 * kx * S, 0.14 * S, 0.78 * S);
    cap.setLocalPosition(0, 1.98 * S, -0.1 * S);
    element.addChild(cap);
    this.buildScreenRail(element, 2.05, 2.52, 1.12 * kx, 0.1);
    const yaw = department.yaw ?? 0;
    screens.set("bread", this.buildStockScreenFace(element, "bread", department.color, [-0.78 * kx, 2.99, 0.1], yaw));
    screens.set("flour", this.buildStockScreenFace(element, "flour", department.color, [0, 2.99, 0.1], yaw));
    screens.set("wheat", this.buildStockScreenFace(element, "wheat", department.color, [0.78 * kx, 2.99, 0.1], yaw));
    this.buildDepartmentSignBoard(element, department.label, department.color, [0, 2.25, 0.08], 2.02 * kx);
  }

  /** Real port of `departments.ts`'s `DrinksDisplay`. */
  private buildDrinksFixtureShell(element: pc.Entity, department: (typeof RETAIL_DEPARTMENTS)[RetailDepartmentId], width: number, screens: Map<ProductId, { countText: pc.Entity; statusText: pc.Entity }>) {
    const S = STORE_ELEMENT_SCALE;
    const kx = width / 2.3;
    this.buildCommercialBackPanel(element, 2.2 * kx, 2.08, -0.36, "#d8d3c6");
    this.buildFixtureUprights(element, 2.28 * kx, 2.2, -0.31);
    this.buildCommercialShelfBank(element, RETAIL_FIXTURE_LEVELS.drinks, 2.13 * kx, 0.67, 0, 1, department.color);
    const cap = new pc.Entity("cap");
    cap.addComponent("render", { type: "box", material: this.material("#222a2b") });
    cap.setLocalScale(2.38 * kx * S, 0.18 * S, 0.92 * S);
    cap.setLocalPosition(0, 2.18 * S, 0);
    element.addChild(cap);
    this.buildScreenRail(element, 2.27, 2.7, 1.12 * kx, 0.1);
    const productId = department.products[0];
    if (productId) screens.set(productId, this.buildStockScreenFace(element, productId, department.color, [0, 3.14, 0.1], department.yaw ?? 0));
    this.buildDepartmentSignBoard(element, department.label, department.color, [0, 2.42, 0.07], 2 * kx);
  }

  /** Real port of `departments.ts`'s `ProduceTable`: four tilted bin decks
   * (one per SKU, positions from `PRODUCE_BIN_COLUMNS`/`produceDeckLocalPoint`
   * — the exact same pure geometry the authoritative stocking-flight math
   * uses), dividers, legs, sign posts and header rail. Every unit is a real
   * `pc.Entity` with its own tilt (`PRODUCE_DECK.tilt`, converted to
   * degrees) rather than a flat box. */
  private buildProduceFixtureShell(element: pc.Entity, department: (typeof RETAIL_DEPARTMENTS)[RetailDepartmentId]) {
    const S = STORE_ELEMENT_SCALE;
    const tiltDeg = (PRODUCE_DECK.tilt * 180) / Math.PI;
    const steel = this.material("#222a2b");
    const woodMat = this.material("#a46f3d");
    const dividerMat = this.material("#6e482d");

    const plinth = new pc.Entity("plinth");
    plinth.addComponent("render", { type: "box", material: steel });
    plinth.setLocalScale(2.42 * S, 0.12 * S, 1.5 * S);
    plinth.setLocalPosition(0, 0.08 * S, 0);
    element.addChild(plinth);

    for (const x of [-1.08, 1.08]) {
      for (const z of [-0.58, 0.58]) {
        const leg = new pc.Entity("leg");
        leg.addComponent("render", { type: "box", material: steel });
        leg.setLocalScale(0.09 * S, 0.7 * S, 0.09 * S);
        leg.setLocalPosition(x * S, 0.39 * S, z * S);
        element.addChild(leg);
      }
    }

    const body = new pc.Entity("body");
    body.addComponent("render", { type: "box", material: woodMat });
    body.setLocalScale(2.28 * S, 0.54 * S, 1.34 * S);
    body.setLocalPosition(0, 0.43 * S, 0);
    element.addChild(body);

    for (const x of PRODUCE_BIN_COLUMNS) {
      const deck = new pc.Entity("deck");
      deck.addComponent("render", { type: "box", material: steel });
      deck.setLocalScale(PRODUCE_DECK.width * S, PRODUCE_DECK.thickness * S, PRODUCE_DECK.depth * S);
      deck.setLocalPosition(x * S, PRODUCE_DECK.center[1] * S, PRODUCE_DECK.center[2] * S);
      deck.setEulerAngles(tiltDeg, 0, 0);
      element.addChild(deck);
    }

    for (const slot of [-2, -1, 0, 1, 2]) {
      const [dx, dy, dz] = produceDeckLocalPoint(slot * PRODUCE_BIN_PITCH, 0.1, 0);
      const divider = new pc.Entity("divider");
      divider.addComponent("render", { type: "box", material: dividerMat });
      divider.setLocalScale(0.03 * S, 0.2 * S, (PRODUCE_DECK.depth + 0.04) * S);
      divider.setLocalPosition(dx * S, dy * S, dz * S);
      divider.setEulerAngles(tiltDeg, 0, 0);
      element.addChild(divider);
    }

    const front = produceDeckLocalPoint(0, 0.055, 0.585);
    const frontRail = new pc.Entity("front-rail");
    frontRail.addComponent("render", { type: "box", material: dividerMat });
    frontRail.setLocalScale(2.32 * S, 0.07 * S, 0.035 * S);
    frontRail.setLocalPosition(front[0] * S, front[1] * S, front[2] * S);
    frontRail.setEulerAngles(tiltDeg, 0, 0);
    element.addChild(frontRail);

    const back = produceDeckLocalPoint(0, 0.1, -0.6);
    const backRail = new pc.Entity("back-rail");
    backRail.addComponent("render", { type: "box", material: dividerMat });
    backRail.setLocalScale(2.32 * S, 0.17 * S, 0.035 * S);
    backRail.setLocalPosition(back[0] * S, back[1] * S, back[2] * S);
    backRail.setEulerAngles(tiltDeg, 0, 0);
    element.addChild(backRail);

    for (const x of PRODUCE_BIN_COLUMNS) {
      const post = new pc.Entity("sign-post");
      post.addComponent("render", { type: "box", material: steel });
      post.setLocalScale(0.045 * S, 0.54 * S, 0.045 * S);
      post.setLocalPosition(x * S, 1.12 * S, -0.68 * S);
      element.addChild(post);
    }
    for (const x of [-1.1, 1.1]) {
      const post = new pc.Entity("header-post");
      post.addComponent("render", { type: "box", material: steel });
      post.setLocalScale(0.055 * S, 1.7 * S, 0.055 * S);
      post.setLocalPosition(x * S, 1.52 * S, -0.7 * S);
      element.addChild(post);
    }
    const headerBar = new pc.Entity("header-bar");
    headerBar.addComponent("render", { type: "box", material: steel });
    headerBar.setLocalScale(2.3 * S, 0.12 * S, 0.08 * S);
    headerBar.setLocalPosition(0, 2.36 * S, -0.7 * S);
    element.addChild(headerBar);

    this.buildDepartmentSignBoard(element, department.label, department.color, [0, 2.33, -0.64], 2.2);
  }

  /**
   * Real GLB cooler case for `dairy`/`eggs` — port of `departments.ts`'s
   * `ChilledDisplay`/`EggDisplay`, which clone the real `dairy.glb`/
   * `egg-display.glb` scenes (`deliveredStock.ts`'s `cloneDeliveredScene`)
   * rather than build a primitive cabinet. Both source GLBs require
   * `EXT_meshopt_compression` + `KHR_mesh_quantization` (confirmed via
   * `gltf-transform inspect`, same problem `PRODUCTION_MODEL_ROOT`'s doc
   * comment describes for the mill/oven/juicer/chicken/cow GLBs), so both
   * are stripped the identical way into this repo's own
   * `playcanvas-production/` directory:
   *   npx gltf-transform copy delivered/dairy.glb playcanvas-production/dairy.glb
   *   npx gltf-transform dequantize playcanvas-production/dairy.glb playcanvas-production/dairy.glb
   *   npx gltf-transform copy delivered/egg-display.glb playcanvas-production/egg-display.glb
   *   npx gltf-transform dequantize playcanvas-production/egg-display.glb playcanvas-production/egg-display.glb
   * Regenerate the same way if either source asset changes. This does not
   * touch any file `/`, `/play2` or `/runtime` reads.
   *
   * Known deviation: the source's three `DairyDoor1..3` leaves swing open
   * while a customer is mid-`WAIT_FOR_ACCESS`/`PICK_PRODUCT` on a milk/cheese
   * line (`kitFurniture.ts`'s `coldDoorActiveOf()`), driven by
   * `customer.shoppingList[customer.currentLine]?.productId` — a field this
   * engine's own `PlayCanvasSceneProps.customers` doesn't carry (it only
   * carries `id`/`x`/`z`/`state`). Piping that per-customer product id
   * through every scene-prop call site solely to open/close a cooler door is
   * out of scope for this cosmetic GLB swap, so the doors here render at
   * their real authored rest pose (closed) rather than animating. The case
   * geometry itself — the actual ask of this pass — is the real asset.
   */
  private buildChillerFixtureShell(element: pc.Entity, ownerGroup: pc.Entity, department: (typeof RETAIL_DEPARTMENTS)[RetailDepartmentId], width: number, depth: number, screens: Map<ProductId, { countText: pc.Entity; statusText: pc.Entity }>) {
    const isDairy = department.id === "dairy";
    const file = isDairy ? "dairy" : "egg-display";
    this.attachFixtureModel(element, ownerGroup, `${PRODUCTION_MODEL_ROOT}/${file}.glb`, `fixture-model:retail-${department.id}`, STORE_ELEMENT_SCALE);
    const yaw = department.yaw ?? 0;
    if (isDairy) {
      this.buildScreenRail(element, 1.58, 2.12, 1.12, 0.1);
      screens.set("milk", this.buildStockScreenFace(element, "milk", department.color, [-0.55, 2.58, 0.1], yaw));
      screens.set("cheese", this.buildStockScreenFace(element, "cheese", department.color, [0.55, 2.58, 0.1], yaw));
    } else {
      this.buildScreenRail(element, 2.1, 2.36, 0.73, 0.1);
      screens.set("eggs", this.buildStockScreenFace(element, "eggs", department.color, [0, 2.83, 0.1], yaw));
    }
    const signY = isDairy ? 1.86 : 2.62;
    this.buildDepartmentSignBoard(element, department.label, department.color, [0, signY, depth * 0.44], width * 0.9);
  }

  /**
   * One `retail-stock:<productId>` pool group per SKU this fixture stocks
   * (`department.products`), attached under `element` — the parent
   * `buildFurniture()` loop just built. Registers a `RetailStockActor` for
   * `stepRetailStock()` to drive every frame; no units are created yet
   * (`growRetailStockPool` creates them lazily the first time they're
   * needed), so an empty/never-stocked SKU costs nothing beyond one empty
   * `pc.Entity`.
   */
  private attachRetailStockPools(element: pc.Entity, department: (typeof RETAIL_DEPARTMENTS)[RetailDepartmentId], fixtureIndex: number, fixtureCount: number, screens: Map<ProductId, { countText: pc.Entity; statusText: pc.Entity }>) {
    for (const productId of department.products) {
      const group = new pc.Entity(`retail-stock:${productId}:${fixtureIndex}`);
      element.addChild(group);
      this.retailStockActors.push({ productId, fixtureIndex, fixtureCount, group, units: [], screen: screens.get(productId) });
    }
  }

  /**
   * Real per-frame retail shelf-stock visuals. Reads `franchise.shelves`
   * directly off the store (like `stepFarmAnimals()` reads
   * `productionMachines`) rather than through `PlayCanvasSceneProps`, splits
   * each SKU's total across its fixture's own share via
   * `distributedFixtureQuantity()` (the exact split `kitFurniture.ts`'s own
   * `produceStock`/`produceCapacity` closures use for produce/pantry, and a
   * no-op split — `distributedFixtureQuantity(total, 0, 1) === total` — for
   * every single-fixture department), then lands each visible unit at the
   * exact local position `retailStockLandingLocalPosition()` computes (the
   * same pure function `/runtime`'s `AuthoritativeRetailStock` calls) —
   * partial rows re-center exactly like the real shelf, because `shelfEnd`
   * is the CURRENT visual count, not the SKU's tier capacity (mirrors
   * `retailStockTransforms()`'s own `visualCount` — see this file's
   * `RETAIL_PRODUCT_VISUAL` doc comment for why capacity numbers matter for
   * pool growth, not for the on-shelf layout math). A unit beyond the
   * current count is simply `enabled = false`, never destroyed. */
  private stepRetailStock() {
    if (this.retailStockActors.length === 0) return;
    const game = useMarketStore.getState().game;
    const franchise = game?.franchises.find((item) => item.id === game.currentFranchiseId) ?? game?.franchises[0];
    if (!franchise) return;
    // Mirrors `kitFurniture.ts`'s `fixtureCapacityOf()`/`GameShell.tsx`'s own
    // `shelfTier` derivation exactly — the franchise has no plain
    // `shelfTier` field of its own.
    const shelfTier = franchise.stationTiers["shelves-1"] ?? franchise.shelvesLevel;
    for (const actor of this.retailStockActors) {
      const total = franchise.shelves[actor.productId] ?? 0;
      const rawCount = distributedFixtureQuantity(total, actor.fixtureIndex, actor.fixtureCount);
      const visualCapacity = RETAIL_VISUAL_CAPACITY[actor.productId];
      const visualCount = Math.min(visualCapacity, Math.max(0, rawCount));
      if (actor.units.length < visualCount) this.growRetailStockPool(actor, visualCount);
      for (let index = 0; index < actor.units.length; index += 1) {
        const unit = actor.units[index];
        const visible = index < visualCount;
        unit.enabled = visible;
        if (!visible) continue;
        const [x, y, z] = retailStockLandingLocalPosition(actor.productId, index, visualCount);
        unit.setLocalPosition(x * STORE_ELEMENT_SCALE, y * STORE_ELEMENT_SCALE, z * STORE_ELEMENT_SCALE);
      }
      if (actor.screen) {
        const capacity = distributedFixtureQuantity(shelfCapacityForTier(shelfTier, actor.productId, franchise.unlockedAreas), actor.fixtureIndex, actor.fixtureCount);
        const missing = Math.max(0, capacity - rawCount);
        const full = capacity > 0 && missing === 0;
        const countLabel = `${rawCount}/${capacity}`;
        if (actor.screen.countText.element!.text !== countLabel) {
          actor.screen.countText.element!.text = countLabel;
          this.growDynamicFontCharset(countLabel);
        }
        const statusLabel = full ? "LLENO" : `faltan ${missing}`;
        if (actor.screen.statusText.element!.text !== statusLabel) {
          actor.screen.statusText.element!.text = statusLabel;
          this.growDynamicFontCharset(statusLabel);
        }
        actor.screen.statusText.element!.color = hexToColor(full ? "#8ce6a1" : "#ffcf6b");
      }
    }
  }

  /** Grows one actor's unit pool up to `targetSize` (never shrinks — see
   * `stepRetailStock()`'s doc comment). Each unit is one primitive mesh from
   * `RETAIL_PRODUCT_VISUAL`, scaled by `STORE_ELEMENT_SCALE` exactly like
   * `buildDepartmentFixture`'s own body/base boxes. */
  private growRetailStockPool(actor: RetailStockActor, targetSize: number) {
    const spec = RETAIL_PRODUCT_VISUAL[actor.productId];
    while (actor.units.length < targetSize) {
      const unit = new pc.Entity(`retail-unit:${actor.productId}:${actor.units.length}`);
      unit.addComponent("render", { type: spec.shape, material: this.material(spec.color) });
      unit.setLocalScale(spec.size[0] * STORE_ELEMENT_SCALE, spec.size[1] * STORE_ELEMENT_SCALE, spec.size[2] * STORE_ELEMENT_SCALE);
      unit.enabled = false;
      actor.group.addChild(unit);
      actor.units.push(unit);
    }
  }

  /** Real per-frame checkout detail (phase 15 port of `checkoutKit.ts`'s
   * `update()` + `animate()`). Reads `useMarketStore.getState()` directly
   * (like `stepFarmAnimals()`/`stepRetailStock()` above) since
   * `checkoutTransactions`/`customers` are raw store state with no React-side
   * derivation. Reuses the exact same pure helpers the real `/` renderer's
   * `kitFurniture.ts` calls (`activeCheckoutForLane`, `checkoutHandoffForLane`,
   * `checkoutBagLocation`) so the handoff-bag logic can never drift from the
   * real one. */
  private stepCheckout(dt: number) {
    if (this.checkoutLaneEntries.size === 0) return;
    const game = useMarketStore.getState().game;
    const franchise = game?.franchises.find((item) => item.id === game.currentFranchiseId) ?? game?.franchises[0];
    if (!franchise) return;
    const s = STORE_ELEMENT_SCALE;
    const factor = 1 - Math.exp(-8 * dt);

    for (const [lane, entry] of this.checkoutLaneEntries) {
      const transaction = activeCheckoutForLane(franchise.checkoutTransactions, lane);
      const handoffTransaction = checkoutHandoffForLane(franchise.checkoutTransactions, lane, franchise.customers);
      const handoffLocation = checkoutBagLocation(handoffTransaction, franchise.customers);
      const hasSeparateHandoffBag = Boolean(handoffTransaction && handoffLocation === "counter");

      const scanning = transaction?.state === "SCANNING" || transaction?.state === "BAGGING";
      const bagged = transaction?.pendingItems.reduce((sum, line) => sum + line.bagged, 0) ?? 0;
      const total = transaction?.pendingItems.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
      const handoffBagged = handoffTransaction?.pendingItems.reduce((sum, line) => sum + line.bagged, 0) ?? 0;
      const handoffTotal = handoffTransaction?.pendingItems.reduce((sum, line) => sum + line.quantity, 0) ?? 0;

      entry.beltLightMaterial.emissive = hexToColor(scanning ? "#60ffbd" : "#2d6553");
      entry.beltLightMaterial.emissiveIntensity = scanning ? 2.2 : 0.5;
      entry.beltLightMaterial.update();
      entry.scanningLight.light!.intensity = scanning ? entry.scanningLightOnIntensity : 0;

      entry.screenGlowMaterial.emissive = hexToColor(transaction ? "#4d9b80" : "#27463d");
      entry.screenGlowMaterial.update();
      const screenLabel = transaction ? `${bagged}/${total}` : "LISTA";
      if (entry.screenText.element!.text !== screenLabel) {
        entry.screenText.element!.text = screenLabel;
        this.growDynamicFontCharset(screenLabel);
      }

      const payment = transaction?.state === "PAYMENT";
      entry.cardGlowMaterial.diffuse = hexToColor(payment ? "#91f2be" : "#77948a");
      entry.cardGlowMaterial.emissiveIntensity = payment ? 1.4 : 0.18;
      entry.cardGlowMaterial.update();

      entry.bagA.update(total ? bagged / total : 0, hasSeparateHandoffBag ? [1.34 * s, 1.02 * s, 0.24 * s] : [1.67 * s, 1.02 * s, 0], Boolean(transaction));
      entry.bagB.update(handoffTotal ? handoffBagged / handoffTotal : 1, transaction ? [1.94 * s, 1.02 * s, -0.24 * s] : [1.67 * s, 1.02 * s, 0], hasSeparateHandoffBag);
      entry.bagC.update(0, [1.67 * s, 1.02 * s, 0], !transaction && !handoffTransaction);

      const unitsList = computeCheckoutUnits(transaction);
      const seen = new Set<string>();
      unitsList.forEach((unit, index) => {
        if (!unit.loaded || unit.bagged) return;
        const key = `${unit.productId}-${index}`;
        seen.add(key);
        const targetX = (unit.scanned ? 1.48 : Math.min(0.15, -1.66 + index * 0.29)) * s;
        const targetY = (unit.scanned ? 1.38 : 1.25) * s;
        const targetZ = (unit.scanned ? 0.18 : 0) * s;
        const live = entry.liveUnits.get(key);
        if (live) {
          live.target.set(targetX, targetY, targetZ);
        } else {
          const spec = RETAIL_PRODUCT_VISUAL[unit.productId];
          const unitEntity = new pc.Entity(`checkout-unit:${key}`);
          unitEntity.addComponent("render", { type: spec.shape, material: this.material(spec.color) });
          unitEntity.setLocalScale(spec.size[0] * 1.18 * s, spec.size[1] * 1.18 * s, spec.size[2] * 1.18 * s);
          unitEntity.setLocalPosition(-2.05 * s, 1.45 * s, 0.42 * s);
          entry.unitsGroup.addChild(unitEntity);
          entry.liveUnits.set(key, { entity: unitEntity, target: new pc.Vec3(targetX, targetY, targetZ) });
        }
      });
      for (const [key, live] of entry.liveUnits) {
        if (!seen.has(key)) {
          live.entity.destroy();
          entry.liveUnits.delete(key);
        }
      }
      for (const live of entry.liveUnits.values()) {
        const p = live.entity.getLocalPosition();
        live.entity.setLocalPosition(
          p.x + (live.target.x - p.x) * factor,
          p.y + (live.target.y - p.y) * factor,
          p.z + (live.target.z - p.z) * factor,
        );
      }
    }
  }

  /** Real per-frame production-machine status (phase 15 port of
   * `machines.ts`'s `buildMachineIdentity()`'s `update()`, plus the
   * per-machine processing light and `dynamic:machine-output` slot
   * visibility). Reads `useMarketStore.getState()` directly, like
   * `stepFarmAnimals()`/`stepCheckout()` above. */
  private stepProductionMachines() {
    if (this.machineBoardEntries.size === 0) return;
    const game = useMarketStore.getState().game;
    const franchise = game?.franchises.find((item) => item.id === game.currentFranchiseId) ?? game?.franchises[0];
    if (!franchise) return;
    const machineById = new Map(franchise.productionMachines.map((machine) => [machine.id, machine] as const));
    for (const entry of this.machineBoardEntries.values()) {
      const machine = machineById.get(entry.machineId);
      const status = machineStatusOf(machine);
      const ingredient = machine ? (Object.keys(PRODUCT_CONFIG[machine.productId]?.recipe ?? {})[0] as ProductId | undefined) : undefined;
      const queued = machine && ingredient
        ? (machine.input[ingredient] ?? 0) + Number(machine.status === "PROCESSING") * Number(PRODUCT_CONFIG[machine.productId]?.recipe?.[ingredient] ?? 0)
        : 0;
      const queueCapacity = machine && ingredient ? machineInputCapacity(machine, ingredient) : 0;

      const outputLabel = `${machine?.output ?? 0}/${machine?.outputCapacity ?? 0}`;
      if (entry.outputText.element!.text !== outputLabel) {
        entry.outputText.element!.text = outputLabel;
        this.growDynamicFontCharset(outputLabel);
      }
      entry.outputText.element!.color = hexToColor(machine && machine.output > 0 ? "#8ce6a1" : "#ffffff");

      const ingredientLabel = ingredient ? PRODUCTS[ingredient].name.toUpperCase() : "COLA";
      if (entry.ingredientText.element!.text !== ingredientLabel) {
        entry.ingredientText.element!.text = ingredientLabel;
        this.growDynamicFontCharset(ingredientLabel);
      }

      const queuedLabel = `${queued}/${queueCapacity}`;
      if (entry.queuedText.element!.text !== queuedLabel) {
        entry.queuedText.element!.text = queuedLabel;
        this.growDynamicFontCharset(queuedLabel);
      }
      entry.queuedText.element!.color = hexToColor(queued > 0 ? "#ffd98a" : "#ffffff");

      if (entry.statusLabelText.element!.text !== status.label) {
        entry.statusLabelText.element!.text = status.label;
        this.growDynamicFontCharset(status.label);
      }
      entry.statusLabelText.element!.color = hexToColor(status.color);
      entry.statusDotMaterial.diffuse = hexToColor(status.color);
      entry.statusDotMaterial.update();

      if (entry.processingLight) {
        entry.processingLight.light!.intensity = machine?.status === "PROCESSING" ? entry.processingLightOnIntensity : 0;
      }
      if (entry.cannerIndicatorMaterial) {
        entry.cannerIndicatorMaterial.diffuse = hexToColor(machine?.status === "PROCESSING" ? "#77e686" : "#d1ae56");
        entry.cannerIndicatorMaterial.update();
      }
      if (entry.outputSlots.length > 0) {
        const visibleCount = Math.min(entry.outputSlots.length, machine?.output ?? 0);
        entry.outputSlots.forEach((slot, index) => { slot.enabled = index < visibleCount; });
      }
    }
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
