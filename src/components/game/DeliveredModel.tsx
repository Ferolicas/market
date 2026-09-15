"use client";

import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type DeliveredModelId = "mill" | "oven" | "juicer" | "dairy" | "egg-display" | "milk" | "cheese" | "egg";
export const deliveredModelPath = (id: DeliveredModelId) => `/models/market/delivered/${id}.glb`;
type Position = [number, number, number];
export type DeliveredTransform = { position: Position; rotation?: Position; quaternion?: [number, number, number, number]; scale?: Position };
export const deliveredProductId = (id: string): "milk" | "cheese" | "egg" | null => id === "eggs" ? "egg" : id === "milk" || id === "cheese" ? id : null;

export function DeliveredModel({ id, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 }: { id: DeliveredModelId; position?: Position; rotation?: Position; scale?: number }) {
  const { scene } = useGLTF(deliveredModelPath(id));
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    return clone;
  }, [scene]);
  return <group name={`delivered:${id}`} position={position} rotation={rotation} scale={scale}><primitive object={model} dispose={null} /></group>;
}

// Products share the loader's geometry/material. Bake quantization transforms
// once, then instance the delivered SKU instead of one draw per unit.
const productMeshes = new WeakMap<THREE.Group, { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[]>();
function productParts(scene: THREE.Group) {
  let parts = productMeshes.get(scene);
  if (parts) return parts;
  scene.updateWorldMatrix(true, true);
  parts = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) parts!.push({ geometry: node.geometry.clone().applyMatrix4(node.matrixWorld), material: node.material });
  });
  productMeshes.set(scene, parts);
  return parts;
}

export function DeliveredProductInstances({ id, transforms, capacity }: { id: "milk" | "cheese" | "egg"; transforms: readonly DeliveredTransform[]; capacity: number }) {
  const { scene } = useGLTF(deliveredModelPath(id));
  const parts = useMemo(() => productParts(scene), [scene]);
  return <group dispose={null}>{parts.map((part, index) => <ProductInstances key={index} {...part} transforms={transforms} capacity={capacity} />)}</group>;
}

function ProductInstances({ geometry, material, transforms, capacity }: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; transforms: readonly DeliveredTransform[]; capacity: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    transforms.forEach((transform, index) => {
      dummy.position.set(...transform.position);
      if (transform.quaternion) dummy.quaternion.set(...transform.quaternion);
      else dummy.rotation.set(...(transform.rotation ?? [0, 0, 0]));
      dummy.scale.set(...(transform.scale ?? [1, 1, 1]));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.count = transforms.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [transforms]);
  return <instancedMesh ref={ref} args={[geometry, material, Math.max(1, capacity)]} castShadow receiveShadow dispose={null} />;
}
