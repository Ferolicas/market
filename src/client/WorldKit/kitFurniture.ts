import * as THREE from "three";
import type { CheckoutTransaction, CustomerRuntimeState, Inventory, ProductionMachineState } from "@/game/types";
import { fixtureAvailable } from "@/game/stations/fixture-availability";
import { shelfCapacityForTier } from "@/game/engine";
import { PRODUCT_RETAIL_DEPARTMENT, distributedFixtureQuantity, retailDisplayPosition, retailFixtureDisplayPositions, RETAIL_DEPARTMENTS, PANTRY_DISPLAY_POSITIONS, PRODUCE_DISPLAY_POSITIONS } from "@/game/stations/retail-layout";
import { CHECKOUT_LANE_IDS, CHECKOUT_LANES, activeCheckoutForLane, checkoutAreaForLane, checkoutBagLocation, checkoutHandoffForLane, type CheckoutLane } from "@/game/stations/checkout-layout";
import { STORE_SERVICE_FIXTURES } from "@/game/stations/store-service-layout";
import { STORE_PRODUCTION_FIXTURES } from "@/game/stations/production-layout";
import { WAREHOUSE_RETURN_STATION } from "@/game/stations/warehouse-layout";
import { makeStoreElement } from "./storeElement";
import { buildGondola, buildBakeryDisplay, buildProduceTable, buildChilledDisplay, buildDrinksDisplay, buildEggDisplay } from "./retail/departments";
import { loadDeliveredStockAssets, type DeliveredStockAssets } from "./retail/deliveredStock";
import { buildCheckoutKit, buildClosedCheckoutKit } from "./checkout/checkoutKit";
import { buildCashierWorkArea } from "./checkout/cashierWorkArea";
import { buildReturnsCubicle } from "./checkout/returnsCubicle";
import { buildCartBay } from "./checkout/cartBay";
import { buildProductionCubicle } from "./production/productionCubicle";
import { buildBakeryKit, buildMillMachine, buildProcessMachine, buildCornCanner } from "./production/machines";
import { buildSupplierCorner, buildWarehouseReturnBasket } from "./production/supplierAndWarehouse";
import { buildStoreUtilities } from "./production/storeUtilities";

export interface FurnitureBuildProps {
  shelves: Inventory;
  shelfTier: number;
  machines: ProductionMachineState[];
  customers: CustomerRuntimeState[];
  checkoutTransactions: CheckoutTransaction[];
  returnsBin: Inventory;
  returnedCartCount: number;
  lightsOn: boolean;
  dynamicCeilingLights: boolean;
  unlockedAreas: string[];
}

/**
 * Imperative port of `KitFurniture` (`MarketKit.tsx`). Gates every fixture by
 * `fixtureAvailable(id, unlockedAreas)` — the exact same check the source
 * uses — so this ALWAYS matches the real save's real progression, unlike the
 * frozen `level30.glb` bake it replaces.
 *
 * `unlockedAreas` changes on a real purchase completion. Measured on
 * 2026-09-26 (see `docs/RUNTIME-IPHONE-FRAME-PACING-AUDIT.md`, "hueco de
 * fotogramas al completar una compra"): the previous approach — discarding
 * the ENTIRE fixture group and calling `buildFixtureSet()` from scratch on
 * any `unlockedAreas` signature change — cost 63-193ms of synchronous
 * main-thread work in this same build even on a warm desktop GPU (confirmed
 * by direct instrumentation: `[DIAG furniture rebuild] build=63.00ms` for a
 * single newly-unlocked area, none of it in the stock-screen photo
 * render-to-texture calls, which stayed at 0.1-2.2ms each once their
 * pipeline was warm — the cost was in recreating geometry/materials/text for
 * every fixture that ALREADY existed and had not changed). On the real
 * iPhone this scaled to the 90 frame-gaps->25ms (worst 216.6ms) recorded
 * during an adversarial gameplay session.
 *
 * Root-cause fix: reconcile incrementally. Each fixture is described once
 * (`FIXTURE_DESCRIPTORS`, below) with its own `available(unlockedAreas)`
 * test and a `build()` factory. `reconcile()` runs on every `update()` call
 * (every ~200ms world tick) and only constructs a fixture the FIRST time it
 * becomes available, and only disposes it if it stops being available —
 * every fixture that stays available across an `unlockedAreas` change is
 * left completely untouched (same geometry, same materials, same
 * once-rendered stock-screen photo texture), exactly like every other prop
 * change (stock, machine status, checkout, cart count, lights) already was.
 */
export async function buildFurniture(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, props: FurnitureBuildProps): Promise<{ group: THREE.Group; update: (next: FurnitureBuildProps) => void; animate: (deltaSeconds: number) => void }> {
  const deliveredAssets = await loadDeliveredStockAssets();
  return buildFixtureSet(renderer, camera, scene, deliveredAssets, props);
}

interface FixtureHandles {
  group: THREE.Group;
  update: (props: FurnitureBuildProps) => void;
  animate: (deltaSeconds: number) => void;
}

interface LiveFixture {
  element: THREE.Object3D;
  update?: (props: FurnitureBuildProps) => void;
  animate?: (deltaSeconds: number) => void;
}

interface FixtureDescriptor {
  key: string;
  available: (unlockedAreas: readonly string[]) => boolean;
  build: (ctx: FixtureBuildContext) => LiveFixture;
}

interface FixtureBuildContext {
  renderer: THREE.WebGLRenderer;
  camera: THREE.Camera;
  scene: THREE.Scene;
  deliveredAssets: DeliveredStockAssets;
  props: FurnitureBuildProps;
}

function machineFinder(machines: ProductionMachineState[]) {
  return (id: string) => machines.find((candidate) => candidate.id === id);
}

function fixtureCapacityOf(props: FurnitureBuildProps) {
  return (productId: Parameters<typeof shelfCapacityForTier>[1], fixtureIndex = 0) => distributedFixtureQuantity(
    shelfCapacityForTier(props.shelfTier, productId, props.unlockedAreas),
    fixtureIndex,
    retailFixtureDisplayPositions(PRODUCT_RETAIL_DEPARTMENT[productId], props.unlockedAreas).length,
  );
}

function coldDoorActiveOf(props: FurnitureBuildProps) {
  return props.customers.some((customer) => ["WAIT_FOR_ACCESS", "PICK_PRODUCT"].includes(customer.state) && ["milk", "cheese"].includes(customer.shoppingList[customer.currentLine]?.productId ?? ""));
}

function buildProduceFixtureDescriptor(index: number): FixtureDescriptor {
  const position = PRODUCE_DISPLAY_POSITIONS[index];
  return {
    key: `produce-${index}`,
    available: (unlockedAreas) => index < retailFixtureDisplayPositions("produce", unlockedAreas).length,
    build: ({ props }) => {
      const element = makeStoreElement([...position], RETAIL_DEPARTMENTS.produce.yaw);
      const produceStock = (source: FurnitureBuildProps) => Object.fromEntries(RETAIL_DEPARTMENTS.produce.products.map((productId) => [productId, distributedFixtureQuantity(source.shelves[productId] ?? 0, index, retailFixtureDisplayPositions("produce", source.unlockedAreas).length)]));
      const produceCapacity = (source: FurnitureBuildProps) => Object.fromEntries(RETAIL_DEPARTMENTS.produce.products.map((productId) => [productId, distributedFixtureQuantity(shelfCapacityForTier(source.shelfTier, productId, source.unlockedAreas), index, retailFixtureDisplayPositions("produce", source.unlockedAreas).length)]));
      const table = buildProduceTable({ position: [0, 0, 0], stock: produceStock(props), capacity: produceCapacity(props) });
      element.add(table.group);
      return { element, update: (next) => table.update(produceStock(next), produceCapacity(next)) };
    },
  };
}

function buildCheckoutOpenDescriptor(lane: CheckoutLane): FixtureDescriptor {
  return {
    key: `checkout-open-${lane}`,
    available: (unlockedAreas) => lane === 0 || unlockedAreas.includes(checkoutAreaForLane(lane)),
    build: ({ renderer, camera, scene, props }) => {
      const counter = makeStoreElement([...CHECKOUT_LANES[lane].counter]);
      const cashierSpot = makeStoreElement([...CHECKOUT_LANES[lane].cashierWork]);
      const kit = buildCheckoutKit(renderer, camera, scene, lane);
      counter.add(kit.group);
      cashierSpot.add(buildCashierWorkArea());
      const element = new THREE.Group();
      element.add(counter, cashierSpot);
      const laneUpdate = (next: FurnitureBuildProps) => {
        const active = activeCheckoutForLane(next.checkoutTransactions, lane);
        const handoff = checkoutHandoffForLane(next.checkoutTransactions, lane, next.customers);
        const handoffLocation = checkoutBagLocation(handoff, next.customers);
        kit.update(active, handoff, handoffLocation === "counter");
      };
      laneUpdate(props);
      return { element, update: laneUpdate, animate: kit.animate };
    },
  };
}

function buildCheckoutClosedDescriptor(lane: CheckoutLane): FixtureDescriptor {
  return {
    key: `checkout-closed-${lane}`,
    available: (unlockedAreas) => lane !== 0 && !unlockedAreas.includes(checkoutAreaForLane(lane)) && !unlockedAreas.includes("purchase-campaign"),
    build: () => {
      const counter = makeStoreElement([...CHECKOUT_LANES[lane].counter]);
      counter.add(buildClosedCheckoutKit(lane));
      return { element: counter };
    },
  };
}

/** Every fixture the store can ever contain, described once (never rebuilt
 * itself) so `reconcile()` can construct/dispose exactly the ones whose
 * `available()` result actually changed between two `unlockedAreas` sets. */
function fixtureDescriptors(): FixtureDescriptor[] {
  const descriptors: FixtureDescriptor[] = [];

  descriptors.push({
    key: "retail-preserves",
    available: (areas) => fixtureAvailable("fixture:retail-preserves-1", areas),
    build: ({ renderer, props }) => {
      const element = makeStoreElement(retailDisplayPosition("preserves"), RETAIL_DEPARTMENTS.preserves.yaw);
      const gondola = buildGondola(renderer, { position: [0, 0, 0], productId: "cannedCorn", count: props.shelves.cannedCorn ?? 0, capacity: fixtureCapacityOf(props)("cannedCorn") });
      element.add(gondola.group);
      return { element, update: (next) => gondola.update(next.shelves.cannedCorn ?? 0, fixtureCapacityOf(next)("cannedCorn")) };
    },
  });

  descriptors.push({
    key: "retail-bakery",
    available: (areas) => fixtureAvailable("fixture:retail-bakery-1", areas),
    build: ({ renderer, props }) => {
      const element = makeStoreElement(retailDisplayPosition("bakery"), RETAIL_DEPARTMENTS.bakery.yaw);
      const bakeryStock = (source: FurnitureBuildProps) => ({ bread: source.shelves.bread ?? 0, flour: source.shelves.flour ?? 0, wheat: source.shelves.wheat ?? 0 });
      const bakeryCapacity = (source: FurnitureBuildProps) => { const capacity = fixtureCapacityOf(source); return { bread: capacity("bread"), flour: capacity("flour"), wheat: capacity("wheat") }; };
      const bakery = buildBakeryDisplay(renderer, { stock: bakeryStock(props), capacity: bakeryCapacity(props) });
      element.add(bakery.group);
      return { element, update: (next) => bakery.update(bakeryStock(next), bakeryCapacity(next)) };
    },
  });

  PANTRY_DISPLAY_POSITIONS.forEach((position, index) => {
    descriptors.push({
      key: `retail-pantry-${index}`,
      available: (areas) => fixtureAvailable("fixture:retail-pantry-1", areas),
      build: ({ renderer, props }) => {
        const element = makeStoreElement([...position], RETAIL_DEPARTMENTS.pantry.yaw);
        const gondola = buildGondola(renderer, { position: [0, 0, 0], count: distributedFixtureQuantity(props.shelves.coffee ?? 0, index, PANTRY_DISPLAY_POSITIONS.length), capacity: fixtureCapacityOf(props)("coffee", index) });
        element.add(gondola.group);
        return { element, update: (next) => gondola.update(distributedFixtureQuantity(next.shelves.coffee ?? 0, index, PANTRY_DISPLAY_POSITIONS.length), fixtureCapacityOf(next)("coffee", index)) };
      },
    });
  });

  descriptors.push({
    key: "retail-eggs",
    available: (areas) => fixtureAvailable("fixture:retail-eggs-1", areas),
    build: ({ renderer, deliveredAssets, props }) => {
      const element = makeStoreElement(retailDisplayPosition("eggs"), RETAIL_DEPARTMENTS.eggs.yaw);
      const eggs = buildEggDisplay(renderer, deliveredAssets, { count: props.shelves.eggs ?? 0, capacity: fixtureCapacityOf(props)("eggs") });
      element.add(eggs.group);
      return { element, update: (next) => eggs.update(next.shelves.eggs ?? 0, fixtureCapacityOf(next)("eggs")) };
    },
  });

  for (let index = 0; index < PRODUCE_DISPLAY_POSITIONS.length; index += 1) descriptors.push(buildProduceFixtureDescriptor(index));

  descriptors.push({
    key: "retail-dairy",
    available: (areas) => fixtureAvailable("fixture:retail-dairy-1", areas),
    build: ({ renderer, deliveredAssets, props }) => {
      const element = makeStoreElement(retailDisplayPosition("dairy"), RETAIL_DEPARTMENTS.dairy.yaw);
      const dairyStock = (source: FurnitureBuildProps) => ({ milk: source.shelves.milk ?? 0, cheese: source.shelves.cheese ?? 0 });
      const dairyCapacity = (source: FurnitureBuildProps) => { const capacity = fixtureCapacityOf(source); return { milk: capacity("milk"), cheese: capacity("cheese") }; };
      const chilled = buildChilledDisplay(renderer, deliveredAssets, { position: [0, 0, 0], stock: dairyStock(props), capacity: dairyCapacity(props), open: coldDoorActiveOf(props) });
      element.add(chilled.group);
      return {
        element,
        update: (next) => chilled.update(dairyStock(next), dairyCapacity(next), coldDoorActiveOf(next)),
        animate: chilled.animate,
      };
    },
  });

  descriptors.push({
    key: "retail-drinks",
    available: (areas) => fixtureAvailable("fixture:retail-drinks-1", areas),
    build: ({ renderer, props }) => {
      const element = makeStoreElement(retailDisplayPosition("drinks"), RETAIL_DEPARTMENTS.drinks.yaw);
      const drinks = buildDrinksDisplay(renderer, { position: [0, 0, 0], count: props.shelves.juice ?? 0, capacity: fixtureCapacityOf(props)("juice") });
      element.add(drinks.group);
      return { element, update: (next) => drinks.update(next.shelves.juice ?? 0, fixtureCapacityOf(next)("juice")) };
    },
  });

  for (const lane of CHECKOUT_LANE_IDS as readonly CheckoutLane[]) {
    descriptors.push(buildCheckoutOpenDescriptor(lane));
    if (lane !== 0) descriptors.push(buildCheckoutClosedDescriptor(lane));
  }

  descriptors.push({
    key: "returns-cubicle",
    available: () => true,
    build: ({ renderer, camera, scene, props }) => {
      const element = makeStoreElement([...STORE_SERVICE_FIXTURES.returns.position]);
      const returns = buildReturnsCubicle(renderer, camera, scene);
      element.add(returns.group);
      returns.update(props.returnsBin);
      return { element, update: (next) => returns.update(next.returnsBin) };
    },
  });

  descriptors.push({
    key: "cart-bay",
    available: () => true,
    build: ({ props }) => {
      const element = makeStoreElement([...STORE_SERVICE_FIXTURES.cartBay.position]);
      const cartBay = buildCartBay([0, 0, 0]);
      element.add(cartBay.group);
      cartBay.update(props.returnedCartCount);
      return { element, update: (next) => cartBay.update(next.returnedCartCount) };
    },
  });

  descriptors.push({
    key: "production-cubicle-shell",
    available: (areas) => fixtureAvailable("fixture:production-cubicle-shell", areas),
    build: () => ({ element: buildProductionCubicle() }),
  });

  descriptors.push({
    key: "bread-oven",
    available: (areas) => fixtureAvailable("fixture:bread-oven", areas),
    build: ({ renderer, camera, scene, props }) => {
      const element = makeStoreElement([...STORE_PRODUCTION_FIXTURES.breadOven.position]);
      const bakery = buildBakeryKit(renderer, camera, scene, [0, 0, 0]);
      element.add(bakery.group);
      bakery.update(machineFinder(props.machines)("bread-oven-1"));
      return { element, update: (next) => bakery.update(machineFinder(next.machines)("bread-oven-1")) };
    },
  });

  descriptors.push({
    key: "flour-mill",
    available: (areas) => fixtureAvailable("fixture:flour-mill", areas),
    build: ({ renderer, camera, scene, props }) => {
      const element = makeStoreElement([...STORE_PRODUCTION_FIXTURES.flourMill.position]);
      const mill = buildMillMachine(renderer, camera, scene, [0, 0, 0]);
      element.add(mill.group);
      mill.update(machineFinder(props.machines)("flour-mill-1"));
      return { element, update: (next) => mill.update(machineFinder(next.machines)("flour-mill-1")) };
    },
  });

  descriptors.push({
    key: "cheese-maker",
    available: (areas) => fixtureAvailable("fixture:cheese-maker", areas),
    build: ({ renderer, camera, scene, props }) => {
      const element = makeStoreElement([...STORE_PRODUCTION_FIXTURES.cheeseMaker.position]);
      const cheeseMaker = buildProcessMachine(renderer, camera, scene, "cheese", [0, 0, 0]);
      element.add(cheeseMaker.group);
      cheeseMaker.update(machineFinder(props.machines)("cheese-maker-1"));
      return { element, update: (next) => cheeseMaker.update(machineFinder(next.machines)("cheese-maker-1")) };
    },
  });

  descriptors.push({
    key: "juice-machine",
    available: (areas) => fixtureAvailable("fixture:juice-machine", areas),
    build: ({ renderer, camera, scene, props }) => {
      const element = makeStoreElement([...STORE_PRODUCTION_FIXTURES.juiceMachine.position]);
      const juiceMachine = buildProcessMachine(renderer, camera, scene, "juice", [0, 0, 0]);
      element.add(juiceMachine.group);
      juiceMachine.update(machineFinder(props.machines)("juice-machine-1"));
      return { element, update: (next) => juiceMachine.update(machineFinder(next.machines)("juice-machine-1")) };
    },
  });

  descriptors.push({
    key: "corn-canner",
    available: (areas) => fixtureAvailable("fixture:corn-canner", areas),
    build: ({ props }) => {
      const element = makeStoreElement([...STORE_PRODUCTION_FIXTURES.cornCanner.position]);
      const canner = buildCornCanner();
      element.add(canner.group);
      canner.update(machineFinder(props.machines)("corn-canner-1"));
      return { element, update: (next) => canner.update(machineFinder(next.machines)("corn-canner-1")) };
    },
  });

  descriptors.push({
    key: "supplier-corner",
    available: () => true,
    build: ({ renderer, camera, scene }) => {
      const element = makeStoreElement([...STORE_SERVICE_FIXTURES.orders.position]);
      element.add(buildSupplierCorner(renderer, camera, scene, [0, 0, 0]));
      return { element };
    },
  });

  descriptors.push({
    key: "warehouse-return-basket",
    available: () => true,
    build: () => {
      const element = makeStoreElement([...WAREHOUSE_RETURN_STATION.position]);
      element.add(buildWarehouseReturnBasket());
      return { element };
    },
  });

  descriptors.push({
    key: "store-utilities",
    available: () => true,
    build: ({ renderer, camera, scene, props }) => {
      const utilities = buildStoreUtilities(renderer, camera, scene, props.lightsOn, props.dynamicCeilingLights);
      return { element: utilities.group, update: (next) => utilities.update(next.lightsOn, next.dynamicCeilingLights) };
    },
  });

  return descriptors;
}

/** Builds the fixture SET once and reconciles it incrementally forever after
 * — see the doc comment on `buildFurniture()` for why this replaced a
 * destroy-and-rebuild-everything approach. */
function buildFixtureSet(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, deliveredAssets: DeliveredStockAssets, initialProps: FurnitureBuildProps): FixtureHandles {
  const group = new THREE.Group();
  group.name = "worldkit:furniture";
  const descriptors = fixtureDescriptors();
  const live = new Map<string, LiveFixture>();

  function reconcile(props: FurnitureBuildProps) {
    for (const descriptor of descriptors) {
      const shouldExist = descriptor.available(props.unlockedAreas);
      const existing = live.get(descriptor.key);
      if (shouldExist && !existing) {
        const built = descriptor.build({ renderer, camera, scene, deliveredAssets, props });
        live.set(descriptor.key, built);
        group.add(built.element);
      } else if (!shouldExist && existing) {
        group.remove(existing.element);
        disposeObject3D(existing.element);
        live.delete(descriptor.key);
      }
    }
  }

  reconcile(initialProps);

  return {
    group,
    update(next: FurnitureBuildProps) {
      reconcile(next);
      for (const fixture of live.values()) fixture.update?.(next);
    },
    animate(deltaSeconds: number) {
      for (const fixture of live.values()) fixture.animate?.(deltaSeconds);
    },
  };
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
  });
}
