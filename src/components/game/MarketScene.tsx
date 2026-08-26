"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, OrthographicCamera, Text } from "@react-three/drei";
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
  { id: "farm", label: "Cosechar trigo", position: [-6.55, 0, 10.55] },
  { id: "mill", label: "Cargar molino", position: [-7.55, 0, -4.05] },
  { id: "bakery", label: "Hornear pan", position: [-7.45, 0, -0.45] },
  { id: "shelf", label: "Surtir estantería", position: [0, 0, -0.8] },
  { id: "checkout", label: "Bloquearse en la caja", position: [6.15, 0, 3.95] },
  { id: "supplier", label: "Terminal de proveedores", position: [7.5, 0, -2.15] },
  { id: "office", label: "Mapa y gerencia", position: [7.5, 0, -5.35] },
  { id: "door", label: "Abrir / cerrar tienda", position: [0, 0, 7.25] },
];

const OBSTACLES = [
  ...[-5.2, -2.8, -0.4, 2].map((x) => ({ x, z: -8.05, halfX: 1.12, halfZ: 0.5 })),
  { x: 5.25, z: -8, halfX: 1.2, halfZ: 0.5 },
  { x: 8.65, z: -7.85, halfX: 0.85, halfZ: 0.5 },
  ...[-4, 0, 4].map((x) => ({ x, z: -2.2, halfX: 1.2, halfZ: 0.78 })),
  { x: -4.1, z: 2.45, halfX: 1.25, halfZ: 0.83 },
  { x: 0, z: 2.45, halfX: 1.25, halfZ: 0.83 },
  { x: 4.05, z: 2.45, halfX: 1.18, halfZ: 0.8 },
  { x: 7.55, z: 3.95, halfX: 1.78, halfZ: 0.72 },
  { x: 9.6, z: 6.25, halfX: 1.05, halfZ: 0.9 },
  { x: -8.75, z: -4.05, halfX: 0.9, halfZ: 0.78 },
  { x: -8.75, z: -0.45, halfX: 1, halfZ: 1.45 },
  { x: 8.8, z: -2.65, halfX: 0.95, halfZ: 1.55 },
  { x: 8.8, z: -5.35, halfX: 0.95, halfZ: 0.7 },
  { x: -8.65, z: 10.65, halfX: 2.05, halfZ: 1.72 },
];

export function MarketScene({ onPrompt, onInteract, lastInteraction, checkoutLocked = false }: { onPrompt: (prompt: InteractionPrompt | null) => void; onInteract: (id: InteractionId) => void; lastInteraction: { id: InteractionId; sequence: number } | null; checkoutLocked?: boolean }) {
  const game = useMarketStore((state) => state.game);
  const franchise = game?.franchises.find((item) => item.id === game.currentFranchiseId);
  if (!game || !franchise) return null;
  return (
    <Canvas shadows dpr={[0.85, 1.4]} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <OverviewCamera checkoutLocked={checkoutLocked} />
      <color attach="background" args={["#b8dfce"]} />
      <fog attach="fog" args={["#b8dfce", 62, 105]} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[8, 13, 7]} intensity={2.3} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-far={30} />
      <Suspense fallback={null}>
        <MarketBuilding open={franchise.open} />
        <KitFurniture />
        <KitFarm />
        <Employees employees={franchise.employees} />
        {franchise.open && <Customers count={Math.min(6, 2 + franchise.checkoutLevel)} />}
        <Player avatar={game.avatar} onPrompt={onPrompt} onInteract={onInteract} lastInteraction={lastInteraction} locked={checkoutLocked} />
        <Environment preset="city" environmentIntensity={0.28} />
      </Suspense>
      <ContactShadows position={[0, 0.015, 2]} opacity={0.24} scale={34} blur={2.6} far={8} />
    </Canvas>
  );
}

function OverviewCamera({ checkoutLocked }: { checkoutLocked: boolean }) {
  const camera = useRef<THREE.OrthographicCamera>(null);
  const { size } = useThree();
  useFrame((_, delta) => {
    if (!camera.current) return;
    const target = checkoutLocked ? new THREE.Vector3(7.15, 0.85, 3.75) : new THREE.Vector3(0, 0, 3.25);
    const position = checkoutLocked ? new THREE.Vector3(13.5, 12.5, 13.5) : new THREE.Vector3(16, 23, 29);
    camera.current.position.lerp(position, 1 - Math.pow(0.0005, delta));
    camera.current.lookAt(target);
    const overviewZoom = Math.min(size.width / 27, size.height / 24.5);
    const checkoutZoom = Math.min(size.width / 15, size.height / 12);
    camera.current.zoom = THREE.MathUtils.lerp(camera.current.zoom, checkoutLocked ? checkoutZoom : overviewZoom, Math.min(1, delta * 5));
    camera.current.updateProjectionMatrix();
  });
  return <OrthographicCamera ref={camera} makeDefault position={[16, 23, 29]} near={0.1} far={120} />;
}

function Player({ avatar, onPrompt, onInteract, lastInteraction, locked }: { avatar: AvatarConfig; onPrompt: (prompt: InteractionPrompt | null) => void; onInteract: (id: InteractionId) => void; lastInteraction: { id: InteractionId; sequence: number } | null; locked: boolean }) {
  const group = useRef<THREE.Group>(null);
  const keys = useRef(new Set<string>());
  const nearest = useRef<InteractionPrompt | null>(null);
  const moving = useRef(false);
  const [walking, setWalking] = useState(false);
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
    const isMoving = !locked && length > 0.08;
    if (isMoving !== moving.current) {
      moving.current = isMoving;
      setWalking(isMoving);
    }
    if (locked) {
      group.current.position.x = THREE.MathUtils.lerp(group.current.position.x, 7.45, Math.min(1, delta * 6));
      group.current.position.z = THREE.MathUtils.lerp(group.current.position.z, 3.05, Math.min(1, delta * 6));
      group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, Math.PI, Math.min(1, delta * 8));
    } else if (isMoving) {
      x /= Math.max(1, length); z /= Math.max(1, length);
      const nextX = THREE.MathUtils.clamp(group.current.position.x + x * delta * 2.9, -10.9, 10.9);
      const nextZ = THREE.MathUtils.clamp(group.current.position.z + z * delta * 2.9, -8.05, 15.6);
      if (!blocked(nextX, group.current.position.z)) group.current.position.x = nextX;
      if (!blocked(group.current.position.x, nextZ)) group.current.position.z = nextZ;
      group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, Math.atan2(x, z), Math.min(1, delta * 10));
    }
    group.current.position.y = 0;
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

  return <group ref={group} position={[0, 0, 6.25]}><Avatar {...avatar} walking={walking && !locked} animation={locked ? "ScanItem" : lastInteraction ? interactionAnimation[lastInteraction.id] : undefined} /></group>;
}

function blocked(x: number, z: number) {
  const radius = 0.34;
  if (x < -10.9 || x > 10.9 || z < -8.05 || z > 15.6) return true;
  if (z > 7.55 && z < 8.2 && Math.abs(x) > 1.82) return true;
  return OBSTACLES.some((obstacle) => Math.abs(x - obstacle.x) < obstacle.halfX + radius && Math.abs(z - obstacle.z) < obstacle.halfZ + radius);
}

function MarketBuilding({ open }: { open: boolean }) {
  return <group>
    <mesh receiveShadow position={[0, -0.08, -0.35]}><boxGeometry args={[23, 0.16, 17]} /><meshStandardMaterial color="#f6e9cc" roughness={0.95} /></mesh>
    <mesh receiveShadow position={[0, -0.1, 11.9]}><boxGeometry args={[23, 0.14, 7.5]} /><meshStandardMaterial color="#d8e8df" roughness={0.96} /></mesh>
    <mesh receiveShadow position={[0, -0.09, 16.15]}><boxGeometry args={[25, 0.12, 1.2]} /><meshStandardMaterial color="#708079" roughness={1} /></mesh>
    {[-6, 0, 6].map((x) => <mesh key={x} position={[x, -0.015, 16.1]}><boxGeometry args={[2.7, 0.02, 0.1]} /><meshStandardMaterial color="#f7e8b9" /></mesh>)}
    <mesh receiveShadow position={[0, 1.5, -8.55]}><boxGeometry args={[23, 3, 0.25]} /><meshStandardMaterial color="#fff8e7" /></mesh>
    <mesh receiveShadow position={[-11.35, 1.5, -0.35]}><boxGeometry args={[0.25, 3, 16.5]} /><meshStandardMaterial color="#fff8e7" /></mesh>
    <mesh receiveShadow position={[11.35, 1.5, -0.35]}><boxGeometry args={[0.25, 3, 16.5]} /><meshStandardMaterial color="#fff8e7" /></mesh>
    <mesh position={[-6.55, 0.22, 7.82]}><boxGeometry args={[8, 0.44, 0.18]} /><meshStandardMaterial color="#f7f2e5" /></mesh>
    <mesh position={[6.55, 0.22, 7.82]}><boxGeometry args={[8, 0.44, 0.18]} /><meshStandardMaterial color="#f7f2e5" /></mesh>
    {[-6.55, 6.55].map((x) => <group key={x} position={[x, 1.45, 7.72]}>
      <mesh><boxGeometry args={[7.95, 1.65, 0.08]} /><meshPhysicalMaterial color="#b9d8d2" transparent opacity={0.42} roughness={0.18} /></mesh>
      {[-4, 0, 4].map((edge) => <mesh key={edge} position={[edge, 0, 0.05]}><boxGeometry args={[0.09, 1.82, 0.09]} /><meshStandardMaterial color="#36443e" /></mesh>)}
      <mesh position={[0, 0.87, 0.05]}><boxGeometry args={[8.05, 0.09, 0.09]} /><meshStandardMaterial color="#36443e" /></mesh>
      <mesh position={[0, -0.87, 0.05]}><boxGeometry args={[8.05, 0.09, 0.09]} /><meshStandardMaterial color="#637b51" /></mesh>
    </group>)}
    <group position={[0, 1.22, 7.8]}>
      {[-0.83, 0.83].map((x) => <mesh key={x} position={[x, 0, 0]}><boxGeometry args={[1.55, 2.35, 0.09]} /><meshPhysicalMaterial color={open ? "#a9d4ca" : "#7e918d"} transparent opacity={0.58} roughness={0.12} /></mesh>)}
      {[-1.68, 0, 1.68].map((x) => <mesh key={x} position={[x, 0, 0.07]}><boxGeometry args={[0.09, 2.5, 0.1]} /><meshStandardMaterial color="#35443e" /></mesh>)}
      <mesh position={[0, 1.27, 0.07]}><boxGeometry args={[3.45, 0.1, 0.1]} /><meshStandardMaterial color="#35443e" /></mesh>
    </group>
    <mesh position={[0, 0.12, 7.85]}><boxGeometry args={[4.2, 0.18, 0.3]} /><meshStandardMaterial color={open ? "#55bf90" : "#e76f51"} /></mesh>
    <Text position={[0, 2.65, -8.38]} fontSize={0.58} color="#173f35" anchorX="center">MINI MARKET</Text>
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
