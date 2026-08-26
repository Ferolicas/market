"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Float, RoundedBox, Text } from "@react-three/drei";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Avatar, type CharacterAnimation } from "./Avatar";
import { mobileInput } from "./input";
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
        <Furniture />
        <Farm />
        <Employees employees={franchise.employees} />
        {franchise.open && <Customers count={Math.min(4, 1 + franchise.checkoutLevel)} />}
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
      group.current.position.x = THREE.MathUtils.clamp(group.current.position.x + x * delta * 4.1, -7.6, 7.6);
      group.current.position.z = THREE.MathUtils.clamp(group.current.position.z + z * delta * 4.1, -5.8, 5.8);
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

function MarketBuilding({ open }: { open: boolean }) {
  return <group>
    <mesh receiveShadow position={[0, -0.08, 0]}><boxGeometry args={[17, 0.16, 13]} /><meshStandardMaterial color="#f6e9cc" roughness={0.95} /></mesh>
    <mesh receiveShadow position={[0, 1.5, -6.35]}><boxGeometry args={[17, 3, 0.25]} /><meshStandardMaterial color="#fff8e7" /></mesh>
    <mesh receiveShadow position={[-8.35, 1.5, 0]}><boxGeometry args={[0.25, 3, 13]} /><meshStandardMaterial color="#fff8e7" /></mesh>
    <mesh receiveShadow position={[8.35, 1.5, 0]}><boxGeometry args={[0.25, 3, 13]} /><meshStandardMaterial color="#fff8e7" /></mesh>
    <mesh position={[0, 0.12, 6.05]}><boxGeometry args={[4.2, 0.18, 0.3]} /><meshStandardMaterial color={open ? "#55bf90" : "#e76f51"} /></mesh>
    <Text position={[0, 2.65, -6.18]} fontSize={0.58} color="#173f35" anchorX="center">MINI MARKET</Text>
  </group>;
}

function Furniture() {
  return <group>
    {[-2.4, 0, 2.4].map((x, index) => <Shelf key={x} position={[x, 0, -0.8]} color={["#ef6c4c", "#e5ad49", "#55b89a"][index]} />)}
    <Counter position={[5.25, 0, 3.2]} />
    <Machine position={[-6.2, 0, -2.8]} color="#e5ad49" label="MOLINO" />
    <Machine position={[-6.2, 0, 0.3]} color="#ef8f65" label="HORNO" />
    <Terminal position={[6.2, 0, -0.5]} label="PEDIDOS" color="#63a9cb" />
    <Terminal position={[6.2, 0, -4.1]} label="MAPA" color="#8f7cc1" />
  </group>;
}

function Shelf({ position, color }: { position: [number, number, number]; color: string }) {
  return <group position={position}>
    <RoundedBox args={[1.25, 2.05, 0.62]} radius={0.09} position={[0, 1.05, 0]} castShadow><meshStandardMaterial color="#f8f1df" /></RoundedBox>
    {[0.45, 1.05, 1.65].map((y) => <mesh key={y} position={[0, y, 0.32]}><boxGeometry args={[1.18, 0.1, 0.67]} /><meshStandardMaterial color={color} /></mesh>)}
    {[[-0.36, 0.7], [0, 0.7], [0.36, 0.7], [-0.36, 1.3], [0, 1.3], [0.36, 1.3]].map(([x, y], index) => <mesh key={index} position={[x, y, 0.48]} castShadow><boxGeometry args={[0.22, 0.28, 0.2]} /><meshStandardMaterial color={index % 2 ? "#79b95c" : "#e8ba55"} /></mesh>)}
  </group>;
}

function Counter({ position }: { position: [number, number, number] }) {
  return <group position={position}><RoundedBox args={[2.2, 0.92, 0.9]} radius={0.12} position={[0, 0.46, 0]} castShadow><meshStandardMaterial color="#55b89a" /></RoundedBox><mesh position={[0.55, 1.05, 0]}><boxGeometry args={[0.55, 0.22, 0.42]} /><meshStandardMaterial color="#243f3a" /></mesh><Text position={[-0.5, 0.58, 0.47]} fontSize={0.22} color="white">CAJA</Text></group>;
}

function Machine({ position, color, label }: { position: [number, number, number]; color: string; label: string }) {
  return <group position={position}><RoundedBox args={[1.3, 1.75, 1.05]} radius={0.14} position={[0, 0.88, 0]} castShadow><meshStandardMaterial color={color} /></RoundedBox><mesh position={[0, 1.1, 0.55]}><circleGeometry args={[0.3, 20]} /><meshStandardMaterial color="#284d47" /></mesh><Text position={[0, 0.45, 0.56]} fontSize={0.18} color="white">{label}</Text></group>;
}

function Terminal({ position, label, color }: { position: [number, number, number]; label: string; color: string }) {
  return <group position={position}><RoundedBox args={[1.4, 1.15, 0.7]} radius={0.12} position={[0, 0.58, 0]} castShadow><meshStandardMaterial color={color} /></RoundedBox><mesh position={[0, 0.75, 0.38]}><planeGeometry args={[0.85, 0.46]} /><meshStandardMaterial color="#d9f5ee" emissive="#183e36" emissiveIntensity={0.08} /></mesh><Text position={[0, 0.72, 0.4]} fontSize={0.14} color="#173f35">{label}</Text></group>;
}

function Farm() {
  return <group position={[-6.45, 0, 4.45]}>
    <mesh position={[0, 0.06, 0]} receiveShadow><boxGeometry args={[2.7, 0.12, 2.2]} /><meshStandardMaterial color="#87623d" /></mesh>
    {Array.from({ length: 18 }, (_, index) => { const x = (index % 6) * 0.38 - 0.95; const z = Math.floor(index / 6) * 0.55 - 0.55; return <Float key={index} speed={1.2} rotationIntensity={0.08} floatIntensity={0.04}><group position={[x, 0, z]}><mesh position={[0, 0.45, 0]}><cylinderGeometry args={[0.025, 0.035, 0.8, 6]} /><meshStandardMaterial color="#6f9d44" /></mesh><mesh position={[0, 0.85, 0]}><sphereGeometry args={[0.09, 7, 6]} /><meshStandardMaterial color="#e7bd4c" /></mesh></group></Float>; })}
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
  const hats: HatId[] = ["mouse", "owl", "frog", "capybara"];
  const bodies: CharacterId[] = ["adult-woman", "adult-man", "girl", "boy"];
  const hair: HairId[] = ["long-wavy", "quiff", "pigtails", "messy"];
  return <>{Array.from({ length: count }, (_, index) => <Npc key={index} position={[3.6 - index * 0.7, 0, 4.1]} offset={index * 1.3} hat={hats[index]} color="#d48771" body={bodies[index]} hair={hair[index]} />)}</>;
}
