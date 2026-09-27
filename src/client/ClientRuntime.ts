import * as THREE from "three";
import type { MarketSceneProps } from "@/components/game/MarketScene";
import { interactionZoneConfigs, PLAYER_START, type InteractionId } from "@/components/game/MarketScene";
import { publishLiveActors } from "@/game/render/LiveActors";
import { PartsInstancer } from "@/game/render/CrowdParts";
import { loadCrowdAnimation } from "@/game/render/CrowdSkinning";
import { CrowdCustomersSystem, CrowdEmployeesSystem, CUSTOMER_BODY_KEYS, CUSTOMER_PROP_DEFINITIONS, EMPLOYEE_BODY_KEYS, EMPLOYEE_PROP_DEFINITIONS, HAT_FILES, PROP_CAPACITY, PRODUCT_CAPACITY, createCrowdBody, createPropInstancers, employeeBodyOf, firstSkinnedMesh } from "@/game/render/CrowdSystems";
import { prepareCharacterModel } from "@/game/animation/CharacterPresentation";
import { daylightPresentation } from "@/game/time/BusinessDay";
import { accessoryParts, deliveredProductParts } from "@/components/game/CrowdProps";
import { ensureStoreNavigation } from "@/game/navigation/NavMeshService";
import { setInPlaceWorldTicks, useMarketStore } from "@/game/store";
import { WORLD_TICK_INTERVAL_MS } from "@/game/core/timing";
import { DisplayCadenceEstimator, marketRenderProfileForCapabilities, MotionCadenceController, presentationDivisor, type MarketRenderProfile } from "@/game/render/AdaptiveQuality";
import { visibleActorMotionActive } from "@/game/render/LiveActors";
import { FieldPerformanceSampler } from "@/game/telemetry/FieldPerformance";
import { STORE_LAYOUT_SCALE, WORLD_SCALE } from "@/game/world-scale";
import type { CharacterId, HatId } from "@/game/types";
import { inputManager } from "@/game/input/InputManager";
import { CameraRig } from "./CameraRig";
import { PlayerActor } from "./PlayerActor";
import { RetailStockLayer } from "./RetailStockLayer";
import { SignLayer } from "./SignLayer";
import { StationLayer } from "./StationLayer";
import { accessoryPath, budgetPath, characterPath, getInFlightLoadCount, loadBakedWorld, loadGltf, type BakedWorld } from "./WorldAssets";
import { buildFurniture, buildFarm, type FurnitureBuildProps, type FarmBuildProps } from "./WorldKit";
import { buildStorefrontDoor, type StorefrontDoorHandle } from "./WorldKit/storefrontDoor";
import { buildRearFarmDoor, type RearFarmDoorHandle } from "./WorldKit/rearFarmDoor";
import { buildPurchaseMarkers } from "./WorldKit/purchaseMarkers";
import { buildRegisterCashMarkers } from "./WorldKit/registerCashMarkers";
import { buildTransferEffects, type TransferEffectsHandle } from "./WorldKit/transferEffects";
import { ablation, configureAblation } from "./WorldKit/ablation";
import { warmUpShadersBeforeAttach, warmUpTexturesIdle, warmUpTexturesNow } from "./WorldKit/gpuWarmup";
import { FrameAttribution, type FrameBreakdown } from "@/runtime/frameAttribution";
import { readUsedJsHeapMb } from "@/runtime/integralMetrics";

/**
 * The plain-three client: one renderer, one scene built once from the baked
 * level, one requestAnimationFrame loop that ticks the world at a fixed
 * step, moves the owner, updates the instanced crowd and props and renders.
 * React only mounts the canvas and hands over the game state slices through
 * `setProps`; nothing in here reconciles a component tree.
 */
export interface ClientRuntimeOptions {
  canvas: HTMLCanvasElement;
  levelName: string;
  debug?: boolean;
  onReady?: () => void;
  /**
   * `/runtime`'s integral test only — never set by `/` or `/play2`. One call
   * per rendered frame with the same shape `FrameMetrics.addFrame` already
   * consumes: `workMs` (the whole `tick()` body, not just the render call)
   * and `gapMs` (time since the previous rAF callback, measured independently
   * of `tick()`'s own clamped `delta` so a real stall over `MAX_FRAME_DELTA`
   * is not silently capped away). Optional-chained: zero behaviour change and
   * one extra `performance.now()` pair when unset.
   */
  onFrameSample?: (workMs: number, gapMs: number, drawCalls: number, triangles: number) => void;
  /**
   * `/runtime`'s integral test only — never set by `/` or `/play2`. Fires
   * exactly once, the first time a REAL input sample (`player.input`,
   * `InputManager`-sourced — same value `?debug=1`'s `__MARKET_QA__.input`
   * already exposes) with non-trivial magnitude is followed, in the same
   * tick, by the player's world position actually having moved. This is
   * deliberately not "the first frame rendered" (`onReady`/`onFrameSample`'s
   * first call): the owner's requirement is that time-to-interactive means
   * the player can really move, not that a canvas appeared. The check runs
   * every tick only until it fires once (`interactiveVerified` short-circuits
   * it after), so steady-state cost is nil.
   */
  onInteractiveVerified?: () => void;
  /**
   * `/runtime` only — never set by `/` or `/play2`, so their behaviour is
   * byte-for-byte unchanged. Builds the store's furniture and farm LIVE from
   * the same source-of-truth layout modules `/` uses (`src/client/WorldKit/`)
   * instead of reading them from the frozen `level30.glb` bake — the fix for
   * the root cause found on 26-09-2026 (a baked snapshot shows whatever was
   * purchased when it was baked, not what the real save has unlocked). The
   * bake (`levelName`) must then point at a shell-only asset (ground/city/
   * building — confirmed unconditional, never gated by `unlockedAreas`) or
   * the baked furniture/farm would double up with WorldKit's live ones.
   */
  worldKit?: boolean;
}

const MAX_FRAME_DELTA = 0.1;

export class ClientRuntime {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** Layout-unit space (the scene scales it by WORLD_SCALE like the React root). */
  readonly layoutRoot = new THREE.Group();
  readonly rig = new CameraRig();
  private readonly customers = new CrowdCustomersSystem();
  private readonly employees = new CrowdEmployeesSystem();
  private readonly player: PlayerActor;
  private world: BakedWorld | null = null;
  private stock: RetailStockLayer | null = null;
  private signs: SignLayer | null = null;
  private stations: StationLayer | null = null;
  private readonly worldKit: boolean;
  private furniture: Awaited<ReturnType<typeof buildFurniture>> | null = null;
  private farm: ReturnType<typeof buildFarm> | null = null;
  private storefrontDoor: StorefrontDoorHandle | null = null;
  private rearFarmDoor: RearFarmDoorHandle | null = null;
  private purchaseMarkers: ReturnType<typeof buildPurchaseMarkers> | null = null;
  private registerCashMarkers: ReturnType<typeof buildRegisterCashMarkers> | null = null;
  private transferEffects: TransferEffectsHandle | null = null;
  private props: MarketSceneProps | null = null;
  private frame = 0;
  private running = false;
  private lastFrameAt = 0;
  private worldClockMs = 0;
  private tickAccumulatorMs = 0;
  private elapsed = 0;
  private lastSimulationTimeMs = -1;
  private lastShelvesRevision = "";
  private readonly performance = new FieldPerformanceSampler();
  private readonly hatKinds = new Set<string>();
  private zoneSignature = "";
  private ready = false;
  /** Guards `load()`'s async continuations against touching a torn-down
   * scene/renderer, or building state nothing will ever dispose again, if
   * `dispose()` runs while `load()` is still mid-await — see `dispose()`. */
  private disposed = false;
  private readonly onReady?: () => void;
  private readonly onFrameSample?: ClientRuntimeOptions["onFrameSample"];
  private readonly onInteractiveVerified?: ClientRuntimeOptions["onInteractiveVerified"];
  private interactiveVerified = false;
  private readonly debug: boolean;
  /** `/runtime`'s worldKit path only (`this.worldKit && this.debug`) — see
   * `frameAttribution.ts`'s module doc comment. `null` (never constructed)
   * for `/` and `/play2`, and for `/runtime` itself without `?debug=1`, so
   * neither pays even the cheap `mark()` bracket cost by default. */
  private readonly attribution: FrameAttribution | null;
  private mobile: boolean;
  private glassTransmission: boolean;
  private readonly renderProfile: MarketRenderProfile;
  /** Idle-vs-motion presentation cadence for mobile — root-caused 2026-09-27:
   * this loop used to call `present()`+`render()` on every single rAF tick
   * unconditionally, so a `targetFps: 30` mobile profile never actually took
   * effect here (only `/`'s and `/play2`'s React canvas, via MarketScene's
   * `CappedFrameScheduler`, ever read it). A 15-minute iPhone playtest spends
   * most of its time with the player standing still, so `/runtime` was doing
   * a full submit-and-present GPU pass roughly twice as often as the already
   * shipped, already-tuned idle budget intends for that whole span — cheap
   * per frame (3-7ms), but sustained at 2x the necessary rate is exactly the
   * kind of "keeps the chip busy beyond the measured work window" load that
   * shows up as lingering heat rather than as a slow frame. Desktop
   * (`targetFps: 60`) is completely unaffected: the divisor is always 1. */
  private readonly presentCadence = new DisplayCadenceEstimator();
  private readonly presentMotionCadence = new MotionCadenceController();
  private presentTicksSincePresent = 0;
  private presentLastAt = 0;
  private presentLastSlotMs = 0;
  private presentLastTickAt = 0;
  private presentAccumulatedDelta = 0;

  constructor(private readonly options: ClientRuntimeOptions) {
    // Diagnostic-only, opt-in ablation flags for the iPhone frame-pacing
    // causal audit (`?ablate=text,glass,animals`) — off by default, no
    // behaviour change for real traffic. See `WorldKit/ablation.ts`.
    configureAblation(window.location.search);
    const profile = marketRenderProfileForCapabilities({ width: window.innerWidth, coarsePointer: window.matchMedia("(any-pointer: coarse)").matches, devicePixelRatio: window.devicePixelRatio });
    this.mobile = profile.mobile;
    this.glassTransmission = profile.glassTransmission;
    this.renderProfile = profile;
    this.renderer = new THREE.WebGLRenderer({ canvas: options.canvas, antialias: !profile.mobile, powerPreference: profile.powerPreference, alpha: false, stencil: false, depth: true });
    this.renderer.setPixelRatio(Math.min(profile.mobile ? 2 : 2, window.devicePixelRatio));
    // `/runtime`'s worldKit path only (`/play2` keeps three.js's default,
    // unchanged). Root-caused 2026-09-27 with a real CDP CPU profile taken
    // WHILE steering into a section for the first time (not guessed from GL
    // call counts): three.js's `WebGLProgram` calls `gl.getProgramInfoLog`/
    // `getShaderInfoLog`/`getProgramParameter` — synchronous, driver-flushing
    // calls — the FIRST TIME each compiled shader program is actually USED
    // to render (`onFirstUse`, `WebGLProgram.js`), not when it is compiled.
    // Neither `renderer.compile()` (`finishReady`) nor `compileAsync`/
    // `initTexture` warm-up (`gpuWarmup.ts`) touches this path at all — both
    // only get the program compiled/linked ahead of time, but the mandatory
    // error-log check three.js's default `debug.checkShaderErrors = true`
    // performs still fires at first real render regardless, which is exactly
    // why attempt 1's warm-up measured byte-identical `maxFrameGapMs` with
    // `?ablate=warmup` on or off — this cost was never touched by it. The
    // profile showed `getProgramInfoLog` alone at 238-288ms of the ~3.5s
    // first-visit window (dairy), a large fraction of the observed
    // 550-650ms `maxFrameGapMs` longtask. Three.js's own doc comment for
    // this flag: "It may be useful to disable this check in production for
    // performance gain." Every WorldKit/crowd/prop material here is an
    // already-shipped, already-vetted shader — never player- or
    // save-authored — so there is nothing this check could ever catch here
    // in production. `?ablate=shaderchecks` reverts to three.js's default
    // for A/B comparison (see `ablation.ts`); `?debug=1` alone does NOT
    // re-enable it, so the QA harness measures the real shipped behaviour.
    this.renderer.debug.checkShaderErrors = !options.worldKit || ablation.forceShaderChecks;
    // `configureRendererPolicy()`'s real-source equivalent — mobile halves the
    // resolution of Three.js's internal transmission scene pass. Root-caused
    // 2026-09-26 (docs/RUNTIME-IPHONE-FRAME-PACING-AUDIT.md): the WorldKit
    // door port hardcoded desktop transmission values and never read
    // `profile.glassTransmission`/`transmissionResolutionScale` at all, so a
    // mobile iPhone was unconditionally paying for Three.js's transmission
    // feature — which renders the whole opaque scene a second time, every
    // frame, into an internal render target — something production has never
    // done on mobile. Measured: this alone accounted for roughly half of
    // /runtime's GPU frame cost (real EXT_disjoint_timer_query_webgl2
    // timings, not draw-call/triangle counts alone).
    this.renderer.transmissionResolutionScale = profile.transmissionResolutionScale;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setClearColor(new THREE.Color("#e8e2d3"), 1);
    this.scene.background = new THREE.Color("#e8e2d3");
    this.layoutRoot.scale.setScalar(WORLD_SCALE);
    this.layoutRoot.name = "client:layout";
    this.scene.add(this.layoutRoot);
    this.debug = Boolean(options.debug);
    if (this.debug) {
      // Exposed here (constructor time), not just in `publishDebug()`
      // (tick-gated, so only after `finishReady()` already ran): an external
      // QA harness that wants to observe curtain-time GPU warm-up work
      // (`gpuWarmup.ts`, dispatched from `finishReady()` itself) needs the
      // real renderer reference BEFORE that call, not after.
      (window as typeof window & { __MARKET_QA_RENDERER__?: THREE.WebGLRenderer }).__MARKET_QA_RENDERER__ = this.renderer;
    }
    this.onReady = options.onReady;
    this.onFrameSample = options.onFrameSample;
    this.onInteractiveVerified = options.onInteractiveVerified;
    this.worldKit = Boolean(options.worldKit);
    this.attribution = this.worldKit && this.debug ? new FrameAttribution(getInFlightLoadCount, readUsedJsHeapMb) : null;
    this.player = new PlayerActor({
      onInteract: (id) => this.props?.onInteract(id as InteractionId),
      onDistance: (meters) => this.props?.onDistance(meters),
      onDoorPresence: (active) => this.props?.onDoorPresence(active),
      onCheckoutFocus: (focused) => { this.checkoutFocused = focused; },
    }, this.worldKit);
    this.layoutRoot.add(this.player.group);
    this.customers.attachTo(this.layoutRoot);
    this.employees.attachTo(this.layoutRoot);
    this.customers.setModelTier(profile.mobile ? 2 : 1);
    this.setupLights();
    this.resize();
  }

  private checkoutFocused = false;

  /** `MarketSceneProps` -> `WorldKit`'s `FurnitureBuildProps`/`FarmBuildProps`
   * — field-name mapping only, no data transform (same fields `KitFurniture`/
   * `KitFarm` read in `MarketScene.tsx`'s own JSX call). `dynamicCeilingLights`
   * has no equivalent prop on `MarketSceneProps` (the source computes it
   * inline from `renderProfile`); `!this.mobile` reproduces its primary
   * condition — the QA-only `renderProfile.baseline` override isn't visible
   * here and isn't exercised by `/runtime`'s integral test. */
  private furnitureProps(props: MarketSceneProps): FurnitureBuildProps {
    return {
      shelves: props.visualShelves,
      shelfTier: props.shelfTier,
      machines: props.productionMachines,
      customers: props.customers,
      checkoutTransactions: props.checkoutTransactions,
      returnsBin: props.returnsBin,
      returnedCartCount: props.returnedCartCount,
      lightsOn: props.lightsOn,
      dynamicCeilingLights: !this.mobile,
      unlockedAreas: props.unlockedAreas,
    };
  }

  private farmProps(props: MarketSceneProps): FarmBuildProps {
    return {
      crops: props.visualCrops,
      machines: props.productionMachines,
      nowMs: props.simulationTimeMs,
      unlockedAreas: props.unlockedAreas,
    };
  }

  private keyLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;

  private setupLights() {
    // One key light, no shadow map: occlusion is baked. Initial values match
    // `daylightPresentation()`'s `DAY` phase (`/`'s `BusinessDay.ts`) so the
    // very first frame (before any `setProps`/`syncStatic` call lands) looks
    // right without waiting on a tick.
    const key = new THREE.DirectionalLight("#fff6df", 2.3);
    key.position.set(8 * WORLD_SCALE, 13 * WORLD_SCALE, 7 * WORLD_SCALE);
    key.castShadow = false;
    const ambient = new THREE.AmbientLight("#ffffff", 1.15);
    this.keyLight = key;
    this.ambientLight = ambient;
    this.scene.add(key, ambient);
    if (this.worldKit) {
      // `/runtime` only — mirrors `MarketScene.tsx`'s `<fog>` (`daylight.fog`,
      // near/far `62/105 * WORLD_SCALE`) so distant geometry fades into the
      // sky colour like the source instead of popping at the far plane.
      // `/play2` is unaffected (no `this.scene.fog` assignment at all,
      // exactly as before this fix).
      this.scene.fog = new THREE.Fog(new THREE.Color("#b8dfce"), 62 * WORLD_SCALE, 105 * WORLD_SCALE);
    } else {
      // `/play2` keeps its own invented fill light, unchanged — it never
      // existed in `/` (`MarketScene.tsx` has no `<hemisphereLight>` at all,
      // confirmed by direct grep) and was never part of the parity contract
      // for that route, which this fix does not touch.
      this.scene.add(new THREE.HemisphereLight("#dfeaf2", "#7d6f5c", 1.15));
    }
  }

  /** `/runtime` only (`this.worldKit`) — real gap found by direct comparison
   * with `MarketScene.tsx`: the source's key light, ambient light, sky/fog
   * colour and clear colour all track `daylightPresentation(minuteOfDay)`
   * (`BusinessDay.ts`) through a full day → sunset → night cycle, but
   * `ClientRuntime` only ever set them once, statically, at construction —
   * so `/runtime` never dimmed, tinted or fogged the scene as the in-game
   * clock advanced, unlike `/`. `/play2` is untouched (never calls this). */
  private applyDaylight(minuteOfDay: number) {
    const daylight = daylightPresentation(minuteOfDay);
    this.keyLight.color.set(daylight.keyColor);
    this.keyLight.intensity = daylight.keyIntensity;
    this.ambientLight.intensity = daylight.ambientIntensity;
    const background = new THREE.Color(daylight.background);
    this.scene.background = background;
    this.renderer.setClearColor(background, 1);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.set(daylight.fog);
  }

  /** Loads the level: baked store, owner, crowd bodies, props, signs. */
  async load(initial: MarketSceneProps) {
    this.props = initial;
    if (this.worldKit) this.applyDaylight(initial.minuteOfDay);
    // `?inplace=0` keeps the cloning tick for A/B checks of the in-place path.
    setInPlaceWorldTicks(!new URLSearchParams(window.location.search).has("inplace") || new URLSearchParams(window.location.search).get("inplace") !== "0");
    // Who drives `tickWorld` (this loop, vs. `GameRuntime`'s own `setInterval`)
    // is decided synchronously by `GameShell` before any effect runs (a
    // `useLayoutEffect` keyed on the same route check this class exists for),
    // not here: setting it only after this async `load()` resolves used to
    // race `GameRuntime`'s mount effect and leave BOTH drivers running at
    // once. See `GameShell.tsx`'s `useLayoutEffect` for the fix.
    const world = await loadBakedWorld(this.options.levelName);
    // A `dispose()` mid-await must not let this continuation touch a scene/
    // renderer that's already torn down, or build (and leak) world content
    // nothing will ever dispose again — confirmed as a real bug by
    // adversarial review 2026-09-26 (see the matching guard in
    // `PlayerActor.load()`, the same class of issue for its own Rapier build).
    if (this.disposed) return;
    this.world = world;
    this.scene.add(world.root);
    this.signs = new SignLayer();
    this.scene.add(this.signs.mesh);
    if (this.worldKit) {
      // `/runtime` only (see `ClientRuntimeOptions.worldKit`'s doc comment —
      // never set by `/`/`/play2`, whose own branch below is untouched).
      // Startup-performance fix (2026-09-26): the crowd's own body/animation
      // GLBs, its delivered-product props and its hats used to sit in this
      // same awaited chain as the player's own load and the navmesh build,
      // so the curtain stayed up for every character variant and every
      // fixture's stock-screen photo before the player could take a single
      // step, even though none of it gates movement. `player.load()` builds
      // real Rapier collision from authored layout constants
      // (`PlayerPhysics.ts`), completely independent of the navmesh; the
      // crowd systems already no-op cleanly when a body/hat/delivered-product
      // registry entry isn't loaded yet (`CrowdSystems.update()`'s
      // `if (!body) continue/return`, mirrored by the isolated
      // `src/runtime/scene.ts` measurement harness's `crowdReady`/`navReady`
      // resolving independently of `ready`). So only the store shell, its
      // furniture/farm/doors/markers and the player itself are awaited here;
      // everything else loads in the background right after the first
      // playable frame (`loadDeferredWorldKitAssets`).
      const [furniture] = await Promise.all([
        buildFurniture(this.renderer, this.furnitureProps(initial)),
        this.player.load(initial.avatar, PLAYER_START[0], PLAYER_START[2]),
      ]);
      if (this.disposed) return;
      this.furniture = furniture;
      this.layoutRoot.add(furniture.group);
      this.farm = buildFarm(this.renderer, this.rig.camera, this.scene, this.farmProps(initial));
      this.layoutRoot.add(this.farm.group);
      this.storefrontDoor = buildStorefrontDoor(this.glassTransmission);
      this.layoutRoot.add(this.storefrontDoor.group);
      this.rearFarmDoor = buildRearFarmDoor(this.glassTransmission);
      this.layoutRoot.add(this.rearFarmDoor.group);
      this.purchaseMarkers = buildPurchaseMarkers();
      this.purchaseMarkers.update(initial.purchaseMarkers);
      this.layoutRoot.add(this.purchaseMarkers.group);
      this.registerCashMarkers = buildRegisterCashMarkers();
      this.registerCashMarkers.update(initial.registerCashMinor, initial.cashBundleMinor);
      this.layoutRoot.add(this.registerCashMarkers.group);
      this.transferEffects = buildTransferEffects();
      this.transferEffects.sync(initial.transferEvents, initial.unlockedAreas, initial.onTransferProgress);
      this.layoutRoot.add(this.transferEffects.group);
      createPropInstancers(this.layoutRoot, CUSTOMER_PROP_DEFINITIONS(), this.customers.props);
      createPropInstancers(this.layoutRoot, EMPLOYEE_PROP_DEFINITIONS(), this.employees.props);
      this.addSigns(world);
      this.finishReady(initial);
      void this.loadDeferredWorldKitAssets(initial);
      return;
    }
    this.stock = new RetailStockLayer(world.anchors);
    this.stations = new StationLayer(world.anchors, this.signs);
    await Promise.all([
      this.stock.load(),
      this.stations.load(),
      this.player.load(initial.avatar, PLAYER_START[0], PLAYER_START[2]),
      this.loadCrowdBodies(),
    ]);
    if (this.disposed) return;
    // Baked anchors are world-space matrices: stock and machines hang from
    // the scene; crops use layout positions and hang from the scaled root.
    this.scene.add(this.stock.group, this.stations.worldGroup);
    this.layoutRoot.add(this.stations.group);
    createPropInstancers(this.layoutRoot, CUSTOMER_PROP_DEFINITIONS(), this.customers.props);
    createPropInstancers(this.layoutRoot, EMPLOYEE_PROP_DEFINITIONS(), this.employees.props);
    await this.loadDeliveredProducts();
    await this.loadEmployeeHats(initial);
    this.addSigns(world);
    await ensureStoreNavigation(initial.unlockedAreas);
    this.player.snapToNavmesh();
    this.finishReady(initial);
  }

  private addSigns(world: BakedWorld) {
    for (const anchor of world.anchors) {
      if (anchor.kind !== "text" || !anchor.text) continue;
      // Live counters are drawn by the station layer; skip their baked copies.
      if (anchor.within && /^(retail-stock-screen|dynamic:(stock-screen|machine-status|machine-output))/.test(anchor.within)) continue;
      const matrix = new THREE.Matrix4().fromArray(anchor.matrix);
      const color = typeof anchor.color === "number" ? `#${anchor.color.toString(16).padStart(6, "0")}` : anchor.color ?? "#ffffff";
      this.signs?.add(anchor.text, { fontSize: anchor.fontSize ?? 0.12, color, weight: 800 }, matrix);
    }
  }

  private finishReady(initial: MarketSceneProps) {
    this.syncStatic(initial);
    // `/runtime`'s worldKit path only: `renderer.compile()` below already
    // precompiles every shader PROGRAM in the scene, but never uploads
    // texture DATA to the GPU (`WebGLRenderer.compile` only builds/links
    // programs; textures upload lazily the first time `render()` actually
    // draws them). Anything outside the camera frustum from `PLAYER_START` —
    // almost every department except what's immediately visible at spawn —
    // would otherwise pay that upload cost the first time the player walks
    // it into view. Doing it here, still inside the loading curtain (before
    // `onReady()` below), is the fix: pay it once, before declaring
    // interactive, not on first sight of a section. See `gpuWarmup.ts`.
    if (this.worldKit && !ablation.skipWarmup) warmUpTexturesNow(this.renderer, this.scene);
    // First frame with everything compiled before the cover lifts.
    this.renderer.compile(this.scene, this.rig.camera);
    this.present(0, performance.now());
    this.renderer.render(this.scene, this.rig.camera);
    this.ready = true;
    this.onReady?.();
  }

  /** `/runtime`'s worldKit path only: everything that doesn't gate the first
   * playable frame (see the doc comment above its `load()` call site) —
   * every crowd body/animation, the crowd's delivered-product props, every
   * employee's hat, and the navmesh (queried only by `player.snapToNavmesh()`,
   * a one-time safety net; real per-frame player collision is Rapier, not
   * this). Fired-and-forgotten right after `onReady()`, so a slow network
   * never keeps the curtain up, and each system simply starts rendering the
   * moment its own registry gains an entry. */
  private async loadDeferredWorldKitAssets(initial: MarketSceneProps) {
    // `stagger: true` here only — see `loadCrowdBodies`'s doc comment for why.
    await Promise.all([this.loadCrowdBodies(true), this.loadDeliveredProducts(), this.loadEmployeeHats(initial)]);
    if (this.disposed) return;
    await ensureStoreNavigation(initial.unlockedAreas);
    if (this.disposed) return;
    this.player.snapToNavmesh();
  }

  /** Runs `tasks` with at most `concurrency` in flight, yielding one rendered
   * frame after each task finishes before starting the next on that worker —
   * network fetches still overlap (`concurrency` of them at a time), but each
   * task's own main-thread work (GLTF `parse()`, `createCrowdBody`, the
   * shader-warm-up-before-attach `warmUpShadersBeforeAttach` dispatches) lands in its own
   * frame instead of piling up in one continuous stretch. Root-caused
   * 2026-09-27 with a real CDP CPU profile taken under 4x CPU throttling
   * (approximating a real mobile SoC — real GPU driver work is invisible on
   * Playwright's default SwiftShader software renderer, and a desktop GPU is
   * fast enough to hide the same cost entirely; throttled CPU + real GPU is
   * the one combination that reproduced the owner's iPhone-reported hitch at
   * comparable severity, ~700-750ms `maxFrameGapMs`/longtask, in this
   * harness): no single function dominated — GLTF parsing
   * (`_getArrayFromAccessor`/`parse`/`loadAnimation`), three.js scene-graph
   * matrix updates (`updateMatrixWorld`/`compose`/`multiplyMatrices`) and
   * native GL calls (`texSubImage2D`/`getProgramParameter`/`shaderSource`)
   * were all present in comparable amounts — because `loadCrowdBodies`'s own
   * `Promise.all` of 8 independent GLTF+animation loads (6 customer bodies +
   * 2 employee bodies) resolve in a tight cluster (same local network, same
   * moment) and each one's parse + scene-attach + warm-up dispatch runs
   * back-to-back with nothing yielding the main thread in between — exactly
   * the same window the QA harness's closed-loop steering already reaches
   * the first section in. */
  private static async runStaggered(tasks: (() => Promise<void>)[], concurrency: number) {
    let index = 0;
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const worker = async () => {
      while (index < tasks.length) {
        const task = tasks[index];
        index += 1;
        await task();
        await nextFrame();
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  }

  /** `stagger` is `true` only from `loadDeferredWorldKitAssets` (`/runtime`'s
   * post-ready background load — see `runStaggered`'s doc comment for why).
   * `/play2`'s own call (`load()`'s non-`worldKit` branch, awaited inside the
   * loading curtain, `stagger` left at its `false` default) is completely
   * unaffected: same `Promise.all` of all 8 bodies at once as before this
   * fix, byte-for-byte. */
  private async loadCrowdBodies(stagger = false) {
    // `worldKit` (`/runtime` only) loads the same device-tiered GLBs `/`
    // renders instead of the fixed, more-reduced budget tier `/play2` still
    // loads unchanged — see `WorldAssets.characterPath`'s doc comment.
    const customerTasks = Object.entries(CUSTOMER_BODY_KEYS).map(([, key]) => async () => {
      const path = this.worldKit ? characterPath("customers", key) : budgetPath("customers", key);
      const [gltf, animation] = await Promise.all([loadGltf(path), loadCrowdAnimation(key)]);
      // `/runtime` only (`this.worldKit`) — `/play2` keeps the raw GLB
      // material unchanged, byte-for-byte. `/`'s own `CrowdRenderer.tsx`
      // (`CrowdBodyBatch`) always runs every crowd body through
      // `prepareCharacterModel({ crowd: true, reducedDetail: true })` before
      // reading its skinned mesh — the "premium" pass that removes the dry
      // GLB-scan look (roughness reduction, envMapIntensity, an emissive
      // self-fill for facial readability, clearcoat/sheen where the GLB
      // ships `MeshPhysicalMaterial`, and 8x anisotropy + linear filtering on
      // every character texture map). `/runtime`'s port never called it —
      // found by direct comparison with `CrowdRenderer.tsx:31`.
      const skinned = firstSkinnedMesh(this.worldKit ? prepareCharacterModel(gltf.scene, { crowd: true, reducedDetail: true }) : gltf.scene);
      if (!skinned) return;
      const body = createCrowdBody(skinned, animation, key);
      // `/runtime` only — see `finishReady`'s doc comment and
      // `gpuWarmup.ts`. This body streams in AFTER the first playable
      // frame on purpose, so its shader/texture warm-up must not block
      // anything long — but the shader program itself must be linked
      // BEFORE this mesh is a scene child, or three.js's normal render path
      // compiles it synchronously the instant it becomes visible (real
      // evidence: `FrameAttribution`, 2026-09-27 — see
      // `warmUpShadersBeforeAttach`'s doc comment). Texture upload stays on
      // the idle path, same as before, since that was never the measured
      // cost here.
      if (this.worldKit && !ablation.skipWarmup) await warmUpShadersBeforeAttach(this.renderer, body.mesh, this.rig.camera, this.scene);
      this.layoutRoot.add(body.mesh);
      this.customers.bodies.set(key, body);
      if (this.worldKit && !ablation.skipWarmup) warmUpTexturesIdle(this.renderer, body.mesh);
    });
    const employeeTasks = Object.values(EMPLOYEE_BODY_KEYS).map((key) => async () => {
      if (!key) return;
      const path = this.worldKit ? characterPath("characters", key) : budgetPath("characters", key);
      const [gltf, animation] = await Promise.all([loadGltf(path), loadCrowdAnimation(key)]);
      // See the matching comment on `customerTasks` above — same fix, same
      // gate, mirroring `CrowdRenderer.tsx:31`'s `EMPLOYEE_BODY_KEYS` path.
      const skinned = firstSkinnedMesh(this.worldKit ? prepareCharacterModel(gltf.scene, { crowd: true, reducedDetail: true }) : gltf.scene);
      if (!skinned) return;
      const body = createCrowdBody(skinned, animation, key);
      if (this.worldKit && !ablation.skipWarmup) await warmUpShadersBeforeAttach(this.renderer, body.mesh, this.rig.camera, this.scene);
      this.layoutRoot.add(body.mesh);
      this.employees.bodies.set(key, body);
      if (this.worldKit && !ablation.skipWarmup) warmUpTexturesIdle(this.renderer, body.mesh);
    });
    const tasks = [...customerTasks, ...employeeTasks];
    if (stagger) await ClientRuntime.runStaggered(tasks, 2);
    else await Promise.all(tasks.map((task) => task()));
  }

  private async loadDeliveredProducts() {
    for (const id of ["milk", "cheese", "egg"] as const) {
      const gltf = await loadGltf(budgetPath("delivered", id));
      const productId = id === "egg" ? "eggs" : id;
      for (const registry of [this.customers.delivered, this.employees.delivered]) {
        const instancer = new PartsInstancer(deliveredProductParts(gltf.scene), PRODUCT_CAPACITY, `client-delivered:${productId}`);
        // `/runtime` only — same shader-before-attach fix as crowd bodies above.
        if (this.worldKit && !ablation.skipWarmup) await warmUpShadersBeforeAttach(this.renderer, instancer.meshes, this.rig.camera, this.scene);
        instancer.attach(this.layoutRoot);
        registry.set(productId, instancer);
        if (this.worldKit && !ablation.skipWarmup) warmUpTexturesIdle(this.renderer, instancer.meshes);
      }
    }
  }

  private async loadEmployeeHats(props: MarketSceneProps) {
    const wanted = new Set(props.employees.map((employee, index) => `${employeeBodyOf(index)}:${employee.hat}`));
    for (const key of wanted) {
      if (this.hatKinds.has(key)) continue;
      const [body, hat] = key.split(":") as [CharacterId, HatId];
      const file = HAT_FILES[hat];
      if (!file) continue;
      const path = this.worldKit ? accessoryPath("hats", file, body) : budgetPath("hats", file, body);
      const gltf = await loadGltf(path).catch(() => null);
      if (!gltf) continue;
      const instancer = new PartsInstancer(accessoryParts(gltf.scene), PROP_CAPACITY, `client-hat:${key}`);
      // `/runtime` only — same shader-before-attach fix as crowd bodies above.
      if (this.worldKit && !ablation.skipWarmup) await warmUpShadersBeforeAttach(this.renderer, instancer.meshes, this.rig.camera, this.scene);
      instancer.attach(this.layoutRoot);
      this.employees.hats.set(key, instancer);
      this.hatKinds.add(key);
      if (this.worldKit && !ablation.skipWarmup) warmUpTexturesIdle(this.renderer, instancer.meshes);
    }
  }

  /** New state slices from the shell (every world tick and HUD change). */
  setProps(props: MarketSceneProps) {
    const previous = this.props;
    this.props = props;
    if (!this.ready) return;
    if (props.employees !== previous?.employees) void this.loadEmployeeHats(props);
    if (this.attribution) this.attribution.markAsync("setProps:syncStatic", () => this.syncStatic(props));
    else this.syncStatic(props);
  }

  private syncStatic(props: MarketSceneProps) {
    // `/runtime` only — cheap (a few colour/intensity writes, no allocation
    // beyond one `THREE.Color`), runs once per world tick like every other
    // `syncStatic` update, not per rendered frame.
    if (this.worldKit) this.applyDaylight(props.minuteOfDay);
    publishLiveActors(props.customers, props.checkoutTransactions, props.employees, props.simulationTimeMs);
    this.employees.setEmployees(props.employees);
    this.player.carry = props.carry;
    this.player.setSpeedTier(props.playerSpeedTier, props.unlockedAreas.includes("purchase-campaign"));
    const zoneSignature = `${props.checkoutLevel}|${props.unlockedAreas.join(",")}|${props.crops.filter((crop) => crop.status !== "LOCKED").map((crop) => crop.id).join(",")}|${props.purchaseMarkers.map((marker) => marker.id).join(",")}`;
    if (zoneSignature !== this.zoneSignature) {
      this.zoneSignature = zoneSignature;
      this.player.setZones(interactionZoneConfigs(props.checkoutLevel, props.unlockedAreas, props.crops.filter((crop) => crop.status !== "LOCKED").map((crop) => crop.id), props.purchaseMarkers.map((marker) => marker.id)), props.unlockedAreas);
    }
    if (this.worldKit) {
      // WorldKit's own update() calls are already cheap (instance/text
      // mutation, never a geometry rebuild except on a real unlockedAreas
      // change) — no need to replicate `shelvesRevision`/`simulationTimeMs`
      // dirty-checking on top of it.
      this.furniture?.update(this.furnitureProps(props));
      this.farm?.update(this.farmProps(props));
      this.purchaseMarkers?.update(props.purchaseMarkers);
      this.registerCashMarkers?.update(props.registerCashMinor, props.cashBundleMinor);
      this.transferEffects?.sync(props.transferEvents, props.unlockedAreas, props.onTransferProgress);
    } else {
      const shelvesRevision = JSON.stringify(props.visualShelves);
      if (shelvesRevision !== this.lastShelvesRevision) {
        this.lastShelvesRevision = shelvesRevision;
        this.stock?.sync(props.visualShelves);
        this.stations?.syncStock(props.visualShelves, props.shelfTier, props.unlockedAreas);
      }
      if (props.simulationTimeMs !== this.lastSimulationTimeMs) {
        this.lastSimulationTimeMs = props.simulationTimeMs;
        this.stations?.syncWorld(props);
      }
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrameAt = performance.now();
    this.worldClockMs = this.lastFrameAt;
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  private tick(now: number) {
    const tickStart = this.onFrameSample || this.attribution ? performance.now() : 0;
    const rawGapMs = now - this.lastFrameAt;
    const delta = Math.min(MAX_FRAME_DELTA, Math.max(0, rawGapMs / 1000));
    this.lastFrameAt = now;
    this.elapsed += delta;
    this.performance.addFrame(delta * 1000);
    // World: fixed 200 ms steps from the frame loop, never from a timer.
    this.tickAccumulatorMs += now - this.worldClockMs;
    this.worldClockMs = now;
    if (this.ready && document.visibilityState === "visible") {
      let steps = 0;
      while (this.tickAccumulatorMs >= WORLD_TICK_INTERVAL_MS && steps < 3) {
        this.tickAccumulatorMs -= WORLD_TICK_INTERVAL_MS;
        steps += 1;
        const before = performance.now();
        useMarketStore.getState().tickWorld(WORLD_TICK_INTERVAL_MS);
        const cost = performance.now() - before;
        window.dispatchEvent(new CustomEvent("market-world-tick-cost", { detail: cost }));
        this.attribution?.addWorldTick(cost);
      }
      if (this.tickAccumulatorMs > WORLD_TICK_INTERVAL_MS * 3) this.tickAccumulatorMs = 0;
    }
    if (!this.ready) return;
    this.presentAccumulatedDelta += delta;
    if (!this.shouldPresentNow(now)) {
      const workMs = performance.now() - tickStart;
      this.onFrameSample?.(workMs, rawGapMs, this.renderer.info.render.calls, this.renderer.info.render.triangles);
      this.attribution?.endFrame(workMs, rawGapMs);
      return;
    }
    const presentDelta = this.presentAccumulatedDelta;
    this.presentAccumulatedDelta = 0;
    const prevX = this.onInteractiveVerified && !this.interactiveVerified ? this.player.position.x : 0;
    const prevZ = this.onInteractiveVerified && !this.interactiveVerified ? this.player.position.z : 0;
    this.present(presentDelta, now);
    if (this.attribution) this.attribution.mark("render", () => this.renderer.render(this.scene, this.rig.camera));
    else this.renderer.render(this.scene, this.rig.camera);
    if (this.onInteractiveVerified && !this.interactiveVerified) {
      const moved = Math.hypot(this.player.position.x - prevX, this.player.position.z - prevZ) > 0.0005;
      if (moved && this.player.input.magnitude > 0.05) {
        this.interactiveVerified = true;
        this.onInteractiveVerified();
      }
    }
    if (this.debug) this.publishDebug();
    const workMs = performance.now() - tickStart;
    this.onFrameSample?.(workMs, rawGapMs, this.renderer.info.render.calls, this.renderer.info.render.triangles);
    this.attribution?.endFrame(workMs, rawGapMs);
  }

  /** Same idle/motion cadence gate as MarketScene's `CappedFrameScheduler`,
   * reimplemented here because this runtime drives its own manual rAF loop
   * instead of R3F's `advance()`. Desktop (`targetFps: 60`) always returns
   * true — `presentationDivisor` degenerates to 1, so behaviour there is
   * byte-for-byte unchanged. On mobile, presents at `motionFps` (60) while
   * the player or any visible crowd actor is actually moving, and drops to
   * `targetFps` (30) the rest of the time — real accumulated wall-clock delta
   * (`presentAccumulatedDelta`) is handed to the eventual `present()` call so
   * motion covers the true elapsed time instead of looking slowed down. */
  private shouldPresentNow(now: number): boolean {
    if (ablation.forceEveryFramePresent) return true;
    if (!this.renderProfile.mobile || this.renderProfile.targetFps >= 60) return true;
    if (document.visibilityState !== "visible") return false;
    const refreshIntervalMs = this.presentCadence.observe(now);
    if (
      this.presentLastAt > 0 &&
      this.presentLastTickAt === this.presentLastAt &&
      this.presentMotionCadence.observe(now - this.presentLastAt, this.presentLastSlotMs, now, refreshIntervalMs, this.renderProfile.motionFps)
    ) {
      // Motion cadence level changed (stepped down/up) — no diagnostics
      // consumer for `/runtime` today, unlike MarketScene's `announce()`.
    }
    this.presentLastTickAt = now;
    const moving = this.player.input.magnitude > 0.05 || visibleActorMotionActive();
    const divisor = moving
      ? this.presentMotionCadence.divisor(refreshIntervalMs, this.renderProfile.motionFps)
      : presentationDivisor(refreshIntervalMs, this.renderProfile.targetFps);
    this.presentTicksSincePresent += 1;
    if (this.presentTicksSincePresent < divisor) return false;
    this.presentTicksSincePresent = 0;
    this.presentLastAt = now;
    this.presentLastSlotMs = refreshIntervalMs * divisor;
    return true;
  }

  /** Subsystem cost attribution (`FrameAttribution`, `/runtime`'s worldKit
   * path + `?debug=1` only) brackets these same calls in the same order —
   * this file never runs a second, attribution-only code path that could
   * itself drift from real behaviour. A no-op passthrough (`fn()` with no
   * `performance.now()` pair) when attribution isn't constructed. */
  private present(delta: number, now: number) {
    const attribution = this.attribution;
    const mark = attribution ? attribution.mark.bind(attribution) : <T,>(_key: keyof FrameBreakdown, fn: () => T) => fn();
    mark("physics", () => {
      this.player.setDoorProgress(this.storefrontDoor?.progress ?? 0, this.rearFarmDoor?.progress ?? 0);
      this.player.step(delta, now);
      this.player.present(delta);
      this.rig.update(this.player.position.x, this.player.position.z, this.checkoutFocused, delta, delta === 0);
    });
    mark("crowd", () => {
      this.customers.update(this.rig.camera, delta, this.elapsed);
      this.employees.update(this.rig.camera, delta);
    });
    mark("stations", () => {
      this.stations?.update(delta);
      this.furniture?.animate(delta);
      this.purchaseMarkers?.animate(delta);
      if (this.props) this.storefrontDoor?.update(this.props.doorState, this.props.doorProgress, this.props.open, delta);
      this.rearFarmDoor?.update(this.player.position.x / STORE_LAYOUT_SCALE, this.player.position.z / STORE_LAYOUT_SCALE, delta);
      this.transferEffects?.animate(delta, this.player.basketWorld);
      this.signs?.flush(this.renderer);
    });
  }

  resize() {
    const canvas = this.options.canvas;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.rig.resize(width, height);
  }

  private debugBreakdownAt = 0;
  private readonly debugFrustum = new THREE.Frustum();
  private readonly debugMatrix = new THREE.Matrix4();

  /** Draw calls and triangles per layer as three would submit them this frame. */
  private drawBreakdown() {
    this.debugFrustum.setFromProjectionMatrix(this.debugMatrix.multiplyMatrices(this.rig.camera.projectionMatrix, this.rig.camera.matrixWorldInverse));
    const rows: Record<string, { draws: number; triangles: number }> = {};
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      let visibleParent = true; let parent = object.parent; while (parent) { if (!parent.visible) { visibleParent = false; break; } parent = parent.parent; }
      if (!visibleParent) return;
      const instanced = object instanceof THREE.InstancedMesh;
      const count = instanced ? (object as THREE.InstancedMesh).count : 1;
      if (count === 0) return;
      if (object.frustumCulled && !this.debugFrustum.intersectsObject(object)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      const triangles = Math.floor((geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3) * count;
      const draws = Array.isArray(object.material) ? Math.max(1, geometry.groups.length) : 1;
      // Attribute an unnamed leaf mesh (e.g. a bare `makeBox()`/`new
      // THREE.Mesh()` fixture part) to its nearest named ancestor group
      // instead of the generic "mesh" bucket, so the breakdown says which
      // WorldKit fixture actually owns each draw call.
      let ownerName = object.name;
      if (!ownerName) { let owner = object.parent; while (owner && !owner.name) owner = owner.parent; ownerName = owner?.name ?? ""; }
      const key = (ownerName || "mesh").split(":")[0] || "mesh";
      const row = rows[key] ??= { draws: 0, triangles: 0 };
      row.draws += draws; row.triangles += triangles;
    });
    return rows;
  }

  private publishDebug() {
    // TEMP (2026-09-26 GPU causal audit, removed once root-caused): exposes
    // the real renderer so an external profiling harness can hook
    // EXT_disjoint_timer_query_webgl2 around `renderer.render()`.
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown>; __MARKET_PERF_SCENE__?: () => THREE.Scene; __MARKET_QA_RENDERER__?: THREE.WebGLRenderer };
    qaWindow.__MARKET_QA__ ??= {};
    if (performance.now() - this.debugBreakdownAt > 1000) {
      this.debugBreakdownAt = performance.now();
      qaWindow.__MARKET_QA__.drawBreakdown = this.drawBreakdown();
      // `/runtime`'s worldKit path + `?debug=1` only — see `frameAttribution.ts`.
      // Refreshed on the same 1s cadence as `drawBreakdown` (not every frame):
      // the spike buffer changes rarely (only on a real >=20ms frame), so
      // resorting/copying it every frame would be pure waste.
      if (this.attribution) {
        qaWindow.__MARKET_QA__.frameAttributionSpikes = this.attribution.getSpikes();
        qaWindow.__MARKET_QA__.frameAttributionGltfParse = this.attribution.getGltfParseEvents();
        qaWindow.__MARKET_QA__.frameAttributionAsync = this.attribution.getAsyncEvents();
      }
    }
    qaWindow.__MARKET_QA__.player = { x: this.player.position.x, z: this.player.position.z, presentedX: this.player.position.x, presentedZ: this.player.position.z, speed: 0, visible: true };
    qaWindow.__MARKET_QA__.input = this.player.input;
    const hooks = window as typeof window & { __MARKET_SET_PLAYER_INPUT__?: (x: number, y: number) => void };
    if (!hooks.__MARKET_SET_PLAYER_INPUT__) hooks.__MARKET_SET_PLAYER_INPUT__ = (x, y) => inputManager.setKeyboard(x, y);
    qaWindow.__MARKET_QA__.render = { frame: this.renderer.info.render.frame, elapsed: this.elapsed, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
    qaWindow.__MARKET_PERF_SCENE__ = () => this.scene;
    qaWindow.__MARKET_QA_RENDERER__ = this.renderer;
  }

  /** Field telemetry window (same shape the React runtime reports). */
  takePerformanceWindow() {
    return this.performance.take();
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.attribution?.dispose();
    setInPlaceWorldTicks(false);
    // The tick-driver flag itself is owned by `GameShell`'s `useLayoutEffect`
    // (its lifetime matches the route, not this instance's) — nothing to
    // reset here.
    this.player.dispose();
    this.stock?.dispose();
    this.signs?.dispose();
    this.stations?.dispose();
    for (const group of [this.world?.root, this.furniture?.group, this.farm?.group, this.storefrontDoor?.group, this.rearFarmDoor?.group, this.purchaseMarkers?.group, this.registerCashMarkers?.group, this.transferEffects?.group]) {
      group?.traverse((object) => {
        if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.InstancedMesh)) return;
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      });
    }
    for (const registry of [this.customers.props, this.customers.delivered, this.employees.props, this.employees.delivered, this.employees.hats]) {
      for (const instancer of registry.values()) { instancer.detach(); instancer.dispose(); }
      registry.clear();
    }
    for (const registry of [this.customers.bodies, this.employees.bodies]) { for (const body of registry.values()) body.dispose(); registry.clear(); }
    this.renderer.dispose();
  }
}

