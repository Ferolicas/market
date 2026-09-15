"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { deliveredModelPath } from "./DeliveredModel";

/** Three supplied door leaves, their rigid pivots prepared at import time. */
export function DeliveredDairy({ open }: { open: boolean }) {
  const { scene } = useGLTF(deliveredModelPath("dairy"));
  const model = useMemo(() => {
    const copy = scene.clone(true);
    copy.traverse(node => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    return copy;
  }, [scene]);
  const doors = useRef<THREE.Object3D[]>([]);
  useEffect(() => {
    doors.current = [1, 2, 3].map(index => model.getObjectByName(`DairyDoor${index}`)).filter((door): door is THREE.Object3D => Boolean(door));
  }, [model]);
  useFrame((_, delta) => {
    for (const door of doors.current) door.rotation.set(0, THREE.MathUtils.damp(door.rotation.y, open ? -1.05 : 0, 8, Math.min(delta, 0.05)), 0);
  });
  return <group name="dynamic:delivered-dairy"><group name="delivered:dairy"><primitive object={model} dispose={null} /></group></group>;
}
