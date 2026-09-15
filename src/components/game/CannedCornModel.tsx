"use client";

import * as THREE from "three";
import type { ThreeElements } from "@react-three/fiber";

// Original low-poly tin. Shared by basket, checkout, flights and shelf instances.
export const cornTinGeometry = new THREE.CylinderGeometry(0.078, 0.078, 0.2, 12);
export const cornLabelGeometry = new THREE.CylinderGeometry(0.079, 0.079, 0.13, 12, 1, true);
export const cornTinMaterial = new THREE.MeshStandardMaterial({ color: "#b9c3c0", metalness: 0.65, roughness: 0.38 });
export const cornLabelMaterial = new THREE.MeshStandardMaterial({ color: "#dfb642", metalness: 0, roughness: 0.85 });

export function CannedCornModel(props: ThreeElements["group"]) {
  return <group name="product:cannedCorn" dispose={null} {...props}>
    <mesh geometry={cornTinGeometry} material={cornTinMaterial} castShadow />
    <mesh geometry={cornLabelGeometry} material={cornLabelMaterial} />
  </group>;
}
