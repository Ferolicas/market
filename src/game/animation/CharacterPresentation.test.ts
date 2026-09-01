import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CHARACTER_SOLE_PROFILES, characterIsInView, characterModelPathForTier, characterModelTierForCapabilities, createCharacterVisibilityScratch, disposeCharacterMaterials, prepareCharacterModel, priorityCustomerModelPathsForTier } from "./CharacterPresentation";

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
  it("closes both shoes and applies a soft front-sided finish without mutating the GLB cache", () => {
    const { root, material: sourceMaterial } = characterFixture();
    const model = prepareCharacterModel(root, { repairOpenSoles: true });
    const body = model.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const material = body?.material;

    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material).not.toBe(sourceMaterial);
    expect((material as THREE.MeshPhysicalMaterial).side).toBe(THREE.FrontSide);
    expect((material as THREE.MeshPhysicalMaterial).roughness).toBeGreaterThanOrEqual(0.54);
    expect((material as THREE.MeshPhysicalMaterial).roughness).toBeLessThanOrEqual(0.68);
    expect((material as THREE.MeshPhysicalMaterial).clearcoat).toBeCloseTo(0.1);
    expect(sourceMaterial.side).toBe(THREE.FrontSide);
    expect(sourceMaterial.roughness).toBeCloseTo(0.94);
    expect(model.getObjectByName("PremiumSole_L")).toBeInstanceOf(THREE.Mesh);
    expect(model.getObjectByName("PremiumSole_R")).toBeInstanceOf(THREE.Mesh);
  });

  it("keeps only thin eyelash cards two-sided", () => {
    const root = new THREE.Group();
    const eyelash = new THREE.MeshStandardMaterial();
    eyelash.name = "Eyelash.001";
    const body = new THREE.MeshStandardMaterial();
    body.name = "CharacterAtlas";
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(), eyelash));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), body));

    const model = prepareCharacterModel(root);
    const materials = model.children.map((child) => (child as THREE.Mesh).material as THREE.Material);

    expect(materials[0].side).toBe(THREE.DoubleSide);
    expect(materials[1].side).toBe(THREE.FrontSide);
  });

  it("keeps conservative mesh culling and disables dynamic shadows for reduced actors", () => {
    const { root } = characterFixture();
    const model = prepareCharacterModel(root, { reducedDetail: true });
    const body = model.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);

    expect(body?.frustumCulled).toBe(true);
    expect(body?.castShadow).toBe(false);
    expect(body?.geometry.boundingSphere?.radius).toBeGreaterThanOrEqual(2.4);
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

  it("selects LODs from live pointer, hardware and viewport capabilities", () => {
    expect(characterModelTierForCapabilities({ width: 1440, height: 900, coarsePointer: false, hardwareConcurrency: 12, deviceMemory: 16 })).toBe(0);
    expect(characterModelTierForCapabilities({ width: 844, height: 390, coarsePointer: true, hardwareConcurrency: 8, deviceMemory: 8, devicePixelRatio: 2 })).toBe(1);
    expect(characterModelTierForCapabilities({ width: 390, height: 844, coarsePointer: true, hardwareConcurrency: 2, deviceMemory: 2, devicePixelRatio: 3 })).toBe(2);
    expect(characterModelTierForCapabilities({ width: 620, height: 900, coarsePointer: false, hardwareConcurrency: 8, deviceMemory: 8 })).toBe(1);
  });

  it("maps both character families to one selected LOD without changing full paths", () => {
    expect(characterModelPathForTier("/models/market/characters/owner_man.glb", 0)).toBe("/models/market/characters/owner_man.glb");
    expect(characterModelPathForTier("/models/market/characters/owner_man.glb", 1)).toBe("/models/market/characters/lod1/owner_man.glb");
    expect(characterModelPathForTier("/models/market/customers/customer_01.glb", 2)).toBe("/models/market/customers/lod2/customer_01.glb");
  });

  it("preloads only the deterministic first three customer identities for the active tier", () => {
    expect(priorityCustomerModelPathsForTier(2)).toEqual([
      "/models/market/customers/lod2/customer_01_man_young.glb",
      "/models/market/customers/lod2/customer_02_man_senior.glb",
      "/models/market/customers/lod2/customer_03_woman_young.glb",
    ]);
    expect(priorityCustomerModelPathsForTier(0)).toHaveLength(3);
    expect(priorityCustomerModelPathsForTier(0)).not.toContain("/models/market/customers/customer_04_woman_adult.glb");
    expect(priorityCustomerModelPathsForTier(0).some((path) => path.includes("/characters/owner_"))).toBe(false);
  });

  it("uses conservative bounds to cull only actors safely outside the camera", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 1, 7);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const actor = new THREE.Group();
    const scratch = createCharacterVisibilityScratch();

    expect(characterIsInView(camera, actor, scratch)).toBe(true);
    actor.position.x = 100;
    expect(characterIsInView(camera, actor, scratch)).toBe(false);
  });
});
