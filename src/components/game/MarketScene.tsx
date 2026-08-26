"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Text } from "@react-three/drei";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Avatar, type CharacterAnimation } from "./Avatar";
import { Customer, type CustomerId } from "./Customer";
import { mobileInput } from "./input";
import { KitFarm, KitFurniture } from "./MarketKit";
import { useMarketStore } from "@/game/store";
import type { AvatarConfig, CharacterId, EmployeeRole, HairId, HatId } from "@/game/types";

export type InteractionId = "farm" | "mill" | "bakery" | "shelf" | "checkout" | "supplier" | "office" | "door";
export interface InteractionPrompt { id: InteractionId; label: string; }

const ZONES: { id: InteractionId; label: string; position: [number, number, number] }[] = [
  { id: "farm", label: "Cosechar trigo", position: [-6.4, 0, 4.4] },
  { id: "mill", label: "Cargar molino", position: [-6.1, 0, -2.8] },
  { id: "bakery", label: "Hornear pan", position: [-5.9, 0, 0.3] },
  { id: "shelf", label: "Surtir estantería", position: [-0.5, 0, -0.2] },
  { id: "checkout", label: "Atender caja", position: [5.2, 0, 3.1] },
  { id: "supplier", label: "Terminal de proveedores", position: [6.2, 0, -0.4] },
  { id: "office", label: "Mapa y gerencia", position: [6.1, 0, -4.2] },
  { id: "door", label: "Abrir / cerrar tienda", position: [0, 0, 5.8] },
];

const OBSTACLES = [
  { x: -2.5, z: -1.25, halfX: 1.12, halfZ: 0.68 },
  { x: 0, z: -1.25, halfX: 1.12, halfZ: 0.68 },
  { x: 2.5, z: -1.25, halfX: 1.12, halfZ: 0.68 },
  { x: -2.4, z: 2, halfX: 1.2, halfZ: 0.78 },
  { x: 0.25, z: 2.05, halfX: 1.2, halfZ: 0.78 },
  { x: 2.65, z: 2, halfX: 1.08, halfZ: 0.75 },
  { x: 5.35, z: 3.55, halfX: 1.78, halfZ: 0.66 },
  { x: -6.2, z: -2.8, halfX: 0.88, halfZ: 0.72 },
  { x: -6.25, z: -0.2, halfX: 0.95, halfZ: 1.35 },
  { x: 6.35, z: -1.8, halfX: 0.9, halfZ: 0.62 },
  { x: 6.35, z: -4.2, halfX: 0.9, halfZ: 0.62 },
];

export function MarketScene({ onPrompt, onInteract, lastInteraction }: { onPrompt: (prompt: InteractionPrompt | null) => void; onInteract: (id: InteractionId) => void; lastInteraction: { id: InteractionId; sequence: number } | null }) {
  const game = useMarketStore((state) => state.game);
  const franchise = game?.franchises.find((item) => item.id === game.currentFranchiseId);
  if (!game || !franchise) return null;
  return (
    <Canvas shadows dpr={[1, 1.65]} camera={{ position: [0, 7, 9], fov: 48 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <color attach="background" args={["#b8dfce"]} />
      <fog attach="fog" args={["#b8dfce", 18, 38]} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[8, 13, 7]} intensity={2.3} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-far={30} />
      <Suspense fallback={null}>
        <MarketBuilding open={franchise.open} />
        <KitFurniture />
        <KitFarm />
        <Employees employees={franchise.employees} />
        {franchise.open && <Customers count={Math.min(6, 2 + franchise.checkoutLevel)} />}
        <Player avatar={game.avatar} onPrompt={onPrompt} onInteract={onInteract} lastInteraction={lastInteraction} />
        <Environment preset="city" environmentIntensity={0.28} />
      </Suspense>
      <ContactShadows position={[0, 0.015, 0]} opacity={0.25} scale={24} blur={2.5} far={8} />
    </Canvas>
  );
}

function Player({ avatar, onPrompt, onInteract, lastInteraction }: { avatar: AvatarConfig; onPrompt: (prompt: InteractionPrompt | null) => void; onInteract: (id: InteractionId) => void; lastInteraction: { id: InteractionId; sequence: number } | null }) {
  const group = useRef<THREE.Group>(null);
  const keys = useRef(new Set<string>());
  const nearest = useRef<InteractionPrompt | null>(null);
  const moving = useRef(false);
  const [walking, setWalking] = useState(false);
  const { camera } = useThree();
  const interactionAnimation: Record<InteractionId, CharacterAnimation> = { farm: "Harvest", mill: "LiftBox", bakery: "StockHigh", shelf: "StockLow", checkout: "ScanItem", supplier: "ReceiveOrder", office: "Wave", door: "Enter" };

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      keys.current.add(event.code);
      if ((event.code === "KeyE" || event.code === "Space") && nearest.current && !event.repeat) onInteract(nearest.current.id);
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [onInteract]);

  useFrame((_, delta) => {
    if (!group.current) return;
    let x = Number(keys.current.has("KeyD") || keys.current.has("ArrowRight")) - Number(keys.current.has("KeyA") || keys.current.has("ArrowLeft")) + mobileInput.x;
    let z = Number(keys.current.has("KeyS") || keys.current.has("ArrowDown")) - Number(keys.current.has("KeyW") || keys.current.has("ArrowUp")) + mobileInput.y;
    const gamepad = navigator.getGamepads?.()[0];
    if (gamepad) { x += Math.abs(gamepad.axes[0] ?? 0) > 0.15 ? gamepad.axes[0] : 0; z += Math.abs(gamepad.axes[1] ?? 0) > 0.15 ? gamepad.axes[1] : 0; }
    const length = Math.hypot(x, z);
    const isMoving = length > 0.08;
    if (isMoving !== moving.current) {
      moving.current = isMoving;
      setWalking(isMoving);
    }
    if (isMoving) {
      x /= Math.max(1, length); z /= Math.max(1, length);
      const nextX = THREE.MathUtils.clamp(group.current.position.x + x * delta * 4.1, -7.6, 7.6);
      const nextZ = THREE.MathUtils.clamp(group.current.position.z + z * delta * 4.1, -5.8, 5.8);
      if (!blocked(nextX, group.current.position.z)) group.current.position.x = nextX;
      if (!blocked(group.current.position.x, nextZ)) group.current.position.z = nextZ;
      group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, Math.atan2(x, z), Math.min(1, delta * 10));
    }
    group.current.position.y = 0;
    const targetCamera = new THREE.Vector3(group.current.position.x, 6.2, group.current.position.z + 7.6);
    camera.position.lerp(targetCamera, 1 - Math.pow(0.001, delta));
    camera.lookAt(group.current.position.x, 1.15, group.current.position.z - 0.5);

    let found: InteractionPrompt | null = null;
    let distance = 1.65;
    for (const zone of ZONES) {
      const currentDistance = Math.hypot(group.current.position.x - zone.position[0], group.current.position.z - zone.position[2]);
      if (currentDistance < distance) { distance = currentDistance; found = { id: zone.id, label: zone.label }; }
    }
    if (found?.id !== nearest.current?.id) { nearest.current = found; onPrompt(found); }

    if (gamepad?.buttons[0]?.pressed && nearest.current) {
      const now = performance.now();
      const last = Number(group.current.userData.lastGamepadAction ?? 0);
      if (now - last > 450) { group.current.userData.lastGamepadAction = now; onInteract(nearest.current.id); }
    }
  });

  return <group ref={group} position={[0, 0, 4.2]}><Avatar {...avatar} walking={walking} animation={lastInteraction ? interactionAnimation[lastInteraction.id] : undefined} /></group>;
}

function blocked(x: number, z: number) {
  return OBSTACLES.some((obstacle) => Math.abs(x - obstacle.x) < obstacle.halfX && Math.abs(z - obstacle.z) < obstacle.halfZ);
}

function MarketBuilding({ open }: { open: boolean }) {
  return <group>
    <mesh receiveShadow position={[0, -0.08, 0]}><boxGeometry args={[17, 0.16, 13]} /><meshStandardMaterial color="#f6e9cc" roughness={0.95} /></mesh>
    <mesh receiveShadow position={[0, 1.5, -6.35]}><boxGeometry args={[17, 3, 0.25]} /><meshStandardMaterial color="#fff8e7" /></mesh>
    <mesh receiveShadow position={[-8.35, 1.5, 0]}><boxGeometry args={[0.25, 3, 13]} /><meshStandardMaterial color="#fff8e7" /></mesh>
    <mesh receiveShadow position={[8.35, 1.5, 0]}><boxGeometry args={[0.25, 3, 13]} /><meshStandardMaterial color="#fff8e7" /></mesh>
    <mesh position={[-5.6, 0.22, 6.05]}><boxGeometry args={[5.2, 0.44, 0.18]} /><meshStandardMaterial color="#f7f2e5" /></mesh>
    <mesh position={[5.6, 0.22, 6.05]}><boxGeometry args={[5.2, 0.44, 0.18]} /><meshStandardMaterial color="#f7f2e5" /></mesh>
    {[-5.6, 5.6].map((x) => <group key={x} position={[x, 1.45, 5.94]}>
      <mesh><boxGeometry args={[3.65, 1.65, 0.08]} /><meshPhysicalMaterial color="#b9d8d2" transparent opacity={0.48} roughness={0.18} /></mesh>
      {[-1.86, 1.86].map((edge) => <mesh key={edge} position={[edge, 0, 0.05]}><boxGeometry args={[0.09, 1.82, 0.09]} /><meshStandardMaterial color="#36443e" /></mesh>)}
      <mesh position={[0, 0.87, 0.05]}><boxGeometry args={[3.82, 0.09, 0.09]} /><meshStandardMaterial color="#36443e" /></mesh>
      <mesh position={[0, -0.87, 0.05]}><boxGeometry args={[3.82, 0.09, 0.09]} /><meshStandardMaterial color="#637b51" /></mesh>
    </group>)}
    <group position={[0, 1.22, 6.0]}>
      {[-0.83, 0.83].map((x) => <mesh key={x} position={[x, 0, 0]}><boxGeometry args={[1.55, 2.35, 0.09]} /><meshPhysicalMaterial color={open ? "#a9d4ca" : "#7e918d"} transparent opacity={0.58} roughness={0.12} /></mesh>)}
      {[-1.68, 0, 1.68].map((x) => <mesh key={x} position={[x, 0, 0.07]}><boxGeometry args={[0.09, 2.5, 0.1]} /><meshStandardMaterial color="#35443e" /></mesh>)}
      <mesh position={[0, 1.27, 0.07]}><boxGeometry args={[3.45, 0.1, 0.1]} /><meshStandardMaterial color="#35443e" /></mesh>
    </group>
    <mesh position={[0, 0.12, 6.05]}><boxGeometry args={[4.2, 0.18, 0.3]} /><meshStandardMaterial color={open ? "#55bf90" : "#e76f51"} /></mesh>
    <Text position={[0, 2.65, -6.18]} fontSize={0.58} color="#173f35" anchorX="center">MINI MARKET</Text>
  </group>;
}

function Employees({ employees }: { employees: { id: string; role: EmployeeRole; hat: HatId }[] }) {
  const rolePositions: Record<EmployeeRole, [number, number, number]> = { farmer: [-5.3, 0, 3.6], operator: [-4.8, 0, -1.5], stocker: [0, 0, -2.2], cashier: [4.7, 0, 2.2], builder: [2.9, 0, -4.5], manager: [5.4, 0, -3.6] };
  const bodies: CharacterId[] = ["adult-woman", "adult-man", "adult-woman", "adult-man"];
  const hair: HairId[] = ["ponytail", "fade", "bun", "waves"];
  return <>{employees.map((employee, index) => <Npc key={employee.id} position={rolePositions[employee.role]} offset={index * 0.7} hat={employee.hat} color={["#e7a959", "#6b9fc8", "#b56fa6", "#70a85d"][index % 4]} body={bodies[index % bodies.length]} hair={hair[index % hair.length]} role={employee.role} />)}</>;
}

function Npc({ position, offset, hat, color, body = "adult-man", hair = "side-part", role }: { position: [number, number, number]; offset: number; hat: HatId; color: string; body?: CharacterId; hair?: HairId; role?: EmployeeRole }) {
  const ref = useRef<THREE.Group>(null);
  const roleAnimation: Record<EmployeeRole, CharacterAnimation> = { farmer: "Harvest", operator: "LiftBox", stocker: "StockHigh", cashier: "ScanItem", builder: "CarryBox", manager: "Wave" };
  useFrame(({ clock }) => { if (ref.current && !role) { ref.current.position.x = position[0] + Math.sin(clock.elapsedTime * 0.65 + offset) * 0.55; ref.current.position.z = position[2] + Math.cos(clock.elapsedTime * 0.55 + offset) * 0.35; ref.current.rotation.y = Math.sin(clock.elapsedTime * 0.4 + offset); } });
  return <group ref={ref} position={position}><Avatar skin="#a96f50" shirt={color} hairColor="#3b2820" hat={hat} body={body} hair={hair} scale={0.86} walking={!role} animation={role ? roleAnimation[role] : undefined} /></group>;
}

function Customers({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, index) => <Customer key={index} id={(index + 1) as CustomerId} offset={index * 5.8} />)}</>;
}
