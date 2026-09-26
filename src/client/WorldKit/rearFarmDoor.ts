import * as THREE from "three";
import { STORE_REAR_DOOR, advanceRearDoorMotion, CLOSED_REAR_DOOR_MOTION, rearDoorActorPresent, rearDoorLeafCenter } from "@/game/stations/storefront-layout";
import { liveActors } from "@/game/render/LiveActors";
import { STORE_LAYOUT_SCALE } from "@/game/world-scale";

/**
 * `dynamic:rear-farm-door` (`RearDoorAssembly` in `MarketScene.tsx`) — a
 * SECOND door, distinct from the storefront one, found during the
 * disjointness audit: it also has real swinging leaves and was also
 * completely unowned in `/play2` (confirmed: zero references anywhere under
 * `src/client/`). It opens automatically when the player or any employee
 * is near (`rearDoorActorPresent`), not from `franchise.doorState`. The
 * source's Rapier `CuboidCollider`s have no plain-three equivalent to hook
 * into — this client has no physics engine for anything, doors included —
 * so only the real visual leaves/indicator are ported, no collider invented.
 */
export interface RearFarmDoorHandle {
  group: THREE.Group;
  /** Call every rendered frame with the player's CURRENT design-unit [x, z]. */
  update: (playerX: number, playerZ: number, deltaSeconds: number) => void;
  /** Current leaf-open progress (0 closed, 1 open) — read by `PlayerPhysics` to keep its door colliders in sync with the visual leaves. */
  readonly progress: number;
}

const leafGlassMaterial = new THREE.MeshPhysicalMaterial({ color: "#cbe8de", transparent: true, opacity: 0.42, transmission: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, roughness: 0.13, metalness: 0.04, depthWrite: false });
const leafEdgeMaterial = new THREE.MeshStandardMaterial({ color: "#294a41", metalness: 0.72, roughness: 0.24 });
const leafHandleMaterial = new THREE.MeshStandardMaterial({ color: "#e4b95f", metalness: 0.7, roughness: 0.22 });
const indicatorHousingMaterial = new THREE.MeshStandardMaterial({ color: "#203a33", metalness: 0.5, roughness: 0.3 });

export function buildRearFarmDoor(): RearFarmDoorHandle {
  const door = STORE_REAR_DOOR.door;
  const doorHalfHeight = door.leafHeight / 2;

  const group = new THREE.Group();
  group.name = "dynamic:rear-farm-door";
  group.scale.set(STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE);

  const leaves: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const leaf = new THREE.Group();
    leaf.position.set(rearDoorLeafCenter(side, 0), doorHalfHeight, STORE_REAR_DOOR.z);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(door.leafWidth, door.leafHeight, door.leafDepth), leafGlassMaterial);
    panel.castShadow = true;
    panel.receiveShadow = true;
    leaf.add(panel);
    for (const edge of [-door.leafWidth / 2, door.leafWidth / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.065, door.leafHeight + 0.02, 0.1), leafEdgeMaterial);
      post.position.set(edge, 0, 0.055);
      post.castShadow = true;
      leaf.add(post);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.6, 0.055), leafHandleMaterial);
    handle.position.set(side * -0.27, 0, 0.075);
    leaf.add(handle);
    group.add(leaf);
    leaves.push(leaf);
  }

  const indicatorGroup = new THREE.Group();
  indicatorGroup.position.set(STORE_REAR_DOOR.x, door.leafHeight + 0.38, STORE_REAR_DOOR.z + 0.035);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.22, 0.18), indicatorHousingMaterial);
  housing.castShadow = true;
  indicatorGroup.add(housing);
  const indicatorMaterial = new THREE.MeshStandardMaterial({ color: "#f0bd66", emissive: "#9d681d", emissiveIntensity: 1.15 });
  const indicatorLight = new THREE.Mesh(new THREE.CircleGeometry(0.058, 18), indicatorMaterial);
  indicatorLight.position.set(0, 0, 0.105);
  indicatorGroup.add(indicatorLight);
  group.add(indicatorGroup);

  let motion = { ...CLOSED_REAR_DOOR_MOTION };

  const update = (playerX: number, playerZ: number, deltaSeconds: number) => {
    const playerPresent = rearDoorActorPresent([playerX, playerZ]);
    let employeePresent = false;
    if (!playerPresent) {
      for (const runtime of liveActors.employees.values()) {
        if (rearDoorActorPresent([runtime.x, runtime.z])) { employeePresent = true; break; }
      }
    }
    motion = advanceRearDoorMotion(motion, playerPresent || employeePresent, deltaSeconds * 1_000);
    const progress = motion.progress;
    leaves[0].position.x = rearDoorLeafCenter(-1, progress);
    leaves[1].position.x = rearDoorLeafCenter(1, progress);
    const open = progress > 0.98;
    indicatorMaterial.color.set(open ? "#79ecad" : "#f0bd66");
    indicatorMaterial.emissive.set(open ? "#36a878" : "#9d681d");
  };

  return { group, update, get progress() { return motion.progress; } };
}
