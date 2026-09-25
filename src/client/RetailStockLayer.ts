import * as THREE from "three";
import type { Inventory, ProductId } from "@/game/types";
import { PRODUCT_IDS } from "@/game/economy/ProductRegistry";
import { PartsInstancer, type InstancedPart } from "@/game/render/CrowdParts";
import { distributedFixtureQuantity, PRODUCE_DECK, RETAIL_VISUAL_CAPACITY, retailStockLandingLocalPosition } from "@/game/stations/retail-layout";
import { deliveredProductParts } from "@/components/game/CrowdProps";
import { budgetProductParts } from "./BudgetProductParts";
import { deliveredProductId } from "@/components/game/DeliveredModel";
import type { WorldAnchor } from "./WorldAssets";
import { budgetPath, loadGltf } from "./WorldAssets";

/**
 * Units on the shelves: one instanced part list per SKU, filled from the
 * authoritative shelf counts at every world tick. Where each fixture's stock
 * group stands comes from the baked anchors (`retail-stock:<sku>`, one per
 * fixture, in the order the store lays them out); where the n-th unit sits on
 * that fixture is the same layout function the React kit used.
 */
const PRODUCE_IDS = new Set<ProductId>(["tomatoes", "oranges", "apples", "corn"]);
const CAPACITY = 320;
/** Basket-scale parts drawn at retail scale. */
const RETAIL_UNIT_SCALE: Partial<Record<ProductId, number>> = { tomatoes: 1.15, apples: 1.15, oranges: 1.15, corn: 1.15, eggs: 1.1, milk: 1.2, juice: 1.2, cheese: 1.25, bread: 1.2, cannedCorn: 1.1 };

interface StockFixture {
  productId: ProductId;
  matrix: THREE.Matrix4;
}

const scratch = { unit: new THREE.Matrix4(), slot: new THREE.Matrix4(), position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(), euler: new THREE.Euler() };

export class RetailStockLayer {
  readonly group = new THREE.Group();
  private readonly instancers = new Map<ProductId, PartsInstancer>();
  private readonly fixtures: StockFixture[] = [];
  private readonly lastCounts = new Map<ProductId, number>();

  constructor(anchors: readonly WorldAnchor[]) {
    this.group.name = "client:retail-stock";
    for (const anchor of anchors) {
      if (anchor.kind !== "retail-stock") continue;
      const productId = anchor.name.split(":")[1] as ProductId;
      if (!PRODUCT_IDS.includes(productId)) continue;
      this.fixtures.push({ productId, matrix: new THREE.Matrix4().fromArray(anchor.matrix) });
    }
  }

  /** Loads the delivered SKUs' parts; the primitive SKUs need no download. */
  async load() {
    const wanted = new Set(this.fixtures.map((fixture) => fixture.productId));
    for (const productId of wanted) {
      let parts: InstancedPart[] | null = budgetProductParts(productId);
      const delivered = deliveredProductId(productId);
      if (delivered) {
        const gltf = await loadGltf(budgetPath("delivered", delivered));
        parts = deliveredProductParts(gltf.scene);
      }
      if (!parts) continue;
      const instancer = new PartsInstancer(parts, CAPACITY, `client-stock:${productId}`);
      for (const mesh of instancer.meshes) mesh.receiveShadow = false;
      instancer.attach(this.group);
      this.instancers.set(productId, instancer);
    }
  }

  /** Re-lays every SKU whose store count changed. */
  sync(shelves: Inventory) {
    let changed = false;
    for (const [productId] of this.instancers) {
      const count = Math.max(0, Math.floor(shelves[productId] ?? 0));
      if (this.lastCounts.get(productId) !== count) { changed = true; break; }
    }
    if (!changed && this.lastCounts.size) return;
    for (const [productId, instancer] of this.instancers) {
      const total = Math.max(0, Math.floor(shelves[productId] ?? 0));
      this.lastCounts.set(productId, total);
      const fixtures = this.fixtures.filter((fixture) => fixture.productId === productId);
      instancer.begin();
      fixtures.forEach((fixture, fixtureIndex) => {
        const visible = Math.min(RETAIL_VISUAL_CAPACITY[productId], distributedFixtureQuantity(total, fixtureIndex, fixtures.length));
        const unitScale = (PRODUCE_IDS.has(productId) || productId === "eggs" ? 0.9 : 0.92) * (RETAIL_UNIT_SCALE[productId] ?? 1);
        for (let ordinal = 0; ordinal < visible; ordinal += 1) {
          const [x, y, z] = retailStockLandingLocalPosition(productId, ordinal, visible);
          scratch.euler.set(PRODUCE_IDS.has(productId) ? PRODUCE_DECK.tilt : 0, 0, 0);
          scratch.slot.compose(scratch.position.set(x, y, z), scratch.quaternion.setFromEuler(scratch.euler), scratch.scale.setScalar(unitScale));
          scratch.unit.multiplyMatrices(fixture.matrix, scratch.slot);
          instancer.push(scratch.unit);
        }
      });
      instancer.end();
    }
  }

  dispose() {
    for (const instancer of this.instancers.values()) { instancer.detach(); instancer.dispose(); }
    this.instancers.clear();
  }
}
