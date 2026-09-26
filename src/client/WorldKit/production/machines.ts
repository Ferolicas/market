import * as THREE from "three";
import type { ProductId, ProductionMachineState } from "@/game/types";
import { PRODUCTS } from "@/game/catalog";
import { PRODUCT_CONFIG } from "@/game/economy/products";
import { machineInputCapacity } from "@/game/stations/StationSystem";
import { STORE_PRODUCTION_FIXTURES, type ProductionFixtureLayout } from "@/game/stations/production-layout";
import { cornLabelGeometry, cornLabelMaterial, cornTinGeometry, cornTinMaterial } from "@/components/game/CannedCornModel";
import { budgetPath, loadGltf } from "../../WorldAssets";
import { makeBox, makeText, updateText, type Position } from "../primitives";

/**
 * Faithful port of `machineStatus`, `ProductionMachineIdentity`, `BakeryKit`,
 * `MillMachine`, `ProcessMachine`, `CornCanner` from MarketKit.tsx
 * (lines ~861-947). The housing (plinth, board frame, pipes, static
 * decoration, delivered/environment GLBs) is built once; only the status
 * board's `dynamic:machine-status` texts, the processing point light and the
 * `dynamic:machine-output` product slots read `ProductionMachineState` and
 * are refreshed through each handle's `update(machine)`.
 */

export interface MachineHandle {
  group: THREE.Group;
  update(machine?: ProductionMachineState): void;
}

export function machineStatus(machine?: ProductionMachineState): { label: string; color: string } {
  if (!machine || machine.status === "LOCKED") return { label: "BLOQUEADA", color: "#9ea7a3" };
  if (machine.output > 0 || machine.status === "OUTPUT_READY" || machine.status === "FULL") return { label: "RECOGER", color: "#54d998" };
  if (machine.status === "PROCESSING") return { label: "EN PROCESO", color: "#f0ad55" };
  return { label: "CARGAR", color: "#7fc8e8" };
}

/** `attachModel`: the imperative equivalent of `DeliveredModel`/
 * `EnvironmentModel` used with no `onFrame`/`onUpdate`/`isolateMaterials` —
 * both set `castShadow`/`receiveShadow` on every mesh unconditionally. The
 * anchor group is returned immediately (synchronous API for the builders
 * below); the GLB is cloned in once its load resolves. */
function attachModel(family: "delivered" | "environment", file: string, position: Position, scale = 1): THREE.Group {
  const anchor = new THREE.Group();
  anchor.position.set(...position);
  anchor.scale.setScalar(scale);
  loadGltf(budgetPath(family, file)).then((gltf) => {
    const model = gltf.scene.clone(true);
    model.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    anchor.add(model);
  }).catch(() => {});
  return anchor;
}

interface MachineIdentityHandle { group: THREE.Group; update(machine?: ProductionMachineState): void; }

/** `ProductionMachineIdentity`: the plinth + top plate + the single readable
 * board every production fixture shares (what it is, what it has ready, what
 * is queued, and what it is waiting for). */
function buildMachineIdentity(fixture: ProductionFixtureLayout): MachineIdentityHandle {
  const group = new THREE.Group();
  group.add(makeBox({ args: [1.22, 0.13, 1.05], position: [0, 0.065, -0.53], color: "#55635f", radius: 0.035 }));
  group.add(makeBox({ args: [1.08, 0.06, 0.9], position: [0, 0.145, -0.53], color: "#c7ceca", radius: 0.02 }));

  const board = new THREE.Group();
  board.position.set(0, 2.3, 0.12);
  board.add(makeBox({ args: [1.52, 1.1, 0.12], color: "#223832", radius: 0.06 }));
  board.add(makeText({ text: fixture.label, position: [0, 0.39, 0.068], fontSize: 0.19, color: "#fff5d8", anchorX: "center", anchorY: "middle", fontWeight: 900 }));
  board.add(makeText({ text: fixture.processLabel, position: [0, 0.22, 0.069], fontSize: 0.082, color: fixture.accent, anchorX: "center", anchorY: "middle", fontWeight: 800 }));

  const statusGroup = new THREE.Group();
  statusGroup.name = "dynamic:machine-status";
  statusGroup.add(makeText({ text: "LISTO", position: [-0.63, 0, 0.07], fontSize: 0.13, color: "#bcd9cc", anchorX: "left", anchorY: "middle", fontWeight: 800 }));
  const outputText = makeText({ text: "0/0", position: [0.63, 0, 0.07], fontSize: 0.26, color: "#ffffff", anchorX: "right", anchorY: "middle", fontWeight: 900 });
  statusGroup.add(outputText);
  const ingredientText = makeText({ text: "COLA", position: [-0.63, -0.22, 0.07], fontSize: 0.11, color: "#bcd9cc", anchorX: "left", anchorY: "middle", fontWeight: 800 });
  statusGroup.add(ingredientText);
  const queuedText = makeText({ text: "0/0", position: [0.63, -0.22, 0.07], fontSize: 0.17, color: "#ffffff", anchorX: "right", anchorY: "middle", fontWeight: 900 });
  statusGroup.add(queuedText);
  const statusLabelText = makeText({ text: "BLOQUEADA", position: [0.63, -0.43, 0.07], fontSize: 0.155, color: "#9ea7a3", anchorX: "right", anchorY: "middle", fontWeight: 900 });
  statusGroup.add(statusLabelText);
  const statusDotMaterial = new THREE.MeshBasicMaterial({ color: "#9ea7a3", toneMapped: false });
  const statusDot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), statusDotMaterial);
  statusDot.position.set(-0.6, -0.43, 0.07);
  statusGroup.add(statusDot);
  board.add(statusGroup);

  const backLabel = makeText({ text: fixture.label, position: [0, 0.39, -0.068], fontSize: 0.19, color: "#fff5d8", anchorX: "center", anchorY: "middle", fontWeight: 900 });
  backLabel.rotation.set(0, Math.PI, 0);
  board.add(backLabel);

  group.add(board);

  function update(machine?: ProductionMachineState) {
    const status = machineStatus(machine);
    const ingredient = machine ? (Object.keys(PRODUCT_CONFIG[machine.productId]?.recipe ?? {})[0] as ProductId | undefined) : undefined;
    const queued = machine && ingredient
      ? (machine.input[ingredient] ?? 0) + Number(machine.status === "PROCESSING") * Number(PRODUCT_CONFIG[machine.productId]?.recipe?.[ingredient] ?? 0)
      : 0;
    const queueCapacity = machine && ingredient ? machineInputCapacity(machine, ingredient) : 0;
    updateText(outputText, { text: `${machine?.output ?? 0}/${machine?.outputCapacity ?? 0}`, color: machine && machine.output > 0 ? "#8ce6a1" : "#ffffff" });
    updateText(ingredientText, { text: ingredient ? PRODUCTS[ingredient].name.toUpperCase() : "COLA" });
    updateText(queuedText, { text: `${queued}/${queueCapacity}`, color: queued > 0 ? "#ffd98a" : "#ffffff" });
    updateText(statusLabelText, { text: status.label, color: status.color });
    statusDotMaterial.color.set(status.color);
  }
  update(undefined);
  return { group, update };
}

export function buildBakeryKit(position: Position): MachineHandle {
  const fixture = STORE_PRODUCTION_FIXTURES.breadOven;
  const group = new THREE.Group();
  group.position.set(...position);
  const identity = buildMachineIdentity(fixture);
  group.add(identity.group);
  group.add(attachModel("delivered", "oven", [0, 0.175, -0.55]));
  const processingLight = new THREE.PointLight("#df8b43", 0.8, 2.2);
  processingLight.position.set(0, 0.95, 0.52);
  processingLight.visible = false;
  group.add(processingLight);

  function update(machine?: ProductionMachineState) {
    identity.update(machine);
    processingLight.visible = machine?.status === "PROCESSING";
  }
  update(undefined);
  return { group, update };
}

export function buildMillMachine(position: Position): MachineHandle {
  const fixture = STORE_PRODUCTION_FIXTURES.flourMill;
  const group = new THREE.Group();
  group.position.set(...position);
  const identity = buildMachineIdentity(fixture);
  group.add(identity.group);
  group.add(attachModel("delivered", "mill", [0, 0.175, -0.58]));

  function update(machine?: ProductionMachineState) {
    identity.update(machine);
  }
  update(undefined);
  return { group, update };
}

const JUICE_BOTTLE_GEOMETRY = new THREE.CylinderGeometry(0.055, 0.064, 0.22, 10);
const JUICE_CAP_GEOMETRY = new THREE.CylinderGeometry(0.03, 0.034, 0.055, 9);
const JUICE_LABEL_GEOMETRY = new THREE.PlaneGeometry(0.075, 0.09);
const JUICE_BOTTLE_MATERIAL = new THREE.MeshStandardMaterial({ color: "#ee8643", roughness: 0.58 });
const JUICE_CAP_MATERIAL = new THREE.MeshStandardMaterial({ color: "#438653", roughness: 0.6 });
const JUICE_LABEL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#fff0c6" });

/** `RetailProduct(productId="juice")`: a bottle, cap and label — juice is
 * NOT one of `deliveredProductId`'s three SKUs (milk/cheese/eggs), so it
 * never takes the delivered-GLB branch, unlike cheese below. */
function buildJuiceBottle(): THREE.Group {
  const group = new THREE.Group();
  const bottle = new THREE.Mesh(JUICE_BOTTLE_GEOMETRY, JUICE_BOTTLE_MATERIAL);
  bottle.castShadow = true;
  group.add(bottle);
  const cap = new THREE.Mesh(JUICE_CAP_GEOMETRY, JUICE_CAP_MATERIAL);
  cap.position.set(0, 0.135, 0);
  group.add(cap);
  const label = new THREE.Mesh(JUICE_LABEL_GEOMETRY, JUICE_LABEL_MATERIAL);
  label.position.set(0, 0, 0.061);
  group.add(label);
  return group;
}

function outputItemPosition(index: number): Position {
  return [0.34 + (index % 2) * 0.13, 0.16 + Math.floor(index / 2) * 0.12, 0.45];
}

export function buildProcessMachine(kind: "cheese" | "juice", position?: Position): MachineHandle {
  const fixture = kind === "cheese" ? STORE_PRODUCTION_FIXTURES.cheeseMaker : STORE_PRODUCTION_FIXTURES.juiceMachine;
  const group = new THREE.Group();
  if (position) group.position.set(...position);
  const identity = buildMachineIdentity(fixture);
  group.add(identity.group);

  if (kind === "cheese") {
    // `EnvironmentModel id="equipment_cheese_maker"`, plus the static pole,
    // top bar and vat drawn straight into the group in the source.
    group.add(attachModel("environment", "equipment_cheese_maker", [0, 0, 0]));
    group.add(makeBox({ args: [0.09, 0.78, 0.09], position: [-0.4, 1.18, -0.35], color: "#4c5855", radius: 0.012 }));
    group.add(makeBox({ args: [0.88, 0.1, 0.12], position: [0, 1.52, -0.35], color: "#4c5855", radius: 0.015 }));
    const vat = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.16, 18), new THREE.MeshStandardMaterial({ color: "#e7b938", roughness: 0.72 }));
    vat.position.set(0, 0.58, 0.08);
    vat.rotation.set(Math.PI / 2, 0, 0);
    group.add(vat);
  } else {
    group.add(attachModel("delivered", "juicer", [0, 0.175, -0.55]));
  }

  const processingLight = new THREE.PointLight(kind === "cheese" ? "#ffd75c" : "#ff6b43", 0.45, 1.6);
  processingLight.position.set(0, 0.65, 0.45);
  processingLight.visible = false;
  group.add(processingLight);

  const outputGroup = new THREE.Group();
  outputGroup.name = "dynamic:machine-output";
  const slots: THREE.Object3D[] = [];
  for (let index = 0; index < 4; index += 1) {
    const slotPosition = outputItemPosition(index);
    let slot: THREE.Object3D;
    if (kind === "cheese") {
      // `RetailProduct(productId="cheese")`: `deliveredProductId("cheese")`
      // is truthy, so the source renders the real delivered "cheese" GLB
      // here, not the low-poly wedge mesh further down `RetailProduct`.
      slot = attachModel("delivered", "cheese", slotPosition, 0.8);
    } else {
      slot = buildJuiceBottle();
      slot.position.set(...slotPosition);
      slot.scale.setScalar(0.8);
    }
    slot.visible = false;
    outputGroup.add(slot);
    slots.push(slot);
  }
  group.add(outputGroup);

  function update(machine?: ProductionMachineState) {
    identity.update(machine);
    processingLight.visible = machine?.status === "PROCESSING";
    const visibleCount = Math.min(4, machine?.output ?? 0);
    slots.forEach((slot, index) => { slot.visible = index < visibleCount; });
  }
  update(undefined);
  return { group, update };
}

function buildCannedCornGroup(): THREE.Group {
  const can = new THREE.Group();
  can.name = "product:cannedCorn";
  const tin = new THREE.Mesh(cornTinGeometry, cornTinMaterial);
  tin.castShadow = true;
  const label = new THREE.Mesh(cornLabelGeometry, cornLabelMaterial);
  can.add(tin, label);
  return can;
}

export function buildCornCanner(): MachineHandle {
  const fixture = STORE_PRODUCTION_FIXTURES.cornCanner;
  const group = new THREE.Group();
  group.name = "fixture:corn-canner";
  const identity = buildMachineIdentity(fixture);
  group.add(identity.group);
  group.add(makeBox({ args: [1.2, 0.85, 1.1], position: [0, 0.6, -0.55], color: "#97aaa4", radius: 0.04 }));
  group.add(makeBox({ args: [1.1, 0.12, 0.7], position: [0, 1.09, -0.48], color: "#334840", radius: 0.02 }));
  group.add(makeBox({ args: [0.14, 0.65, 0.14], position: [0.4, 1.45, -0.8], color: "#65833d", radius: 0.02 }));
  group.add(makeBox({ args: [0.65, 0.15, 0.4], position: [0.12, 1.74, -0.65], color: "#65833d", radius: 0.02 }));
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.35, 12), new THREE.MeshStandardMaterial({ color: "#c2cdca", metalness: 0.6, roughness: 0.4 }));
  pipe.position.set(-0.03, 1.47, -0.55);
  group.add(pipe);
  const indicatorMaterial = new THREE.MeshStandardMaterial({ color: "#d1ae56" });
  const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), indicatorMaterial);
  indicator.position.set(0.44, 0.85, 0.012);
  group.add(indicator);

  const outputGroup = new THREE.Group();
  outputGroup.name = "dynamic:machine-output";
  const cans: THREE.Group[] = [];
  for (let index = 0; index < 4; index += 1) {
    const can = buildCannedCornGroup();
    can.position.set(-0.4 + index * 0.2, 1.26, -0.3);
    can.visible = false;
    outputGroup.add(can);
    cans.push(can);
  }
  group.add(outputGroup);

  const staticCan = buildCannedCornGroup();
  staticCan.position.set(-0.03, 1.26, -0.55);
  group.add(staticCan);

  function update(machine?: ProductionMachineState) {
    identity.update(machine);
    indicatorMaterial.color.set(machine?.status === "PROCESSING" ? "#77e686" : "#d1ae56");
    const visibleCount = Math.min(4, machine?.output ?? 0);
    cans.forEach((can, index) => { can.visible = index < visibleCount; });
  }
  update(undefined);
  return { group, update };
}
