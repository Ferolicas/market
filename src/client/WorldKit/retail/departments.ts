import * as THREE from "three";
import type { ProductId } from "@/game/types";
import { PRODUCE_BIN_COLUMNS, PRODUCE_BIN_PITCH, PRODUCE_DECK, PRODUCT_RETAIL_DEPARTMENT, RETAIL_DEPARTMENTS, RETAIL_FIXTURE_LEVELS, produceDeckLocalPoint } from "@/game/stations/retail-layout";
import { makeBox, makeInstances, makeRoundedBoxGeometry, makeText, palette, updateText, type InstanceTransform, type Position } from "../primitives";
import { makeCommercialBackPanel, makeCommercialShelfBank, makeDepartmentSign, makeFixtureUprights, makeScreenRail } from "../fixtureShell";
import { buildRetailStockGroup, updateRetailStockGroup } from "../retailProducts";
import { buildBasketProductMesh } from "./basketProduct";
import { buildStockScreen, PRODUCTS_LABELS } from "./stockScreen";
import { buildDeliveredStockGroup, cloneDeliveredScene, type DeliveredStockAssets } from "./deliveredStock";

export { PRODUCTS_LABELS } from "./stockScreen";

/**
 * Imperative ports of MarketKit.tsx's retail department fixtures: `Gondola`,
 * `BakeryDisplay`, `ProduceTable`/`ProduceSlotSign`, `ChilledDisplay`,
 * `DrinksDisplay`, `EggDisplay`. Every geometry/material/position number is
 * copied verbatim from the source. Each `build*` returns `{ group, update }`
 * — `update` re-applies exactly the fields `sameFixtureProps` would notice
 * changing at runtime (stock counts, capacities, the dairy cooler's open
 * state); everything else (shell geometry, signage) is built once. Callers
 * wrap the returned `group` at `[0, 0, 0]` inside `makeStoreElement` exactly
 * like the source wraps these components in `<StoreElement>`.
 */

type StockCounts = Readonly<Partial<Record<ProductId, number>>>;
type ProduceCounts = StockCounts;
const PRODUCE_PRODUCTS = RETAIL_DEPARTMENTS.produce.products;

// ─── Gondola (pantry / preserves) ──────────────────────────────────────────

export interface GondolaProps {
  position: Position;
  count: number;
  capacity: number;
  productId?: "coffee" | "cannedCorn";
}

export function buildGondola(renderer: THREE.WebGLRenderer, props: GondolaProps) {
  const { position, productId = "coffee" } = props;
  const department = RETAIL_DEPARTMENTS[PRODUCT_RETAIL_DEPARTMENT[productId]];
  const accent = department.color;

  const group = new THREE.Group();
  group.name = `retail-department:${department.id}`;
  group.position.set(...position);

  group.add(makeBox({ args: [2.24, 0.16, 1.12], position: [0, 0.08, 0], color: palette.fixtureSteel, radius: 0.035 }));
  group.add(makeCommercialBackPanel({ width: 2.08, height: 1.82, z: 0, color: "#b69a77" }));
  group.add(makeFixtureUprights({ width: 2.18, height: 1.92, z: 0 }));
  // Fill the service-facing side first so the visible stock and its proximity
  // magnet share one face of the gondola at low inventory.
  for (const side of [1, -1] as const) {
    group.add(makeCommercialShelfBank({ levels: RETAIL_FIXTURE_LEVELS.pantry, width: 2.08, depth: 0.52, z: side * 0.28, front: side, accent }));
  }
  const stockGroup = buildRetailStockGroup(productId, props.count);
  if (stockGroup) group.add(stockGroup);
  group.add(makeBox({ args: [2.3, 0.14, 1.08], position: [0, 1.88, 0], color: palette.fixtureSteel, radius: 0.03 }));
  group.add(makeScreenRail({ barY: 1.95, railY: 2.43, halfWidth: 1.1, z: 0.12 }));
  const screen = buildStockScreen(renderer, { productId, count: props.count, capacity: props.capacity, position: [0, 2.9, 0.12], fixtureYaw: department.yaw });
  group.add(screen.group);
  group.add(makeDepartmentSign({ label: department.label, color: accent, position: [0, 2.15, 0], width: 2.02 }));

  const update = (count: number, capacity: number) => {
    if (stockGroup) updateRetailStockGroup(stockGroup, productId, count);
    screen.update(count, capacity);
  };
  return { group, update };
}

// ─── BakeryDisplay ──────────────────────────────────────────────────────────

export interface BakeryDisplayProps {
  stock: StockCounts;
  capacity: StockCounts;
}

export function buildBakeryDisplay(renderer: THREE.WebGLRenderer, props: BakeryDisplayProps) {
  const levels = RETAIL_FIXTURE_LEVELS.bakery;
  const yaw = RETAIL_DEPARTMENTS.bakery.yaw;
  const group = new THREE.Group();
  group.name = "retail-department:bakery";

  group.add(makeBox({ args: [2.24, 0.16, 0.78], position: [0, 0.08, -0.11], color: palette.fixtureSteel, radius: 0.035 }));
  group.add(makeCommercialBackPanel({ width: 2.08, height: 1.9, z: -0.34, color: "#d8c3a2" }));
  group.add(makeFixtureUprights({ width: 2.18, height: 2, z: -0.34 }));
  group.add(makeCommercialShelfBank({ levels, width: 2.08, depth: 0.52, z: 0.02, front: 1, accent: RETAIL_DEPARTMENTS.bakery.color }));

  const breadGroup = buildRetailStockGroup("bread", props.stock.bread ?? 0);
  const flourGroup = buildRetailStockGroup("flour", props.stock.flour ?? 0);
  const wheatGroup = buildRetailStockGroup("wheat", props.stock.wheat ?? 0);
  if (breadGroup) group.add(breadGroup);
  if (flourGroup) group.add(flourGroup);
  if (wheatGroup) group.add(wheatGroup);

  group.add(makeScreenRail({ barY: 2.05, railY: 2.52, halfWidth: 1.12, z: 0.1 }));
  const breadScreen = buildStockScreen(renderer, { productId: "bread", count: props.stock.bread ?? 0, capacity: props.capacity.bread ?? 0, position: [-0.78, 2.99, 0.1], fixtureYaw: yaw });
  const flourScreen = buildStockScreen(renderer, { productId: "flour", count: props.stock.flour ?? 0, capacity: props.capacity.flour ?? 0, position: [0, 2.99, 0.1], fixtureYaw: yaw });
  const wheatScreen = buildStockScreen(renderer, { productId: "wheat", count: props.stock.wheat ?? 0, capacity: props.capacity.wheat ?? 0, position: [0.78, 2.99, 0.1], fixtureYaw: yaw });
  group.add(breadScreen.group, flourScreen.group, wheatScreen.group);

  group.add(makeBox({ args: [2.3, 0.14, 0.78], position: [0, 1.98, -0.1], color: palette.fixtureSteel, radius: 0.03 }));
  group.add(makeDepartmentSign({ label: RETAIL_DEPARTMENTS.bakery.label, color: RETAIL_DEPARTMENTS.bakery.color, position: [0, 2.25, 0.08], width: 2.02 }));

  const update = (stock: StockCounts, capacity: StockCounts) => {
    if (breadGroup) updateRetailStockGroup(breadGroup, "bread", stock.bread ?? 0);
    if (flourGroup) updateRetailStockGroup(flourGroup, "flour", stock.flour ?? 0);
    if (wheatGroup) updateRetailStockGroup(wheatGroup, "wheat", stock.wheat ?? 0);
    breadScreen.update(stock.bread ?? 0, capacity.bread ?? 0);
    flourScreen.update(stock.flour ?? 0, capacity.flour ?? 0);
    wheatScreen.update(stock.wheat ?? 0, capacity.wheat ?? 0);
  };
  return { group, update };
}

// ─── ProduceTable / ProduceSlotSign ────────────────────────────────────────

const produceLegMaterial = new THREE.MeshStandardMaterial({ color: palette.fixtureSteel, metalness: 0.34, roughness: 0.42 });
const produceDeckMaterial = new THREE.MeshStandardMaterial({ color: palette.fixtureSteel, metalness: 0.3, roughness: 0.44 });
const produceDividerMaterial = new THREE.MeshStandardMaterial({ color: "#6e482d", roughness: 0.9 });
const produceLegGeometry = makeRoundedBoxGeometry(1, 1, 1, 0.1, { smoothness: 2 });
const produceDeckGeometry = makeRoundedBoxGeometry(1, 1, 1, 0.06, { smoothness: 2 });
const producePostGeometry = makeRoundedBoxGeometry(1, 1, 1, 0.08, { smoothness: 2 });
const unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);

function buildProduceSlotSign(productId: ProductId, x: number, count: number, capacity: number) {
  const missing = Math.max(0, capacity - count);
  const full = capacity > 0 && missing === 0;

  const group = new THREE.Group();
  group.name = `retail-slot-sign:${productId}`;
  group.position.set(x, 1.69, -0.66);
  group.add(makeBox({ args: [0.56, 0.7, 0.05], position: [0, 0, -0.02], color: palette.frame, radius: 0.04 }));
  group.add(makeBox({ args: [0.52, 0.66, 0.06], color: RETAIL_DEPARTMENTS.produce.color, radius: 0.035 }));
  group.add(makeBox({ args: [0.46, 0.3, 0.02], position: [0, -0.15, 0.035], color: "#fbf5e6", radius: 0.02 }));

  const productWrapper = new THREE.Group();
  productWrapper.name = `retail-product:${productId}`;
  productWrapper.position.set(0, 0.215, 0.07);
  productWrapper.add(buildBasketProductMesh(productId, { scale: 1.05 }));
  group.add(productWrapper);

  group.add(makeText({ text: PRODUCTS_LABELS[productId], position: [0, 0.06, 0.036], fontSize: 0.064, color: "#fffaf0", anchorX: "center", anchorY: "middle", fontWeight: 800 }));

  const dynamic = new THREE.Group();
  dynamic.name = "dynamic:produce-sign";
  const countText = makeText({ text: `${count}/${capacity}`, position: [0, -0.09, 0.05], fontSize: 0.12, color: "#24402c", anchorX: "center", anchorY: "middle", fontWeight: 800 });
  const statusText = makeText({ text: full ? "LLENO" : `faltan ${missing}`, position: [0, -0.235, 0.05], fontSize: 0.08, color: full ? "#2f7d3a" : "#b8641a", anchorX: "center", anchorY: "middle", fontWeight: 800 });
  dynamic.add(countText, statusText);
  group.add(dynamic);

  const update = (nextCount: number, nextCapacity: number) => {
    const nextMissing = Math.max(0, nextCapacity - nextCount);
    const nextFull = nextCapacity > 0 && nextMissing === 0;
    updateText(countText, { text: `${nextCount}/${nextCapacity}` });
    updateText(statusText, { text: nextFull ? "LLENO" : `faltan ${nextMissing}`, color: nextFull ? "#2f7d3a" : "#b8641a" });
  };
  return { group, update };
}

export interface ProduceTableProps {
  position: Position;
  stock: ProduceCounts;
  capacity: ProduceCounts;
}

/** Produce table seen from the isometric camera at +x/+z: four tilted bins,
 * one per SKU, each headed by its own slot sign at the back of the table so
 * nothing stands between the camera and the units on the deck. The
 * department header hangs above the signs on the same rear rail. */
export function buildProduceTable(props: ProduceTableProps) {
  const { position, stock, capacity } = props;
  const deckTilt: Position = [PRODUCE_DECK.tilt, 0, 0];
  const legs: InstanceTransform[] = [-1.08, 1.08].flatMap((x) => [-0.58, 0.58].map((z) => ({ position: [x, 0.39, z] as Position, scale: [0.09, 0.7, 0.09] as Position })));
  const decks: InstanceTransform[] = PRODUCE_BIN_COLUMNS.map((x) => ({ position: [x, PRODUCE_DECK.center[1], PRODUCE_DECK.center[2]] as Position, rotation: [PRODUCE_DECK.tilt, 0, 0] as Position, scale: [PRODUCE_DECK.width, PRODUCE_DECK.thickness, PRODUCE_DECK.depth] as Position }));
  const dividers: InstanceTransform[] = [-2, -1, 0, 1, 2].map((slot) => ({ position: produceDeckLocalPoint(slot * PRODUCE_BIN_PITCH, 0.1, 0), rotation: [PRODUCE_DECK.tilt, 0, 0] as Position, scale: [0.03, 0.2, PRODUCE_DECK.depth + 0.04] as Position }));
  const signPosts: InstanceTransform[] = PRODUCE_BIN_COLUMNS.map((x) => ({ position: [x, 1.12, -0.68] as Position, scale: [0.045, 0.54, 0.045] as Position }));
  const headerPosts: InstanceTransform[] = [-1.1, 1.1].map((x) => ({ position: [x, 1.52, -0.7] as Position, scale: [0.055, 1.7, 0.055] as Position }));

  const group = new THREE.Group();
  group.name = "retail-department:produce";
  group.position.set(...position);

  group.add(makeBox({ args: [2.42, 0.12, 1.5], position: [0, 0.08, 0], color: palette.fixtureSteel, radius: 0.035 }));
  group.add(makeInstances(legs, produceLegGeometry, produceLegMaterial, { castShadow: true }));
  group.add(makeBox({ args: [2.28, 0.54, 1.34], position: [0, 0.43, 0], color: palette.wood, radius: 0.055 }));
  group.add(makeInstances(decks, produceDeckGeometry, produceDeckMaterial, { receiveShadow: true }));
  group.add(makeInstances(dividers, unitBoxGeometry, produceDividerMaterial));
  group.add(makeBox({ args: [2.32, 0.07, 0.035], position: produceDeckLocalPoint(0, 0.055, 0.585), rotation: deckTilt, color: "#6e482d", radius: 0.012 }));
  group.add(makeBox({ args: [2.32, 0.17, 0.035], position: produceDeckLocalPoint(0, 0.1, -0.6), rotation: deckTilt, color: "#6e482d", radius: 0.012 }));

  const stockGroups = new Map<ProductId, THREE.Group>();
  for (const productId of PRODUCE_PRODUCTS) {
    const stockGroup = buildRetailStockGroup(productId, stock[productId] ?? 0);
    if (stockGroup) { group.add(stockGroup); stockGroups.set(productId, stockGroup); }
  }

  group.add(makeInstances(signPosts, producePostGeometry, produceLegMaterial, { castShadow: true }));
  const slotSigns = PRODUCE_PRODUCTS.map((productId, index) => buildProduceSlotSign(productId, PRODUCE_BIN_COLUMNS[index], stock[productId] ?? 0, capacity[productId] ?? 0));
  for (const sign of slotSigns) group.add(sign.group);
  group.add(makeInstances(headerPosts, producePostGeometry, produceLegMaterial, { castShadow: true }));
  group.add(makeBox({ args: [2.3, 0.12, 0.08], position: [0, 2.36, -0.7], color: palette.fixtureSteel, radius: 0.025 }));
  group.add(makeDepartmentSign({ label: RETAIL_DEPARTMENTS.produce.label, color: RETAIL_DEPARTMENTS.produce.color, position: [0, 2.33, -0.64], width: 2.2 }));

  const update = (nextStock: ProduceCounts, nextCapacity: ProduceCounts) => {
    for (const productId of PRODUCE_PRODUCTS) {
      const stockGroup = stockGroups.get(productId);
      if (stockGroup) updateRetailStockGroup(stockGroup, productId, nextStock[productId] ?? 0);
    }
    slotSigns.forEach((sign, index) => sign.update(nextStock[PRODUCE_PRODUCTS[index]] ?? 0, nextCapacity[PRODUCE_PRODUCTS[index]] ?? 0));
  };
  return { group, update };
}

// ─── ChilledDisplay (dairy) ─────────────────────────────────────────────────

export interface ChilledDisplayProps {
  position: Position;
  stock: StockCounts;
  capacity: StockCounts;
  open: boolean;
}

export function buildChilledDisplay(renderer: THREE.WebGLRenderer, assets: DeliveredStockAssets, props: ChilledDisplayProps) {
  const { position, stock, capacity, open } = props;
  const group = new THREE.Group();
  group.name = "retail-department:dairy";
  group.position.set(...position);

  const dairyWrapper = new THREE.Group();
  dairyWrapper.name = "dynamic:delivered-dairy";
  const dairyModel = cloneDeliveredScene(assets, "dairy");
  const dairyInner = new THREE.Group();
  dairyInner.name = "delivered:dairy";
  dairyInner.add(dairyModel);
  dairyWrapper.add(dairyInner);
  group.add(dairyWrapper);
  // Three supplied door leaves, their rigid pivots prepared at import time.
  const doors = [1, 2, 3]
    .map((index) => dairyModel.getObjectByName(`DairyDoor${index}`))
    .filter((door): door is THREE.Object3D => Boolean(door));
  let openTarget = open;

  const milkGroup = buildDeliveredStockGroup(assets, "milk", stock.milk ?? 0);
  const cheeseGroup = buildDeliveredStockGroup(assets, "cheese", stock.cheese ?? 0);
  if (milkGroup) group.add(milkGroup.group);
  if (cheeseGroup) group.add(cheeseGroup.group);

  group.add(makeDepartmentSign({ label: RETAIL_DEPARTMENTS.dairy.label, color: RETAIL_DEPARTMENTS.dairy.color, position: [0, 1.86, 0.08], width: 2.02 }));
  group.add(makeScreenRail({ barY: 1.58, railY: 2.12, halfWidth: 1.12, z: 0.1 }));
  const milkScreen = buildStockScreen(renderer, { productId: "milk", count: stock.milk ?? 0, capacity: capacity.milk ?? 0, position: [-0.55, 2.58, 0.1], fixtureYaw: RETAIL_DEPARTMENTS.dairy.yaw, deliveredScene: assets.scenes.get("milk") });
  const cheeseScreen = buildStockScreen(renderer, { productId: "cheese", count: stock.cheese ?? 0, capacity: capacity.cheese ?? 0, position: [0.55, 2.58, 0.1], fixtureYaw: RETAIL_DEPARTMENTS.dairy.yaw, deliveredScene: assets.scenes.get("cheese") });
  group.add(milkScreen.group, cheeseScreen.group);

  const update = (nextStock: StockCounts, nextCapacity: StockCounts, nextOpen: boolean) => {
    if (milkGroup) milkGroup.update(nextStock.milk ?? 0);
    if (cheeseGroup) cheeseGroup.update(nextStock.cheese ?? 0);
    milkScreen.update(nextStock.milk ?? 0, nextCapacity.milk ?? 0);
    cheeseScreen.update(nextStock.cheese ?? 0, nextCapacity.cheese ?? 0);
    openTarget = nextOpen;
  };
  /** Per-frame door damp — the source drives this from `useFrame` every
   * frame regardless of whether `open` just changed; call each render tick. */
  const animate = (delta: number) => {
    for (const door of doors) door.rotation.set(0, THREE.MathUtils.damp(door.rotation.y, openTarget ? -1.05 : 0, 8, Math.min(delta, 0.05)), 0);
  };
  return { group, update, animate };
}

// ─── DrinksDisplay ──────────────────────────────────────────────────────────

export interface DrinksDisplayProps {
  position: Position;
  count: number;
  capacity: number;
}

export function buildDrinksDisplay(renderer: THREE.WebGLRenderer, props: DrinksDisplayProps) {
  const { position, count, capacity } = props;
  const levels = RETAIL_FIXTURE_LEVELS.drinks;
  const group = new THREE.Group();
  group.name = "retail-department:drinks";
  group.position.set(...position);

  group.add(makeBox({ args: [2.3, 0.17, 0.9], position: [0, 0.085, 0], color: palette.fixtureSteel, radius: 0.04 }));
  group.add(makeCommercialBackPanel({ width: 2.2, height: 2.08, z: -0.36, color: "#d8d3c6" }));
  group.add(makeFixtureUprights({ width: 2.28, height: 2.2, z: -0.31 }));
  group.add(makeCommercialShelfBank({ levels, width: 2.13, depth: 0.67, front: 1, accent: RETAIL_DEPARTMENTS.drinks.color }));
  const juiceGroup = buildRetailStockGroup("juice", count);
  if (juiceGroup) group.add(juiceGroup);
  group.add(makeBox({ args: [2.38, 0.18, 0.92], position: [0, 2.18, 0], color: palette.fixtureSteel, radius: 0.04 }));
  group.add(makeScreenRail({ barY: 2.27, railY: 2.7, halfWidth: 1.12, z: 0.1 }));
  const screen = buildStockScreen(renderer, { productId: "juice", count, capacity, position: [0, 3.14, 0.1], fixtureYaw: RETAIL_DEPARTMENTS.drinks.yaw });
  group.add(screen.group);
  group.add(makeDepartmentSign({ label: RETAIL_DEPARTMENTS.drinks.label, color: RETAIL_DEPARTMENTS.drinks.color, position: [0, 2.42, 0.07], width: 2 }));

  const update = (nextCount: number, nextCapacity: number) => {
    if (juiceGroup) updateRetailStockGroup(juiceGroup, "juice", nextCount);
    screen.update(nextCount, nextCapacity);
  };
  return { group, update };
}

// ─── EggDisplay ─────────────────────────────────────────────────────────────

export interface EggDisplayProps {
  count: number;
  capacity: number;
}

export function buildEggDisplay(renderer: THREE.WebGLRenderer, assets: DeliveredStockAssets, props: EggDisplayProps) {
  const { count, capacity } = props;
  const group = new THREE.Group();
  group.name = "retail-department:eggs";

  const caseWrapper = new THREE.Group();
  caseWrapper.name = "delivered:egg-display";
  caseWrapper.add(cloneDeliveredScene(assets, "egg-display"));
  group.add(caseWrapper);

  const eggGroup = buildDeliveredStockGroup(assets, "eggs", count);
  if (eggGroup) group.add(eggGroup.group);

  group.add(makeScreenRail({ barY: 2.1, railY: 2.36, halfWidth: 0.73, z: 0.1 }));
  const screen = buildStockScreen(renderer, { productId: "eggs", count, capacity, position: [0, 2.83, 0.1], fixtureYaw: RETAIL_DEPARTMENTS.eggs.yaw, deliveredScene: assets.scenes.get("egg") });
  group.add(screen.group);

  const update = (nextCount: number, nextCapacity: number) => {
    if (eggGroup) eggGroup.update(nextCount);
    screen.update(nextCount, nextCapacity);
  };
  return { group, update };
}
