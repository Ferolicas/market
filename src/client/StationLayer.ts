import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MarketSceneProps } from "@/components/game/MarketScene";
import { PRODUCTS_LABELS } from "@/components/game/MarketKit";
import type { CropState, Inventory, ProductId } from "@/game/types";
import { PRODUCT_IDS } from "@/game/economy/ProductRegistry";
import { shelfCapacityForTier } from "@/game/engine";
import { distributedFixtureQuantity, PRODUCT_RETAIL_DEPARTMENT, RETAIL_DEPARTMENTS, retailFixtureDisplayPositions } from "@/game/stations/retail-layout";
import { FARM_PLOTS } from "@/game/stations/farm-layout";
import { scaleStorePosition } from "@/game/world-scale";
import { SignLayer, type SignHandle } from "./SignLayer";
import { budgetPath, loadGltf, type WorldAnchor } from "./WorldAssets";

/**
 * Everything on the floor that is neither baked nor a character: the
 * production machines (budget GLBs at their baked anchors), the live stock
 * screens over each fixture (labels in the sign atlas), the crop beds
 * (one instanced model per crop stage) and the two farm animals.
 */
const MACHINE_FILES: Record<string, string> = { HORNO: "oven", EXPRIMIDORA: "juicer", MOLINO: "mill", ESTANTE_HUEVOS: "egg-display" };
const CROP_STAGES = ["sprout", "small", "growing", "ripe"] as const;
const CROP_MODEL_PREFIX: Partial<Record<CropState["productId"], string>> = { tomatoes: "tomato", wheat: "wheat", corn: "corn" };
const SCREEN_TITLE = new THREE.Matrix4().makeTranslation(0, 0.34, 0.01);
const SCREEN_COUNT = new THREE.Matrix4().makeTranslation(0, -0.16, 0.01);
const SCREEN_STATUS = new THREE.Matrix4().makeTranslation(0, -0.325, 0.01);
const SCREEN_PANEL = new THREE.Matrix4().makeTranslation(0, 0, -0.01);

interface Screen {
  productId: ProductId;
  fixtureIndex: number;
  count: SignHandle;
  status: SignHandle;
}

interface CropBed {
  id: string;
  productId: CropState["productId"];
  matrix: THREE.Matrix4;
}

/** Merged, instanced copy of one budget model (all primitives, multi-material). */
class ModelInstances {
  readonly mesh: THREE.InstancedMesh;
  count = 0;
  constructor(root: THREE.Object3D, capacity: number, name: string) {
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = (object.geometry as THREE.BufferGeometry).clone().applyMatrix4(object.matrixWorld);
      for (const key of Object.keys(geometry.attributes)) if (!["position", "normal", "uv", "color"].includes(key)) geometry.deleteAttribute(key);
      if (!geometry.attributes.uv) geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      geometries.push(geometry);
      materials.push(Array.isArray(object.material) ? object.material[0] : object.material);
    });
    const merged = mergeGeometries(geometries, true) ?? new THREE.BufferGeometry();
    for (const geometry of geometries) geometry.dispose();
    // One draw per distinct material, not per source primitive.
    const unique: THREE.Material[] = [];
    for (const group of merged.groups) {
      const material = materials[group.materialIndex ?? 0];
      let index = unique.indexOf(material);
      if (index < 0) { index = unique.length; unique.push(material); }
      group.materialIndex = index;
    }
    merged.computeBoundingSphere();
    this.mesh = new THREE.InstancedMesh(merged, unique.length === 1 ? unique[0] : unique, capacity);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.frustumCulled = true;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }
  begin() { this.count = 0; }
  push(matrix: THREE.Matrix4) { if (this.count < this.mesh.instanceMatrix.count) { this.mesh.setMatrixAt(this.count, matrix); this.count += 1; } }
  end() {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    // Frustum culling of an InstancedMesh uses its own sphere over the instances.
    if (this.count > 0) this.mesh.computeBoundingSphere();
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.dispose(); }
}

const scratch = { matrix: new THREE.Matrix4(), scale: new THREE.Matrix4(), position: new THREE.Vector3() };

export class StationLayer {
  /** Layout-unit space children (crops, animals). */
  readonly group = new THREE.Group();
  /** World-space children (machines from world-space anchors). */
  readonly worldGroup = new THREE.Group();
  private readonly screens: Screen[] = [];
  private readonly crops = new Map<string, ModelInstances>();
  private readonly beds: CropBed[] = [];
  private readonly animals: { mixer: THREE.AnimationMixer; root: THREE.Object3D }[] = [];
  private lastCrops = "";

  constructor(private readonly anchors: readonly WorldAnchor[], private readonly signs: SignLayer) {
    this.group.name = "client:stations";
    this.worldGroup.name = "client:machines";
  }

  async load() {
    // Machines: budget models at the baked anchors of their Tripo originals.
    for (const anchor of this.anchors) {
      if (anchor.kind !== "machine") continue;
      const file = MACHINE_FILES[anchor.name];
      if (!file) continue;
      const gltf = await loadGltf(budgetPath("delivered", file)).catch(() => null);
      if (!gltf) continue;
      const root = gltf.scene.clone(true);
      root.matrixAutoUpdate = false;
      root.matrix.fromArray(anchor.matrix);
      root.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = false; object.receiveShadow = false; } });
      this.worldGroup.add(root);
    }
    // Stock screens: a dark panel and three labels per fixture screen.
    const perProduct = new Map<ProductId, number>();
    for (const anchor of this.anchors) {
      if (anchor.kind !== "retail-stock-screen") continue;
      const productId = anchor.name.split(":")[1] as ProductId;
      if (!PRODUCT_IDS.includes(productId)) continue;
      const fixtureIndex = perProduct.get(productId) ?? 0;
      perProduct.set(productId, fixtureIndex + 1);
      const base = new THREE.Matrix4().fromArray(anchor.matrix);
      const accent = RETAIL_DEPARTMENTS[PRODUCT_RETAIL_DEPARTMENT[productId]].color;
      // Local units: the anchor matrix carries the world scale.
      this.signs.add(" ", { fontSize: 0.62, color: "#0f1e23", background: "#101c1f", width: 0.76 }, scratch.matrix.multiplyMatrices(base, SCREEN_PANEL));
      this.signs.add(PRODUCTS_LABELS[productId], { fontSize: 0.07, color: "#e9f6f2", background: accent, weight: 800 }, scratch.matrix.multiplyMatrices(base, SCREEN_TITLE));
      const count = this.signs.add("0/0", { fontSize: 0.15, color: "#ffffff", weight: 800 }, scratch.matrix.multiplyMatrices(base, SCREEN_COUNT));
      const status = this.signs.add("", { fontSize: 0.082, color: "#ffcf6b", weight: 800 }, scratch.matrix.multiplyMatrices(base, SCREEN_STATUS));
      this.screens.push({ productId, fixtureIndex, count, status });
    }
    // Crop beds at the farm plot positions; one instanced model per stage.
    for (const plot of FARM_PLOTS) {
      const prefix = CROP_MODEL_PREFIX[plot.productId];
      if (!prefix) continue;
      const [x, y, z] = scaleStorePosition([...plot.position]);
      this.beds.push({ id: plot.id, productId: plot.productId, matrix: new THREE.Matrix4().makeTranslation(x, y, z) });
      for (const stage of CROP_STAGES) {
        const key = `${prefix}_${stage}`;
        if (this.crops.has(key)) continue;
        const gltf = await loadGltf(budgetPath("environment", key)).catch(() => null);
        if (!gltf) continue;
        const instances = new ModelInstances(gltf.scene, 8, `client-crop:${key}`);
        this.group.add(instances.mesh);
        this.crops.set(key, instances);
      }
    }
    // Animals: the delivered skinned models with their idle clip.
    for (const anchor of this.anchors) {
      if (anchor.kind !== "dynamic" || !/^dynamic:delivered-(chicken|cow)$/.test(anchor.name)) continue;
      const kind = anchor.name.endsWith("chicken") ? "chicken" : "cow";
      const gltf = await loadGltf(budgetPath("delivered", kind)).catch(() => null);
      if (!gltf) continue;
      const root = gltf.scene.clone(true);
      root.matrixAutoUpdate = false;
      root.matrix.fromArray(anchor.matrix);
      const mixer = new THREE.AnimationMixer(root);
      const clip = gltf.animations[0];
      if (clip) mixer.clipAction(clip).play();
      this.worldGroup.add(root);
      this.animals.push({ mixer, root });
    }
  }

  syncStock(shelves: Inventory, shelfTier: number, unlockedAreas: readonly string[]) {
    for (const screen of this.screens) {
      const fixtures = retailFixtureDisplayPositions(PRODUCT_RETAIL_DEPARTMENT[screen.productId], unlockedAreas).length || 1;
      const capacity = distributedFixtureQuantity(shelfCapacityForTier(shelfTier, screen.productId, unlockedAreas), screen.fixtureIndex, fixtures);
      const count = distributedFixtureQuantity(Math.max(0, Math.floor(shelves[screen.productId] ?? 0)), screen.fixtureIndex, fixtures);
      const missing = Math.max(0, capacity - count);
      const full = capacity > 0 && missing === 0;
      this.signs.update(screen.count, `${count}/${capacity}`);
      this.signs.update(screen.status, full ? "LLENO" : `faltan ${missing}`, { color: full ? "#8ce6a1" : "#ffcf6b" });
    }
  }

  syncWorld(props: MarketSceneProps) {
    const signature = props.visualCrops.map((crop) => `${crop.id}:${crop.status}:${Math.floor(cropProgress(crop, props.simulationTimeMs) * 20)}`).join("|");
    if (signature === this.lastCrops) return;
    this.lastCrops = signature;
    for (const instances of this.crops.values()) instances.begin();
    for (const bed of this.beds) {
      const crop = props.visualCrops.find((candidate) => candidate.id === bed.id);
      if (!crop || crop.status === "LOCKED" || crop.status === "EMPTY") continue;
      const stage = crop.status === "READY" || crop.status === "HARVESTING" ? 3 : Math.min(2, Math.floor(cropProgress(crop, props.simulationTimeMs) * 3));
      const model = this.crops.get(`${CROP_MODEL_PREFIX[bed.productId]}_${CROP_STAGES[stage]}`);
      model?.push(bed.matrix);
    }
    for (const instances of this.crops.values()) instances.end();
  }

  update(delta: number) {
    for (const animal of this.animals) animal.mixer.update(delta);
  }

  dispose() {
    for (const instances of this.crops.values()) instances.dispose();
    this.group.removeFromParent();
  }
}

function cropProgress(crop: CropState, simulationTimeMs: number) {
  const span = Math.max(1, crop.readyAt - crop.plantedAt);
  return Math.min(1, Math.max(0, (simulationTimeMs - crop.plantedAt) / span));
}
