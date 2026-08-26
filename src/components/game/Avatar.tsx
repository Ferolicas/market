"use client";

import { createPortal } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { HATS } from "@/game/catalog";
import type { AvatarHatId, CharacterId, HairId } from "@/game/types";

interface AvatarProps {
  skin: string;
  shirt: string;
  hat: AvatarHatId;
  body?: CharacterId;
  hair?: HairId;
  hairColor?: string;
  walking?: boolean;
  animation?: CharacterAnimation;
  scale?: number;
}

export type CharacterAnimation = "Idle" | "Walk" | "Run" | "Enter" | "Wave" | "ReceiveOrder" | "LiftBox" | "CarryBox" | "StockLow" | "StockHigh" | "ScanItem" | "Pay" | "Plant" | "Harvest" | "Happy";

const MODEL_PATHS: Record<CharacterId, string> = {
  "adult-man": "/models/store_owner_man.glb",
  "adult-woman": "/models/store_owner_woman.glb",
  boy: "/models/store_owner_boy.glb",
  girl: "/models/store_owner_girl.glb",
};

export function Avatar({
  skin,
  shirt,
  hat,
  body = "adult-man",
  hair = "side-part",
  hairColor = "#332b27",
  walking = false,
  animation,
  scale = 1,
}: AvatarProps) {
  const gltf = useGLTF(MODEL_PATHS[body]);
  const model = useMemo(() => {
    const copy = clone(gltf.scene) as THREE.Group;
    copy.traverse((object) => {
      if (object.name.startsWith("Hair_")) object.visible = false;
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.material = Array.isArray(object.material) ? object.material.map((material) => material.clone()) : object.material.clone();
    });
    return copy;
  }, [gltf.scene]);
  const { actions } = useAnimations(gltf.animations, model);
  const clip = animation ?? (walking ? "Walk" : "Idle");
  const head = model.getObjectByName("Head");

  useEffect(() => {
    const action = actions[clip];
    action?.reset().fadeIn(0.16).play();
    return () => { action?.fadeOut(0.16); };
  }, [actions, clip]);

  useEffect(() => {
    const skinColor = new THREE.Color(skin);
    const shirtColor = new THREE.Color(shirt);
    const hair = new THREE.Color(hairColor);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (material.name === "skin") material.color.copy(skinColor);
        if (material.name === "skinLight") material.color.copy(skinColor).offsetHSL(0, -0.02, 0.09);
        if (material.name === "shirt") material.color.copy(shirtColor);
        if (material.name === "shirtDark") material.color.copy(shirtColor).multiplyScalar(0.72);
        if (material.name === "hair" || material.name === "hairBrown" || material.name === "beard") material.color.copy(hair);
      }
    });
  }, [hairColor, model, shirt, skin]);

  useEffect(() => () => {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }, [model]);

  return (
    <group scale={scale} rotation={[0, Math.PI, 0]} position={[0, 0.055, 0]}>
      <primitive object={model} dispose={null} />
      {head && createPortal(<group rotation={[0, Math.PI, 0]} scale={0.82}><Hair style={hair} color={hairColor} wearingHat={hat !== "none"} /><AnimalHat hat={hat} /></group>, head)}
    </group>
  );
}

function Hair({ style, color, wearingHat }: { style: HairId; color: string; wearingHat: boolean }) {
  const short = ["side-part", "fade", "waves", "swept", "messy", "curls", "short-fringe", "quiff"].includes(style);
  return <group>
    {!wearingHat && <mesh position={[0, 0.17, -0.035]} scale={[1.03, 0.72, 1.02]} castShadow><sphereGeometry args={[0.35, 16, 11, 0, Math.PI * 2, 0, Math.PI / 1.75]} /><meshStandardMaterial color={color} roughness={0.92} /></mesh>}
    {!wearingHat && <HairFront style={style} color={color} />}
    {!short && <HairBack style={style} color={color} wearingHat={wearingHat} />}
  </group>;
}

function HairFront({ style, color }: { style: HairId; color: string }) {
  if (style === "curls") return <HairClusters color={color} positions={[[-0.24,0.24,0.18],[-0.12,0.3,0.25],[0,0.31,0.27],[0.12,0.29,0.25],[0.24,0.23,0.18],[-0.2,0.13,0.3],[0,0.16,0.33],[0.2,0.13,0.3]]} radius={0.1} />;
  if (style === "messy") return <HairSpikes color={color} points={[[-0.24,0.25,-0.2],[-0.12,0.36,0.2],[0,0.4,-0.1],[0.12,0.36,0.15],[0.25,0.27,-0.15]]} />;
  if (style === "quiff") return <HairSpikes color={color} points={[[-0.16,0.28,0.18],[-0.05,0.4,0.23],[0.07,0.43,0.2],[0.2,0.34,0.13]]} />;
  if (style === "fade") return <HairSpikes color={color} points={[[-0.22,0.25,0.17],[-0.1,0.34,0.23],[0.03,0.37,0.25],[0.16,0.32,0.2],[0.25,0.24,0.12]]} small />;
  if (style === "waves") return <HairClusters color={color} positions={[[-0.24,0.2,0.19],[-0.12,0.29,0.27],[0.02,0.31,0.28],[0.16,0.27,0.25],[0.26,0.17,0.18]]} radius={0.115} />;
  if (style === "short-fringe" || style === "blunt-bob") return <>{[-0.22,-0.11,0,0.11,0.22].map((x) => <mesh key={x} position={[x, 0.12 + Math.abs(x) * 0.18, 0.3]} rotation={[0,0,x * -0.3]}><capsuleGeometry args={[0.055, 0.16, 4, 7]} /><meshStandardMaterial color={color} /></mesh>)}</>;
  const sweptLeft = style === "side-part" || style === "swept" || style === "bob" || style === "long-wavy" || style === "braid";
  return <>{[-0.22,-0.1,0.02,0.14,0.24].map((x, index) => <mesh key={x} position={[x, 0.19 + (index % 2) * 0.035, 0.28]} rotation={[0.08,0,sweptLeft ? -0.5 : 0.5]}><capsuleGeometry args={[0.055, 0.19, 4, 7]} /><meshStandardMaterial color={color} roughness={0.92} /></mesh>)}</>;
}

function HairBack({ style, color, wearingHat }: { style: HairId; color: string; wearingHat: boolean }) {
  const capY = wearingHat ? 0.02 : 0.12;
  if (style === "bob" || style === "blunt-bob") return <>{[-0.29,0.29].map((x) => <mesh key={x} position={[x,-0.02,-0.03]}><capsuleGeometry args={[0.1,0.36,5,9]} /><meshStandardMaterial color={color} /></mesh>)}<mesh position={[0,-0.11,-0.25]} scale={[1,1.1,0.55]}><sphereGeometry args={[0.31,14,10]} /><meshStandardMaterial color={color} /></mesh></>;
  if (style === "long-wavy") return <>{[-0.25,-0.08,0.09,0.26].map((x,index) => <mesh key={x} position={[x,-0.18 - index%2*0.05,-0.22]} rotation={[0,0,index%2?.18:-.18]}><capsuleGeometry args={[0.09,0.62,5,9]} /><meshStandardMaterial color={color} /></mesh>)}</>;
  if (style === "bun") return <mesh position={[0,0.31,-0.25]} castShadow><sphereGeometry args={[0.19,12,9]} /><meshStandardMaterial color={color} /></mesh>;
  if (style === "ponytail" || style === "high-ponytail") return <group position={[0,style === "high-ponytail" ? 0.24 : 0.08,-0.29]}><mesh><sphereGeometry args={[0.12,10,8]} /><meshStandardMaterial color="#2b2421" /></mesh><mesh position={[0,-0.28,-0.02]} rotation={[0.15,0,0]}><capsuleGeometry args={[0.12,0.48,5,9]} /><meshStandardMaterial color={color} /></mesh></group>;
  if (style === "pigtails") return <>{[-1,1].map((side) => <group key={side} position={[side*0.36,capY,-0.08]}><mesh><sphereGeometry args={[0.1,9,8]} /><meshStandardMaterial color="#9e4d45" /></mesh><mesh position={[side*0.08,-0.22,-0.03]} rotation={[0,0,side*-.35]}><capsuleGeometry args={[0.1,0.36,5,9]} /><meshStandardMaterial color={color} /></mesh></group>)}</>;
  if (style === "braid") return <group position={[0.2,-0.02,-0.25]} rotation={[0,0,-.1]}>{[0,-.14,-.28,-.42].map((y,index) => <mesh key={y} position={[index%2?.035:-.035,y,0]} scale={[1,.78,1]}><sphereGeometry args={[0.095-index*.008,9,7]} /><meshStandardMaterial color={color} /></mesh>)}</group>;
  return null;
}

function HairClusters({ color, positions, radius }: { color: string; positions: number[][]; radius: number }) {
  return <>{positions.map(([x,y,z], index) => <mesh key={index} position={[x,y,z]}><dodecahedronGeometry args={[radius,0]} /><meshStandardMaterial color={index % 2 ? darken(color, .9) : color} roughness={0.95} /></mesh>)}</>;
}

function HairSpikes({ color, points, small = false }: { color: string; points: number[][]; small?: boolean }) {
  return <>{points.map(([x,y,z], index) => <mesh key={index} position={[x,y,z]} rotation={[0,0,x * -1.2]}><coneGeometry args={[small ? .075 : .09,small ? .22 : .3,8]} /><meshStandardMaterial color={index%2 ? darken(color,.88) : color} /></mesh>)}</>;
}

function AnimalHat({ hat }: { hat: AvatarHatId }) {
  if (hat === "none") return null;
  const definition = HATS.find((item) => item.id === hat) ?? HATS[0];
  const color = definition.color;
  const pointed = hat === "red-panda" || hat === "red-fox" || hat === "owl";
  const rounded = hat === "mouse" || hat === "capybara" || hat === "elephant" || hat === "panda";

  return <group position={[0, 0.285, 0]}>
    <mesh position={[0, 0.035, 0]} scale={[1, 0.72, 1]} castShadow><sphereGeometry args={[0.4, 18, 13, 0, Math.PI * 2, 0, Math.PI / 1.72]} /><meshStandardMaterial color={color} roughness={0.88} /></mesh>
    <mesh position={[0, -0.085, 0]} castShadow><cylinderGeometry args={[0.385, 0.36, 0.09, 18]} /><meshStandardMaterial color={darken(color, 0.72)} roughness={0.9} /></mesh>
    <mesh position={[-0.31,-0.15,-0.01]}><capsuleGeometry args={[0.055,0.2,4,8]} /><meshStandardMaterial color={color} /></mesh>
    <mesh position={[0.31,-0.15,-0.01]}><capsuleGeometry args={[0.055,0.2,4,8]} /><meshStandardMaterial color={color} /></mesh>

    {pointed && <><HatEar position={[-0.25, 0.25, 0]} color={color} pointed /><HatEar position={[0.25, 0.25, 0]} color={color} pointed mirror /></>}
    {rounded && <><HatEar position={[-0.27, 0.2, 0]} color={hat === "panda" ? "#242625" : color} /><HatEar position={[0.27, 0.2, 0]} color={hat === "panda" ? "#242625" : color} /></>}
    {hat === "frog" && <><HatEye position={[-0.2, 0.25, 0.1]} /><HatEye position={[0.2, 0.25, 0.1]} /></>}
    {hat === "chicken" && <><mesh position={[-.08,.31,0]}><sphereGeometry args={[.09,9,7]} /><meshStandardMaterial color="#df4f45" /></mesh><mesh position={[.05,.35,0]}><sphereGeometry args={[.105,9,7]} /><meshStandardMaterial color="#df4f45" /></mesh><mesh position={[0,.03,.39]} rotation={[Math.PI/2,0,0]}><coneGeometry args={[.075,.17,8]} /><meshStandardMaterial color="#e9a739" /></mesh></>}
    {hat === "elephant" && <mesh position={[0,-.005,.39]} rotation={[Math.PI/2,0,0]}><capsuleGeometry args={[.04,.24,4,8]} /><meshStandardMaterial color={color} /></mesh>}
    {hat === "rhino" && <mesh position={[0,.02,.4]} rotation={[Math.PI/2,0,0]}><coneGeometry args={[.07,.25,9]} /><meshStandardMaterial color="#ddd4c1" /></mesh>}
    {hat === "giraffe" && <><HatEar position={[-.27,.19,0]} color={color} /><HatEar position={[.27,.19,0]} color={color} />{[-.13,.13].map((x) => <group key={x} position={[x,.25,0]}><mesh position={[0,.1,0]}><cylinderGeometry args={[.035,.04,.2,7]} /><meshStandardMaterial color="#825b35" /></mesh><mesh position={[0,.22,0]}><sphereGeometry args={[.055,8,6]} /><meshStandardMaterial color="#825b35" /></mesh></group>)}</>}
    {hat === "cow" && <><HatEar position={[-.28,.16,0]} color="#d89b8d" /><HatEar position={[.28,.16,0]} color="#d89b8d" />{[-.2,.2].map((x) => <mesh key={x} position={[x,.26,0]} rotation={[0,0,x>0?-.25:.25]}><coneGeometry args={[.055,.2,8]} /><meshStandardMaterial color="#d8b36d" /></mesh>)}</>}
    {hat === "rabbit" && <>{[-.17,.17].map((x) => <mesh key={x} position={[x,.38,0]}><capsuleGeometry args={[.075,.38,5,9]} /><meshStandardMaterial color={color} /></mesh>)}</>}
    {hat === "axolotl" && <><AxolotlGills side={-1} /><AxolotlGills side={1} /></>}

    {hat !== "frog" && <><mesh position={[-.105,.075,.365]}><sphereGeometry args={[.034,8,7]} /><meshStandardMaterial color="#1f2928" /></mesh><mesh position={[.105,.075,.365]}><sphereGeometry args={[.034,8,7]} /><meshStandardMaterial color="#1f2928" /></mesh></>}
    {(hat === "red-panda" || hat === "red-fox" || hat === "mouse" || hat === "capybara" || hat === "owl" || hat === "panda" || hat === "cow" || hat === "rabbit") && <mesh position={[0,-.005,.39]} scale={[1.3,.85,.65]}><sphereGeometry args={[.06,9,7]} /><meshStandardMaterial color={hat === "owl" ? "#e6c87e" : hat === "cow" || hat === "rabbit" ? "#d99583" : "#2c3532"} /></mesh>}
  </group>;
}

function HatEar({ position, color, pointed = false, mirror = false }: { position: [number, number, number]; color: string; pointed?: boolean; mirror?: boolean }) {
  if (pointed) return <group position={position} rotation={[0,0,mirror?.24:-.24]}><mesh><coneGeometry args={[.14,.32,9]} /><meshStandardMaterial color={color} /></mesh><mesh position={[0,-.025,.08]} scale={[.54,.62,.42]}><coneGeometry args={[.14,.25,9]} /><meshStandardMaterial color="#f3b39b" /></mesh></group>;
  return <mesh position={position} castShadow><sphereGeometry args={[.13,10,8]} /><meshStandardMaterial color={color} /></mesh>;
}

function HatEye({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh><sphereGeometry args={[.115,10,8]} /><meshStandardMaterial color="#f5f1dd" /></mesh><mesh position={[0,0,.09]}><sphereGeometry args={[.045,8,7]} /><meshStandardMaterial color="#1f2928" /></mesh></group>;
}

function AxolotlGills({ side }: { side: -1 | 1 }) {
  return <group position={[side*.31,.13,0]} rotation={[0,0,side*-.35]}>{[-.08,.04,.16].map((y) => <mesh key={y} position={[side*.055,y,0]} rotation={[0,0,side*-.8]}><capsuleGeometry args={[.025,.16,4,7]} /><meshStandardMaterial color="#d9548c" /></mesh>)}</group>;
}

function darken(color: string, factor: number) {
  return new THREE.Color(color).multiplyScalar(factor).getStyle();
}

Object.values(MODEL_PATHS).forEach((path) => useGLTF.preload(path));
