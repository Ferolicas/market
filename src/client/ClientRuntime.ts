import * as THREE from "three";
import type { MarketSceneProps } from "@/components/game/MarketScene";
import { interactionZoneConfigs, PLAYER_START, type InteractionId } from "@/components/game/MarketScene";
import { publishLiveActors } from "@/game/render/LiveActors";
import { PartsInstancer } from "@/game/render/CrowdParts";
import { loadCrowdAnimation } from "@/game/render/CrowdSkinning";
import { CrowdCustomersSystem, CrowdEmployeesSystem, CUSTOMER_BODY_KEYS, CUSTOMER_PROP_DEFINITIONS, EMPLOYEE_BODY_KEYS, EMPLOYEE_PROP_DEFINITIONS, HAT_FILES, PROP_CAPACITY, PRODUCT_CAPACITY, createCrowdBody, createPropInstancers, employeeBodyOf, firstSkinnedMesh } from "@/game/render/CrowdSystems";
import { accessoryParts, deliveredProductParts } from "@/components/game/CrowdProps";
import { ensureStoreNavigation } from "@/game/navigation/NavMeshService";
import { setExternalWorldTickDriver, setInPlaceWorldTicks, useMarketStore } from "@/game/store";
import { WORLD_TICK_INTERVAL_MS } from "@/game/core/timing";
import { marketRenderProfileForCapabilities } from "@/game/render/AdaptiveQuality";
import { FieldPerformanceSampler } from "@/game/telemetry/FieldPerformance";
import { WORLD_SCALE } from "@/game/world-scale";
import type { CharacterId, HatId } from "@/game/types";
import { inputManager } from "@/game/input/InputManager";
import { CameraRig } from "./CameraRig";
import { PlayerActor } from "./PlayerActor";
import { RetailStockLayer } from "./RetailStockLayer";
import { SignLayer } from "./SignLayer";
import { StationLayer } from "./StationLayer";
import { budgetPath, loadBakedWorld, loadGltf, type BakedWorld } from "./WorldAssets";

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
  private readonly onReady?: () => void;
  private readonly onFrameSample?: ClientRuntimeOptions["onFrameSample"];
  private readonly debug: boolean;
  private mobile: boolean;

  constructor(private readonly options: ClientRuntimeOptions) {
    const profile = marketRenderProfileForCapabilities({ width: window.innerWidth, coarsePointer: window.matchMedia("(any-pointer: coarse)").matches, devicePixelRatio: window.devicePixelRatio });
    this.mobile = profile.mobile;
    this.renderer = new THREE.WebGLRenderer({ canvas: options.canvas, antialias: !profile.mobile, powerPreference: profile.powerPreference, alpha: false, stencil: false, depth: true });
    this.renderer.setPixelRatio(Math.min(profile.mobile ? 2 : 2, window.devicePixelRatio));
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
    this.onReady = options.onReady;
    this.onFrameSample = options.onFrameSample;
    this.player = new PlayerActor({
      onInteract: (id) => this.props?.onInteract(id as InteractionId),
      onDistance: (meters) => this.props?.onDistance(meters),
      onDoorPresence: (active) => this.props?.onDoorPresence(active),
      onCheckoutFocus: (focused) => { this.checkoutFocused = focused; },
    });
    this.layoutRoot.add(this.player.group);
    this.customers.attachTo(this.layoutRoot);
    this.employees.attachTo(this.layoutRoot);
    this.customers.setModelTier(profile.mobile ? 2 : 1);
    this.setupLights();
    this.resize();
  }

  private checkoutFocused = false;

  private setupLights() {
    // One key light, no shadow map, hemisphere fill: occlusion is baked.
    const key = new THREE.DirectionalLight("#fff2dc", 2.1);
    key.position.set(8 * WORLD_SCALE, 13 * WORLD_SCALE, 7 * WORLD_SCALE);
    key.castShadow = false;
    const hemisphere = new THREE.HemisphereLight("#dfeaf2", "#7d6f5c", 1.15);
    const ambient = new THREE.AmbientLight("#ffffff", 0.35);
    this.scene.add(key, hemisphere, ambient);
  }

  /** Loads the level: baked store, owner, crowd bodies, props, signs. */
  async load(initial: MarketSceneProps) {
    this.props = initial;
    // `?inplace=0` keeps the cloning tick for A/B checks of the in-place path.
    setInPlaceWorldTicks(!new URLSearchParams(window.location.search).has("inplace") || new URLSearchParams(window.location.search).get("inplace") !== "0");
    setExternalWorldTickDriver(true);
    const world = await loadBakedWorld(this.options.levelName);
    this.world = world;
    this.scene.add(world.root);
    this.signs = new SignLayer();
    this.scene.add(this.signs.mesh);
    this.stock = new RetailStockLayer(world.anchors);
    this.stations = new StationLayer(world.anchors, this.signs);
    await Promise.all([
      this.stock.load(),
      this.stations.load(),
      this.player.load(initial.avatar, PLAYER_START[0], PLAYER_START[2]),
      this.loadCrowdBodies(),
    ]);
    // Baked anchors are world-space matrices: stock and machines hang from
    // the scene; crops use layout positions and hang from the scaled root.
    this.scene.add(this.stock.group, this.stations.worldGroup);
    this.layoutRoot.add(this.stations.group);
    createPropInstancers(this.layoutRoot, CUSTOMER_PROP_DEFINITIONS(), this.customers.props);
    createPropInstancers(this.layoutRoot, EMPLOYEE_PROP_DEFINITIONS(), this.employees.props);
    await this.loadDeliveredProducts();
    await this.loadEmployeeHats(initial);
    for (const anchor of world.anchors) {
      if (anchor.kind !== "text" || !anchor.text) continue;
      // Live counters are drawn by the station layer; skip their baked copies.
      if (anchor.within && /^(retail-stock-screen|dynamic:(stock-screen|machine-status|machine-output))/.test(anchor.within)) continue;
      const matrix = new THREE.Matrix4().fromArray(anchor.matrix);
      const color = typeof anchor.color === "number" ? `#${anchor.color.toString(16).padStart(6, "0")}` : anchor.color ?? "#ffffff";
      this.signs.add(anchor.text, { fontSize: anchor.fontSize ?? 0.12, color, weight: 800 }, matrix);
    }
    await ensureStoreNavigation(initial.unlockedAreas);
    this.player.snapToNavmesh();
    this.syncStatic(initial);
    // First frame with everything compiled before the cover lifts.
    this.renderer.compile(this.scene, this.rig.camera);
    this.present(0, performance.now());
    this.renderer.render(this.scene, this.rig.camera);
    this.ready = true;
    this.onReady?.();
  }

  private async loadCrowdBodies() {
    await Promise.all([
      ...Object.entries(CUSTOMER_BODY_KEYS).map(async ([, key]) => {
        const [gltf, animation] = await Promise.all([loadGltf(budgetPath("customers", key)), loadCrowdAnimation(key)]);
        const skinned = firstSkinnedMesh(gltf.scene);
        if (!skinned) return;
        const body = createCrowdBody(skinned, animation, key);
        this.layoutRoot.add(body.mesh);
        this.customers.bodies.set(key, body);
      }),
      ...Object.values(EMPLOYEE_BODY_KEYS).map(async (key) => {
        if (!key) return;
        const [gltf, animation] = await Promise.all([loadGltf(budgetPath("characters", key)), loadCrowdAnimation(key)]);
        const skinned = firstSkinnedMesh(gltf.scene);
        if (!skinned) return;
        const body = createCrowdBody(skinned, animation, key);
        this.layoutRoot.add(body.mesh);
        this.employees.bodies.set(key, body);
      }),
    ]);
  }

  private async loadDeliveredProducts() {
    for (const id of ["milk", "cheese", "egg"] as const) {
      const gltf = await loadGltf(budgetPath("delivered", id));
      const productId = id === "egg" ? "eggs" : id;
      for (const registry of [this.customers.delivered, this.employees.delivered]) {
        const instancer = new PartsInstancer(deliveredProductParts(gltf.scene), PRODUCT_CAPACITY, `client-delivered:${productId}`);
        instancer.attach(this.layoutRoot);
        registry.set(productId, instancer);
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
      const gltf = await loadGltf(budgetPath("hats", file, body)).catch(() => null);
      if (!gltf) continue;
      const instancer = new PartsInstancer(accessoryParts(gltf.scene), PROP_CAPACITY, `client-hat:${key}`);
      instancer.attach(this.layoutRoot);
      this.employees.hats.set(key, instancer);
      this.hatKinds.add(key);
    }
  }

  /** New state slices from the shell (every world tick and HUD change). */
  setProps(props: MarketSceneProps) {
    const previous = this.props;
    this.props = props;
    if (!this.ready) return;
    if (props.employees !== previous?.employees) void this.loadEmployeeHats(props);
    this.syncStatic(props);
  }

  private syncStatic(props: MarketSceneProps) {
    publishLiveActors(props.customers, props.checkoutTransactions, props.employees, props.simulationTimeMs);
    this.employees.setEmployees(props.employees);
    this.player.carry = props.carry;
    this.player.setSpeedTier(props.playerSpeedTier, props.unlockedAreas.includes("purchase-campaign"));
    const zoneSignature = `${props.checkoutLevel}|${props.unlockedAreas.join(",")}|${props.crops.filter((crop) => crop.status !== "LOCKED").map((crop) => crop.id).join(",")}|${props.purchaseMarkers.map((marker) => marker.id).join(",")}`;
    if (zoneSignature !== this.zoneSignature) {
      this.zoneSignature = zoneSignature;
      this.player.setZones(interactionZoneConfigs(props.checkoutLevel, props.unlockedAreas, props.crops.filter((crop) => crop.status !== "LOCKED").map((crop) => crop.id), props.purchaseMarkers.map((marker) => marker.id)));
    }
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
    const tickStart = this.onFrameSample ? performance.now() : 0;
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
        window.dispatchEvent(new CustomEvent("market-world-tick-cost", { detail: performance.now() - before }));
      }
      if (this.tickAccumulatorMs > WORLD_TICK_INTERVAL_MS * 3) this.tickAccumulatorMs = 0;
    }
    if (!this.ready) return;
    this.present(delta, now);
    this.renderer.render(this.scene, this.rig.camera);
    if (this.debug) this.publishDebug();
    this.onFrameSample?.(performance.now() - tickStart, rawGapMs, this.renderer.info.render.calls, this.renderer.info.render.triangles);
  }

  private present(delta: number, now: number) {
    this.player.step(delta, now);
    this.player.present(delta);
    this.rig.update(this.player.position.x, this.player.position.z, this.checkoutFocused, delta, delta === 0);
    this.customers.update(this.rig.camera, delta, this.elapsed);
    this.employees.update(this.rig.camera, delta);
    this.stations?.update(delta);
    this.signs?.flush(this.renderer);
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
      const key = (object.name || "mesh").split(":")[0] || "mesh";
      const row = rows[key] ??= { draws: 0, triangles: 0 };
      row.draws += draws; row.triangles += triangles;
    });
    return rows;
  }

  private publishDebug() {
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown>; __MARKET_PERF_SCENE__?: () => THREE.Scene };
    qaWindow.__MARKET_QA__ ??= {};
    if (performance.now() - this.debugBreakdownAt > 1000) { this.debugBreakdownAt = performance.now(); qaWindow.__MARKET_QA__.drawBreakdown = this.drawBreakdown(); }
    qaWindow.__MARKET_QA__.player = { x: this.player.position.x, z: this.player.position.z, presentedX: this.player.position.x, presentedZ: this.player.position.z, speed: 0, visible: true };
    qaWindow.__MARKET_QA__.input = this.player.input;
    const hooks = window as typeof window & { __MARKET_SET_PLAYER_INPUT__?: (x: number, y: number) => void };
    if (!hooks.__MARKET_SET_PLAYER_INPUT__) hooks.__MARKET_SET_PLAYER_INPUT__ = (x, y) => inputManager.setKeyboard(x, y);
    qaWindow.__MARKET_QA__.render = { frame: this.renderer.info.render.frame, elapsed: this.elapsed, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
    qaWindow.__MARKET_PERF_SCENE__ = () => this.scene;
  }

  /** Field telemetry window (same shape the React runtime reports). */
  takePerformanceWindow() {
    return this.performance.take();
  }

  dispose() {
    this.stop();
    setInPlaceWorldTicks(false);
    setExternalWorldTickDriver(false);
    this.player.dispose();
    this.stock?.dispose();
    this.signs?.dispose();
    this.stations?.dispose();
    for (const registry of [this.customers.props, this.customers.delivered, this.employees.props, this.employees.delivered, this.employees.hats]) {
      for (const instancer of registry.values()) { instancer.detach(); instancer.dispose(); }
      registry.clear();
    }
    for (const registry of [this.customers.bodies, this.employees.bodies]) { for (const body of registry.values()) body.dispose(); registry.clear(); }
    this.renderer.dispose();
  }
}

