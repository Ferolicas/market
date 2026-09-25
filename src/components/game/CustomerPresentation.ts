import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { VisitorAnimation } from "@/game/locomotion";
import type { CustomerRuntimeState, ProductId } from "@/game/types";
import { scaleStorePoint } from "@/game/world-scale";
import { liveActors } from "@/game/render/LiveActors";
import { customerShowingAnger } from "@/game/ai/CustomerPatience";
import { CUSTOMER_CART_WHEEL_RADIUS } from "@/game/animation/CustomerCartMotion";
import { CART_BAY_POINT } from "@/game/stations/store-service-layout";
import { adultCustomerSceneScale } from "@/game/animation/CharacterScale";

/**
 * Customer presentation data shared by the crowd renderer: body scales, the
 * animation state machine, pickup geometry and the cart's chassis parts
 * (geometries and materials built once per module). The per-character React
 * components that used these lived here until the crowd moved to the GPU
 * (`CrowdRenderer.tsx`).
 */

export type CustomerId = 1 | 2 | 3 | 4 | 5 | 6;
type CustomerAnimation = VisitorAnimation;

// Preserve the proven in-store height after replacing the former cast with
// the delivered two-metre FBX bodies. Identity 2 intentionally reuses the one
// approved male customer body.
export const CUSTOMER_SCALE: Record<CustomerId, number> = {
  1: adultCustomerSceneScale(1.236),
  2: adultCustomerSceneScale(1.226),
  3: adultCustomerSceneScale(1.291),
  4: adultCustomerSceneScale(1.265),
  5: adultCustomerSceneScale(1.265),
  6: adultCustomerSceneScale(1.216),
};
export const CART_SCALE = 0.92;
export const CART_HANDLE_Z = -0.43;
export const CART_HANDLE_Y = 0.82;
// Calibrated to the palm span of the delivered Mixamo customer cast.
export const CART_HANDLE_BASE_WIDTH = 0.44;
export const CART_BAY_POSITION = scaleStorePoint([...CART_BAY_POINT]);
export const PICKUP_HEIGHT: Record<ProductId, number> = { tomatoes: 0.86, apples: 0.86, oranges: 0.86, corn: 0.92, eggs: 0.92, milk: 1.02, cheese: 1.02, juice: 1.02, bread: 0.9, flour: 0.9, wheat: 0.9, coffee: 0.9, cannedCorn: 0.9 };

export function customerAnimation(customer: CustomerRuntimeState, elapsed = 0, checkoutLoading = false, runsFree = false): CustomerAnimation {
  if (customerShowingAnger(customer, liveActors.simulationTimeMs)) return "Impatient";
  switch (customer.state) {
    case "ENTER_STORE": return runsFree ? "Run" : "Enter";
    case "GET_CART":
    case "BUILD_SHOPPING_LIST": return "CarryBasket";
    case "NAVIGATE_TO_PRODUCT": return "BasketWalk";
    case "NAVIGATE_TO_QUEUE":
    case "MOVE_QUEUE": return "BasketWalk";
    case "WAIT_FOR_ACCESS": return "Browse";
    case "PICK_PRODUCT": return "ReachShelf";
    case "QUEUE_WAIT": {
      const phase = (elapsed + customer.identity * 2.31) % 18;
      if (phase < 8) return "Queue";
      if (phase < 11) return "Wait";
      if (phase < 13) return "Phone";
      if (phase < 15.5) return "Queue";
      if (phase < 17) return "Impatient";
      return "Talk";
    }
    case "UNLOAD": return "CheckoutItem";
    case "WAIT_CHECKOUT": return checkoutLoading ? "CheckoutItem" : customer.identity % 3 === 0 ? "Confused" : customer.identity % 2 ? "Wait" : "Queue";
    case "PAY": return "Pay";
    case "NAVIGATE_TO_BAG": return "BasketWalk";
    case "TAKE_BAG": return "ReceiveBag";
    case "NAVIGATE_TO_RETURNS": return "BasketWalk";
    case "LEAVE_RETURNS": return "CheckoutItem";
    case "NAVIGATE_TO_CART_RETURN": return "BasketWalk";
    case "RETURN_CART": return "CheckoutItem";
    case "EXIT_STORE": return runsFree ? "Run" : "Exit";
    case "WAIT_RESTOCK": return "Confused";
    default: return "Idle";
  }
}

export function productPickupLateralOffset(productId: ProductId) {
  if (productId === "tomatoes" || productId === "milk") return -0.42;
  if (productId === "corn" || productId === "cheese") return 0.42;
  return 0;
}

export const CART_BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const CART_CYLINDER_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 12);
const CART_WHEEL_GEOMETRY = new THREE.CylinderGeometry(CUSTOMER_CART_WHEEL_RADIUS, CUSTOMER_CART_WHEEL_RADIUS, 0.055, 14);
const CART_HUB_GEOMETRY = new THREE.CylinderGeometry(0.032, 0.032, 0.062, 12);
export const CART_METAL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#a1aca8", metalness: 0.62, roughness: 0.3 });
export const CART_DARK_METAL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#56635f", metalness: 0.48, roughness: 0.4 });
export const CART_GRIP_MATERIAL = new THREE.MeshStandardMaterial({ color: "#315f4d", roughness: 0.55, metalness: 0.04 });
export const CART_WHEEL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#252b29", roughness: 0.82 });
export const CART_PANEL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#426f5d", roughness: 0.62 });

type CartTubeTransform = Readonly<{
  key: string;
  position: readonly [number, number, number];
  quaternion: THREE.Quaternion;
  scale: readonly [number, number, number];
  dark?: boolean;
}>;

function cartTube(key: string, from: readonly [number, number, number], to: readonly [number, number, number], radius: number, dark = false): CartTubeTransform {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const length = direction.length();
  return {
    key,
    position: start.add(end).multiplyScalar(0.5).toArray(),
    quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()),
    scale: [radius, length, radius],
    dark,
  };
}

const CART_BASKET_TOP = {
  leftRear: [-0.37, 0.75, -0.25] as const,
  rightRear: [0.37, 0.75, -0.25] as const,
  leftFront: [-0.4, 0.75, 0.34] as const,
  rightFront: [0.4, 0.75, 0.34] as const,
};
const CART_BASKET_BOTTOM = {
  leftRear: [-0.28, 0.34, -0.19] as const,
  rightRear: [0.28, 0.34, -0.19] as const,
  leftFront: [-0.31, 0.34, 0.27] as const,
  rightFront: [0.31, 0.34, 0.27] as const,
};
const CART_TUBES: readonly CartTubeTransform[] = [
  cartTube("top-rear", CART_BASKET_TOP.leftRear, CART_BASKET_TOP.rightRear, 0.014),
  cartTube("top-front", CART_BASKET_TOP.leftFront, CART_BASKET_TOP.rightFront, 0.014),
  cartTube("top-left", CART_BASKET_TOP.leftRear, CART_BASKET_TOP.leftFront, 0.014),
  cartTube("top-right", CART_BASKET_TOP.rightRear, CART_BASKET_TOP.rightFront, 0.014),
  cartTube("bottom-rear", CART_BASKET_BOTTOM.leftRear, CART_BASKET_BOTTOM.rightRear, 0.012),
  cartTube("bottom-front", CART_BASKET_BOTTOM.leftFront, CART_BASKET_BOTTOM.rightFront, 0.012),
  cartTube("bottom-left", CART_BASKET_BOTTOM.leftRear, CART_BASKET_BOTTOM.leftFront, 0.012),
  cartTube("bottom-right", CART_BASKET_BOTTOM.rightRear, CART_BASKET_BOTTOM.rightFront, 0.012),
  cartTube("corner-left-rear", CART_BASKET_BOTTOM.leftRear, CART_BASKET_TOP.leftRear, 0.013),
  cartTube("corner-right-rear", CART_BASKET_BOTTOM.rightRear, CART_BASKET_TOP.rightRear, 0.013),
  cartTube("corner-left-front", CART_BASKET_BOTTOM.leftFront, CART_BASKET_TOP.leftFront, 0.013),
  cartTube("corner-right-front", CART_BASKET_BOTTOM.rightFront, CART_BASKET_TOP.rightFront, 0.013),
  ...[-0.23, -0.075, 0.075, 0.23].map((x) => cartTube(`basket-long-${x}`, [x, 0.34, -0.19], [x * 1.34, 0.75, 0.34], 0.008)),
  ...[-0.08, 0.09, 0.25].flatMap((z) => [-1, 1].map((side) => cartTube(`basket-side-${side}-${z}`, [side * 0.29, 0.39, z], [side * 0.39, 0.7, z + 0.035], 0.008))),
  cartTube("handle-stay-left", CART_BASKET_TOP.leftRear, [-0.39, CART_HANDLE_Y, CART_HANDLE_Z], 0.018, true),
  cartTube("handle-stay-right", CART_BASKET_TOP.rightRear, [0.39, CART_HANDLE_Y, CART_HANDLE_Z], 0.018, true),
  cartTube("chassis-left", [-0.3, 0.14, -0.24], [-0.31, 0.27, 0.28], 0.019, true),
  cartTube("chassis-right", [0.3, 0.14, -0.24], [0.31, 0.27, 0.28], 0.019, true),
  cartTube("rear-axle", [-0.34, 0.14, -0.22], [0.34, 0.14, -0.22], 0.016, true),
  cartTube("front-axle", [-0.34, 0.14, 0.27], [0.34, 0.14, 0.27], 0.016, true),
];

export const CART_FRAME_METAL_GEOMETRY = mergedGeometry(CART_TUBES
  .filter((tube) => !tube.dark)
  .map((tube) => transformedGeometry(CART_CYLINDER_GEOMETRY, tube.position, tube.quaternion, tube.scale)));
export const CART_FRAME_DARK_GEOMETRY = mergedGeometry([
  ...CART_TUBES
    .filter((tube) => tube.dark)
    .map((tube) => transformedGeometry(CART_CYLINDER_GEOMETRY, tube.position, tube.quaternion, tube.scale)),
  transformedGeometry(CART_BOX_GEOMETRY, [0, 0.27, 0.04], undefined, [0.64, 0.032, 0.5]),
  transformedGeometry(CART_BOX_GEOMETRY, [0, 0.455, -0.205], undefined, [0.04, 0.15, 0.04]),
]);
export const CART_PANEL_GEOMETRY = mergedGeometry([
  transformedGeometry(CART_BOX_GEOMETRY, [0, 0.65, -0.265], new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0, 0)), [0.54, 0.21, 0.035]),
  transformedGeometry(CART_BOX_GEOMETRY, [0, 0.545, -0.13], new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, 0, 0)), [0.5, 0.035, 0.24]),
]);
export const CART_HANDLE_GRIP_GEOMETRY = transformedGeometry(
  CART_CYLINDER_GEOMETRY,
  [0, 0, 0],
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
  [0.04, CART_HANDLE_BASE_WIDTH, 0.04],
);
export const CART_HANDLE_END_GEOMETRY = mergedGeometry([-0.5, 0.5].map((side) => transformedGeometry(
  CART_CYLINDER_GEOMETRY,
  [side * CART_HANDLE_BASE_WIDTH, 0, 0],
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
  [0.052, 0.07, 0.052],
)));
export const CART_CASTER_GEOMETRY = mergedGeometry([
  transformedGeometry(CART_CYLINDER_GEOMETRY, [0, 0.07, 0], undefined, [0.022, 0.14, 0.022]),
  ...[-0.042, 0.042].map((x) => transformedGeometry(CART_BOX_GEOMETRY, [x, 0.025, 0], undefined, [0.012, 0.07, 0.026])),
]);
const CART_WHEEL_METAL_GEOMETRY = mergedGeometry([
  transformedGeometry(CART_HUB_GEOMETRY, [0, 0, 0], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2))),
  transformedGeometry(CART_BOX_GEOMETRY, [0, 0.038, 0], undefined, [0.063, 0.01, 0.014]),
]);
export const CART_WHEEL_ASSEMBLY_GEOMETRY = mergedGeometry([
  transformedGeometry(CART_WHEEL_GEOMETRY, [0, 0, 0], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2))),
  CART_WHEEL_METAL_GEOMETRY,
], true);
export const CART_CASTER_POSITIONS = [
  [-0.3, 0.09, 0.27],
  [0.3, 0.09, 0.27],
  [-0.3, 0.09, -0.22],
  [0.3, 0.09, -0.22],
] as const;
function transformedGeometry(
  source: THREE.BufferGeometry,
  position: readonly [number, number, number],
  quaternion = new THREE.Quaternion(),
  scale: readonly [number, number, number] = [1, 1, 1],
) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    quaternion,
    new THREE.Vector3(...scale),
  );
  return source.clone().applyMatrix4(matrix);
}

function mergedGeometry(geometries: THREE.BufferGeometry[], useGroups = false) {
  const geometry = mergeGeometries(geometries, useGroups);
  if (!geometry) throw new Error("Customer cart geometry attributes are incompatible");
  geometry.computeBoundingSphere();
  return geometry;
}
