import * as THREE from "three";
import { STORE_REAR_DOOR } from "@/game/stations/storefront-layout";
import { budgetPath, loadGltf } from "../../WorldAssets";
import { makeBox, makeText, palette } from "../primitives";
import { makeStoreElement } from "../storeElement";

/**
 * Faithful port of `StoreUtilities`, `WallClock`, `SecurityCamera`,
 * `HangingSign` and `CeilingLamp` from MarketKit.tsx (lines ~1008-1043).
 * Only the four ceiling lamps are live: `lightsOn` toggles their emissive
 * material (`CeilingLamp`'s `updateMaterials`, run through `isolateMaterials`
 * so one lamp's clone never bleeds into another sharing the same GLB
 * material) and `dynamicCeilingLights` decides whether an "on" lamp also
 * carries a real `THREE.PointLight` — a perf toggle, not a visual one: the
 * source only ever conditions the light on `on && dynamicLight` together,
 * never lets a lamp glow without also looking on.
 */

interface CeilingLampHandle { group: THREE.Group; update(on: boolean, dynamicLight: boolean): void; }

function buildWallClock(): THREE.Group {
  const group = new THREE.Group();
  group.rotation.set(0, 0, 0);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 24), new THREE.MeshStandardMaterial({ color: "#f7f2e2" }));
  group.add(face);
  const minuteHand = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.25, 0.025), new THREE.MeshStandardMaterial({ color: "#303735" }));
  minuteHand.position.set(0, -0.045, 0.05);
  minuteHand.rotation.set(Math.PI / 2, 0, 0);
  group.add(minuteHand);
  const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.02), new THREE.MeshStandardMaterial({ color: "#303735" }));
  hourHand.position.set(0.09, 0.02, 0.055);
  hourHand.rotation.set(Math.PI / 2, 0, -0.85);
  group.add(hourHand);
  return group;
}

function buildSecurityCamera(rotationY = 0): THREE.Group {
  const group = new THREE.Group();
  group.rotation.set(0, rotationY, 0);
  group.add(makeBox({ args: [0.42, 0.22, 0.2], position: [0, 0, 0], color: "#e6e9e3", radius: 0.07 }));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12), new THREE.MeshStandardMaterial({ color: "#202725" }));
  lens.position.set(0, 0, 0.12);
  group.add(lens);
  group.add(makeBox({ args: [0.06, 0.35, 0.06], position: [0, 0.22, -0.05], color: palette.frame }));
  return group;
}

function buildHangingSign(label: string): THREE.Group {
  const group = new THREE.Group();
  group.add(makeBox({ args: [1.55, 0.46, 0.09], color: palette.darkGreen, radius: 0.04 }));
  group.add(makeText({ text: label, position: [0, 0, 0.052], fontSize: 0.175, color: "#fff1cc", anchorX: "center", anchorY: "middle", fontWeight: 900 }));
  const backLabel = makeText({ text: label, position: [0, 0, -0.052], fontSize: 0.175, color: "#fff1cc", anchorX: "center", anchorY: "middle", fontWeight: 900 });
  backLabel.rotation.set(0, Math.PI, 0);
  group.add(backLabel);
  for (const x of [-0.56, 0.56]) group.add(makeBox({ args: [0.025, 0.55, 0.025], position: [x, 0.45, 0], color: palette.frame }));
  return group;
}

function buildCeilingLamp(): CeilingLampHandle {
  const group = new THREE.Group();
  group.name = "dynamic:ceiling-lamp";
  const modelAnchor = new THREE.Group();
  group.add(modelAnchor);

  const clonedMaterials: THREE.MeshStandardMaterial[] = [];
  let currentOn = false;
  let pointLight: THREE.PointLight | null = null;

  function applyEmissive(on: boolean) {
    for (const material of clonedMaterials) {
      material.emissive.set(on ? "#fff0b8" : "#000000");
      material.emissiveIntensity = on ? 1.1 : 0;
    }
  }

  function syncLight(on: boolean, dynamicLight: boolean) {
    const shouldHaveLight = on && dynamicLight;
    if (shouldHaveLight && !pointLight) {
      pointLight = new THREE.PointLight("#fff2c9", 0.18, 4);
      pointLight.position.set(0, -0.15, 0);
      group.add(pointLight);
    } else if (!shouldHaveLight && pointLight) {
      group.remove(pointLight);
      pointLight = null;
    }
  }

  loadGltf(budgetPath("environment", "equipment_ceiling_light")).then((gltf) => {
    const model = gltf.scene.clone(true);
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      // `isolateMaterials`: clone so this lamp's own emissive toggle never
      // bleeds into every other lamp sharing the same loaded GLB material.
      const materials = Array.isArray(node.material) ? node.material.map((material) => material.clone()) : node.material.clone();
      node.material = materials;
      for (const material of Array.isArray(materials) ? materials : [materials]) {
        if (material instanceof THREE.MeshStandardMaterial) clonedMaterials.push(material);
      }
    });
    modelAnchor.add(model);
    applyEmissive(currentOn);
  }).catch(() => {});

  function update(on: boolean, dynamicLight: boolean) {
    currentOn = on;
    applyEmissive(on);
    syncLight(on, dynamicLight);
  }
  return { group, update };
}

export interface StoreUtilitiesHandle {
  group: THREE.Group;
  update(lightsOn: boolean, dynamicCeilingLights: boolean): void;
}

export function buildStoreUtilities(lightsOn: boolean, dynamicCeilingLights: boolean): StoreUtilitiesHandle {
  const group = new THREE.Group();

  const clockElement = makeStoreElement([STORE_REAR_DOOR.adjacentRackPosition[0], 2.2, -8.34]);
  clockElement.add(buildWallClock());
  group.add(clockElement);

  const cameraLeft = makeStoreElement([-10.75, 2.55, -8.05]);
  cameraLeft.add(buildSecurityCamera(0));
  group.add(cameraLeft);

  const cameraRight = makeStoreElement([10.65, 2.55, 7.2]);
  cameraRight.add(buildSecurityCamera(Math.PI));
  group.add(cameraRight);

  const checkoutSign = makeStoreElement([7.25, 2.45, 1.65]);
  checkoutSign.add(buildHangingSign("CAJAS"));
  group.add(checkoutSign);

  const pantrySign = makeStoreElement([-3.8, 2.45, -3.35]);
  pantrySign.add(buildHangingSign("DESPENSA"));
  group.add(pantrySign);

  const lamps: CeilingLampHandle[] = [-7.2, -2.4, 2.4, 7.2].map((x) => {
    const element = makeStoreElement([x, 2.85, -0.6]);
    const lamp = buildCeilingLamp();
    element.add(lamp.group);
    group.add(element);
    return lamp;
  });

  function update(on: boolean, dynamicLight: boolean) {
    for (const lamp of lamps) lamp.update(on, dynamicLight);
  }
  update(lightsOn, dynamicCeilingLights);
  return { group, update };
}
