import * as THREE from "three";
import { STOREFRONT_LAYOUT, storefrontDoorLeafCenter, storefrontDoorProgress } from "@/game/stations/storefront-layout";
import { frameDelta } from "@/game/locomotion";
import { STORE_LAYOUT_SCALE } from "@/game/world-scale";

/**
 * `dynamic:storefront-door`, from `MarketBuilding`/`StorefrontDoorMotion` in
 * `MarketScene.tsx` — the ONE piece of the structural shell that genuinely
 * cannot be baked (it swings). Confirmed this had NO owner at all in
 * `/play2` before this port: the source explicitly excludes this whole
 * group from `export-static-world.mjs`'s static bake (matched by
 * `dynamic:storefront-door` in its mesh-skip regex), and nothing in
 * `src/client/` previously built or animated it — the doors were simply
 * invisible in the plain-three client. `ClientRuntime.ts` now builds this
 * once (`buildStorefrontDoor`) and drives it every frame (`update`), so the
 * door has exactly one owner instead of zero.
 */
const STOREFRONT_DOOR_TRAVEL_MS = 450; // MarketScene.tsx's own constant, copied verbatim.

const postMaterial = new THREE.MeshStandardMaterial({ color: "#294a41", metalness: 0.6, roughness: 0.28 });
const leafFrameMaterial = new THREE.MeshStandardMaterial({ color: "#294a41", metalness: 0.62, roughness: 0.25 });
const glassMaterial = new THREE.MeshPhysicalMaterial({ color: "#c9e9e3", transparent: true, opacity: 0.28, transmission: 0.5, clearcoat: 1, clearcoatRoughness: 0.04, roughness: 0.06, envMapIntensity: 1.9, depthWrite: false });
const glintMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.32, depthWrite: false });
const indicatorHousingMaterial = new THREE.MeshStandardMaterial({ color: "#203a33", metalness: 0.42, roughness: 0.32 });
const indicatorOpenMaterial = new THREE.MeshStandardMaterial({ color: "#72e8a9", emissive: "#2fac74", emissiveIntensity: 1.35 });
const indicatorClosedMaterial = new THREE.MeshStandardMaterial({ color: "#f08d73", emissive: "#b84f38", emissiveIntensity: 1.35 });

export interface StorefrontDoorHandle {
  group: THREE.Group;
  /** Call every rendered frame — matches `StorefrontDoorMotion`'s own `useFrame`, not a per-tick update. */
  update: (doorState: "OPEN" | "OPENING" | "CLOSING" | "CLOSED" | string, doorProgress: number, open: boolean, deltaSeconds: number) => void;
  /** Current leaf-open progress (0 closed, 1 open) — read by `PlayerPhysics` to keep its door colliders in sync with the visual leaves. */
  readonly progress: number;
}

export function buildStorefrontDoor(): StorefrontDoorHandle {
  const door = STOREFRONT_LAYOUT.door;
  // The source nests `dynamic:storefront-door` (unscaled design-unit
  // position/geometry) inside `perf:building`'s own
  // `scale={[STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE]}` wrapper — a
  // group's `position` is in its PARENT's space, so that ancestor scale
  // multiplies the door's z-position too, not just its children's geometry.
  // Reproduced here with the same two-level nesting, not a single group with
  // both position and scale set on it (which would leave the position
  // unscaled — a real, easy-to-miss bug caught during the disjointness
  // audit).
  const wrapper = new THREE.Group();
  wrapper.name = "dynamic:storefront-door";
  wrapper.scale.set(STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE);
  const group = new THREE.Group();
  wrapper.add(group);
  group.position.set(0, door.leafHeight / 2, STOREFRONT_LAYOUT.z);

  const leaves: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const leaf = new THREE.Group();
    leaf.position.set(storefrontDoorLeafCenter(side, 0), 0, 0);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(door.leafWidth, door.leafHeight, door.leafDepth), glassMaterial);
    leaf.add(panel);
    for (const edge of [-door.leafWidth / 2, door.leafWidth / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.075, door.leafHeight + 0.02, 0.1), leafFrameMaterial);
      post.position.set(edge, 0, 0.07);
      leaf.add(post);
    }
    const glint = new THREE.Mesh(new THREE.PlaneGeometry(0.075, door.leafHeight * 0.61), glintMaterial);
    glint.position.set(0, 0.9, 0.1);
    glint.rotation.z = -0.2;
    leaf.add(glint);
    group.add(leaf);
    leaves.push(leaf);
  }

  for (const x of [-door.outerPostX, door.outerPostX]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(door.postWidth, door.leafHeight + 0.16, door.frameDepth), postMaterial);
    post.position.set(x, 0, 0.08);
    group.add(post);
  }
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(door.outerPostX * 2 + door.postWidth * 2, 0.14, 0.15), postMaterial);
  topBar.position.set(0, door.leafHeight / 2 + 0.07, 0.08);
  group.add(topBar);

  const indicator = new THREE.Group();
  indicator.position.set(0, door.leafHeight / 2 + 0.38, 0.02);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.24, 0.2), indicatorHousingMaterial);
  indicator.add(housing);
  const light = new THREE.Mesh(new THREE.CircleGeometry(0.065, 20), indicatorClosedMaterial);
  light.position.set(0, 0, 0.12);
  indicator.add(light);
  group.add(indicator);

  let progress = storefrontDoorProgress(0);

  const update = (doorState: string, doorProgress: number, open: boolean, deltaSeconds: number) => {
    const target = doorState === "OPENING" || doorState === "OPEN" ? 1 : doorState === "CLOSING" || doorState === "CLOSED" ? 0 : storefrontDoorProgress(doorProgress);
    const step = (frameDelta(deltaSeconds) * 1_000) / STOREFRONT_DOOR_TRAVEL_MS;
    progress = progress < target ? Math.min(target, progress + step) : Math.max(target, progress - step);
    leaves[0].position.x = storefrontDoorLeafCenter(-1, progress);
    leaves[1].position.x = storefrontDoorLeafCenter(1, progress);
    light.material = open ? indicatorOpenMaterial : indicatorClosedMaterial;
  };

  return { group: wrapper, update, get progress() { return progress; } };
}
