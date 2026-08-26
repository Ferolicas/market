"use client";

import type { HatId } from "@/game/types";

interface AvatarProps {
  skin: string;
  shirt: string;
  hat: HatId;
  walking?: boolean;
  scale?: number;
}

export function Avatar({ skin, shirt, hat, walking = false, scale = 1 }: AvatarProps) {
  const hatColor = ({
    "red-panda": "#b94d31", "red-fox": "#ed6b36", chicken: "#fff0c9", frog: "#65b95a",
    mouse: "#9d94ad", elephant: "#7e9da9", giraffe: "#e4ac45", owl: "#795941",
    axolotl: "#f08cb4", capybara: "#9b6f50",
  } as Record<HatId, string>)[hat];
  const earShape = hat === "frog" || hat === "owl" ? "round" : "cone";
  return (
    <group scale={scale}>
      <mesh position={[0, 1.12, 0]} castShadow><capsuleGeometry args={[0.28, 0.58, 5, 10]} /><meshStandardMaterial color={shirt} roughness={0.82} /></mesh>
      <mesh position={[0, 1.77, 0]} castShadow><sphereGeometry args={[0.34, 18, 14]} /><meshStandardMaterial color={skin} roughness={0.9} /></mesh>
      <mesh position={[-0.12, 1.81, 0.29]}><sphereGeometry args={[0.035, 8, 8]} /><meshStandardMaterial color="#202c29" /></mesh>
      <mesh position={[0.12, 1.81, 0.29]}><sphereGeometry args={[0.035, 8, 8]} /><meshStandardMaterial color="#202c29" /></mesh>
      <group position={[0, 2.04, 0]}>
        <mesh castShadow><sphereGeometry args={[0.37, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={hatColor} roughness={0.9} /></mesh>
        {earShape === "round" ? <>
          <mesh position={[-0.24, 0.18, 0]}><sphereGeometry args={[0.12, 10, 8]} /><meshStandardMaterial color={hatColor} /></mesh>
          <mesh position={[0.24, 0.18, 0]}><sphereGeometry args={[0.12, 10, 8]} /><meshStandardMaterial color={hatColor} /></mesh>
        </> : <>
          <mesh position={[-0.23, 0.17, 0]} rotation={[0, 0, -0.22]}><coneGeometry args={[0.13, 0.3, 8]} /><meshStandardMaterial color={hatColor} /></mesh>
          <mesh position={[0.23, 0.17, 0]} rotation={[0, 0, 0.22]}><coneGeometry args={[0.13, 0.3, 8]} /><meshStandardMaterial color={hatColor} /></mesh>
        </>}
        {hat === "elephant" && <mesh position={[0, -0.05, 0.34]} rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[0.045, 0.28, 4, 8]} /><meshStandardMaterial color={hatColor} /></mesh>}
        {hat === "giraffe" && <><mesh position={[-0.13, 0.32, 0]}><cylinderGeometry args={[0.035, 0.045, 0.28, 7]} /><meshStandardMaterial color="#8a6338" /></mesh><mesh position={[0.13, 0.32, 0]}><cylinderGeometry args={[0.035, 0.045, 0.28, 7]} /><meshStandardMaterial color="#8a6338" /></mesh></>}
      </group>
      <mesh position={[-0.22, 0.45, walking ? 0.08 : 0]} rotation={[0, 0, walking ? 0.14 : 0]} castShadow><capsuleGeometry args={[0.095, 0.48, 4, 8]} /><meshStandardMaterial color="#325f58" /></mesh>
      <mesh position={[0.22, 0.45, walking ? -0.08 : 0]} rotation={[0, 0, walking ? -0.14 : 0]} castShadow><capsuleGeometry args={[0.095, 0.48, 4, 8]} /><meshStandardMaterial color="#325f58" /></mesh>
    </group>
  );
}
