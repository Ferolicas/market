import * as THREE from "three";
import { FARM_BARN } from "@/game/stations/farm-layout";
import { makeBox, makeText } from "../primitives";

/**
 * Faithful port of `FarmBarn` from `MarketKit.tsx` (lines ~1467-1491): the
 * farm's intake to the warehouse. Purely static — a solid timber body on the
 * `FARM_BARN` footprint, open doors facing the middle corridor with a
 * drop-off pallet, a gable roof and a board that says what it is for.
 */
export function buildFarmBarn(): THREE.Group {
  const halfX = FARM_BARN.footprint.halfX;
  const halfZ = FARM_BARN.footprint.halfZ;
  const wallHeight = 1.42;

  const group = new THREE.Group();
  group.name = "static:farm-barn";

  group.add(makeBox({ args: [halfX * 2, 0.12, halfZ * 2], position: [0, 0.06, 0], color: "#8d7154", radius: 0.03 }));
  // Side and rear walls; the front stays open around a central post.
  group.add(makeBox({ args: [0.12, wallHeight, halfZ * 2], position: [-halfX + 0.06, wallHeight / 2 + 0.1, 0], color: "#9c3f2e" }));
  group.add(makeBox({ args: [0.12, wallHeight, halfZ * 2], position: [halfX - 0.06, wallHeight / 2 + 0.1, 0], color: "#9c3f2e" }));
  group.add(makeBox({ args: [halfX * 2, wallHeight, 0.12], position: [0, wallHeight / 2 + 0.1, -halfZ + 0.06], color: "#a8452f" }));
  group.add(makeBox({ args: [0.42, wallHeight, 0.1], position: [-halfX + 0.27, wallHeight / 2 + 0.1, halfZ - 0.05], color: "#9c3f2e" }));
  group.add(makeBox({ args: [0.42, wallHeight, 0.1], position: [halfX - 0.27, wallHeight / 2 + 0.1, halfZ - 0.05], color: "#9c3f2e" }));
  group.add(makeBox({ args: [halfX * 2, 0.22, 0.1], position: [0, wallHeight - 0.01, halfZ - 0.05], color: "#f1e3c8" }));
  // Gable roof: two pitched slabs meeting on the ridge.
  group.add(makeBox({ args: [halfX * 1.16, 0.08, halfZ * 2 + 0.36], position: [-halfX * 0.5, wallHeight + 0.5, 0], rotation: [0, 0, 0.62], color: "#5d3b2a" }));
  group.add(makeBox({ args: [halfX * 1.16, 0.08, halfZ * 2 + 0.36], position: [halfX * 0.5, wallHeight + 0.5, 0], rotation: [0, 0, -0.62], color: "#5d3b2a" }));
  group.add(makeBox({ args: [0.1, 0.12, halfZ * 2 + 0.4], position: [0, wallHeight + 0.98, 0], color: "#3d2619" }));
  // Drop-off pallet just inside the doors, where the baskets land.
  group.add(makeBox({ args: [1.1, 0.1, 0.7], position: [0, 0.17, halfZ - 0.55], color: "#c9a36a", radius: 0.02 }));
  group.add(makeBox({ args: [0.42, 0.34, 0.42], position: [-0.28, 0.39, halfZ - 0.55], color: "#d8b05c", radius: 0.03 }));
  group.add(makeBox({ args: [0.42, 0.28, 0.42], position: [0.3, 0.36, halfZ - 0.5], color: "#c99f4d", radius: 0.03 }));

  group.add(makeText({ text: "GRANERO", position: [0, wallHeight + 0.18, halfZ + 0.02], fontSize: 0.2, color: "#fff5d8", anchorX: "center", anchorY: "middle", fontWeight: 900 }));
  group.add(makeText({ text: "ENTREGA AL ALMACÉN", position: [0, wallHeight - 0.02, halfZ + 0.02], fontSize: 0.085, color: "#3d2619", anchorX: "center", anchorY: "middle", fontWeight: 800 }));

  return group;
}
