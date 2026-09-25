import * as THREE from "three";
import { budgetPath, loadGltf } from "@/client/WorldAssets";
import { loadCrowdAnimation } from "@/game/render/CrowdSkinning";
import {
  CrowdCustomersSystem,
  CrowdEmployeesSystem,
  CUSTOMER_BODY_KEYS,
  CUSTOMER_PROP_DEFINITIONS,
  EMPLOYEE_BODY_KEYS,
  EMPLOYEE_PROP_DEFINITIONS,
  createCrowdBody,
  createPropInstancers,
  firstSkinnedMesh,
} from "@/game/render/CrowdSystems";
import { createSyntheticEmployeeRoster } from "./crowdFeed";

export interface SceneStats {
  drawCalls: number;
  triangles: number;
}

const STORE_URL = "/models/market/budget/world/level30.glb";

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
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  private readonly lookAt = new THREE.Vector3();
  private readonly crowdRoot = new THREE.Group();
  private readonly customers = new CrowdCustomersSystem();
  private readonly employees = new CrowdEmployeesSystem();
  private crowdBodiesReady = false;
  private elapsedSeconds = 0;
  private disposeCrowdProps: (() => void) | null = null;
  private disposed = false;

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
    this.resize();
    this.ready = this.loadStore();
    this.crowdReady = this.loadCrowd();
  }

  /**
   * Phase 4: 8 body variants (6 customer identities + owner_man/owner_woman,
   * the only two the crowd system animates), each an InstancedMesh skinned
   * from a baked bone texture. Phase 5 adds exactly the rigid transported
   * props (customer cart, employee basket) filtered out of
   * `CUSTOMER_PROP_DEFINITIONS`/`EMPLOYEE_PROP_DEFINITIONS` — no shadow, bags,
   * hats or product instancers, so this measures the rigid-prop system alone
   * on top of the phase 4 crowd.
   */
  private async loadCrowd() {
    const loaded = await Promise.all([
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
    this.employees.setEmployees(createSyntheticEmployeeRoster());
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
    if (this.crowdBodiesReady) {
      const deltaSeconds = Math.max(0, deltaMs) / 1_000;
      this.elapsedSeconds += deltaSeconds;
      this.customers.update(this.camera, deltaSeconds, this.elapsedSeconds);
      this.employees.update(this.camera, deltaSeconds);
    }
    this.renderer.render(this.scene, this.camera);
    const stats = {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
    this.renderer.info.reset();
    return stats;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Body geometry/material are exclusive to `createCrowdBody` (cloned from
    // the shared GLB cache), unlike the baked store: these must be freed.
    for (const registry of [this.customers.bodies, this.employees.bodies]) {
      for (const body of registry.values()) body.dispose();
      registry.clear();
    }
    this.disposeCrowdProps?.();
    this.disposeCrowdProps = null;
    this.renderer.dispose();
  }
}
