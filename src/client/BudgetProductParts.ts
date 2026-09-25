import * as THREE from "three";
import type { ProductId } from "@/game/types";
import { localMatrix, mergeStaticParts, type InstancedPart } from "@/game/render/CrowdParts";
import { productMaterial } from "@/components/game/HarvestBasket";
import { cornLabelMaterial, cornTinMaterial } from "@/components/game/CannedCornModel";

/**
 * Shelf units at shelf polygon counts: hundreds of them sit on the fixtures,
 * so each is a few dozen triangles with the same materials the basket units
 * use (the materials are what the eye reads at this distance).
 */
const geometry = {
  fruit: new THREE.IcosahedronGeometry(0.09, 1),
  crown: new THREE.ConeGeometry(0.045, 0.05, 4),
  egg: new THREE.SphereGeometry(0.073, 6, 5),
  bottle: new THREE.CylinderGeometry(0.052, 0.06, 0.2, 7),
  cap: new THREE.CylinderGeometry(0.028, 0.032, 0.05, 6),
  cheese: new THREE.CylinderGeometry(0.1, 0.1, 0.14, 3),
  loaf: new THREE.BoxGeometry(0.22, 0.15, 0.15),
  box: new THREE.BoxGeometry(0.17, 0.24, 0.12),
  tin: new THREE.CylinderGeometry(0.06, 0.06, 0.13, 8),
  cornBody: new THREE.CylinderGeometry(0.05, 0.06, 0.2, 6),
  stem: new THREE.CylinderGeometry(0.008, 0.01, 0.18, 4),
  head: new THREE.SphereGeometry(0.035, 5, 4),
};
const packageMaterial = { coffee: new THREE.MeshStandardMaterial({ color: "#6b3d2d", roughness: 0.72 }), flour: new THREE.MeshStandardMaterial({ color: "#eee4cc", roughness: 0.72 }), wheat: new THREE.MeshStandardMaterial({ color: "#d5ab42", roughness: 0.72 }) };
const cache = new Map<ProductId, InstancedPart[]>();

export function budgetProductParts(productId: ProductId): InstancedPart[] | null {
  const cached = cache.get(productId);
  if (cached) return cached;
  let parts: InstancedPart[] | null;
  switch (productId) {
    case "oranges": parts = [{ geometry: geometry.fruit, material: productMaterial.orange, local: localMatrix() }]; break;
    case "tomatoes": parts = [{ geometry: geometry.fruit, material: productMaterial.tomato, local: localMatrix([0, 0, 0], [0, 0, 0], [1, 0.86, 1]) }, { geometry: geometry.crown, material: productMaterial.crown, local: localMatrix([0, 0.08, 0], [0, 0, Math.PI]) }]; break;
    case "apples": parts = [{ geometry: geometry.fruit, material: productMaterial.apple, local: localMatrix([0, 0, 0], [0, 0, 0], [0.92, 1, 0.92]) }, { geometry: geometry.crown, material: productMaterial.crown, local: localMatrix([0, 0.08, 0], [0, 0, Math.PI]) }]; break;
    case "corn": parts = [{ geometry: geometry.cornBody, material: productMaterial.corn, local: localMatrix([0, 0, 0], [0, 0, 0.16]) }]; break;
    case "eggs": parts = [{ geometry: geometry.egg, material: productMaterial.egg, local: localMatrix([0, 0, 0], [0, 0, 0], [0.72, 1.02, 0.72]) }]; break;
    case "milk": parts = [{ geometry: geometry.bottle, material: productMaterial.milk, local: localMatrix() }, { geometry: geometry.cap, material: productMaterial.milkCap, local: localMatrix([0, 0.115, 0]) }]; break;
    case "juice": parts = [{ geometry: geometry.bottle, material: productMaterial.juice, local: localMatrix() }, { geometry: geometry.cap, material: productMaterial.juiceCap, local: localMatrix([0, 0.115, 0]) }]; break;
    case "cheese": parts = [{ geometry: geometry.cheese, material: productMaterial.cheese, local: localMatrix([0, 0, 0], [0, 0, Math.PI / 2]) }]; break;
    case "bread": parts = [{ geometry: geometry.loaf, material: productMaterial.bread, local: localMatrix() }]; break;
    case "cannedCorn": parts = [{ geometry: geometry.tin, material: cornTinMaterial, local: localMatrix() }, { geometry: geometry.box, material: cornLabelMaterial, local: localMatrix([0, 0, 0], [0, 0, 0], [0.72, 0.4, 1.02]) }]; break;
    case "wheat": parts = [-0.045, 0, 0.045].flatMap((x, index) => [
      { geometry: geometry.stem, material: productMaterial.wheatStem, local: localMatrix([x, 0.04, (index - 1) * 0.012], [0, 0, (index - 1) * 0.1]) },
      { geometry: geometry.head, material: productMaterial.wheatHead, local: localMatrix([x, 0.145, (index - 1) * 0.012], [0, 0, 0], [0.65, 1.25, 0.65]) },
    ]); break;
    case "coffee": case "flour": parts = [{ geometry: geometry.box, material: packageMaterial[productId], local: localMatrix() }]; break;
    default: parts = null;
  }
  const merged = parts ? mergeStaticParts(parts) : null;
  if (merged) cache.set(productId, merged);
  return merged;
}
