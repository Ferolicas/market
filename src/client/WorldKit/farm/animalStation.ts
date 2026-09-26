import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ProductionMachineState } from "@/game/types";
import { animalMotion, type FarmAnimalClip, type FarmAnimalKind } from "@/game/animation/AnimalMotion";
import { chickenFeedStatus } from "@/game/stations/StationSystem";
import { budgetPath, loadGltf } from "../../WorldAssets";
import { makeInstances, type InstanceTransform, type Position } from "../primitives";
import { buildStationSign, roundedBoxMesh } from "./farmShared";

/**
 * Faithful port of `AnimalPaddock`, `StationSign`'s animal-station call site,
 * `AnimalStation`, `ChickenCharacter`/`CowCharacter` (thin wrappers around
 * `FarmAnimal`) from `MarketKit.tsx` (lines ~1389-1460) plus `FarmAnimal`
 * itself from `FarmAnimal.tsx`.
 *
 * `FarmAnimal` is a real skinned/animated GLB character driven by a
 * `THREE.AnimationMixer` and the same pure `animalMotion()` the source uses —
 * it is NOT the crowd system's per-texture GPU skinning (`CrowdSystems.ts`),
 * which is built for hundreds of concurrently walking customers sharing one
 * draw call. There are at most three animal stations on screen at once, each
 * with exactly one character, so a plain per-instance `AnimationMixer` (one
 * clone via `SkeletonUtils.clone`, same as the source, so two chickens don't
 * share bone state) is the faithful and appropriately-scoped port; reaching
 * for the crowd system here would be over-engineering for three actors.
 *
 * The coop/station shell (`chicken_coop`/`cow_station`) and the output prop
 * (`egg_output_tray`/`milk_output_can`) are real GLBs loaded through the
 * same `loadGltf`/`budgetPath` helper `StationLayer.ts` and
 * `ClientRuntime.ts` already use for every other prop in this client, at the
 * "budget" (low-poly) variant every other WorldKit-adjacent module uses —
 * consistent with the rest of `src/client/*`, not a fidelity cut introduced
 * here. `EnvironmentModel`'s `castShadow`/`receiveShadow = true` on every
 * mesh is copied through.
 */

function buildAnimalCharacter(kind: FarmAnimalKind) {
  const group = new THREE.Group();
  group.name = `dynamic:delivered-${kind}`;
  group.position.set(0, 0.08, 0.32);

  let time = kind === "cow" ? 4 : 0;
  let lastTick = performance.now();
  let mixer: THREE.AnimationMixer | null = null;
  let actions: Record<string, THREE.AnimationAction> = {};
  let currentClip: FarmAnimalClip | null = null;
  let root: THREE.Object3D | null = null;

  loadGltf(budgetPath("delivered", kind)).then((gltf) => {
    const instance = cloneSkeleton(gltf.scene) as THREE.Object3D;
    instance.traverse((node) => {
      if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; }
      // The animated head can extend beyond the rest-pose bounding sphere.
      if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false;
    });
    root = instance;
    group.add(instance);
    mixer = new THREE.AnimationMixer(instance);
    actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, mixer!.clipAction(clip)]));
  }).catch(() => {});

  function update(active: boolean) {
    const now = performance.now();
    // No catch-up leap when returning from a hidden tab.
    const step = Math.min((now - lastTick) / 1000, 0.05);
    lastTick = now;
    if (!mixer || !root) return;
    time += step;
    const motion = animalMotion(kind, time, active);
    root.position.x = motion.x;
    root.rotation.y = motion.yaw;
    if (currentClip !== motion.clip) {
      const previous = currentClip ? actions[currentClip] : undefined;
      const next = actions[motion.clip];
      next?.reset().setEffectiveWeight(1).play();
      if (previous && next) next.crossFadeFrom(previous, 0.18, false);
      currentClip = motion.clip;
    }
    mixer.update(step);
  }

  return { group, update };
}

function loadEnvironmentProp(id: string, into: THREE.Group) {
  loadGltf(budgetPath("environment", id)).then((gltf) => {
    const model = gltf.scene.clone(true);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    into.add(model);
  }).catch(() => {});
}

/** `AnimalPaddock`: the static pen shell (ground, posts, rails, trough). */
export function buildAnimalPaddock(kind: "chicken" | "cow"): THREE.Group {
  const width = kind === "cow" ? 3.35 : 2.75;
  const depth = kind === "cow" ? 2.25 : 1.95;
  const posts: InstanceTransform[] = [
    ...[-width / 2, width / 2].flatMap((x) => [-depth / 2, 0, depth / 2].map((z): InstanceTransform => ({ position: [x, 0.46, z], scale: [0.085, 0.92, 0.085] }))),
    ...[-width / 4, 0, width / 4].flatMap((x) => [-depth / 2, depth / 2].map((z): InstanceTransform => ({ position: [x, 0.46, z], scale: [0.085, 0.92, 0.085] }))),
  ];
  const rails: InstanceTransform[] = [
    ...[-depth / 2, depth / 2].flatMap((z) => [0.32, 0.67].map((y): InstanceTransform => ({ position: [0, y, z], scale: [width, 0.07, 0.07] }))),
    ...[-width / 2, width / 2].flatMap((x) => [0.32, 0.67].map((y): InstanceTransform => ({ position: [x, y, 0], scale: [0.07, 0.07, depth] }))),
  ];

  const group = new THREE.Group();

  // Bevel radius must be smaller than half the thickness. The old 0.16
  // inverted the thin shape and raised its surface through the legs.
  const ground = roundedBoxMesh({
    args: [width + 0.22, 0.075, depth + 0.22],
    position: [0, 0.035, 0],
    radius: 0.025,
    smoothness: 2,
    material: new THREE.MeshStandardMaterial({ color: kind === "cow" ? "#6d9b55" : "#78a65b", roughness: 1 }),
    receiveShadow: true,
  });
  ground.name = `farm-paddock-ground:${kind}`;
  group.add(ground);

  group.add(makeInstances(posts, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#6d4930", roughness: 0.94 }), { castShadow: true }));
  group.add(makeInstances(rails, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#95643c", roughness: 0.92 }), { castShadow: true }));

  const trough = new THREE.Group();
  trough.position.set(width * 0.31, 0.18, -depth * 0.27);
  trough.add(roundedBoxMesh({
    args: [kind === "cow" ? 0.72 : 0.5, 0.28, 0.38],
    radius: 0.07,
    smoothness: 2,
    material: new THREE.MeshStandardMaterial({ color: "#668c86", metalness: 0.12, roughness: 0.64 }),
  }));
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(kind === "cow" ? 0.58 : 0.38, 0.04, 0.25),
    new THREE.MeshStandardMaterial({ color: "#91c4cf", transparent: true, opacity: 0.78, roughness: 0.22 }),
  );
  water.position.set(0, 0.16, 0);
  trough.add(water);
  group.add(trough);

  return group;
}

/** `AnimalStation`: sign + coop/station shell + live animal + output prop. */
export function buildAnimalStation(kind: "chicken" | "cow", position: Position) {
  const group = new THREE.Group();
  group.name = "dynamic:farm-animal";
  group.position.set(...position);

  const sign = buildStationSign({
    position: [kind === "cow" ? 1.95 : 1.75, 0, 0.1],
    title: kind === "cow" ? "VACA" : "GALLINA",
    rowCount: 2,
  });
  group.add(sign.group);

  const shell = new THREE.Group();
  group.add(shell);
  loadEnvironmentProp(kind === "chicken" ? "chicken_coop" : "cow_station", shell);

  const animal = buildAnimalCharacter(kind);
  group.add(animal.group);

  const outputProp = new THREE.Group();
  outputProp.position.set(kind === "cow" ? 0.62 : 0.44, 0.02, 0.42);
  outputProp.scale.setScalar(0.72);
  outputProp.visible = false;
  group.add(outputProp);
  loadEnvironmentProp(kind === "chicken" ? "egg_output_tray" : "milk_output_can", outputProp);

  function update(machine: ProductionMachineState) {
    const feed = chickenFeedStatus(machine);
    const hungry = feed.occupied === 0;
    sign.update([
      { label: kind === "cow" ? "TRIGO" : "TOMATES", value: `${feed.occupied}/${feed.capacity}`, tone: hungry ? "#ffb27a" : "#ffffff" },
      { label: kind === "cow" ? "LECHE" : "HUEVOS", value: `${machine.output}/${machine.outputCapacity}`, tone: machine.output > 0 ? "#8ce6a1" : "#ffffff" },
    ]);
    animal.update(machine.status === "PROCESSING");
    outputProp.visible = machine.output > 0;
  }

  return { group, update };
}
