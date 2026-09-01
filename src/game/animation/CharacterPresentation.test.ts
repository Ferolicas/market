import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CHARACTER_SOLE_PROFILES, disposeCharacterMaterials, prepareCharacterModel } from "./CharacterPresentation";

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
    const model = prepareCharacterModel(root, { repairOpenSoles: true });
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
    const model = prepareCharacterModel(root, { repairOpenSoles: true });
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

  it.each(["adult", "child"] as const)("keeps the %s rubber insert centred, thin and inside an anatomical shoe silhouette", (build) => {
    const { root } = characterFixture();
    const model = prepareCharacterModel(root, { build, repairOpenSoles: true });
    const left = model.getObjectByName("PremiumSole_L") as THREE.Mesh;
    const right = model.getObjectByName("PremiumSole_R") as THREE.Mesh;
    const profile = CHARACTER_SOLE_PROFILES[build];
    left.geometry.computeBoundingBox();
    const size = left.geometry.boundingBox?.getSize(new THREE.Vector3());
    const material = left.material as THREE.MeshStandardMaterial;

    expect(size?.x).toBeCloseTo(profile.width, 5);
    expect(size?.y).toBeCloseTo(profile.thickness, 5);
    expect(size?.z).toBeCloseTo(profile.length, 5);
    expect(profile.length / profile.width).toBeGreaterThan(1.5);
    expect(profile.length / profile.width).toBeLessThan(1.7);
    expect(profile.thickness / profile.length).toBeLessThan(0.11);
    expect(left.position.z).toBe(0);
    expect(right.position.z).toBe(0);
    expect(left.geometry).toBe(right.geometry);
    expect(left.material).toBe(right.material);
    expect(material.metalness).toBe(0);
    expect(material.roughness).toBeGreaterThanOrEqual(0.8);
  });

  it("does not duplicate the rigged outsole already baked into current market characters", () => {
    const { root } = characterFixture();
    const model = prepareCharacterModel(root);

    expect(model.getObjectByName("PremiumSole_L")).toBeUndefined();
    expect(model.getObjectByName("PremiumSole_R")).toBeUndefined();
  });

  it("prepares a shared atlas once for an oblique camera without cloning its texture", () => {
    const { root, material: sourceMaterial } = characterFixture();
    const atlas = new THREE.Texture({ width: 512, height: 512 });
    atlas.anisotropy = 1;
    atlas.magFilter = THREE.NearestFilter;
    atlas.minFilter = THREE.NearestFilter;
    atlas.generateMipmaps = false;
    sourceMaterial.map = atlas;

    const first = prepareCharacterModel(root);
    const second = prepareCharacterModel(root, { crowd: true });
    const firstBody = first.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const secondBody = second.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);

    expect((firstBody?.material as THREE.MeshStandardMaterial).map).toBe(atlas);
    expect((secondBody?.material as THREE.MeshStandardMaterial).map).toBe(atlas);
    expect(atlas.anisotropy).toBeGreaterThanOrEqual(8);
    expect(atlas.magFilter).toBe(THREE.LinearFilter);
    expect(atlas.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(atlas.generateMipmaps).toBe(true);
  });

  it("does not request runtime mipmap generation for compressed character maps", () => {
    const { root, material: sourceMaterial } = characterFixture();
    const atlas = new THREE.CompressedTexture([], 4, 4);
    atlas.generateMipmaps = false;
    sourceMaterial.map = atlas;

    prepareCharacterModel(root);

    expect(atlas.anisotropy).toBeGreaterThanOrEqual(8);
    expect(atlas.generateMipmaps).toBe(false);
    expect(atlas.minFilter).toBe(THREE.LinearFilter);
  });
});
