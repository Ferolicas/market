import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { disposeCharacterMaterials, prepareCharacterModel } from "./CharacterPresentation";

function characterFixture() {
  const root = new THREE.Group();
  const material = new THREE.MeshPhysicalMaterial({ roughness: 0.94, metalness: 0.4 });
  material.name = "CharacterAtlas";
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
  for (const side of ["L", "R"] as const) {
    const foot = new THREE.Bone();
    foot.name = `Foot_${side}`;
    root.add(foot);
  }
  return { root, material };
}

describe("character presentation", () => {
  it("closes both shoes and applies a soft two-sided finish without mutating the GLB cache", () => {
    const { root, material: sourceMaterial } = characterFixture();
    const model = prepareCharacterModel(root);
    const body = model.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const material = body?.material;

    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material).not.toBe(sourceMaterial);
    expect((material as THREE.MeshPhysicalMaterial).side).toBe(THREE.DoubleSide);
    expect((material as THREE.MeshPhysicalMaterial).roughness).toBeGreaterThanOrEqual(0.54);
    expect((material as THREE.MeshPhysicalMaterial).roughness).toBeLessThanOrEqual(0.68);
    expect((material as THREE.MeshPhysicalMaterial).clearcoat).toBeCloseTo(0.1);
    expect(sourceMaterial.side).toBe(THREE.FrontSide);
    expect(sourceMaterial.roughness).toBeCloseTo(0.94);
    expect(model.getObjectByName("PremiumSole_L")).toBeInstanceOf(THREE.Mesh);
    expect(model.getObjectByName("PremiumSole_R")).toBeInstanceOf(THREE.Mesh);
  });

  it("disposes the instance finish but preserves shared sole resources", () => {
    const { root } = characterFixture();
    const model = prepareCharacterModel(root);
    const body = model.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const bodyDispose = vi.fn();
    const soleDispose = vi.fn();
    const bodyMaterial = body?.material as THREE.Material;
    const soleMaterial = (model.getObjectByName("PremiumSole_L") as THREE.Mesh).material as THREE.Material;
    bodyMaterial.addEventListener("dispose", bodyDispose);
    soleMaterial.addEventListener("dispose", soleDispose);

    disposeCharacterMaterials(model);

    expect(bodyDispose).toHaveBeenCalledOnce();
    expect(soleDispose).not.toHaveBeenCalled();
  });
});
