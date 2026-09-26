import * as THREE from "three";
import type { CheckoutTransaction, CustomerRuntimeState, Inventory, ProductionMachineState } from "@/game/types";
import { fixtureAvailable } from "@/game/stations/fixture-availability";
import { shelfCapacityForTier } from "@/game/engine";
import { PRODUCT_RETAIL_DEPARTMENT, distributedFixtureQuantity, retailDisplayPosition, retailFixtureDisplayPositions, RETAIL_DEPARTMENTS, PANTRY_DISPLAY_POSITIONS } from "@/game/stations/retail-layout";
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
 * frozen `level30.glb` bake it replaces. `unlockedAreas` changes (a real
 * purchase) are rare, so a change there does a full rebuild of the fixture
 * SET (add/remove); every other prop change (stock, machine status,
 * checkout, cart count, lights) only calls each already-built fixture's own
 * cheap `update()` — no geometry is rebuilt on a normal 200ms world tick.
 */
export async function buildFurniture(renderer: THREE.WebGLRenderer, props: FurnitureBuildProps): Promise<{ group: THREE.Group; update: (next: FurnitureBuildProps) => void; animate: (deltaSeconds: number) => void }> {
  const deliveredAssets = await loadDeliveredStockAssets();
  const root = new THREE.Group();
  root.name = "worldkit:furniture";

  let unlockedSignature = "";
  let handles: FixtureHandles | null = null;

  const rebuild = (next: FurnitureBuildProps) => {
    if (handles) {
      root.remove(handles.group);
      disposeGroup(handles.group);
    }
    handles = buildFixtureSet(renderer, deliveredAssets, next);
    root.add(handles.group);
    unlockedSignature = next.unlockedAreas.join("|");
  };

  rebuild(props);

  return {
    group: root,
    update(next: FurnitureBuildProps) {
      const nextSignature = next.unlockedAreas.join("|");
      if (nextSignature !== unlockedSignature) {
        rebuild(next);
        return;
      }
      handles?.update(next);
    },
    animate(deltaSeconds: number) {
      handles?.animate(deltaSeconds);
    },
  };
}

interface FixtureHandles {
  group: THREE.Group;
  update: (props: FurnitureBuildProps) => void;
  animate: (deltaSeconds: number) => void;
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

/** Builds the full fixture SET for one `unlockedAreas` signature. Called
 * again from scratch only when that signature changes. */
function buildFixtureSet(renderer: THREE.WebGLRenderer, deliveredAssets: DeliveredStockAssets, props: FurnitureBuildProps): FixtureHandles {
  const group = new THREE.Group();
  const machine = machineFinder(props.machines);
  const fixtureCapacity = fixtureCapacityOf(props);
  const { unlockedAreas } = props;

  const updaters: Array<(props: FurnitureBuildProps) => void> = [];
  const animators: Array<(delta: number) => void> = [];
  const add = (element: THREE.Object3D) => group.add(element);

  if (fixtureAvailable("fixture:retail-preserves-1", unlockedAreas)) {
    const element = makeStoreElement(retailDisplayPosition("preserves"), RETAIL_DEPARTMENTS.preserves.yaw);
    const gondola = buildGondola(renderer, { position: [0, 0, 0], productId: "cannedCorn", count: props.shelves.cannedCorn ?? 0, capacity: fixtureCapacity("cannedCorn") });
    element.add(gondola.group);
    add(element);
    updaters.push((next) => gondola.update(next.shelves.cannedCorn ?? 0, fixtureCapacityOf(next)("cannedCorn")));
  }

  if (fixtureAvailable("fixture:retail-bakery-1", unlockedAreas)) {
    const element = makeStoreElement(retailDisplayPosition("bakery"), RETAIL_DEPARTMENTS.bakery.yaw);
    const bakeryStock = () => ({ bread: props.shelves.bread ?? 0, flour: props.shelves.flour ?? 0, wheat: props.shelves.wheat ?? 0 });
    const bakeryCapacity = () => ({ bread: fixtureCapacity("bread"), flour: fixtureCapacity("flour"), wheat: fixtureCapacity("wheat") });
    const bakery = buildBakeryDisplay(renderer, { stock: bakeryStock(), capacity: bakeryCapacity() });
    element.add(bakery.group);
    add(element);
    updaters.push((next) => {
      const capacity = fixtureCapacityOf(next);
      bakery.update({ bread: next.shelves.bread ?? 0, flour: next.shelves.flour ?? 0, wheat: next.shelves.wheat ?? 0 }, { bread: capacity("bread"), flour: capacity("flour"), wheat: capacity("wheat") });
    });
  }

  if (fixtureAvailable("fixture:retail-pantry-1", unlockedAreas)) {
    PANTRY_DISPLAY_POSITIONS.forEach((position, index) => {
      const element = makeStoreElement([...position], RETAIL_DEPARTMENTS.pantry.yaw);
      const gondola = buildGondola(renderer, { position: [0, 0, 0], count: distributedFixtureQuantity(props.shelves.coffee ?? 0, index, PANTRY_DISPLAY_POSITIONS.length), capacity: fixtureCapacity("coffee", index) });
      element.add(gondola.group);
      add(element);
      updaters.push((next) => gondola.update(distributedFixtureQuantity(next.shelves.coffee ?? 0, index, PANTRY_DISPLAY_POSITIONS.length), fixtureCapacityOf(next)("coffee", index)));
    });
  }

  if (fixtureAvailable("fixture:retail-eggs-1", unlockedAreas)) {
    const element = makeStoreElement(retailDisplayPosition("eggs"), RETAIL_DEPARTMENTS.eggs.yaw);
    const eggs = buildEggDisplay(renderer, deliveredAssets, { count: props.shelves.eggs ?? 0, capacity: fixtureCapacity("eggs") });
    element.add(eggs.group);
    add(element);
    updaters.push((next) => eggs.update(next.shelves.eggs ?? 0, fixtureCapacityOf(next)("eggs")));
  }

  retailFixtureDisplayPositions("produce", unlockedAreas).forEach((position, index, fixtures) => {
    const element = makeStoreElement([...position], RETAIL_DEPARTMENTS.produce.yaw);
    const produceStock = (source: FurnitureBuildProps) => Object.fromEntries(RETAIL_DEPARTMENTS.produce.products.map((productId) => [productId, distributedFixtureQuantity(source.shelves[productId] ?? 0, index, fixtures.length)]));
    const produceCapacity = (source: FurnitureBuildProps) => Object.fromEntries(RETAIL_DEPARTMENTS.produce.products.map((productId) => [productId, distributedFixtureQuantity(shelfCapacityForTier(source.shelfTier, productId, source.unlockedAreas), index, fixtures.length)]));
    const table = buildProduceTable({ position: [0, 0, 0], stock: produceStock(props), capacity: produceCapacity(props) });
    element.add(table.group);
    add(element);
    updaters.push((next) => table.update(produceStock(next), produceCapacity(next)));
  });

  if (fixtureAvailable("fixture:retail-dairy-1", unlockedAreas)) {
    const element = makeStoreElement(retailDisplayPosition("dairy"), RETAIL_DEPARTMENTS.dairy.yaw);
    const dairyStock = () => ({ milk: props.shelves.milk ?? 0, cheese: props.shelves.cheese ?? 0 });
    const dairyCapacity = () => ({ milk: fixtureCapacity("milk"), cheese: fixtureCapacity("cheese") });
    const chilled = buildChilledDisplay(renderer, deliveredAssets, { position: [0, 0, 0], stock: dairyStock(), capacity: dairyCapacity(), open: coldDoorActiveOf(props) });
    element.add(chilled.group);
    add(element);
    updaters.push((next) => {
      const capacity = fixtureCapacityOf(next);
      chilled.update({ milk: next.shelves.milk ?? 0, cheese: next.shelves.cheese ?? 0 }, { milk: capacity("milk"), cheese: capacity("cheese") }, coldDoorActiveOf(next));
    });
    if (chilled.animate) animators.push(chilled.animate);
  }

  if (fixtureAvailable("fixture:retail-drinks-1", unlockedAreas)) {
    const element = makeStoreElement(retailDisplayPosition("drinks"), RETAIL_DEPARTMENTS.drinks.yaw);
    const drinks = buildDrinksDisplay(renderer, { position: [0, 0, 0], count: props.shelves.juice ?? 0, capacity: fixtureCapacity("juice") });
    element.add(drinks.group);
    add(element);
    updaters.push((next) => drinks.update(next.shelves.juice ?? 0, fixtureCapacityOf(next)("juice")));
  }

  for (const lane of CHECKOUT_LANE_IDS as readonly CheckoutLane[]) {
    if (lane === 0 || unlockedAreas.includes(checkoutAreaForLane(lane))) {
      const counter = makeStoreElement([...CHECKOUT_LANES[lane].counter]);
      const cashierSpot = makeStoreElement([...CHECKOUT_LANES[lane].cashierWork]);
      const kit = buildCheckoutKit(lane);
      counter.add(kit.group);
      cashierSpot.add(buildCashierWorkArea());
      add(counter);
      add(cashierSpot);
      const laneUpdate = (next: FurnitureBuildProps) => {
        const active = activeCheckoutForLane(next.checkoutTransactions, lane);
        const handoff = checkoutHandoffForLane(next.checkoutTransactions, lane, next.customers);
        const handoffLocation = checkoutBagLocation(handoff, next.customers);
        kit.update(active, handoff, handoffLocation === "counter");
      };
      laneUpdate(props);
      updaters.push(laneUpdate);
      animators.push(kit.animate);
    } else if (!unlockedAreas.includes("purchase-campaign")) {
      const counter = makeStoreElement([...CHECKOUT_LANES[lane].counter]);
      counter.add(buildClosedCheckoutKit(lane));
      add(counter);
    }
  }

  {
    const element = makeStoreElement([...STORE_SERVICE_FIXTURES.returns.position]);
    const returns = buildReturnsCubicle();
    element.add(returns.group);
    add(element);
    returns.update(props.returnsBin);
    updaters.push((next) => returns.update(next.returnsBin));
  }

  {
    const element = makeStoreElement([...STORE_SERVICE_FIXTURES.cartBay.position]);
    const cartBay = buildCartBay([0, 0, 0]);
    element.add(cartBay.group);
    add(element);
    cartBay.update(props.returnedCartCount);
    updaters.push((next) => cartBay.update(next.returnedCartCount));
  }

  if (fixtureAvailable("fixture:production-cubicle-shell", unlockedAreas)) add(buildProductionCubicle());

  if (fixtureAvailable("fixture:bread-oven", unlockedAreas)) {
    const element = makeStoreElement([...STORE_PRODUCTION_FIXTURES.breadOven.position]);
    const bakery = buildBakeryKit([0, 0, 0]);
    element.add(bakery.group);
    add(element);
    bakery.update(machine("bread-oven-1"));
    updaters.push((next) => bakery.update(machineFinder(next.machines)("bread-oven-1")));
  }
  if (fixtureAvailable("fixture:flour-mill", unlockedAreas)) {
    const element = makeStoreElement([...STORE_PRODUCTION_FIXTURES.flourMill.position]);
    const mill = buildMillMachine([0, 0, 0]);
    element.add(mill.group);
    add(element);
    mill.update(machine("flour-mill-1"));
    updaters.push((next) => mill.update(machineFinder(next.machines)("flour-mill-1")));
  }
  if (fixtureAvailable("fixture:cheese-maker", unlockedAreas)) {
    const element = makeStoreElement([...STORE_PRODUCTION_FIXTURES.cheeseMaker.position]);
    const cheeseMaker = buildProcessMachine("cheese", [0, 0, 0]);
    element.add(cheeseMaker.group);
    add(element);
    cheeseMaker.update(machine("cheese-maker-1"));
    updaters.push((next) => cheeseMaker.update(machineFinder(next.machines)("cheese-maker-1")));
  }
  if (fixtureAvailable("fixture:juice-machine", unlockedAreas)) {
    const element = makeStoreElement([...STORE_PRODUCTION_FIXTURES.juiceMachine.position]);
    const juiceMachine = buildProcessMachine("juice", [0, 0, 0]);
    element.add(juiceMachine.group);
    add(element);
    juiceMachine.update(machine("juice-machine-1"));
    updaters.push((next) => juiceMachine.update(machineFinder(next.machines)("juice-machine-1")));
  }
  if (fixtureAvailable("fixture:corn-canner", unlockedAreas)) {
    const element = makeStoreElement([...STORE_PRODUCTION_FIXTURES.cornCanner.position]);
    const canner = buildCornCanner();
    element.add(canner.group);
    add(element);
    canner.update(machine("corn-canner-1"));
    updaters.push((next) => canner.update(machineFinder(next.machines)("corn-canner-1")));
  }

  {
    const element = makeStoreElement([...STORE_SERVICE_FIXTURES.orders.position]);
    element.add(buildSupplierCorner([0, 0, 0]));
    add(element);
  }
  {
    const element = makeStoreElement([...WAREHOUSE_RETURN_STATION.position]);
    element.add(buildWarehouseReturnBasket());
    add(element);
  }

  const utilities = buildStoreUtilities(props.lightsOn, props.dynamicCeilingLights);
  add(utilities.group);
  updaters.push((next) => utilities.update(next.lightsOn, next.dynamicCeilingLights));

  return {
    group,
    update(next: FurnitureBuildProps) {
      for (const updater of updaters) updater(next);
    },
    animate(deltaSeconds: number) {
      for (const animator of animators) animator(deltaSeconds);
    },
  };
}

function disposeGroup(group: THREE.Group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
  });
}
