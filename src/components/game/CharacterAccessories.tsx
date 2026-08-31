"use client";

import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { AvatarHatId, CharacterId, HairId } from "@/game/types";

const HAIR_FILES: Record<HairId, string> = {
  "side-part": "side-part", fade: "fade", waves: "waves", swept: "swept",
  bob: "bob", ponytail: "ponytail", "long-wavy": "long-wavy", bun: "bun",
  messy: "messy", curls: "curls", "short-fringe": "short-fringe", quiff: "quiff",
  "blunt-bob": "blunt-bob", pigtails: "pigtails", braid: "braid",
  "high-ponytail": "high-ponytail",
};

const HAT_FILES: Record<Exclude<AvatarHatId, "none">, string> = {
  "red-panda": "red-panda", "red-fox": "red-fox", chicken: "chicken", owl: "owl",
  elephant: "elephant", rhino: "rhino", giraffe: "giraffe", panda: "panda",
  frog: "frog", cow: "cow", rabbit: "rabbit", capybara: "capybara",
};

function cloneStaticScene(scene: THREE.Group) {
  const copy = scene.clone(true);
  copy.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
  });
  return copy;
}

function disposeMaterials(model: THREE.Group) {
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

export function CharacterHair({ body, style, color }: { body: CharacterId; style: HairId; color: string }) {
  const gltf = useGLTF(`/models/market/hair/${body}/${HAIR_FILES[style]}.glb`);
  const model = useMemo(() => cloneStaticScene(gltf.scene), [gltf.scene]);

  useEffect(() => {
    const tint = new THREE.Color(color);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial) || !material.name.toLowerCase().includes("hair")) return;
        material.color.copy(tint);
        material.metalness = 0;
        material.roughness = Math.max(material.roughness, 0.74);
        material.envMapIntensity = 0.48;
        if (material instanceof THREE.MeshPhysicalMaterial) material.specularIntensity = 0.28;
      });
    });
  }, [color, model]);

  useEffect(() => () => disposeMaterials(model), [model]);
  return <primitive object={model} dispose={null} />;
}

export function CharacterHat({ body, hat }: { body: CharacterId; hat: Exclude<AvatarHatId, "none"> }) {
  const gltf = useGLTF(`/models/market/hats/${body}/${HAT_FILES[hat]}.glb`);
  const model = useMemo(() => cloneStaticScene(gltf.scene), [gltf.scene]);
  useEffect(() => () => disposeMaterials(model), [model]);
  return <primitive object={model} dispose={null} />;
}
