import * as THREE from "three";
import type { Inventory, ProductId } from "@/game/types";
import { makeBox, makeText, type Position } from "../primitives";
import { buildRetailProductUnit } from "./retailProductUnit";

/**
 * Faithful port of `ReturnsCubicle` from `MarketKit.tsx`. The shell is
 * static; the units shown on the shelf depend on `inventory` and are rebuilt
 * (cheap: at most 6 small meshes) whenever `update()` is called.
 */
export function buildReturnsCubicle(): { group: THREE.Group; update(inventory: Inventory): void } {
  const group = new THREE.Group();
  group.name = "fixture:returns";
  group.rotation.set(0, Math.PI, 0);

  group.add(makeBox({ args: [1.35, 1.25, 1.05], position: [0, 0.63, 0], color: "#d5c3aa", radius: 0.08 }));
  group.add(makeBox({ args: [1.05, 0.72, 0.82], position: [0, 0.86, 0.04], color: "#735847", radius: 0.06 }));

  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.34, 0.08), new THREE.MeshStandardMaterial({ color: "#e7bb62" }));
  sign.position.set(0, 1.31, 0.54);
  group.add(sign);

  group.add(makeText({ text: "DEVOLUCIONES", position: [0, 1.31, 0.59], fontSize: 0.15, color: "#493821", anchorX: "center" }));

  const unitsGroup = new THREE.Group();
  unitsGroup.name = "returns-units";
  group.add(unitsGroup);

  function update(inventory: Inventory) {
    while (unitsGroup.children.length) unitsGroup.remove(unitsGroup.children[0]!);
    const units = (Object.entries(inventory) as [ProductId, number][])
      .flatMap(([productId, quantity]) => Array.from({ length: Math.min(6, quantity) }, () => productId))
      .slice(0, 6);
    units.forEach((productId, index) => {
      const position: Position = [((index % 3) - 1) * 0.24, 0.62 + Math.floor(index / 3) * 0.2, 0.48];
      unitsGroup.add(buildRetailProductUnit(productId, position));
    });
  }

  update({} as Inventory);

  return { group, update };
}
