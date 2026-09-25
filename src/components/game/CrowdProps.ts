import * as THREE from "three";
import type { ProductId } from "@/game/types";
import { localMatrix, nestParts, type InstancedPart } from "@/game/render/CrowdParts";
import { HARVEST_BASKET_GRIP_HALF_WIDTH, HARVEST_BASKET_GRIP_HEIGHT, HARVEST_BASKET_GRIP_REACH } from "@/game/animation/CarrySocket";
import { basketGeometry, basketMaterial, productGeometry, productMaterial } from "./HarvestBasket";
import { cornLabelGeometry, cornLabelMaterial, cornTinGeometry, cornTinMaterial } from "./CannedCornModel";
import { CART_CASTER_GEOMETRY, CART_CASTER_POSITIONS, CART_DARK_METAL_MATERIAL, CART_FRAME_DARK_GEOMETRY, CART_FRAME_METAL_GEOMETRY, CART_GRIP_MATERIAL, CART_HANDLE_END_GEOMETRY, CART_HANDLE_GRIP_GEOMETRY, CART_HANDLE_Y, CART_HANDLE_Z, CART_METAL_MATERIAL, CART_PANEL_GEOMETRY, CART_PANEL_MATERIAL, CART_WHEEL_ASSEMBLY_GEOMETRY, CART_WHEEL_MATERIAL, CART_BOX_GEOMETRY } from "./CustomerPresentation";

/**
 * The same shapes the per-character components build, as part lists the
 * crowd renderer can instance. Kept next to those components so a change in
 * a prop's look lands in both paths.
 */

/** A product unit as `BasketProduct` draws it (delivered SKUs come from their
 * GLB at runtime, see `deliveredProductParts`). */
export function basketProductParts(productId: ProductId): InstancedPart[] | null {
  switch (productId) {
    case "cannedCorn":
      return [
        { geometry: cornTinGeometry, material: cornTinMaterial, local: localMatrix() },
        { geometry: cornLabelGeometry, material: cornLabelMaterial, local: localMatrix() },
      ];
    case "oranges":
      return [{ geometry: productGeometry.orange, material: productMaterial.orange, local: localMatrix() }];
    case "tomatoes":
      return [
        { geometry: productGeometry.fruit, material: productMaterial.tomato, local: localMatrix([0, 0, 0], [0, 0, 0], [1, 0.86, 1]) },
        { geometry: productGeometry.tomatoCrown, material: productMaterial.crown, local: localMatrix([0, 0.075, 0], [0, 0, Math.PI]) },
      ];
    case "apples":
      return [
        { geometry: productGeometry.fruit, material: productMaterial.apple, local: localMatrix([0, 0, 0], [0, 0, 0], [0.9, 1, 0.9]) },
        { geometry: productGeometry.appleCrown, material: productMaterial.crown, local: localMatrix([0, 0.075, 0], [0, 0, Math.PI]) },
      ];
    case "corn":
      return [
        { geometry: productGeometry.cornBody, material: productMaterial.corn, local: localMatrix([0, 0, 0], [0, 0, 0.16], [0.68, 1.28, 0.68]) },
        ...[-1, 1].map((side) => ({ geometry: productGeometry.cornHusk, material: productMaterial.husk, local: new THREE.Matrix4().multiplyMatrices(localMatrix([0, 0, 0], [0, 0, 0.16]), localMatrix([side * 0.048, -0.015, 0], [0, 0, side * 0.48], [0.44, 1.1, 0.32])) })),
      ];
    case "wheat":
      return [-0.045, 0, 0.045].flatMap((x, index) => {
        const stalk = localMatrix([x, 0, (index - 1) * 0.012], [0, 0, (index - 1) * 0.1]);
        return [
          { geometry: productGeometry.wheatStem, material: productMaterial.wheatStem, local: new THREE.Matrix4().multiplyMatrices(stalk, localMatrix([0, 0.04, 0])) },
          { geometry: productGeometry.wheatHead, material: productMaterial.wheatHead, local: new THREE.Matrix4().multiplyMatrices(stalk, localMatrix([0, 0.145, 0], [0, 0, 0], [0.65, 1.25, 0.65])) },
        ];
      });
    case "eggs":
      return [{ geometry: productGeometry.egg, material: productMaterial.egg, local: localMatrix([0, 0, 0], [0, 0, 0], [0.72, 1.02, 0.72]) }];
    case "milk":
    case "juice":
      return [
        { geometry: productGeometry.bottle, material: productId === "milk" ? productMaterial.milk : productMaterial.juice, local: localMatrix() },
        { geometry: productGeometry.bottleCap, material: productId === "milk" ? productMaterial.milkCap : productMaterial.juiceCap, local: localMatrix([0, 0.108, 0]) },
      ];
    case "cheese":
      return [{ geometry: productGeometry.cheese, material: productMaterial.cheese, local: localMatrix([0, 0, 0], [0, 0, Math.PI / 2]) }];
    case "bread":
      return [{ geometry: productGeometry.bread, material: productMaterial.bread, local: localMatrix() }];
    case "coffee":
      return [{ geometry: productGeometry.pack, material: productMaterial.coffee, local: localMatrix() }];
    case "flour":
      return [{ geometry: productGeometry.pack, material: productMaterial.flour, local: localMatrix() }];
    default:
      return null;
  }
}

/** Parts of a delivered SKU's GLB scene, baked into the model's root space. */
export function deliveredProductParts(scene: THREE.Group, scale = 0.8): InstancedPart[] {
  scene.updateWorldMatrix(true, true);
  const parts: InstancedPart[] = [];
  const outer = localMatrix([0, 0, 0], [0, 0, 0], scale);
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) parts.push({ geometry: node.geometry, material: node.material, local: new THREE.Matrix4().multiplyMatrices(outer, node.matrixWorld) });
  });
  return parts;
}

/** Hat or hair GLB scene as parts in its own root space. */
export function accessoryParts(scene: THREE.Group): InstancedPart[] {
  scene.updateWorldMatrix(true, true);
  const parts: InstancedPart[] = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) parts.push({ geometry: node.geometry, material: node.material, local: node.matrixWorld.clone() });
  });
  return parts;
}

export const CART_CHASSIS_PARTS: InstancedPart[] = [
  { geometry: CART_FRAME_METAL_GEOMETRY, material: CART_METAL_MATERIAL, local: localMatrix() },
  { geometry: CART_FRAME_DARK_GEOMETRY, material: CART_DARK_METAL_MATERIAL, local: localMatrix() },
  { geometry: CART_PANEL_GEOMETRY, material: CART_PANEL_MATERIAL, local: localMatrix() },
  { geometry: CART_HANDLE_GRIP_GEOMETRY, material: CART_GRIP_MATERIAL, local: localMatrix([0, CART_HANDLE_Y, CART_HANDLE_Z]) },
  { geometry: CART_HANDLE_END_GEOMETRY, material: CART_DARK_METAL_MATERIAL, local: localMatrix([0, CART_HANDLE_Y, CART_HANDLE_Z]) },
];

/** One caster bracket and one wheel assembly; the cart pushes four of each. */
export const CART_CASTER_PART: InstancedPart = { geometry: CART_CASTER_GEOMETRY, material: CART_DARK_METAL_MATERIAL, local: localMatrix(), dynamic: true };
export const CART_WHEEL_PART: InstancedPart = { geometry: CART_WHEEL_ASSEMBLY_GEOMETRY, material: [CART_WHEEL_MATERIAL, CART_METAL_MATERIAL], local: localMatrix(), dynamic: true };
export { CART_CASTER_POSITIONS };

/** Where the cart's basket starts (products stack from here). */
export const CART_BASKET_SOCKET = localMatrix([0, 0.43, 0.05]);

/** Slot of the n-th unit in a cart basket, as `CustomerCart` lays them out. */
export function cartProductSlot(index: number, target: THREE.Matrix4) {
  return target.compose(
    new THREE.Vector3((index % 3 - 1) * 0.18, Math.floor(index / 3) * 0.14, (index % 2 ? -1 : 1) * 0.12),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index * 1.41, index % 2 ? -0.08 : 0.08)),
    new THREE.Vector3(1.05, 1.05, 1.05),
  );
}

const bagBodyMaterial = new THREE.MeshStandardMaterial({ color: "#bd8550", roughness: 0.92 });
const bagHandleMaterial = new THREE.MeshStandardMaterial({ color: "#8c5e38" });
const bagHandleGeometry = new THREE.TorusGeometry(0.13, 0.018, 6, 12, Math.PI);
const bagBodyGeometry = new THREE.BoxGeometry(0.42, 0.5, 0.26);

/** The paper bag in a customer's hand (`CustomerBag`). */
export const HAND_BAG_PARTS: InstancedPart[] = nestParts(localMatrix([0, -0.28, 0.08], [0.03, 0, 0.03]), [
  { geometry: bagBodyGeometry, material: bagBodyMaterial, local: localMatrix() },
  { geometry: bagHandleGeometry, material: bagHandleMaterial, local: localMatrix([0, 0.29, 0], [Math.PI / 2, 0, 0]) },
]);

/** The same bag riding in the cart basket (`CustomerBagInCart`). */
export const CART_BAG_PARTS: InstancedPart[] = nestParts(new THREE.Matrix4().multiplyMatrices(CART_BASKET_SOCKET, localMatrix([0, 0.2, 0], [0, 0, 0], 0.86)), [
  { geometry: CART_BOX_GEOMETRY, material: bagBodyMaterial, local: localMatrix([0, 0, 0], [0, 0, 0], [0.42, 0.5, 0.28]) },
  { geometry: bagHandleGeometry, material: bagHandleMaterial, local: localMatrix([0, 0.29, 0], [Math.PI / 2, 0, 0]) },
]);

/** The soft blob under every crowd body (`GroundingShadow`), in body space. */
const shadowMaterial = new THREE.MeshBasicMaterial({ color: "#15251f", transparent: true, opacity: 0.2, depthWrite: false });
export const GROUND_SHADOW_PARTS: InstancedPart[] = [
  { geometry: new THREE.CircleGeometry(1, 24), material: shadowMaterial, local: localMatrix([0, 0.008, 0], [-Math.PI / 2, 0, 0], [0.6, 0.35, 1]) },
];

/** A unit cylinder (along y) stretched between two points, as `placeCylinder` lays it. */
function cylinderBetween(start: readonly [number, number, number], end: readonly [number, number, number]) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const direction = b.clone().sub(a);
  const length = direction.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5), rotation, new THREE.Vector3(1, Math.max(1e-5, length), 1));
}

/**
 * The harvest basket a worker carries (`HarvestBasket`) in carry-socket space:
 * the grips sit on the palms at (±0.25, 0.18, −0.24) and the tub hangs below
 * and behind them, as `placeCarrySocket` + `updateHarvestBasketHandle` place
 * it for a hand span of one (the socket never scales the tub).
 */
const BASKET_GRIP: readonly [number, number, number] = [HARVEST_BASKET_GRIP_HALF_WIDTH, HARVEST_BASKET_GRIP_HEIGHT, -HARVEST_BASKET_GRIP_REACH];
const BASKET_ATTACHMENT: readonly [number, number, number] = [0.27, 0.13, -0.13];
export const HARVEST_BASKET_PARTS: InstancedPart[] = [
  { geometry: basketGeometry.base, material: basketMaterial.base, local: localMatrix([0, -0.13, 0]) },
  { geometry: basketGeometry.bed, material: basketMaterial.bed, local: localMatrix([0, -0.045, 0]) },
  ...[-0.19, 0, 0.19].map((x) => ({ geometry: basketGeometry.post, material: basketMaterial.post, local: localMatrix([x, -0.025, 0.185]) })),
  ...[-0.09, 0.02, 0.13].map((y) => ({ geometry: basketGeometry.frontRail, material: y === 0.13 ? basketMaterial.topRail : basketMaterial.rail, local: localMatrix([0, y, 0.19]) })),
  ...[-1, 1].flatMap((side) => [-0.09, 0.02, 0.13].map((y) => ({ geometry: basketGeometry.sideRail, material: y === 0.13 ? basketMaterial.topRail : basketMaterial.rail, local: localMatrix([side * 0.305, y, 0]) }))),
  { geometry: basketGeometry.gripBar, material: basketMaterial.grip, local: cylinderBetween([-BASKET_GRIP[0], BASKET_GRIP[1], BASKET_GRIP[2]], BASKET_GRIP) },
  ...[-1, 1].flatMap((side) => [
    { geometry: basketGeometry.stay, material: basketMaterial.stay, local: cylinderBetween([side * BASKET_ATTACHMENT[0], BASKET_ATTACHMENT[1], BASKET_ATTACHMENT[2]], [side * BASKET_GRIP[0], BASKET_GRIP[1], BASKET_GRIP[2]]) },
    { geometry: basketGeometry.grip, material: basketMaterial.grip, local: localMatrix([side * BASKET_GRIP[0], BASKET_GRIP[1], BASKET_GRIP[2]]) },
  ]),
];

/** Slot of the n-th unit inside a harvest basket, as `HarvestBasket` lays them out. */
export function harvestProductSlot(index: number, target: THREE.Matrix4) {
  const column = index % 4;
  const depth = Math.floor(index / 4) % 2;
  const layer = Math.floor(index / 8);
  return target.compose(
    new THREE.Vector3((column - 1.5) * 0.13, 0.08 + layer * 0.105, (depth - 0.5) * 0.13),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (index * 1.71) % Math.PI, index % 2 ? -0.08 : 0.08)),
    new THREE.Vector3(0.78, 0.78, 0.78),
  );
}
