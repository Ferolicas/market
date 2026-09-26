import * as THREE from "three";
import { STORE_SERVICE_FIXTURES } from "@/game/stations/store-service-layout";
import { WAREHOUSE_RETURN_STATION } from "@/game/stations/warehouse-layout";
import { budgetPath, loadGltf } from "../../WorldAssets";
import { makeBox, makeInstances, makeText, palette, type InstanceTransform, type Position } from "../primitives";

/**
 * Faithful port of `SupplierCorner`, `WarehouseReturnBasket`, `TerminalModel`,
 * `Pallet` and `Parcel` from MarketKit.tsx (lines ~949-1006). Neither fixture
 * takes a live prop in `KitFurniture`'s usage (`<MemoSupplierCorner
 * position={[0, 0, 0]} />`, `<MemoWarehouseReturnBasket />`), so both
 * builders here are fully static — no `update()`.
 */

const unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
const returnBasketSlatMaterial = new THREE.MeshStandardMaterial({ color: "#c9955b", roughness: 0.9 });

function buildTerminalModel(position: Position, label: string): THREE.Group {
  const group = new THREE.Group();
  group.position.set(...position);
  group.add(makeBox({ args: [1.18, 0.82, 0.62], position: [0, 0.41, 0], color: palette.darkGreen, radius: 0.11 }));
  group.add(makeBox({ args: [1.38, 0.12, 0.76], position: [0, 0.86, 0.04], color: palette.cream, radius: 0.055 }));
  group.add(makeBox({ args: [0.76, 0.1, 0.48], position: [0, 0.96, 0.08], color: "#303b38", radius: 0.035 }));

  const buttonGeometry = new THREE.BoxGeometry(0.09, 0.025, 0.18);
  const buttonMaterial = new THREE.MeshStandardMaterial({ color: "#85938d", roughness: 0.58, metalness: 0.12 });
  for (const x of [-0.24, -0.08, 0.08, 0.24]) {
    const button = new THREE.Mesh(buttonGeometry, buttonMaterial);
    button.position.set(x, 1.025, 0.16);
    button.rotation.set(-0.25, 0, 0);
    group.add(button);
  }

  group.add(makeBox({ args: [0.76, 0.64, 0.1], position: [0, 1.38, 0.03], rotation: [-0.14, 0, 0], color: "#202b28", radius: 0.06 }));

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.48), new THREE.MeshStandardMaterial({ color: "#c7eadc", emissive: "#40806a", emissiveIntensity: 0.34, roughness: 0.45 }));
  screen.position.set(0, 1.39, 0.091);
  screen.rotation.set(-0.14, 0, 0);
  group.add(screen);

  const labelText = makeText({ text: label, position: [0, 1.42, 0.101], fontSize: 0.105, color: "#173f35", anchorX: "center", anchorY: "middle", fontWeight: 800 });
  labelText.rotation.set(-0.14, 0, 0);
  group.add(labelText);

  const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 7), new THREE.MeshBasicMaterial({ color: "#8ce0a6", toneMapped: false }));
  indicator.position.set(-0.48, 0.63, 0.32);
  group.add(indicator);

  return group;
}

function buildPallet(position: Position): THREE.Group {
  const group = new THREE.Group();
  group.position.set(...position);
  for (const z of [-0.32, 0, 0.32]) group.add(makeBox({ args: [1.1, 0.09, 0.18], position: [0, 0.09, z], color: palette.wood }));
  for (const x of [-0.43, 0, 0.43]) group.add(makeBox({ args: [0.16, 0.11, 0.82], position: [x, 0.02, 0], color: "#754c2f" }));
  return group;
}

function buildParcel(position: Position, small = false): THREE.Group {
  const group = new THREE.Group();
  group.position.set(...position);
  group.scale.setScalar(small ? 0.72 : 1);
  group.add(makeBox({ args: [0.52, 0.44, 0.46], position: [0, 0.22, 0], color: "#ba8050", radius: 0.025 }));
  group.add(makeBox({ args: [0.08, 0.45, 0.47], position: [0, 0.23, 0], color: "#d5ad70", radius: 0.01 }));
  return group;
}

/**
 * Orders block on the rear wall: the PEDIDOS terminal faces the sales floor
 * while the delivery dock and pallet back onto the wall behind it, matching
 * `SupplierCorner`'s comment in the source verbatim.
 */
export function buildSupplierCorner(position: Position): THREE.Group {
  const group = new THREE.Group();
  group.name = STORE_SERVICE_FIXTURES.orders.obstacleId;
  group.position.set(...position);

  group.add(buildTerminalModel([0, 0, 0.62], "PEDIDOS"));

  const dock = new THREE.Group();
  dock.position.set(0, 0.52, -0.9);
  dock.scale.setScalar(0.72);
  loadGltf(budgetPath("environment", "equipment_delivery_dock")).then((gltf) => {
    const model = gltf.scene.clone(true);
    model.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    dock.add(model);
  }).catch(() => {});
  group.add(dock);

  group.add(buildPallet([-0.05, 0, -0.68]));
  group.add(buildParcel([-0.3, 0.34, -0.68]));
  group.add(buildParcel([0.25, 0.34, -0.68], true));
  group.add(buildParcel([0.05, 0.73, -0.68]));

  return group;
}

/**
 * Worker return crate beside the farm door — see the source's own comment:
 * the owner/player empties their complete basket through its proximity
 * magnet, automated stockers use it for shelf overflow, and customers never
 * interact with it.
 */
export function buildWarehouseReturnBasket(): THREE.Group {
  const group = new THREE.Group();
  group.name = WAREHOUSE_RETURN_STATION.obstacleId;

  group.add(makeBox({ args: [1.04, 0.06, 0.4], position: [0, 0.03, 0], color: palette.wood, radius: 0.018 }));
  for (const side of [-1, 1] as const) group.add(makeBox({ args: [0.045, 0.9, 0.4], position: [side * 0.5, 0.51, 0], color: palette.wood, radius: 0.012 }));
  for (const side of [-1, 1] as const) group.add(makeBox({ args: [1.04, 0.9, 0.045], position: [0, 0.51, side * 0.18], color: palette.wood, radius: 0.012 }));
  for (const x of [-0.5, 0, 0.5]) group.add(makeBox({ args: [0.06, 0.96, 0.06], position: [x, 0.48, 0.2], color: "#7a5230", radius: 0.01 }));

  const slats: InstanceTransform[] = [0.18, 0.4, 0.62, 0.84].map((y) => ({ position: [0, y, 0], scale: [1.08, 0.03, 0.42] }));
  group.add(makeInstances(slats, unitBoxGeometry, returnBasketSlatMaterial));

  group.add(makeBox({ args: [0.98, 0.02, 0.34], position: [0, 0.08, 0], color: "#8c6a3f", radius: 0.006 }));
  group.add(makeBox({ args: [0.035, 1.34, 0.035], position: [-0.62, 0.67, -0.14], color: palette.frame, radius: 0.008 }));
  group.add(makeBox({ args: [0.62, 0.26, 0.03], position: [-0.62, 1.42, -0.14], color: "#173f35", radius: 0.02 }));
  group.add(makeText({ text: "DEVOLVER", position: [-0.62, 1.46, -0.122], fontSize: 0.075, color: "#fff3ce", anchorX: "center", anchorY: "middle", fontWeight: 800 }));
  group.add(makeText({ text: "AL ALMACÉN", position: [-0.62, 1.375, -0.122], fontSize: 0.058, color: "#9fd8c0", anchorX: "center", anchorY: "middle", fontWeight: 800 }));

  return group;
}
