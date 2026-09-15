"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { animalMotion, type FarmAnimalClip, type FarmAnimalKind } from "@/game/animation/AnimalMotion";

export function FarmAnimal({ kind, active }: { kind: FarmAnimalKind; active: boolean }) {
  const gltf = useGLTF(`/models/market/delivered/${kind}.glb`);
  const root = useRef<THREE.Group>(null);
  const time = useRef(kind === "cow" ? 4 : 0);
  const current = useRef<FarmAnimalClip | null>(null);
  const model = useMemo(() => {
    const instance = clone(gltf.scene);
    instance.traverse(node => {
      if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; }
      // The animated head can extend beyond the rest-pose bounding sphere.
      if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false;
    });
    return instance;
  }, [gltf.scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  const actions = useMemo(() => Object.fromEntries(gltf.animations.map(clip => [clip.name, mixer.clipAction(clip)])), [gltf.animations, mixer]);
  useEffect(() => () => { mixer.stopAllAction(); mixer.uncacheRoot(model); }, [mixer, model]);
  useFrame((_, delta) => {
    // No catch-up leap when returning from a hidden tab. Mixer and travel
    // consume the same time, so slowing the render cannot desynchronise feet.
    const step = Math.min(delta, 0.05);
    time.current += step;
    const motion = animalMotion(kind, time.current, active);
    if (root.current) { root.current.position.x = motion.x; root.current.rotation.y = motion.yaw; }
    if (current.current !== motion.clip) {
      const previous = current.current ? actions[current.current] : undefined;
      const next = actions[motion.clip];
      next?.reset().setEffectiveWeight(1).play();
      if (previous && next) next.crossFadeFrom(previous, 0.18, false);
      current.current = motion.clip;
    }
    mixer.update(step);
  });
  return <group name={`dynamic:delivered-${kind}`} ref={root} position={[0, 0.08, 0.32]}><primitive object={model} dispose={null} /></group>;
}
