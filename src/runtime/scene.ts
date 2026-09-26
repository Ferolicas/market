import * as THREE from "three";
import { budgetPath, loadGltf } from "@/client/WorldAssets";
import { accessoryParts } from "@/components/game/CrowdProps";
import type { CharacterId, Employee, HatId } from "@/game/types";
import { PartsInstancer } from "@/game/render/CrowdParts";
import { loadCrowdAnimation } from "@/game/render/CrowdSkinning";
import {
  CrowdCustomersSystem,
  CrowdEmployeesSystem,
  CUSTOMER_BODY_KEYS,
  CUSTOMER_PROP_DEFINITIONS,
  EMPLOYEE_BODY_KEYS,
  EMPLOYEE_PROP_DEFINITIONS,
  HAT_FILES,
  PROP_CAPACITY,
  createCrowdBody,
  createPropInstancers,
  employeeBodyOf,
  firstSkinnedMesh,
} from "@/game/render/CrowdSystems";
import { ensureStoreNavigation, storeMoveAlongSurface } from "@/game/navigation/NavMeshService";
import { STORE_LAYOUT_SCALE } from "@/game/world-scale";
import { InputManager } from "@/game/input/InputManager";
import { DEFAULT_PLAYER_MOTION } from "@/game/player/PlayerController";
import { createSyntheticEmployeeRoster } from "./crowdFeed";

export interface SceneStats {
  drawCalls: number;
  triangles: number;
  /** Phase 10: time spent in this frame's `storeMoveAlongSurface` call, 0 before the navmesh is ready. */
  playerMoveMs: number;
  /** Phase 11A: exclusive cost of `navigator.getGamepads()` — polled every frame regardless of a gamepad being connected, matching `PlayerActor.step()`'s real production behaviour. */
  gamepadPollMs: number;
  /** Phase 11A: exclusive cost of `InputManager.sample()` — normalizing/unifying keyboard+gamepad+pointer state into one axis. */
  inputSampleMs: number;
  /** Phase 11A: one continuous timer spanning poll → normalize → `sample()` — the real per-frame input pipeline cost, not just the sum of the two above (it also covers `setGamepad()`'s own glue cost in between). */
  inputTotalMs: number;
}

/**
 * Phase 11A: keyboard (WASD/arrows) and gamepad only — the same key set
 * `GameInputSurface.tsx` listens for, duplicated here (not imported) since
 * that file is a React component with its own pointer/joystick concerns this
 * phase deliberately excludes. No DOM touch surface yet (phase 11B).
 */
const MOVEMENT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);
/** Same calibrated base walking speed the real player uses (`DEFAULT_PLAYER_MOTION.walkSpeed`) — no acceleration/braking curve, that is gameplay feel, out of scope for isolating `InputManager.sample()`'s own cost. */
const PLAYER_SPEED = DEFAULT_PLAYER_MOTION.walkSpeed;

const STORE_URL = "/models/market/budget/world/level30.glb";

/** The real unlocked-zone list of the level-30 seed already used to bake
 * `level30.glb` (`franchise.unlockedAreas`, read from the seed state used for
 * `scripts/export-static-world.mjs`) — the full store, not a cut-down one. */
const LEVEL30_UNLOCKED_AREAS = [
  "store-floor", "farm-tomato", "checkout-1", "purchase-campaign", "egg-display", "chicken-coop",
  "farm-tomato-2", "expansion-side", "farm-tomato-3", "checkout-2", "farm-wheat", "chicken-coop-2",
  "flour-mill", "bread-oven", "dairy-display", "cow-station", "checkout-3", "cheese-maker",
  "farm-apple", "farm-corn", "coffee-supply", "farm-coffee", "farm-orange", "juice-machine",
  "preserves-supply", "corn-canner",
];

/** Every network fetch under `/models/market/` that isn't the store itself is
 * a crowd asset (body GLB or baked animation texture) — phase 4 loads nothing
 * else. Read once the crowd finishes loading, not per frame. */
function measureCrowdBytes(): number {
  if (typeof performance === "undefined" || !performance.getEntriesByType) return 0;
  let total = 0;
  for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (!entry.name.includes("/models/market/") || entry.name.includes("/models/market/budget/world/")) continue;
    total += entry.transferSize || entry.encodedBodySize || 0;
  }
  return total;
}

/**
 * Recast ships no separate `.wasm` file to this build: webpack's
 * "wasm-compat" path embeds the binary as base64 inside a lazily-imported JS
 * chunk (`import('@recast-navigation/wasm')` inside `init()`), so filtering
 * by `.wasm` extension silently finds nothing. Instead, diff the resource
 * list before/after the navmesh promise: any `_next/static/chunks/*` entry
 * that appears during that window is a chunk `ensureStoreNavigation()`
 * pulled in, whatever its hashed name is — nothing else in this runtime
 * lazily imports JS at runtime.
 */
function measureNavBytes(beforeNames: ReadonlySet<string>): number {
  if (typeof performance === "undefined" || !performance.getEntriesByType) return 0;
  let total = 0;
  for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (beforeNames.has(entry.name) || !entry.name.includes("/_next/static/chunks/")) continue;
    total += entry.transferSize || entry.encodedBodySize || 0;
  }
  return total;
}

/**
 * Phase 8: detects main-thread stalls from the outside, without touching
 * `src/game/navigation/`. `ensureStoreNavigation()`'s actual Recast build is
 * synchronous WASM with no worker, so it blocks whatever `setTimeout(0)` is
 * already queued; the gap between two heartbeat callbacks is (at least) as
 * long as any stall that occurred between them. `onStall` is called with
 * every gap, including normal ones — the caller keeps the max.
 */
function startStallHeartbeat(onStall: (stallMs: number) => void): () => void {
  let stopped = false;
  let last = performance.now();
  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    onStall(now - last);
    last = now;
    setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  return () => { stopped = true; };
}

/**
 * The measured runtime scene. Renderer settings match the empty baseline.
 * The only added content is the baked static store. Markers, characters,
 * stock and physics stay out.
 */
export class PlaceholderScene {
  readonly renderer: THREE.WebGLRenderer;
  /** Resolves once the baked store is in the scene. The crowd loads on its own timeline (`crowdReady`) and never blocks this. */
  readonly ready: Promise<void>;
  /** Phase 4: resolves once the crowd's bodies/animations are loaded, independently of `ready`. */
  readonly crowdReady: Promise<void>;
  crowdReadyAtMs = 0;
  crowdBytes = 0;
  /** Phase 8: resolves once `ensureStoreNavigation()` resolves. Phase 10 adds the first real query against it. */
  readonly navReady: Promise<void>;
  navReadyAtMs = 0;
  navBytes = 0;
  navMaxStallMs = 0;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  private readonly lookAt = new THREE.Vector3();
  private readonly crowdRoot = new THREE.Group();
  private readonly customers = new CrowdCustomersSystem();
  private readonly employees = new CrowdEmployeesSystem();
  private crowdBodiesReady = false;
  private elapsedSeconds = 0;
  private disposeCrowdProps: (() => void) | null = null;
  private readonly hatInstancers: PartsInstancer[] = [];
  private disposed = false;
  /**
   * Phase 10: a kinematic capsule with no rig, no animation — the minimal
   * visual proxy needed to drive `storeMoveAlongSurface()` every frame and
   * measure exactly what that call costs in isolation. Position is design
   * units (same convention `PlayerActor.ts` uses): divide by
   * `STORE_LAYOUT_SCALE` before calling into navigation, multiply back when
   * placing the mesh. Phase 11A replaces the synthetic sine-wave target with
   * a real `InputManager` instance (keyboard + gamepad only, no DOM touch
   * surface yet) — a separate instance from the game's shared
   * `inputManager` singleton, so this isolated harness never shares state
   * with a real gameplay session running elsewhere.
   */
  private readonly playerMesh: THREE.Mesh;
  private playerPos: [number, number] = [0, 0];
  private readonly playerInput = new InputManager();
  private readonly heldKeys = new Set<string>();
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!MOVEMENT_KEYS.has(event.code)) return;
    this.heldKeys.add(event.code);
    this.publishKeyboardInput();
  };
  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (!MOVEMENT_KEYS.has(event.code)) return;
    this.heldKeys.delete(event.code);
    this.publishKeyboardInput();
  };
  private readonly onWindowBlur = () => {
    this.heldKeys.clear();
    this.playerInput.clearAll();
  };

  private publishKeyboardInput() {
    const x = Number(this.heldKeys.has("KeyD") || this.heldKeys.has("ArrowRight")) - Number(this.heldKeys.has("KeyA") || this.heldKeys.has("ArrowLeft"));
    const y = Number(this.heldKeys.has("KeyS") || this.heldKeys.has("ArrowDown")) - Number(this.heldKeys.has("KeyW") || this.heldKeys.has("ArrowUp"));
    this.playerInput.setKeyboard(x, y);
  }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor("#d7ebe3", 1);
    this.renderer.shadowMap.enabled = false;

    this.scene.add(new THREE.HemisphereLight("#f4f7fb", "#8a7d6a", 1.15));
    const key = new THREE.DirectionalLight("#fff4e2", 1.8);
    key.position.set(6, 10, 4);
    this.scene.add(key);
    this.scene.add(this.crowdRoot);
    this.playerMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
      new THREE.MeshStandardMaterial({ color: "#ff3366" }),
    );
    this.playerMesh.position.set(0, 0.9, 0);
    this.scene.add(this.playerMesh);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onWindowBlur);
    this.resize();
    this.ready = this.loadStore();
    this.crowdReady = this.loadCrowd();
    this.navReady = this.loadNavigation();
  }

  /**
   * Phase 11A: real keyboard/gamepad input drives the capsule via the same
   * `storeMoveAlongSurface()` call phase 10 isolated — no camera-relative
   * transform, no acceleration/braking curve, that is gameplay feel and out
   * of scope here.
   *
   * Three separate timings for the input pipeline (poll device → normalize →
   * final axis), corrected on 26-09-2026 after the first cut left the
   * gamepad poll outside `inputSampleMs`, understating the real per-frame
   * input cost:
   * - `gamepadPollMs`: exclusively `navigator.getGamepads()`. Polled every
   *   frame regardless of whether a gamepad is connected — this mirrors
   *   `PlayerActor.step()`'s real production behaviour exactly (it also
   *   calls `navigator.getGamepads?.()[0]` unconditionally on every step,
   *   only feeding it into `InputManager` when one exists); the harness does
   *   not invent a different polling policy.
   * - `inputSampleMs`: exclusively `InputManager.sample()`.
   * - `inputTotalMs`: one continuous timer from just before the poll to just
   *   after `sample()` returns — the real total, not just the sum of the two
   *   above, since it also covers `setGamepad()`'s own glue cost in between.
   */
  private updatePlayer(deltaSeconds: number): { playerMoveMs: number; gamepadPollMs: number; inputSampleMs: number; inputTotalMs: number } {
    const inputStart = performance.now();
    const gamepad = typeof navigator !== "undefined" ? navigator.getGamepads?.()[0] : null;
    const gamepadPollMs = performance.now() - inputStart;
    if (gamepad) this.playerInput.setGamepad(gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0);
    const sampleStart = performance.now();
    const input = this.playerInput.sample();
    const sampleEnd = performance.now();
    const inputSampleMs = sampleEnd - sampleStart;
    const inputTotalMs = sampleEnd - inputStart;

    const targetX = this.playerPos[0] + input.x * PLAYER_SPEED * deltaSeconds;
    const targetZ = this.playerPos[1] + input.y * PLAYER_SPEED * deltaSeconds;
    const moveStart = performance.now();
    const moved = storeMoveAlongSurface(this.playerPos, [targetX, targetZ]);
    const playerMoveMs = performance.now() - moveStart;
    if (moved) this.playerPos = moved;
    this.playerMesh.position.set(this.playerPos[0] * STORE_LAYOUT_SCALE, 0.9, this.playerPos[1] * STORE_LAYOUT_SCALE);
    return { playerMoveMs, gamepadPollMs, inputSampleMs, inputTotalMs };
  }

  /**
   * Phase 8: builds the real level-30 navmesh (26 unlocked zones) in
   * parallel with the store and the crowd — the same parallel-promise
   * pattern this runtime has used since phase 4, kept as-is for this
   * measurement. Nothing ever queries it (no player, no pathfinding).
   * Phase 9 moved the actual Recast build off-thread (`NavMeshService.ts`'s
   * own persistent worker); what happens here on the main thread is now just
   * the one-time WASM compile plus `importNavMesh`/`NavMeshQuery` setup for
   * the *first* navmesh. The `setTimeout(0)` heartbeat still runs for as long
   * as this is pending, so any main-thread stall during that first-boot setup
   * is still caught even though it happens outside `render()` — later
   * rebuilds no longer produce one at all (see `navBuildTelemetry` in
   * `NavMeshService.ts`). Confirmed on 26-09-2026 with an external
   * `PerformanceObserver("longtask")` probe: this first-boot WASM compile can
   * produce a genuine, sustained main-thread long task, not just a scheduling
   * delay. It never shows up in the panel's `gapMaxMs`/`gapsOver25Ms` — those
   * only start sampling after `RUNTIME_CONTRACT.warmupFrames`, and this stall
   * falls inside that deliberately-excluded startup window, same as GPU/JIT
   * warmup would.
   */
  private async loadNavigation() {
    const beforeNames = typeof performance !== "undefined" && performance.getEntriesByType
      ? new Set(performance.getEntriesByType("resource").map((entry) => entry.name))
      : new Set<string>();
    let maxStall = 0;
    const stopHeartbeat = startStallHeartbeat((stall) => { if (stall > maxStall) maxStall = stall; });
    try {
      await ensureStoreNavigation(LEVEL30_UNLOCKED_AREAS);
    } finally {
      stopHeartbeat();
    }
    if (this.disposed) return;
    this.navMaxStallMs = maxStall;
    this.navReadyAtMs = performance.now();
    this.navBytes = measureNavBytes(beforeNames);
  }

  /**
   * Phase 4: 8 body variants (6 customer identities + owner_man/owner_woman,
   * the only two the crowd system animates), each an InstancedMesh skinned
   * from a baked bone texture. Phase 5 adds exactly the rigid transported
   * props (customer cart, employee basket) filtered out of
   * `CUSTOMER_PROP_DEFINITIONS`/`EMPLOYEE_PROP_DEFINITIONS` — no shadow, bags,
   * hats or product instancers. Phase 6 added one hat kind for every employee;
   * phase 7 makes the roster's own `hat` field diverse (12 kinds,
   * round-robin, from `crowdFeed.ts`) and loads exactly the body:hat
   * combinations that actually occur — same `loadEmployeeHats` pattern as
   * `/play2`'s `ClientRuntime`, generic this time instead of one fixed kind.
   */
  private async loadCrowd() {
    const roster = createSyntheticEmployeeRoster();
    const [loaded] = await Promise.all([
      Promise.all([
        ...Object.values(CUSTOMER_BODY_KEYS).map(async (key) => {
          const [gltf, animation] = await Promise.all([loadGltf(budgetPath("customers", key)), loadCrowdAnimation(key)]);
          const skinned = firstSkinnedMesh(gltf.scene);
          return skinned ? { key, target: "customer" as const, body: createCrowdBody(skinned, animation, key) } : null;
        }),
        ...Object.values(EMPLOYEE_BODY_KEYS).filter((key): key is string => Boolean(key)).map(async (key) => {
          const [gltf, animation] = await Promise.all([loadGltf(budgetPath("characters", key)), loadCrowdAnimation(key)]);
          const skinned = firstSkinnedMesh(gltf.scene);
          return skinned ? { key, target: "employee" as const, body: createCrowdBody(skinned, animation, key) } : null;
        }),
      ]),
      this.loadEmployeeHats(roster),
    ]);
    if (this.disposed) return;
    for (const entry of loaded) {
      if (!entry) continue;
      this.crowdRoot.add(entry.body.mesh);
      if (entry.target === "customer") this.customers.bodies.set(entry.key, entry.body);
      else this.employees.bodies.set(entry.key, entry.body);
    }
    this.customers.attachTo(this.crowdRoot);
    this.employees.attachTo(this.crowdRoot);
    this.employees.setEmployees(roster);
    const { cart, caster, wheel } = CUSTOMER_PROP_DEFINITIONS();
    const { basket } = EMPLOYEE_PROP_DEFINITIONS();
    const disposeCustomerProps = createPropInstancers(this.crowdRoot, { cart, caster, wheel }, this.customers.props);
    const disposeEmployeeProps = createPropInstancers(this.crowdRoot, { basket }, this.employees.props);
    this.disposeCrowdProps = () => {
      disposeCustomerProps();
      disposeEmployeeProps();
    };
    this.crowdBodiesReady = true;
    this.crowdReadyAtMs = performance.now();
    this.crowdBytes = measureCrowdBytes();
  }

  /**
   * Exactly `ClientRuntime.loadEmployeeHats`'s pattern: one GLB per body:hat
   * combination that actually appears in the roster, no more — with 19
   * employees round-robin over 12 kinds and 2 body variants, that is at most
   * min(19, 12*2) combinations, not a forced 12*2=24.
   */
  private async loadEmployeeHats(roster: readonly Employee[]) {
    const wanted = new Set(roster.map((employee, index) => `${employeeBodyOf(index)}:${employee.hat}`));
    await Promise.all([...wanted].map(async (key) => {
      const [body, hat] = key.split(":") as [CharacterId, HatId];
      const file = HAT_FILES[hat];
      const gltf = await loadGltf(budgetPath("hats", file, body)).catch(() => null);
      if (!gltf || this.disposed) return;
      const instancer = new PartsInstancer(accessoryParts(gltf.scene), PROP_CAPACITY, `runtime-hat:${key}`);
      instancer.attach(this.crowdRoot);
      this.employees.hats.set(key, instancer);
      this.hatInstancers.push(instancer);
    }));
  }

  private async loadStore() {
    const gltf = await loadGltf(STORE_URL);
    if (this.disposed) return;
    const root = gltf.scene;
    root.matrixAutoUpdate = false;
    root.updateMatrix();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.matrixAutoUpdate = false;
      object.updateMatrix();
      object.frustumCulled = true;
      object.castShadow = false;
      object.receiveShadow = false;
      object.geometry.computeBoundingSphere();
    });
    this.scene.add(root);
    this.frameStore(root);
  }

  /** One fixed view of the whole bake. The camera does not move per frame. */
  private frameStore(root: THREE.Object3D) {
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(this.lookAt);
    const radius = Math.max(1, bounds.getSize(new THREE.Vector3()).length() * 0.5);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const direction = new THREE.Vector3(16, 23, 25.75).normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.1, distance - radius * 2);
    this.camera.far = distance + radius * 4;
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Draws the bake. The pose buffer stays in the loop so that path is
   * unchanged; the crowd reads its own positions from `liveActors`, published
   * once per 5 Hz tick by `crowdFeed.ts` — not from this buffer.
   */
  render(pose: Float32Array, deltaMs = 0) {
    void pose;
    const deltaSeconds = Math.max(0, deltaMs) / 1_000;
    if (this.crowdBodiesReady) {
      this.elapsedSeconds += deltaSeconds;
      this.customers.update(this.camera, deltaSeconds, this.elapsedSeconds);
      this.employees.update(this.camera, deltaSeconds);
    }
    const { playerMoveMs, gamepadPollMs, inputSampleMs, inputTotalMs } = this.updatePlayer(deltaSeconds);
    this.renderer.render(this.scene, this.camera);
    const stats = {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      playerMoveMs,
      gamepadPollMs,
      inputSampleMs,
      inputTotalMs,
    };
    this.renderer.info.reset();
    return stats;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onWindowBlur);
    this.playerInput.clearAll();
    // Body geometry/material are exclusive to `createCrowdBody` (cloned from
    // the shared GLB cache), unlike the baked store: these must be freed.
    for (const registry of [this.customers.bodies, this.employees.bodies]) {
      for (const body of registry.values()) body.dispose();
      registry.clear();
    }
    this.disposeCrowdProps?.();
    this.disposeCrowdProps = null;
    for (const instancer of this.hatInstancers) { instancer.detach(); instancer.dispose(); }
    this.hatInstancers.length = 0;
    this.employees.hats.clear();
    this.renderer.dispose();
  }
}
