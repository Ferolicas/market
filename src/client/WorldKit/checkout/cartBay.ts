import * as THREE from "three";
import { makeBox, makeInstances, makeText, type InstanceTransform, type Position } from "../primitives";

/**
 * Faithful port of `CartBay`, `cartTubeTransform`, `CartTubeInstances` and
 * `ShoppingCart` from `MarketKit.tsx`. `ShoppingCart`'s geometry is fully
 * static, so four carts (the maximum the source ever shows) are built once
 * at their fixed per-index position/scale and only `.visible` is toggled by
 * `update(count)` — never rebuilt.
 */

type CartTubeSegment = readonly [from: Position, to: Position, radius: number];

/** Verbatim port of `cartTubeTransform`: orients a unit cylinder to span
 * `from`→`to` at the given radius. */
function cartTubeTransform([from, to, radius]: CartTubeSegment): InstanceTransform {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return {
    position: start.add(end).multiplyScalar(0.5).toArray() as Position,
    quaternion: quaternion.toArray() as [number, number, number, number],
    scale: [radius, length, radius],
  };
}

const tubeGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
const gripMaterial = new THREE.MeshStandardMaterial({ color: "#315f4d", metalness: 0.68, roughness: 0.27 });
const metalMaterial = new THREE.MeshStandardMaterial({ color: "#9aa5a2", metalness: 0.68, roughness: 0.27 });
const forkGeometry = new THREE.BoxGeometry(1, 1, 1);
const forkMaterial = new THREE.MeshStandardMaterial({ color: "#6d7774", metalness: 0.42, roughness: 0.4 });
const wheelOuterGeometry = new THREE.CylinderGeometry(0.075, 0.075, 0.055, 14);
const wheelOuterMaterial = new THREE.MeshStandardMaterial({ color: "#272d2c", roughness: 0.65 });
const wheelInnerGeometry = new THREE.CylinderGeometry(0.034, 0.034, 0.058, 12);
const wheelInnerMaterial = new THREE.MeshStandardMaterial({ color: "#adb7b4", metalness: 0.62, roughness: 0.3 });

/** Verbatim port of `ShoppingCart`'s geometry (position/scale applied by
 * the caller, matching the source's own `position`/`scale` props). */
function buildShoppingCart(): THREE.Group {
  const group = new THREE.Group();

  const top = { leftBack: [-0.46, 0.88, -0.35] as Position, rightBack: [0.46, 0.88, -0.35] as Position, leftFront: [-0.46, 0.88, 0.42] as Position, rightFront: [0.46, 0.88, 0.42] as Position };
  const bottom = { leftBack: [-0.34, 0.43, -0.25] as Position, rightBack: [0.34, 0.43, -0.25] as Position, leftFront: [-0.34, 0.43, 0.33] as Position, rightFront: [0.34, 0.43, 0.33] as Position };
  const metal: CartTubeSegment[] = [
    [[-0.44, 0.18, -0.28], top.leftBack, 0.022],
    [[0.44, 0.18, -0.28], top.rightBack, 0.022],
    ...([
      [top.leftBack, top.rightBack],
      [top.leftFront, top.rightFront],
      [top.leftBack, top.leftFront],
      [top.rightBack, top.rightFront],
      [bottom.leftBack, bottom.rightBack],
      [bottom.leftFront, bottom.rightFront],
      [bottom.leftBack, bottom.leftFront],
      [bottom.rightBack, bottom.rightFront],
      [top.leftBack, bottom.leftBack],
      [top.rightBack, bottom.rightBack],
      [top.leftFront, bottom.leftFront],
      [top.rightFront, bottom.rightFront],
    ] as const).map(([from, to]) => [from, to, 0.015] as CartTubeSegment),
    ...[-0.27, -0.09, 0.09, 0.27].map((x) => [[x, 0.43, -0.25], [x * 1.3, 0.88, 0.42], 0.009] as CartTubeSegment),
    ...[-0.1, 0.08, 0.26].flatMap((z) => [-1, 1].map((side) => [[side * 0.36, 0.48, z], [side * 0.45, 0.84, z + 0.05], 0.009] as CartTubeSegment)),
    ...[-0.34, 0.34].map((x) => [[x, 0.13, -0.26], [x, 0.24, 0.32], 0.02] as CartTubeSegment),
  ];
  const grip: CartTubeSegment[] = [[[-0.52, 1.02, -0.43], [0.52, 1.02, -0.43], 0.035]];

  group.add(makeInstances(grip.map(cartTubeTransform), tubeGeometry, gripMaterial, { castShadow: true }));
  group.add(makeInstances(metal.map(cartTubeTransform), tubeGeometry, metalMaterial, { castShadow: true }));

  group.add(makeBox({ args: [0.72, 0.035, 0.58], position: [0, 0.27, 0.04], color: "#9da8a5", radius: 0.01 }));
  group.add(makeBox({ args: [0.74, 0.27, 0.045], position: [0, 0.7, -0.29], color: "#466f60", radius: 0.025 }));

  const wheelTransforms: InstanceTransform[] = [-0.33, 0.33].flatMap((x) => [-0.23, 0.28].map((z) => ({ position: [x, 0.085, z] as Position, rotation: [0, 0, Math.PI / 2] as Position })));
  const forkTransforms: InstanceTransform[] = [-0.33, 0.33].flatMap((x) => [-0.23, 0.28].map((z) => ({ position: [x, 0.15, z] as Position, scale: [0.045, 0.13, 0.045] as Position })));

  group.add(makeInstances(forkTransforms, forkGeometry, forkMaterial));
  group.add(makeInstances(wheelTransforms, wheelOuterGeometry, wheelOuterMaterial));
  group.add(makeInstances(wheelTransforms, wheelInnerGeometry, wheelInnerMaterial));

  return group;
}

export function buildCartBay(position: Position): { group: THREE.Group; update(count: number): void } {
  const group = new THREE.Group();
  group.name = "fixture:cart-bay";
  group.position.set(...position);

  group.add(makeBox({ args: [2.1, 0.07, 1.45], position: [0, 0.035, 0], color: "#596864", radius: 0.022 }));

  for (const x of [-0.96, 0.96]) {
    group.add(makeBox({ args: [0.075, 1.34, 1.45], position: [x, 0.67, 0], color: "#53645f", radius: 0.018 }));
    group.add(makeBox({ args: [0.16, 0.14, 1.48], position: [x, 0.18, 0], color: "#d6a745", radius: 0.025 }));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshStandardMaterial({ color: "#f0c45e", emissive: "#765318", emissiveIntensity: 0.18, roughness: 0.38 }));
    cap.position.set(x, 1.35, 0);
    group.add(cap);
  }

  group.add(makeBox({ args: [2.08, 0.4, 0.12], position: [0, 1.5, -0.66], color: "#f1e8cf", radius: 0.045 }));
  group.add(
    makeText({
      text: "CARROS",
      position: [0, 1.5, -0.59],
      fontSize: 0.16,
      color: "#28483e",
      anchorX: "center",
      anchorY: "middle",
      fontWeight: 800,
    }),
  );

  const carts = [0, 1, 2, 3].map((index) => {
    const cart = buildShoppingCart();
    cart.position.set(0, 0, 0.42 - index * 0.26);
    cart.scale.setScalar(1 - index * 0.055);
    group.add(cart);
    return cart;
  });

  function update(count: number) {
    const visible = Math.max(2, Math.min(4, count));
    carts.forEach((cart, index) => {
      cart.visible = index < visible;
    });
  }

  update(2);

  return { group, update };
}
