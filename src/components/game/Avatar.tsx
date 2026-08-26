"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { HATS } from "@/game/catalog";
import type { HatId } from "@/game/types";

interface AvatarProps {
  skin: string;
  shirt: string;
  hat: HatId;
  walking?: boolean;
  scale?: number;
}

export function Avatar({ skin, shirt, hat, walking = false, scale = 1 }: AvatarProps) {
  const upperBody = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const phase = useRef(0);

  useFrame((_, delta) => {
    phase.current += delta * (walking ? 10 : 4);
    const stride = walking ? Math.sin(phase.current) * 0.7 : 0;
    const settle = Math.min(1, delta * 14);

    if (leftLeg.current) leftLeg.current.rotation.x = THREE.MathUtils.lerp(leftLeg.current.rotation.x, stride, settle);
    if (rightLeg.current) rightLeg.current.rotation.x = THREE.MathUtils.lerp(rightLeg.current.rotation.x, -stride, settle);
    if (leftArm.current) leftArm.current.rotation.x = THREE.MathUtils.lerp(leftArm.current.rotation.x, -stride * 0.72, settle);
    if (rightArm.current) rightArm.current.rotation.x = THREE.MathUtils.lerp(rightArm.current.rotation.x, stride * 0.72, settle);
    if (upperBody.current) {
      upperBody.current.position.y = THREE.MathUtils.lerp(
        upperBody.current.position.y,
        walking ? Math.abs(Math.sin(phase.current * 2)) * 0.025 : 0,
        settle,
      );
      upperBody.current.rotation.z = THREE.MathUtils.lerp(
        upperBody.current.rotation.z,
        walking ? Math.sin(phase.current) * 0.025 : 0,
        settle,
      );
    }
  });

  return (
    <group scale={scale}>
      <group ref={upperBody}>
        <mesh position={[0, 1.14, 0]} castShadow>
          <capsuleGeometry args={[0.3, 0.56, 6, 12]} />
          <meshStandardMaterial color={shirt} roughness={0.82} />
        </mesh>

        <group position={[0, 1.78, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.34, 20, 16]} />
            <meshStandardMaterial color={skin} roughness={0.9} />
          </mesh>
          <mesh position={[-0.12, 0.045, 0.31]}>
            <sphereGeometry args={[0.036, 9, 9]} />
            <meshStandardMaterial color="#202c29" />
          </mesh>
          <mesh position={[0.12, 0.045, 0.31]}>
            <sphereGeometry args={[0.036, 9, 9]} />
            <meshStandardMaterial color="#202c29" />
          </mesh>
          <mesh position={[0, -0.055, 0.335]} scale={[1, 0.55, 0.5]}>
            <sphereGeometry args={[0.045, 9, 7]} />
            <meshStandardMaterial color={skin} roughness={0.9} />
          </mesh>
          <mesh position={[0, -0.145, 0.325]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.055, 0.009, 6, 12, Math.PI]} />
            <meshStandardMaterial color="#7d493e" />
          </mesh>
        </group>

        <AnimalHat hat={hat} />

        <group ref={leftArm} position={[-0.38, 1.36, 0]}>
          <mesh position={[0, -0.29, 0]} castShadow>
            <capsuleGeometry args={[0.085, 0.42, 5, 9]} />
            <meshStandardMaterial color={shirt} roughness={0.84} />
          </mesh>
          <mesh position={[0, -0.56, 0]} castShadow>
            <sphereGeometry args={[0.095, 10, 8]} />
            <meshStandardMaterial color={skin} roughness={0.9} />
          </mesh>
        </group>
        <group ref={rightArm} position={[0.38, 1.36, 0]}>
          <mesh position={[0, -0.29, 0]} castShadow>
            <capsuleGeometry args={[0.085, 0.42, 5, 9]} />
            <meshStandardMaterial color={shirt} roughness={0.84} />
          </mesh>
          <mesh position={[0, -0.56, 0]} castShadow>
            <sphereGeometry args={[0.095, 10, 8]} />
            <meshStandardMaterial color={skin} roughness={0.9} />
          </mesh>
        </group>
      </group>

      <Leg ref={leftLeg} x={-0.18} />
      <Leg ref={rightLeg} x={0.18} />
    </group>
  );
}

function Leg({ x, ref }: { x: number; ref: React.Ref<THREE.Group> }) {
  return (
    <group ref={ref} position={[x, 0.78, 0]}>
      <mesh position={[0, -0.34, 0]} castShadow>
        <capsuleGeometry args={[0.105, 0.46, 5, 9]} />
        <meshStandardMaterial color="#315d57" roughness={0.88} />
      </mesh>
      <mesh position={[0, -0.69, 0.07]} castShadow>
        <boxGeometry args={[0.23, 0.12, 0.36]} />
        <meshStandardMaterial color="#233d39" roughness={0.95} />
      </mesh>
    </group>
  );
}

function AnimalHat({ hat }: { hat: HatId }) {
  const definition = HATS.find((item) => item.id === hat) ?? HATS[0];
  const color = definition.color;
  const pointed = hat === "red-panda" || hat === "red-fox" || hat === "owl";
  const rounded = hat === "mouse" || hat === "capybara" || hat === "elephant";

  return (
    <group position={[0, 2.055, 0]}>
      <mesh position={[0, 0.035, 0]} scale={[1, 0.72, 1]} castShadow>
        <sphereGeometry args={[0.4, 18, 13, 0, Math.PI * 2, 0, Math.PI / 1.72]} />
        <meshStandardMaterial color={color} roughness={0.88} />
      </mesh>
      <mesh position={[0, -0.085, 0]} castShadow>
        <cylinderGeometry args={[0.385, 0.36, 0.09, 18]} />
        <meshStandardMaterial color={darken(color)} roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.095, 0.28]} scale={[1, 0.16, 0.58]} castShadow>
        <sphereGeometry args={[0.34, 16, 8]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>

      {pointed && <>
        <HatEar position={[-0.25, 0.25, 0]} color={color} pointed />
        <HatEar position={[0.25, 0.25, 0]} color={color} pointed mirror />
      </>}
      {rounded && <>
        <HatEar position={[-0.27, 0.2, 0]} color={color} />
        <HatEar position={[0.27, 0.2, 0]} color={color} />
      </>}
      {hat === "frog" && <>
        <HatEye position={[-0.2, 0.25, 0.1]} />
        <HatEye position={[0.2, 0.25, 0.1]} />
      </>}
      {hat === "chicken" && <>
        {[-0.12, 0, 0.12].map((z, index) => <mesh key={z} position={[0, 0.31 + (index === 1 ? 0.05 : 0), z]}><sphereGeometry args={[0.095, 9, 7]} /><meshStandardMaterial color="#df4f45" /></mesh>)}
        <mesh position={[0, 0.03, 0.4]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.075, 0.17, 8]} /><meshStandardMaterial color="#e9a739" /></mesh>
      </>}
      {hat === "elephant" && <mesh position={[0, -0.005, 0.39]} rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[0.04, 0.24, 4, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>}
      {hat === "giraffe" && <>
        <HatEar position={[-0.27, 0.19, 0]} color={color} />
        <HatEar position={[0.27, 0.19, 0]} color={color} />
        {[-0.13, 0.13].map((x) => <group key={x} position={[x, 0.25, 0]}><mesh position={[0, 0.1, 0]}><cylinderGeometry args={[0.035, 0.04, 0.2, 7]} /><meshStandardMaterial color="#825b35" /></mesh><mesh position={[0, 0.22, 0]}><sphereGeometry args={[0.055, 8, 6]} /><meshStandardMaterial color="#825b35" /></mesh></group>)}
      </>}
      {hat === "axolotl" && <>
        <AxolotlGills side={-1} />
        <AxolotlGills side={1} />
      </>}

      {hat !== "frog" && <>
        <mesh position={[-0.105, 0.075, 0.365]}><sphereGeometry args={[0.029, 8, 7]} /><meshStandardMaterial color="#1f2928" /></mesh>
        <mesh position={[0.105, 0.075, 0.365]}><sphereGeometry args={[0.029, 8, 7]} /><meshStandardMaterial color="#1f2928" /></mesh>
      </>}
      {(hat === "red-panda" || hat === "red-fox" || hat === "mouse" || hat === "capybara" || hat === "owl") && <mesh position={[0, -0.005, 0.39]} scale={[1.3, 0.85, 0.65]}>
        <sphereGeometry args={[0.055, 9, 7]} />
        <meshStandardMaterial color={hat === "owl" ? "#e6c87e" : "#2c3532"} />
      </mesh>}
    </group>
  );
}

function HatEar({ position, color, pointed = false, mirror = false }: { position: [number, number, number]; color: string; pointed?: boolean; mirror?: boolean }) {
  if (pointed) return <group position={position} rotation={[0, 0, mirror ? 0.24 : -0.24]}><mesh><coneGeometry args={[0.14, 0.32, 9]} /><meshStandardMaterial color={color} /></mesh><mesh position={[0, -0.025, 0.08]} scale={[0.54, 0.62, 0.42]}><coneGeometry args={[0.14, 0.25, 9]} /><meshStandardMaterial color="#f3b39b" /></mesh></group>;
  return <mesh position={position} castShadow><sphereGeometry args={[0.13, 10, 8]} /><meshStandardMaterial color={color} /></mesh>;
}

function HatEye({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh><sphereGeometry args={[0.115, 10, 8]} /><meshStandardMaterial color="#f5f1dd" /></mesh><mesh position={[0, 0, 0.09]}><sphereGeometry args={[0.045, 8, 7]} /><meshStandardMaterial color="#1f2928" /></mesh></group>;
}

function AxolotlGills({ side }: { side: -1 | 1 }) {
  return <group position={[side * 0.31, 0.13, 0]} rotation={[0, 0, side * -0.35]}>{[-0.08, 0.04, 0.16].map((y) => <mesh key={y} position={[side * 0.055, y, 0]} rotation={[0, 0, side * -0.8]}><capsuleGeometry args={[0.025, 0.16, 4, 7]} /><meshStandardMaterial color="#d9548c" /></mesh>)}</group>;
}

function darken(color: string) {
  return new THREE.Color(color).multiplyScalar(0.72).getStyle();
}
