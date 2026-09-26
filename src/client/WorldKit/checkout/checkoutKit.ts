import * as THREE from "three";
import type { CheckoutTransaction } from "@/game/types";
import type { CheckoutLane } from "@/game/stations/checkout-layout";
import { makeBox, makeText, palette, updateText, type Position } from "../primitives";
import { buildRetailProductUnit } from "./retailProductUnit";

/**
 * Faithful port of `CheckoutKit` from `MarketKit.tsx`. The source is a
 * single JSX tree re-rendered on every prop change (React does the diffing);
 * here the group is built once and `update()` mutates exactly the pieces the
 * source made conditional/dynamic (scanning light, screen/kiosk emissive and
 * text, card-reader glow, the checkout bag(s), and the belt's product
 * units). `animate(deltaSeconds)` mirrors `CheckoutProductUnit`'s own
 * `useFrame` lerp so units keep sliding smoothly between `update()` calls.
 */

interface CheckoutBagHandle {
  group: THREE.Group;
  update(fill: number, position: Position, visible: boolean): void;
}

function buildCheckoutBag(): CheckoutBagHandle {
  const group = new THREE.Group();
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.42), new THREE.MeshStandardMaterial({ color: "#c7935e", roughness: 0.92 }));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 7, 16, Math.PI), new THREE.MeshStandardMaterial({ color: "#8b623d" }));
  handle.position.set(0, 0.41, 0);
  handle.rotation.set(Math.PI / 2, 0, 0);
  const content = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: "#e0b44a" }));
  content.position.set(0, 0.26, 0);
  group.add(bag, handle, content);
  function update(fill: number, position: Position, visible: boolean) {
    group.visible = visible;
    group.position.set(...position);
    group.scale.set(1, 0.72 + fill * 0.28, 1);
    content.visible = fill > 0;
  }
  update(0, [1.67, 1.02, 0], false);
  return { group, update };
}

interface LiveUnit {
  group: THREE.Group;
  target: THREE.Vector3;
}

interface CheckoutUnit {
  productId: CheckoutTransaction["pendingItems"][number]["productId"];
  loaded: boolean;
  scanned: boolean;
  bagged: boolean;
}

function computeUnits(transaction?: CheckoutTransaction): CheckoutUnit[] {
  return (
    transaction?.pendingItems.flatMap((line) =>
      Array.from({ length: line.quantity }, (_, unit) => ({
        productId: line.productId,
        loaded: unit < line.loaded,
        scanned: unit < line.scanned,
        bagged: unit < line.bagged,
      })),
    ) ?? []
  );
}

export function buildCheckoutKit(lane: CheckoutLane): {
  group: THREE.Group;
  update(transaction?: CheckoutTransaction, handoffTransaction?: CheckoutTransaction, handoffBagAtCounter?: boolean): void;
  animate(deltaSeconds: number): void;
} {
  const group = new THREE.Group();
  group.name = "dynamic:checkout";

  const mainLight = new THREE.PointLight("#fff0d2", 0.72, 5.8, 1.7);
  mainLight.position.set(0, 2.7, -1.7);
  group.add(mainLight);

  group.add(makeBox({ args: [4.45, 0.92, 1.18], position: [0, 0.46, 0], color: palette.darkGreen, radius: 0.14 }));
  group.add(makeBox({ args: [4.24, 0.16, 1.08], position: [0, 0.98, 0], color: "#d8dedb", radius: 0.09 }));
  group.add(makeBox({ args: [2.55, 0.08, 0.82], position: [-0.66, 1.08, 0], color: "#252d2b", radius: 0.035 }));

  const beltGeometry = new THREE.BoxGeometry(0.025, 0.018, 0.78);
  const beltMaterial = new THREE.MeshStandardMaterial({ color: "#68726f", metalness: 0.35, roughness: 0.48 });
  for (let index = 0; index < 9; index += 1) {
    const roller = new THREE.Mesh(beltGeometry, beltMaterial);
    roller.position.set(-1.7 + index * 0.28, 1.125, 0);
    group.add(roller);
  }

  group.add(makeBox({ args: [0.52, 0.11, 0.94], position: [0.64, 1.1, 0], color: "#1f2a27", radius: 0.035 }));

  const beltLightMaterial = new THREE.MeshStandardMaterial({ color: "#8fe8c5", emissive: "#2d6553", emissiveIntensity: 0.5 });
  const beltLight = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.018, 0.57), beltLightMaterial);
  beltLight.position.set(0.64, 1.165, 0);
  group.add(beltLight);

  const scanningLight = new THREE.PointLight("#64ffc2", 1.4, 1.4);
  scanningLight.position.set(0.64, 1.35, 0);
  scanningLight.visible = false;
  group.add(scanningLight);

  group.add(makeBox({ args: [0.86, 0.18, 0.62], position: [1.28, 1.13, -0.18], color: "#24302d", radius: 0.08 }));

  const screenBack = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.62, 0.1), new THREE.MeshStandardMaterial({ color: "#25322f", roughness: 0.42 }));
  screenBack.position.set(1.28, 1.61, -0.13);
  screenBack.rotation.set(-0.23, 0, 0);
  group.add(screenBack);

  const screenGlowMaterial = new THREE.MeshStandardMaterial({ color: "#bde9d8", emissive: "#27463d", emissiveIntensity: 0.8 });
  const screenGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.42), screenGlowMaterial);
  screenGlow.position.set(1.28, 1.62, -0.07);
  screenGlow.rotation.set(-0.23, 0, 0);
  group.add(screenGlow);

  const screenText = makeText({ text: "LISTA", position: [1.28, 1.63, -0.01], rotation: [-0.23, 0, 0], fontSize: 0.11, color: "#173f35", anchorX: "center" });
  group.add(screenText);

  group.add(makeBox({ args: [0.32, 0.13, 0.5], position: [1.78, 1.16, 0.24], color: "#e8ece7", radius: 0.055 }));

  const cardGlowMaterial = new THREE.MeshStandardMaterial({ color: "#77948a", emissive: "#42a776", emissiveIntensity: 0.18 });
  const cardGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.18), cardGlowMaterial);
  cardGlow.position.set(1.78, 1.26, 0.26);
  cardGlow.rotation.set(-0.42, 0, 0);
  group.add(cardGlow);

  group.add(makeBox({ args: [0.92, 0.5, 0.82], position: [1.67, 0.48, 0], color: "#eff1e8", radius: 0.09 }));

  const bagA = buildCheckoutBag();
  const bagB = buildCheckoutBag();
  const bagC = buildCheckoutBag();
  group.add(bagA.group, bagB.group, bagC.group);

  const unitsGroup = new THREE.Group();
  unitsGroup.name = "checkout-units";
  group.add(unitsGroup);
  const liveUnits = new Map<string, LiveUnit>();

  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.35, 0.06), new THREE.MeshStandardMaterial({ color: "#4b5b56", metalness: 0.4 }));
  pole.position.set(-1.55, 2.32, -0.48);
  group.add(pole);

  const board = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.58, 0.12), new THREE.MeshStandardMaterial({ color: "#f4e4ad", roughness: 0.55 }));
  board.position.set(-1.55, 3.08, -0.44);
  group.add(board);

  group.add(makeText({ text: `CAJA ${lane + 1}`, position: [-1.55, 3.09, -0.36], fontSize: 0.24, color: "#24453d", anchorX: "center" }));

  function update(transaction?: CheckoutTransaction, handoffTransaction?: CheckoutTransaction, handoffBagAtCounter = false) {
    const scanning = transaction?.state === "SCANNING" || transaction?.state === "BAGGING";
    const bagged = transaction?.pendingItems.reduce((sum, line) => sum + line.bagged, 0) ?? 0;
    const total = transaction?.pendingItems.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
    const handoffBagged = handoffTransaction?.pendingItems.reduce((sum, line) => sum + line.bagged, 0) ?? 0;
    const handoffTotal = handoffTransaction?.pendingItems.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
    const hasSeparateHandoffBag = Boolean(handoffTransaction && handoffBagAtCounter);
    const unitsList = computeUnits(transaction);

    beltLightMaterial.emissive.set(scanning ? "#60ffbd" : "#2d6553");
    beltLightMaterial.emissiveIntensity = scanning ? 2.2 : 0.5;
    scanningLight.visible = scanning;

    screenGlowMaterial.emissive.set(transaction ? "#4d9b80" : "#27463d");
    updateText(screenText, { text: transaction ? `${bagged}/${total}` : "LISTA" });

    const payment = transaction?.state === "PAYMENT";
    cardGlowMaterial.color.set(payment ? "#91f2be" : "#77948a");
    cardGlowMaterial.emissiveIntensity = payment ? 1.4 : 0.18;

    bagA.update(total ? bagged / total : 0, hasSeparateHandoffBag ? [1.34, 1.02, 0.24] : [1.67, 1.02, 0], Boolean(transaction));
    bagB.update(handoffTotal ? handoffBagged / handoffTotal : 1, transaction ? [1.94, 1.02, -0.24] : [1.67, 1.02, 0], hasSeparateHandoffBag);
    bagC.update(0, [1.67, 1.02, 0], !transaction && !handoffTransaction);

    const seen = new Set<string>();
    unitsList.forEach((unit, index) => {
      if (!unit.loaded || unit.bagged) return;
      const key = `${unit.productId}-${index}`;
      seen.add(key);
      const targetX = unit.scanned ? 1.48 : Math.min(0.15, -1.66 + index * 0.29);
      const targetY = unit.scanned ? 1.38 : 1.25;
      const targetZ = unit.scanned ? 0.18 : 0;
      const live = liveUnits.get(key);
      if (live) {
        live.target.set(targetX, targetY, targetZ);
      } else {
        const wrapper = new THREE.Group();
        wrapper.position.set(-2.05, 1.45, 0.42);
        wrapper.add(buildRetailProductUnit(unit.productId, [0, 0, 0], 1.18));
        unitsGroup.add(wrapper);
        liveUnits.set(key, { group: wrapper, target: new THREE.Vector3(targetX, targetY, targetZ) });
      }
    });
    for (const [key, live] of liveUnits) {
      if (!seen.has(key)) {
        unitsGroup.remove(live.group);
        liveUnits.delete(key);
      }
    }
  }

  function animate(deltaSeconds: number) {
    const factor = 1 - Math.exp(-8 * deltaSeconds);
    for (const live of liveUnits.values()) live.group.position.lerp(live.target, factor);
  }

  update(undefined, undefined, false);

  return { group, update, animate };
}

export function buildClosedCheckoutKit(lane: CheckoutLane): THREE.Group {
  const group = new THREE.Group();
  group.name = "fixture:closed-checkout";
  group.add(makeBox({ args: [4.45, 0.92, 1.18], position: [0, 0.46, 0], color: palette.darkGreen, radius: 0.14 }));
  group.add(makeBox({ args: [4.24, 0.16, 1.08], position: [0, 0.98, 0], color: "#d8dedb", radius: 0.09 }));
  group.add(makeBox({ args: [3.72, 0.13, 0.42], position: [0, 1.1, 0], color: "#26332f", radius: 0.045 }));
  group.add(makeBox({ args: [1.74, 0.46, 0.08], position: [0, 1.48, 0.04], color: "#f1dfad", radius: 0.055 }));
  group.add(
    makeText({
      text: `CAJA ${lane + 1} · CERRADA`,
      position: [0, 1.48, 0.085],
      fontSize: 0.15,
      color: "#315044",
      anchorX: "center",
      anchorY: "middle",
      fontWeight: 800,
    }),
  );
  return group;
}
