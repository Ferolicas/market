import * as THREE from "three";
import { STORE_REAR_DOOR } from "@/game/stations/storefront-layout";
import { budgetPath, loadGltf } from "../../WorldAssets";
import { makeBox, makeText, mergeStaticMeshes, palette } from "../primitives";
import { makeStoreElement } from "../storeElement";
import { warmUpShadersBeforeAttach, warmUpTexturesIdle } from "../gpuWarmup";

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

interface CeilingLampHandle { group: THREE.Group; update(on: boolean): void; }

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
  // Merged per-camera (not store-wide, see `buildStoreUtilities`): the two
  // cameras sit at opposite corners of the store, so folding their boxes
  // together at the outer level would grow one merged mesh's bounding
  // volume across the whole floor and hurt frustum culling.
  mergeStaticMeshes(group);
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
  mergeStaticMeshes(group);
  return group;
}

/** 2026-09-27 tail-latency follow-up: same real, unfixed instance of the
 * shader-warm-up bug as `production/machines.ts`'s `attachModel` — four of
 * these load the same GLB right after `onReady()`, never awaiting shader
 * compile before attach. Fixed the same way. */
function buildCeilingLamp(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, dynamicLight: boolean): CeilingLampHandle {
  const group = new THREE.Group();
  group.name = "dynamic:ceiling-lamp";
  const modelAnchor = new THREE.Group();
  group.add(modelAnchor);

  const clonedMaterials: THREE.MeshStandardMaterial[] = [];
  let currentOn = false;
  // 2026-09-27 crowd-recompile fix: this used to add/remove a real
  // `THREE.PointLight` from `group` as `on`/`dynamicLight` changed. Every
  // such add/remove changes THREE's per-material program cache key
  // (`numPointLights`), forcing every standard/physical material in the
  // scene — crowd bodies' instanced+skinned material worst of all, since
  // it's the largest program to relink — to recompile synchronously the
  // next time it's drawn, no matter how early `warmUpShadersBeforeAttach`
  // already ran for it (a warm-up can only cover the light configuration
  // that existed in the scene AT THAT TIME, and these lamps' point lights
  // used to not exist yet then). `dynamicLight` itself never actually
  // changes after construction (`ClientRuntime`'s call site passes
  // `!this.mobile`, decided once) — only `on` (`lightsOn`, tied to whether
  // customers are in the store) toggles during a session — so the light
  // object itself can be created once, up front, and kept permanently
  // `visible` (added to `group` unconditionally when `dynamicLight` is
  // true, never created at all when it's false — mobile keeps its exact
  // zero-point-light behaviour). Only `intensity` (0 when off) toggles from
  // here on, which THREE does not treat as a program-cache-key input: zero
  // visual difference, but the light count — and therefore the cache key —
  // never changes again after the loading curtain's initial warm-up.
  const pointLight = dynamicLight
    ? (() => { const light = new THREE.PointLight("#fff2c9", 0, 4); light.position.set(0, -0.15, 0); group.add(light); return light; })()
    : null;
  const pointLightOnIntensity = 0.18;

  function applyEmissive(on: boolean) {
    for (const material of clonedMaterials) {
      material.emissive.set(on ? "#fff0b8" : "#000000");
      material.emissiveIntensity = on ? 1.1 : 0;
    }
  }

  function syncLight(on: boolean) {
    if (pointLight) pointLight.intensity = on ? pointLightOnIntensity : 0;
  }

  loadGltf(budgetPath("environment", "equipment_ceiling_light")).then(async (gltf) => {
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
    await warmUpShadersBeforeAttach(renderer, model, camera, scene);
    modelAnchor.add(model);
    warmUpTexturesIdle(renderer, model);
    applyEmissive(currentOn);
  }).catch(() => {});

  function update(on: boolean) {
    currentOn = on;
    applyEmissive(on);
    syncLight(on);
  }
  return { group, update };
}

export interface StoreUtilitiesHandle {
  group: THREE.Group;
  update(lightsOn: boolean): void;
}

export function buildStoreUtilities(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, lightsOn: boolean, dynamicCeilingLights: boolean): StoreUtilitiesHandle {
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
    const lamp = buildCeilingLamp(renderer, camera, scene, dynamicCeilingLights);
    element.add(lamp.group);
    group.add(element);
    return lamp;
  });

  function update(on: boolean) {
    for (const lamp of lamps) lamp.update(on);
  }
  update(lightsOn);
  return { group, update };
}
