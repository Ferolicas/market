"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdaptiveDpr, ContactShadows, Environment, Lightformer, Line, OrthographicCamera, Text } from "@react-three/drei";
import { BallCollider, CapsuleCollider, CuboidCollider, Physics, RigidBody, useRapier, type RapierCollider, type RapierRigidBody } from "@react-three/rapier";
import { memo, Suspense, useEffect, useEffectEvent, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { Avatar, type CharacterAnimation } from "./Avatar";
import { CityPerimeter } from "./CityPerimeter";
import { Customer } from "./Customer";
import { EnvironmentModel, KitFarm, KitFurniture } from "./MarketKit";
import { dampFactor, frameDelta, turnTowards } from "@/game/locomotion";
import type { AvatarConfig, BuildProject, CarryState, CharacterId, CheckoutTransaction, CropState, CustomerRuntimeState, Employee, EmployeeRole, HairId, Inventory, ProductId, ProductionMachineState } from "@/game/types";
import { scaleStorePoint, scaleStorePosition, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE, STORE_OBSTACLES, WORLD_SCALE } from "@/game/world-scale";
import { FixedStepLoop } from "@/game/core/GameLoop";
import { inputManager } from "@/game/input/InputManager";
import { InteractionDirector } from "@/game/interaction/InteractionDirector";
import { WorkstationController } from "@/game/interaction/WorkstationController";
import type { InteractionZoneConfig } from "@/game/interaction/InteractionZone";
import { cameraRelativeMovement, moveVelocity, smoothYaw } from "@/game/player/PlayerController";
import { safeCanvasEvents } from "./safeCanvasEvents";
import { PerformanceMonitor } from "@/game/debug/PerformanceMonitor";
import { createWalkableStoreGeometry, storePathfinder } from "@/game/navigation/NavMeshService";
import { captureEmployeeMotion, projectCustomerMotion, type CustomerMotionSnapshot } from "@/game/animation/CustomerVisualMotion";
import { CHECKOUT_CAMERA_POSITION as CHECKOUT_CAMERA_POSITION_COORDS, CHECKOUT_CAMERA_TARGET as CHECKOUT_CAMERA_TARGET_COORDS, checkoutQueuePosition } from "@/game/stations/checkout-layout";
import { retailServicePoint } from "@/game/stations/retail-layout";
import { isWorkstationId, isWorkstationUnlocked, WORKSTATIONS, WORKSTATION_IDS, type WorkstationId } from "@/game/stations/workstation-layout";
import { PRODUCTS } from "@/game/catalog";

export type InteractionId = WorkstationId | "supplier" | "door";
export interface InteractionPrompt { id: InteractionId; label: string; }
const PLAYER_START = scaleStorePosition([0, 0, 6.25]);
const PLAYER_SCALE = 1.1;
const PLAYER_SPEED = 2.2;
const PLAYER_WALK_ANIMATION_SPEED = 1.12;
const CAMERA_DISTANCE_FACTOR = 1.15;
const OVERVIEW_CAMERA_OFFSET = { x: 16, y: 23, z: 25.75 } as const;
const OVERVIEW_CAMERA_GROUND_FORWARD = { x: -OVERVIEW_CAMERA_OFFSET.x, y: -OVERVIEW_CAMERA_OFFSET.z } as const;

const ZONES: { id: InteractionId; label: string; position: [number, number, number]; facing?: number }[] = ([
  ...WORKSTATION_IDS.map((id) => {
    const station = WORKSTATIONS[id];
    return { id, label: station.label, position: [...station.position] as [number, number, number], facing: station.facing };
  }),
  { id: "supplier", label: "Terminal de proveedores", position: [7.5, 0, -2.15] },
  { id: "door", label: "Sensor de entrada", position: [0, 0, 7.8] },
] satisfies { id: InteractionId; label: string; position: [number, number, number]; facing?: number }[]).map((zone) => ({ ...zone, position: scaleStorePosition(zone.position) }));

interface MarketSceneProps {
  avatar: AvatarConfig;
  carry: CarryState;
  checkoutLevel: number;
  playerSpeedTier: number;
  stationTiers: Record<string, number>;
  customers: CustomerRuntimeState[];
  checkoutTransactions: CheckoutTransaction[];
  returnsBin: Inventory;
  returnedCartCount: number;
  buildProject?: BuildProject;
  objectiveComplete: boolean;
  crops: CropState[];
  productionMachines: ProductionMachineState[];
  shelves: Inventory;
  unlockedAreas: string[];
  lightsOn: boolean;
  simulationTimeMs: number;
  employees: Employee[];
  lastInteraction: { id: InteractionId; sequence: number } | null;
  onInteract: (id: InteractionId) => void;
  onDistance: (meters: number) => void;
  onPrompt: (prompt: InteractionPrompt | null) => void;
  open: boolean;
  doorState: "CLOSED" | "OPENING" | "OPEN" | "CLOSING" | "BLOCKED";
  doorProgress: number;
  onDoorPresence: (active: boolean) => void;
  debug?: boolean;
}

export const MarketScene = memo(function MarketScene({ avatar, carry, customers, checkoutTransactions, returnsBin, returnedCartCount, buildProject, objectiveComplete, crops, productionMachines, shelves, unlockedAreas, lightsOn, simulationTimeMs, employees, onPrompt, onInteract, onDistance, onDoorPresence, lastInteraction, open, doorProgress, checkoutLevel, playerSpeedTier, stationTiers, debug = false }: MarketSceneProps) {
  const playerFocus = useRef(new THREE.Vector3(...PLAYER_START));
  const [checkoutFocused, setCheckoutFocused] = useState(false);
  const [activeWorkstation, setActiveWorkstation] = useState<WorkstationId | null>(null);
  const carriedProduct = carry.item?.productId ?? "tomatoes";
  const servicePoint = retailServicePoint(carriedProduct);
  const shelfPosition = scaleStorePosition([servicePoint[0], 0, servicePoint[1]]);
  const primaryCrop = crops.find((crop) => crop.status !== "LOCKED" && (!carry.item || crop.productId === carry.item.productId))
    ?? crops.find((crop) => crop.status !== "LOCKED");
  const interactionLabels: Partial<Record<InteractionId, string>> = {
    farm: farmInteractionLabel(primaryCrop, carry, simulationTimeMs),
    shelf: `Surtir expositor de ${PRODUCTS[carriedProduct].name.toLowerCase()}`,
  };
  return (
    <Canvas events={safeCanvasEvents} shadows="percentage" dpr={[0.85, 1.4]} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <AdaptiveDpr pixelated />
      <OverviewCamera playerFocus={playerFocus} checkoutFocused={checkoutFocused} />
      <color attach="background" args={["#b8dfce"]} />
      <fog attach="fog" args={["#b8dfce", 62 * WORLD_SCALE, 105 * WORLD_SCALE]} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[8 * WORLD_SCALE, 13 * WORLD_SCALE, 7 * WORLD_SCALE]} intensity={2.3} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-far={30 * WORLD_SCALE} />
      <group scale={WORLD_SCALE}>
        <Suspense fallback={null}>
          <group scale={[STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE]}><CityPerimeter /></group>
          <group scale={[STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE]}><MarketBuilding open={open} doorProgress={doorProgress} /></group>
          <KitFurniture shelves={shelves} machines={productionMachines} customers={customers} checkoutTransactions={checkoutTransactions} returnsBin={returnsBin} returnedCartCount={returnedCartCount} lightsOn={lightsOn} unlockedAreas={unlockedAreas} />
          <KitFarm crops={crops} machines={productionMachines} nowMs={simulationTimeMs} unlockedAreas={unlockedAreas} />
          <WorkstationPads shelfPosition={shelfPosition} carriedProduct={carriedProduct} unlockedAreas={unlockedAreas} activeId={activeWorkstation} />
          {buildProject && <BuildPad project={buildProject} objectiveComplete={objectiveComplete} />}
          <UpgradePads level={Math.min(...Object.values(stationTiers))} />
          {lastInteraction && lastInteraction.id !== "door" && <InteractionPulse id={lastInteraction.id} sequence={lastInteraction.sequence} position={lastInteraction.id === "shelf" ? shelfPosition : undefined} />}
          {debug && <DebugWorld customers={customers} />}
        </Suspense>
        <Suspense fallback={null}><Employees employees={employees} simulationTimeMs={simulationTimeMs} /></Suspense>
        {open && <Customers customers={customers} simulationTimeMs={simulationTimeMs} />}
        <ContactShadows frames={1} position={[0, 0.015, 2 * STORE_LAYOUT_SCALE]} opacity={0.24} scale={34 * STORE_LAYOUT_SCALE} blur={2.6} far={8} />
      </group>
      <Physics timeStep={1 / 60} gravity={[0, -9.81, 0]}>
        <StoreColliders doorProgress={doorProgress} />
        <InteractionSensors checkoutLevel={checkoutLevel} shelfPosition={shelfPosition} unlockedAreas={unlockedAreas} />
        <Suspense fallback={null}><Player avatar={avatar} carry={carry} checkoutLevel={checkoutLevel} playerSpeedTier={playerSpeedTier} unlockedAreas={unlockedAreas} debug={debug} onPrompt={onPrompt} onInteract={onInteract} onDistance={onDistance} onDoorPresence={onDoorPresence} onCheckoutFocus={setCheckoutFocused} onWorkstationChange={setActiveWorkstation} lastInteraction={lastInteraction} playerFocus={playerFocus} shelfPosition={shelfPosition} interactionLabels={interactionLabels} farmAnimation={primaryCrop?.status === "EMPTY" ? "Plant" : "Harvest"} /></Suspense>
      </Physics>
      <LocalEnvironment />
      {debug && <DebugProbe />}
    </Canvas>
  );
}, sameMarketSceneProps);

function farmInteractionLabel(crop: CropState | undefined, carry: CarryState, simulationTimeMs: number) {
  if (!crop) return "Huerta aún no desbloqueada";
  if (carry.item && carry.item.productId !== crop.productId) return "Vacía tu carga antes de cosechar";
  if (carry.item && carry.item.quantity >= carry.capacity) return `Carga llena · lleva ${PRODUCTS[carry.item.productId].name.toLowerCase()} al expositor`;
  const productName = PRODUCTS[crop.productId].name.toLowerCase();
  if (crop.status === "EMPTY") return `Sembrar ${productName}`;
  if (crop.status === "READY") return `Cosechar ${productName}`;
  if (crop.status === "GROWING") {
    const progress = Math.round(Math.min(1, Math.max(0, (simulationTimeMs - crop.plantedAt) / Math.max(1, crop.readyAt - crop.plantedAt))) * 100);
    return `${PRODUCTS[crop.productId].name} creciendo · ${progress}%`;
  }
  return `Atender parcela de ${productName}`;
}

function sameMarketSceneProps(previous: MarketSceneProps, next: MarketSceneProps) {
  if (previous.debug !== next.debug || previous.checkoutLevel !== next.checkoutLevel || previous.playerSpeedTier !== next.playerSpeedTier || previous.stationTiers !== next.stationTiers || previous.open !== next.open || previous.doorState !== next.doorState || previous.doorProgress !== next.doorProgress) return false;
  if (previous.buildProject?.contributedMinor !== next.buildProject?.contributedMinor || previous.buildProject?.completed !== next.buildProject?.completed || previous.objectiveComplete !== next.objectiveComplete) return false;
  if (previous.crops !== next.crops || previous.productionMachines !== next.productionMachines || previous.shelves !== next.shelves || previous.unlockedAreas !== next.unlockedAreas || previous.lightsOn !== next.lightsOn || previous.simulationTimeMs !== next.simulationTimeMs) return false;
  if (previous.customers !== next.customers || previous.checkoutTransactions !== next.checkoutTransactions || previous.returnsBin !== next.returnsBin || previous.returnedCartCount !== next.returnedCartCount) return false;
  if (previous.lastInteraction !== next.lastInteraction || previous.onInteract !== next.onInteract || previous.onPrompt !== next.onPrompt || previous.onDistance !== next.onDistance || previous.onDoorPresence !== next.onDoorPresence) return false;
  const avatarKeys = ["body", "hair", "hairColor", "skin", "shirt", "hat"] as const;
  if (avatarKeys.some((key) => previous.avatar[key] !== next.avatar[key])) return false;
  if (previous.carry.capacity !== next.carry.capacity || previous.carry.item?.productId !== next.carry.item?.productId || previous.carry.item?.quantity !== next.carry.item?.quantity) return false;
  return previous.employees === next.employees;
}

function LocalEnvironment() {
  return <Environment resolution={64} frames={1} environmentIntensity={0.28}>
    <Lightformer form="rect" intensity={2.4} color="#fff3d2" position={[0, 8, 2]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12]} />
    <Lightformer form="rect" intensity={1.4} color="#b8dfce" position={[8, 3, 4]} rotation={[0, -Math.PI / 2, 0]} scale={[7, 5]} />
    <Lightformer form="rect" intensity={1.1} color="#a8c7e8" position={[-8, 4, -2]} rotation={[0, Math.PI / 2, 0]} scale={[6, 5]} />
  </Environment>;
}

function BuildPad({ project, objectiveComplete }: { project: BuildProject; objectiveComplete: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const progress = project.costMinor ? project.contributedMinor / project.costMinor : 1;
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.y = Math.sin(clock.elapsedTime * 0.8) * 0.08; });
  return <group ref={ref} position={scaleStorePosition([7.5, 0.035, -5.35])}>
    <mesh receiveShadow><cylinderGeometry args={[1.05, 1.2, 0.08, 32]} /><meshStandardMaterial color={project.completed ? objectiveComplete ? "#55bf90" : "#e0b44a" : "#67a9de"} emissive={project.completed ? "#294e35" : "#173e62"} emissiveIntensity={0.35} /></mesh>
    <mesh position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.72, 0.9, 36, 1, 0, Math.max(0.02, progress) * Math.PI * 2]} /><meshBasicMaterial color="#fff3d2" side={THREE.DoubleSide} /></mesh>
    <Text position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.24} color="#173f35" anchorX="center">{project.completed ? objectiveComplete ? "LISTO" : "OBJETIVO" : `${Math.round(progress * 100)}%`}</Text>
  </group>;
}

function UpgradePads({ level }: { level: number }) {
  const pads: { id: string; label: string; position: [number, number, number]; hire?: boolean }[] = [
    { id: "station", label: `ESTACIÓN T${level}`, position: [3.2, 0.035, -6.55] },
    { id: "speed", label: "VELOCIDAD", position: [4.75, 0.035, -6.55] },
    { id: "capacity", label: "CARGA", position: [6.3, 0.035, -6.55] },
    { id: "employee", label: "EQUIPO", position: [7.85, 0.035, -6.55], hire: true },
  ];
  return <>{pads.map((pad) => <group key={pad.id} position={scaleStorePosition(pad.position)} scale={0.78}>
    <EnvironmentModel id={pad.hire ? "equipment_hire_pad" : "equipment_upgrade_pad"} />
    <Text position={[0, 0.13, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.18} color="#fff7dc" anchorX="center">{pad.label}</Text>
  </group>)}</>;
}

function WorkstationPads({ shelfPosition, carriedProduct, unlockedAreas, activeId }: { shelfPosition: [number, number, number]; carriedProduct: ProductId; unlockedAreas: readonly string[]; activeId: WorkstationId | null }) {
  return <>{WORKSTATION_IDS.filter((id) => !WORKSTATIONS[id].dedicatedPad && isWorkstationUnlocked(id, unlockedAreas)).map((id) => {
    const station = WORKSTATIONS[id];
    const position = id === "shelf" ? shelfPosition : scaleStorePosition([...station.position]);
    const label = id === "shelf" ? `SURTIR ${PRODUCTS[carriedProduct].name.toUpperCase()}` : station.padLabel;
    const active = activeId === id;
    return <group key={id} position={[position[0], 0.065, position[2]]} scale={STORE_ELEMENT_SCALE}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1.35, 0.92]} />
        <meshStandardMaterial color={station.color} emissive={active ? station.color : "#000000"} emissiveIntensity={active ? 0.55 : 0} transparent opacity={active ? 0.88 : 0.62} roughness={0.72} />
      </mesh>
      <Line points={[[-0.675, 0.018, -0.46], [0.675, 0.018, -0.46], [0.675, 0.018, 0.46], [-0.675, 0.018, 0.46], [-0.675, 0.018, -0.46]]} color={active ? "#fff1ac" : "#ecf7ef"} lineWidth={active ? 2.2 : 1.25} />
      <Text position={[0, 0.024, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={label.length > 14 ? 0.085 : 0.105} color="#ffffff" anchorX="center" anchorY="middle" fontWeight={850}>{label}</Text>
    </group>;
  })}</>;
}

function InteractionPulse({ id, sequence, position }: { id: InteractionId; sequence: number; position?: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  const zone = ZONES.find((candidate) => candidate.id === id);
  useFrame(({ clock }) => { if (ref.current) { const phase = (clock.elapsedTime * 2.8 + sequence * 0.17) % 1; ref.current.scale.setScalar(0.7 + phase * 0.55); ref.current.children.forEach((child) => { if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) { child.material.opacity = 0.55 * (1 - phase); child.material.transparent = true; } }); } });
  if (!zone) return null;
  return <group ref={ref} position={position ?? [zone.position[0], 0.06, zone.position[2]]}><mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.35, 0.48, 24]} /><meshBasicMaterial color="#fff1a8" transparent opacity={0.5} depthWrite={false} /></mesh></group>;
}

function DebugWorld({ customers }: { customers: CustomerRuntimeState[] }) {
  const navGeometry = useMemo(() => createWalkableStoreGeometry(), []);
  useEffect(() => () => navGeometry.dispose(), [navGeometry]);
  const sockets: [string, number, number][] = [
    ["tomato/pan", -4.1, -0.9], ["maíz", -4, 4.15], ["frío", 0, -3.35],
    ["queso", 0, 4.2], ["huevos", 4.1, -0.9], ["zumo", 4, 4.15],
  ];
  const queueSlots = [0, 1].flatMap((lane) => Array.from({ length: 6 }, (_, slot) => {
    const point = checkoutQueuePosition(slot, lane === 1 ? 1 : 0);
    return { lane, slot, position: scaleStorePosition([point[0], 0.055, point[1]]) };
  }));
  return <group>
    <gridHelper args={[43, 86, "#46d89c", "#285f4e"]} position={[0, 0.045, 7.2]} />
    <mesh geometry={navGeometry} scale={[STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE]} position={[0, 0.052, 0]}>
      <meshBasicMaterial color="#54e7b1" wireframe transparent opacity={0.17} depthWrite={false} />
    </mesh>
    {STORE_OBSTACLES.map((obstacle, index) => <mesh key={`collider-${index}`} position={[obstacle.x, 0.9, obstacle.z]}>
      <boxGeometry args={[obstacle.halfX * 2, 1.8, obstacle.halfZ * 2]} />
      <meshBasicMaterial color="#ff6f61" wireframe transparent opacity={0.65} />
    </mesh>)}
    {ZONES.map((zone) => <mesh key={`sensor-${zone.id}`} position={[zone.position[0], 0.06, zone.position[2]]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.68, 0.73, 24]} /><meshBasicMaterial color="#49b8ff" transparent opacity={0.8} /></mesh>)}
    {sockets.map(([label, x, z]) => <group key={`socket-${label}`} position={scaleStorePosition([x, 0.08, z])}>
      <mesh><sphereGeometry args={[0.105, 10, 8]} /><meshBasicMaterial color="#ffde59" /></mesh>
      <Text position={[0, 0.28, 0]} fontSize={0.12} color="#fff5b0" anchorX="center">S {label}</Text>
    </group>)}
    {queueSlots.map(({ lane, slot, position }) => <group key={`queue-${lane}-${slot}`} position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.22, 0.27, 20]} /><meshBasicMaterial color={lane ? "#d879ff" : "#80e8ff"} transparent opacity={0.9} /></mesh>
      <Text position={[0, 0.16, 0]} fontSize={0.105} color="#ffffff" anchorX="center">Q{lane + 1}.{slot}</Text>
    </group>)}
    {customers.map((customer) => customer.path.length > customer.pathIndex ? <Line key={`route-${customer.id}`} points={[[customer.x * STORE_LAYOUT_SCALE, 0.12, customer.z * STORE_LAYOUT_SCALE], ...customer.path.slice(customer.pathIndex).map((point) => [point[0] * STORE_LAYOUT_SCALE, 0.12, point[1] * STORE_LAYOUT_SCALE] as [number, number, number])]} color={customer.queueLane === 1 ? "#d879ff" : "#ffe16b"} lineWidth={1} /> : null)}
    {customers.map((customer) => <Text key={`fsm-${customer.id}`} position={[customer.x * STORE_LAYOUT_SCALE, 2.2, customer.z * STORE_LAYOUT_SCALE]} fontSize={0.16} color="#ffffff" anchorX="center">{customer.state}</Text>)}
  </group>;
}

function DebugProbe() {
  const monitor = useRef(new PerformanceMonitor());
  const get = useThree((state) => state.get);
  useEffect(() => {
    const publish = () => {
      const state = get();
      const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
      qaWindow.__MARKET_QA__ ??= {};
      qaWindow.__MARKET_QA__.renderer = {
        frameloop: state.frameloop,
        active: state.internal.active,
        pendingFrames: state.internal.frames,
        contextLost: state.gl.getContext().isContextLost(),
        visibility: document.visibilityState,
      };
    };
    publish();
    const timer = window.setInterval(publish, 250);
    return () => window.clearInterval(timer);
  }, [get]);
  useFrame(({ gl }, delta) => {
    const metrics = monitor.current.sample(delta * 1_000, { drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0 });
    if (metrics) window.dispatchEvent(new CustomEvent("market-debug-metrics", { detail: metrics }));
  });
  return null;
}

const CHECKOUT_CAMERA_TARGET = new THREE.Vector3(...scaleStorePosition([...CHECKOUT_CAMERA_TARGET_COORDS]));
const CHECKOUT_CAMERA_POSITION = new THREE.Vector3(...scaleStorePosition([...CHECKOUT_CAMERA_POSITION_COORDS]));

function OverviewCamera({ playerFocus, checkoutFocused }: { playerFocus: RefObject<THREE.Vector3>; checkoutFocused: boolean }) {
  const camera = useRef<THREE.OrthographicCamera>(null);
  const lookAt = useRef(new THREE.Vector3(PLAYER_START[0], 0.9 * PLAYER_SCALE, PLAYER_START[2]).multiplyScalar(WORLD_SCALE));
  const desiredLookAt = useRef(new THREE.Vector3());
  const desiredPosition = useRef(new THREE.Vector3());
  const overviewLookAt = useRef(new THREE.Vector3());
  const overviewPosition = useRef(new THREE.Vector3());
  const checkoutBlend = useRef(0);
  const { size } = useThree();
  useFrame((_, delta) => {
    if (!camera.current) return;
    const targetY = 0.9 * PLAYER_SCALE;
    overviewLookAt.current.set(playerFocus.current.x, targetY, playerFocus.current.z);
    overviewPosition.current.set(
      playerFocus.current.x + OVERVIEW_CAMERA_OFFSET.x,
      targetY + OVERVIEW_CAMERA_OFFSET.y,
      playerFocus.current.z + OVERVIEW_CAMERA_OFFSET.z,
    );
    checkoutBlend.current = THREE.MathUtils.lerp(checkoutBlend.current, checkoutFocused ? 1 : 0, dampFactor(checkoutFocused ? 4.8 : 3.2, delta));
    desiredLookAt.current.copy(overviewLookAt.current).lerp(CHECKOUT_CAMERA_TARGET, checkoutBlend.current).multiplyScalar(WORLD_SCALE);
    desiredPosition.current.copy(overviewPosition.current).lerp(CHECKOUT_CAMERA_POSITION, checkoutBlend.current).multiplyScalar(WORLD_SCALE);
    const response = dampFactor(2.8, delta);
    camera.current.position.lerp(desiredPosition.current, response);
    lookAt.current.lerp(desiredLookAt.current, response);
    camera.current.lookAt(lookAt.current);
    const overviewZoom = Math.min(size.width / 32, size.height / 28.5) / CAMERA_DISTANCE_FACTOR;
    const checkoutZoom = Math.min(size.width / 27, size.height / 19);
    camera.current.zoom = THREE.MathUtils.lerp(camera.current.zoom, THREE.MathUtils.lerp(overviewZoom, checkoutZoom, checkoutBlend.current), dampFactor(5, delta));
    camera.current.updateProjectionMatrix();
  });
  return <OrthographicCamera ref={camera} makeDefault position={[(PLAYER_START[0] + OVERVIEW_CAMERA_OFFSET.x) * WORLD_SCALE, 23.9 * WORLD_SCALE, (PLAYER_START[2] + OVERVIEW_CAMERA_OFFSET.z) * WORLD_SCALE]} near={0.1 * WORLD_SCALE} far={120 * WORLD_SCALE} />;
}

function Player({ avatar, carry, checkoutLevel, playerSpeedTier, unlockedAreas, debug, onPrompt, onInteract, onDistance, onDoorPresence, onCheckoutFocus, onWorkstationChange, lastInteraction, playerFocus, shelfPosition, interactionLabels, farmAnimation }: { avatar: AvatarConfig; carry: CarryState; checkoutLevel: number; playerSpeedTier: number; unlockedAreas: readonly string[]; debug: boolean; onPrompt: (prompt: InteractionPrompt | null) => void; onInteract: (id: InteractionId) => void; onDistance: (meters: number) => void; onDoorPresence: (active: boolean) => void; onCheckoutFocus: (active: boolean) => void; onWorkstationChange: (id: WorkstationId | null) => void; lastInteraction: { id: InteractionId; sequence: number } | null; playerFocus: RefObject<THREE.Vector3>; shelfPosition: [number, number, number]; interactionLabels: Partial<Record<InteractionId, string>>; farmAnimation: CharacterAnimation }) {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const visual = useRef<THREE.Group>(null);
  const logicalPosition = useRef(new THREE.Vector3(...PLAYER_START).multiplyScalar(WORLD_SCALE));
  const velocity = useRef(new THREE.Vector2());
  const nearest = useRef<InteractionPrompt | null>(null);
  const moving = useRef(false);
  const angularVelocity = useRef(0);
  const avatarMotion = useRef({ speed: 0, locomotionSpeed: 0, yawDelta: 0 });
  const unreportedDistance = useRef(0);
  const lastInput = useRef({ x: 0, y: 0, magnitude: 0 });
  const lastRequestedMovement = useRef(new THREE.Vector3());
  const lastComputedMovement = useRef(new THREE.Vector3());
  const lastPhysicsCollisions = useRef<unknown[]>([]);
  const fixedLoop = useRef(new FixedStepLoop());
  const frameCount = useRef(0);
  const checkoutFocused = useRef(false);
  const workstation = useRef(new WorkstationController());
  const publishedWorkstation = useRef<WorkstationId | null>(null);
  const shelfX = shelfPosition[0];
  const shelfZ = shelfPosition[2];
  const unlockedSignature = unlockedAreas.join("|");
  const director = useMemo(() => new InteractionDirector(interactionZoneConfigs(checkoutLevel, [shelfX, 0, shelfZ], unlockedSignature ? unlockedSignature.split("|") : [])), [checkoutLevel, shelfX, shelfZ, unlockedSignature]);
  const characterController = useRef<ReturnType<ReturnType<typeof useRapier>["world"]["createCharacterController"]> | null>(null);
  const { world, rapier } = useRapier();
  const [walking, setWalking] = useState(false);
  const [performingWorkstation, setPerformingWorkstation] = useState<WorkstationId | null>(null);
  const interactionAnimation: Record<InteractionId, CharacterAnimation> = { farm: farmAnimation, mill: "LiftBox", bakery: "StockHigh", chicken: "PickupLow", cow: "PickupLow", cheese: "LiftBox", juice: "LiftBox", shelf: "StockLow", checkout: "ScanItem", supplier: "ReceiveOrder", office: "Wave", "upgrade-station": "Happy", "upgrade-speed": "Happy", "upgrade-capacity": "Happy", "upgrade-employee": "Wave", door: "Enter" };
  const publishWorkstation = (id: WorkstationId | null) => {
    if (publishedWorkstation.current === id) return;
    publishedWorkstation.current = id;
    setPerformingWorkstation(id);
    onWorkstationChange(id);
  };

  useEffect(() => {
    const controller = world.createCharacterController(0.03);
    controller.enableAutostep(0.25, 0.18, true);
    controller.enableSnapToGround(0.18);
    controller.setMaxSlopeClimbAngle(Math.PI / 4);
    controller.setMinSlopeSlideAngle(Math.PI / 3);
    characterController.current = controller;
    return () => {
      characterController.current = null;
      world.removeCharacterController(controller);
    };
  }, [world]);

  useEffect(() => {
    if (!debug) return;
    const qaWindow = window as typeof window & {
      __MARKET_FIND_PLAYER_PATH__?: (target: [number, number]) => [number, number][];
      __MARKET_SET_PLAYER_INPUT__?: (x: number, y: number) => void;
    };
    const findPlayerPath = (target: [number, number]) => storePathfinder(
      [logicalPosition.current.x / WORLD_SCALE / STORE_LAYOUT_SCALE, logicalPosition.current.z / WORLD_SCALE / STORE_LAYOUT_SCALE],
      [target[0] / STORE_LAYOUT_SCALE, target[1] / STORE_LAYOUT_SCALE],
    ).map(([x, z]) => [x * STORE_LAYOUT_SCALE, z * STORE_LAYOUT_SCALE] as [number, number]);
    const setPlayerInput = (x: number, y: number) => inputManager.setKeyboard(x, y);
    qaWindow.__MARKET_FIND_PLAYER_PATH__ = findPlayerPath;
    qaWindow.__MARKET_SET_PLAYER_INPUT__ = setPlayerInput;
    return () => {
      if (qaWindow.__MARKET_FIND_PLAYER_PATH__ === findPlayerPath) delete qaWindow.__MARKET_FIND_PLAYER_PATH__;
      if (qaWindow.__MARKET_SET_PLAYER_INPUT__ === setPlayerInput) delete qaWindow.__MARKET_SET_PLAYER_INPUT__;
      inputManager.clearKeyboard();
    };
  }, [debug]);

  useFrame(({ clock }) => {
    frameCount.current += 1;
    if (!body.current || !collider.current || !visual.current || !characterController.current) return;
    const gamepad = navigator.getGamepads?.()[0];
    inputManager.setGamepad(gamepad?.axes[0] ?? 0, gamepad?.axes[1] ?? 0);
    fixedLoop.current.advance(clock.elapsedTime, (step) => {
      const input = inputManager.sample();
      lastInput.current = input;
      const workLocked = workstation.current.updateInput(input.magnitude);
      const currentWorkstation = workstation.current.performingZoneId() as WorkstationId | null;
      publishWorkstation(currentWorkstation);
      const intention = workLocked ? { x: 0, y: 0 } : cameraRelativeMovement(input, OVERVIEW_CAMERA_GROUND_FORWARD);
      const tierSpeed = PLAYER_SPEED * (1 + Math.min(0.32, Math.max(0, playerSpeedTier - 1) * 0.08));
      const nextVelocity = workLocked ? { x: 0, y: 0 } : moveVelocity(
        { x: velocity.current.x, y: velocity.current.y },
        intention,
        step,
        { walkSpeed: tierSpeed * WORLD_SCALE, acceleration: 12 * WORLD_SCALE, braking: 16 * WORLD_SCALE, turnTime: 0.13, maxTurnRate: Math.PI * 3 },
      );
      velocity.current.set(nextVelocity.x, nextVelocity.y);

      lastRequestedMovement.current.set(velocity.current.x * step, -0.025, velocity.current.y * step);
      characterController.current!.computeColliderMovement(
        collider.current!,
        lastRequestedMovement.current,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      );
      if (debug) {
        lastPhysicsCollisions.current = Array.from({ length: characterController.current!.numComputedCollisions() }, (_, index) => {
          const collision = characterController.current!.computedCollision(index);
          const translation = collision?.collider?.translation();
          return collision ? {
            handle: collision.collider?.handle ?? null,
            shape: collision.collider?.shapeType() ?? null,
            colliderPosition: translation ? [translation.x / WORLD_SCALE, translation.y / WORLD_SCALE, translation.z / WORLD_SCALE] : null,
            normal: [collision.normal1.x, collision.normal1.y, collision.normal1.z],
            remaining: [collision.translationDeltaRemaining.x, collision.translationDeltaRemaining.y, collision.translationDeltaRemaining.z],
            toi: collision.toi,
          } : null;
        });
      }
      const movement = characterController.current!.computedMovement();
      lastComputedMovement.current.set(movement.x, movement.y, movement.z);
      logicalPosition.current.add(lastComputedMovement.current);
      unreportedDistance.current += Math.hypot(movement.x, movement.z) / WORLD_SCALE;
      if (unreportedDistance.current >= 1) { const meters = unreportedDistance.current; unreportedDistance.current = 0; onDistance(meters); }
      logicalPosition.current.y = Math.max(0, logicalPosition.current.y);
      body.current!.setNextKinematicTranslation(logicalPosition.current);

      const speed = velocity.current.length();
      const workHeading = currentWorkstation ? workstationFacing(currentWorkstation, carry.item?.productId) : null;
      if (workLocked && workHeading !== null) {
        const turn = smoothYaw(visual.current!.rotation.y, workHeading, angularVelocity.current, step, { walkSpeed: PLAYER_SPEED * WORLD_SCALE, acceleration: 12, braking: 16, turnTime: 0.13, maxTurnRate: Math.PI * 3 });
        avatarMotion.current.yawDelta = workHeading - visual.current!.rotation.y;
        visual.current!.rotation.y = turn.yaw;
        angularVelocity.current = turn.angularVelocity;
      } else if (speed > 0.08) {
        const heading = Math.atan2(velocity.current.x, velocity.current.y);
        const turn = smoothYaw(visual.current!.rotation.y, heading, angularVelocity.current, step, { walkSpeed: PLAYER_SPEED * WORLD_SCALE, acceleration: 12, braking: 16, turnTime: 0.13, maxTurnRate: Math.PI * 3 });
        avatarMotion.current.yawDelta = heading - visual.current!.rotation.y;
        visual.current!.rotation.y = turn.yaw;
        angularVelocity.current = turn.angularVelocity;
      }

      const events = director.update("player", logicalPosition.current.x / WORLD_SCALE, logicalPosition.current.z / WORLD_SCALE, clock.elapsedTime * 1000);
      const activeWorkstation = highestPriorityWorkstation(director.activeZoneIds());
      workstation.current.sync(activeWorkstation, input.magnitude);
      publishWorkstation(workstation.current.performingZoneId() as WorkstationId | null);
      for (const event of events) {
        if (event.zone.id === "door" && (event.signal === "enter" || event.signal === "exit")) onDoorPresence(event.signal === "enter");
        if (event.signal === "tick" && (!isWorkstationId(event.zone.id) || workstation.current.canPerform(event.zone.id))) onInteract(event.zone.id as InteractionId);
      }
    });
    const isMoving = velocity.current.length() > 0.12;
    avatarMotion.current.speed = velocity.current.length();
    avatarMotion.current.locomotionSpeed = velocity.current.length() / WORLD_SCALE;
    if (isMoving !== moving.current) { moving.current = isMoving; setWalking(isMoving); }
    playerFocus.current.copy(logicalPosition.current).multiplyScalar(1 / WORLD_SCALE);
    if (debug) {
      const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
      qaWindow.__MARKET_QA__ ??= {};
      qaWindow.__MARKET_QA__.player = { x: logicalPosition.current.x / WORLD_SCALE, z: logicalPosition.current.z / WORLD_SCALE, speed: avatarMotion.current.locomotionSpeed };
      qaWindow.__MARKET_QA__.input = lastInput.current;
      qaWindow.__MARKET_QA__.physics = {
        requested: lastRequestedMovement.current.toArray(),
        computed: lastComputedMovement.current.toArray(),
        velocity: velocity.current.toArray(),
        collisions: lastPhysicsCollisions.current,
      };
      qaWindow.__MARKET_QA__.workstation = workstation.current.snapshot();
      qaWindow.__MARKET_QA__.render = { frame: frameCount.current, elapsed: clock.elapsedTime };
    }

    const active = director.activeZoneIds();
    const nextCheckoutFocused = workstation.current.performingZoneId() === "checkout";
    if (nextCheckoutFocused !== checkoutFocused.current) {
      checkoutFocused.current = nextCheckoutFocused;
      onCheckoutFocus(nextCheckoutFocused);
    }
    visual.current.visible = !nextCheckoutFocused;
    if (debug) {
      const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
      if (qaWindow.__MARKET_QA__) qaWindow.__MARKET_QA__.activeZones = active;
    }
    const foundZone = ZONES.find((zone) => active.includes(zone.id));
    const found = foundZone ? { id: foundZone.id, label: interactionLabels[foundZone.id] ?? foundZone.label } : null;
    if (found?.id !== nearest.current?.id || found?.label !== nearest.current?.label) { nearest.current = found; onPrompt(found); }
  });

  const worldStart = PLAYER_START.map((value) => value * WORLD_SCALE) as [number, number, number];
  return <RigidBody ref={body} type="kinematicPosition" colliders={false} position={worldStart} enabledRotations={[false, false, false]} canSleep={false} userData={{ actor: "player" }}>
    <CapsuleCollider ref={collider} args={[0.45 * WORLD_SCALE, 0.24 * WORLD_SCALE]} position={[0, 0.69 * WORLD_SCALE, 0]} friction={0} />
    <group ref={visual}><Avatar {...avatar} scale={PLAYER_SCALE * WORLD_SCALE} walking={walking} carrying={Boolean(carry.item)} motion={avatarMotion} animation={!walking && lastInteraction && lastInteraction.id === performingWorkstation ? interactionAnimation[lastInteraction.id] : undefined} animationSpeed={walking ? PLAYER_WALK_ANIMATION_SPEED : undefined} feedbackSource="player" feedbackActorId="player" /><CarryStack carry={carry} /></group>
  </RigidBody>;
}

function CarryStack({ carry }: { carry: CarryState }) {
  if (!carry.item) return null;
  const colors: Record<ProductId, string> = { wheat: "#d7af48", flour: "#eee2c8", bread: "#ad6d35", corn: "#e6bc43", milk: "#f4f0df", eggs: "#eee4c8", cheese: "#e8b94b", apples: "#c94f3e", tomatoes: "#d6503e", coffee: "#6b4031", juice: "#d96842" };
  const count = Math.min(carry.capacity, carry.item.quantity);
  return <group position={[0, 0.95 * WORLD_SCALE, 0.33 * WORLD_SCALE]} rotation={[-0.08, 0, 0]}>
    {Array.from({ length: count }, (_, index) => <mesh key={index} castShadow position={[((index % 3) - 1) * 0.12 * WORLD_SCALE, Math.floor(index / 3) * 0.13 * WORLD_SCALE, 0]}>
      {carry.item!.productId === "tomatoes" || carry.item!.productId === "apples" || carry.item!.productId === "eggs" ? <dodecahedronGeometry args={[0.09 * WORLD_SCALE, 1]} /> : <boxGeometry args={[0.18 * WORLD_SCALE, 0.12 * WORLD_SCALE, 0.16 * WORLD_SCALE]} />}
      <meshStandardMaterial color={colors[carry.item!.productId]} roughness={0.8} />
    </mesh>)}
  </group>;
}

function StoreColliders({ doorProgress }: { doorProgress: number }) {
  return <RigidBody type="fixed" colliders={false}>
    <CuboidCollider args={[11.5 * STORE_LAYOUT_SCALE * WORLD_SCALE, 0.08 * WORLD_SCALE, 12.2 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[0, -0.08 * WORLD_SCALE, 3.7 * STORE_LAYOUT_SCALE * WORLD_SCALE]} friction={0.8} />
    {STORE_OBSTACLES.map((obstacle, index) => <CuboidCollider key={index} args={[obstacle.halfX * WORLD_SCALE, 0.9 * WORLD_SCALE, obstacle.halfZ * WORLD_SCALE]} position={[obstacle.x * WORLD_SCALE, 0.9 * WORLD_SCALE, obstacle.z * WORLD_SCALE]} />)}
    <CuboidCollider args={[0.15 * WORLD_SCALE, 2.3 * WORLD_SCALE, 11.9 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[-11.25 * STORE_LAYOUT_SCALE * WORLD_SCALE, 2.3 * WORLD_SCALE, 3.75 * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    <CuboidCollider args={[0.15 * WORLD_SCALE, 2.3 * WORLD_SCALE, 11.9 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[11.25 * STORE_LAYOUT_SCALE * WORLD_SCALE, 2.3 * WORLD_SCALE, 3.75 * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    <CuboidCollider args={[11.4 * STORE_LAYOUT_SCALE * WORLD_SCALE, 2.3 * WORLD_SCALE, 0.15 * WORLD_SCALE]} position={[0, 2.3 * WORLD_SCALE, -8.45 * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    <CuboidCollider args={[4.765 * STORE_LAYOUT_SCALE * WORLD_SCALE, 2.3 * WORLD_SCALE, 0.12 * WORLD_SCALE]} position={[-6.585 * STORE_LAYOUT_SCALE * WORLD_SCALE, 2.3 * WORLD_SCALE, 7.78 * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    <CuboidCollider args={[4.765 * STORE_LAYOUT_SCALE * WORLD_SCALE, 2.3 * WORLD_SCALE, 0.12 * WORLD_SCALE]} position={[6.585 * STORE_LAYOUT_SCALE * WORLD_SCALE, 2.3 * WORLD_SCALE, 7.78 * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    {[-1, 1].map((side) => <CuboidCollider key={side} args={[0.84 * STORE_LAYOUT_SCALE * WORLD_SCALE, 1.36 * WORLD_SCALE, 0.06 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[side * (0.86 + doorProgress * 0.82) * STORE_LAYOUT_SCALE * WORLD_SCALE, 1.36 * WORLD_SCALE, 7.8 * STORE_LAYOUT_SCALE * WORLD_SCALE]} />)}
  </RigidBody>;
}

function highestPriorityWorkstation(activeZoneIds: readonly string[]) {
  return WORKSTATION_IDS.find((id) => activeZoneIds.includes(id)) ?? null;
}

function workstationFacing(id: WorkstationId, carriedProduct?: ProductId) {
  if (id !== "shelf") return WORKSTATIONS[id].facing;
  return retailServicePoint(carriedProduct ?? "tomatoes")[1] > 0 ? 0 : Math.PI;
}

function InteractionSensors({ checkoutLevel, shelfPosition, unlockedAreas }: { checkoutLevel: number; shelfPosition: [number, number, number]; unlockedAreas: readonly string[] }) {
  return <RigidBody type="fixed" colliders={false}>
    {interactionZoneConfigs(checkoutLevel, shelfPosition, unlockedAreas).map((zone) => <BallCollider key={zone.id} args={[zone.enterRadius * WORLD_SCALE]} position={[zone.x * WORLD_SCALE, 0.6 * WORLD_SCALE, zone.z * WORLD_SCALE]} sensor name={`interaction:${zone.id}`} />)}
  </RigidBody>;
}

function interactionZoneConfigs(checkoutLevel = 1, shelfPosition?: [number, number, number], unlockedAreas: readonly string[] = []): InteractionZoneConfig[] {
  return ZONES.filter((zone) => !isWorkstationId(zone.id) || isWorkstationUnlocked(zone.id, unlockedAreas)).map((zone) => ({
    id: zone.id,
    type: zone.id,
    x: zone.id === "shelf" && shelfPosition ? shelfPosition[0] : zone.position[0],
    z: zone.id === "shelf" && shelfPosition ? shelfPosition[2] : zone.position[2],
    enterRadius: (zone.id === "door" ? 1.3 : isWorkstationId(zone.id) ? 0.44 : 0.75) * STORE_ELEMENT_SCALE,
    exitRadius: (zone.id === "door" ? 1.5 : isWorkstationId(zone.id) ? 0.58 : 0.9) * STORE_ELEMENT_SCALE,
    actorMask: ["player"],
    priority: ({ checkout: 100, shelf: 80, mill: 70, bakery: 70, cheese: 70, juice: 70, chicken: 65, cow: 65, farm: 60, "upgrade-station": 50, "upgrade-speed": 50, "upgrade-capacity": 50, "upgrade-employee": 50, door: 20, supplier: 5, office: 5 } as Record<InteractionId, number>)[zone.id],
    dwellMs: zone.id === "checkout" ? 180 : zone.id === "door" ? 0 : 80,
    repeatEveryMs: zone.id === "farm" ? 250 : zone.id === "shelf" ? 180 : zone.id === "checkout" ? (checkoutLevel >= 2 ? 340 : 450) : zone.id === "door" ? 60_000 : 220,
    exitGraceMs: 120,
    channel: zone.id === "door" || zone.id === "supplier" ? "passive" : zone.id === "checkout" ? "hands" : "transfer",
  }));
}

function MarketBuilding({ open, doorProgress }: { open: boolean; doorProgress: number }) {
  return <group>
    <mesh receiveShadow position={[0, -0.08, -0.35]}><boxGeometry args={[23, 0.16, 17]} /><meshStandardMaterial color="#f6e9cc" roughness={0.95} /></mesh>
    <mesh receiveShadow position={[0, -0.1, 11.9]}><boxGeometry args={[23, 0.14, 7.5]} /><meshStandardMaterial color="#d8e8df" roughness={0.96} /></mesh>
    <mesh receiveShadow position={[0, -0.09, 16.15]}><boxGeometry args={[25, 0.12, 1.2]} /><meshStandardMaterial color="#708079" roughness={1} /></mesh>
    {[-6, 0, 6].map((x) => <mesh key={x} position={[x, -0.015, 16.1]}><boxGeometry args={[2.7, 0.02, 0.1]} /><meshStandardMaterial color="#f7e8b9" /></mesh>)}
    <mesh receiveShadow position={[0, 2.3, -8.55]}><boxGeometry args={[23, 4.6, 0.32]} /><meshStandardMaterial color="#c8cbc5" roughness={0.96} /></mesh>
    <mesh receiveShadow position={[-11.35, 2.3, -0.35]}><boxGeometry args={[0.34, 4.6, 16.5]} /><meshStandardMaterial color="#c3c7c1" roughness={0.97} /></mesh>
    <mesh receiveShadow position={[11.35, 2.3, -0.35]}><boxGeometry args={[0.34, 4.6, 16.5]} /><meshStandardMaterial color="#c3c7c1" roughness={0.97} /></mesh>
    <mesh position={[0, 4.48, 7.8]}><boxGeometry args={[23, 0.22, 0.32]} /><meshStandardMaterial color="#bfc3bd" roughness={0.96} /></mesh>
    {[-11.12, -1.82, 1.82, 11.12].map((x) => <mesh key={`concrete-column-${x}`} position={[x, 2.3, 7.8]}><boxGeometry args={[0.46, 4.6, 0.34]} /><meshStandardMaterial color="#c3c7c1" roughness={0.97} /></mesh>)}
    {[-6.585, 6.585].map((x) => <group key={x} position={[x, 1.78, 7.78]}>
      <mesh position={[0, -1.4, 0]}><boxGeometry args={[9.53, 0.76, 0.3]} /><meshStandardMaterial color="#c4c8c2" roughness={0.96} /></mesh>
      <mesh position={[0, 0.54, 0]}><boxGeometry args={[9.34, 3.13, 0.1]} /><meshPhysicalMaterial color="#b9ddd8" transparent opacity={0.34} transmission={0.22} clearcoat={1} clearcoatRoughness={0.08} roughness={0.12} metalness={0.04} envMapIntensity={1.6} /></mesh>
      {[-4.67, 0, 4.67].map((edge) => <mesh key={edge} position={[edge, 0.54, 0.08]}><boxGeometry args={[0.13, 3.3, 0.15]} /><meshStandardMaterial color="#36443e" metalness={0.5} roughness={0.35} /></mesh>)}
      <mesh position={[0, 2.14, 0.08]}><boxGeometry args={[9.42, 0.13, 0.15]} /><meshStandardMaterial color="#36443e" metalness={0.5} roughness={0.35} /></mesh>
      <mesh position={[-1.2, 0.62, 0.14]} rotation={[0, 0, -0.25]}><planeGeometry args={[0.16, 2.85]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.22} depthWrite={false} /></mesh>
    </group>)}
    <group position={[0, 1.36, 7.8]}>
      {[-1, 1].map((side) => <group key={side} position={[side * (0.86 + doorProgress * 0.82), 0, 0]}>
        <mesh><boxGeometry args={[1.68, 2.7, 0.09]} /><meshPhysicalMaterial color="#b8e3df" transparent opacity={0.42} transmission={0.24} clearcoat={1} clearcoatRoughness={0.06} roughness={0.1} envMapIntensity={1.8} /></mesh>
        <mesh position={[0, 0, 0.07]}><boxGeometry args={[0.09, 2.72, 0.11]} /><meshStandardMaterial color="#3b4b46" metalness={0.55} roughness={0.32} /></mesh>
        <mesh position={[0, 0.45, 0.1]} rotation={[0, 0, -0.2]}><planeGeometry args={[0.09, 1.65]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.28} depthWrite={false} /></mesh>
      </group>)}
      {[-1.82, 0, 1.82].map((x) => <mesh key={x} position={[x, 0, 0.08]}><boxGeometry args={[0.12, 2.86, 0.16]} /><meshStandardMaterial color="#35443e" metalness={0.56} roughness={0.3} /></mesh>)}
      <mesh position={[0, 1.46, 0.08]}><boxGeometry args={[3.76, 0.16, 0.17]} /><meshStandardMaterial color="#35443e" metalness={0.56} roughness={0.3} /></mesh>
      <group position={[0, 1.76, 0.02]}>
        <mesh><boxGeometry args={[1.42, 0.38, 0.22]} /><meshStandardMaterial color="#273531" metalness={0.42} roughness={0.36} /></mesh>
        <mesh position={[0, 0, 0.13]}><planeGeometry args={[1.12, 0.2]} /><meshStandardMaterial color={open ? "#79efae" : "#f09678"} emissive={open ? "#39b978" : "#b64b32"} emissiveIntensity={1.2} /></mesh>
        <Text position={[0, 0, 0.145]} fontSize={0.105} color="#f4fff8" anchorX="center">SENSOR AUTOMÁTICO</Text>
      </group>
    </group>
    <mesh position={[0, 4.05, 7.84]}><boxGeometry args={[4.7, 0.66, 0.24]} /><meshStandardMaterial color="#e8e9e3" roughness={0.88} /></mesh>
    <Text position={[0, 4.05, 7.98]} fontSize={0.43} color="#173f35" anchorX="center">MINI MARKET</Text>
  </group>;
}

function Employees({ employees, simulationTimeMs }: { employees: Employee[]; simulationTimeMs: number }) {
  const rolePositions: Record<EmployeeRole, [number, number, number]> = {
    farmer: scaleStorePosition([-5.3, 0, 3.6]),
    operator: scaleStorePosition([-4.8, 0, -1.5]),
    stocker: scaleStorePosition([0, 0, -2.2]),
    cashier: scaleStorePosition([4.7, 0, 2.2]),
    builder: scaleStorePosition([2.9, 0, -4.5]),
    manager: scaleStorePosition([5.4, 0, -3.6]),
  };
  const bodies: CharacterId[] = ["adult-woman", "adult-man", "adult-woman", "adult-man"];
  const hair: HairId[] = ["ponytail", "fade", "bun", "waves"];
  return <>{employees.map((employee, index) => <Npc key={employee.id} employee={employee} simulationTimeMs={simulationTimeMs} position={rolePositions[employee.role]} offset={index * 0.7} color={["#e7a959", "#6b9fc8", "#b56fa6", "#70a85d"][index % 4]} body={bodies[index % bodies.length]} hair={hair[index % hair.length]} />)}</>;
}

function Npc({ employee, simulationTimeMs, position, offset, color, body = "adult-man", hair = "side-part" }: { employee: Employee; simulationTimeMs: number; position: [number, number, number]; offset: number; color: string; body?: CharacterId; hair?: HairId }) {
  const ref = useRef<THREE.Group>(null);
  const visualFrame = useRef(0);
  const motionSnapshot = useRef<CustomerMotionSnapshot | null>(employee.runtime ? captureEmployeeMotion(employee.runtime, runtimeNowMs()) : null);
  const refreshMotionSnapshot = useEffectEvent(() => {
    motionSnapshot.current = employee.runtime ? captureEmployeeMotion(employee.runtime, runtimeNowMs()) : null;
  });
  const motion = useRef({ speed: 0, locomotionSpeed: 0, yawDelta: 0 });
  const roleAnimation: Record<EmployeeRole, CharacterAnimation> = { farmer: "Harvest", operator: "LiftBox", stocker: "StockHigh", cashier: "ScanItem", builder: "CarryBox", manager: "Wave" };
  const moving = employee.runtime?.state === "NAVIGATE_PICKUP" || employee.runtime?.state === "NAVIGATE_DROPOFF" || employee.runtime?.state === "NAVIGATE_CHECKOUT";
  useEffect(() => {
    refreshMotionSnapshot();
  }, [employee.id, employee.runtime?.state, simulationTimeMs]);
  useEffect(() => {
    return () => {
      const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
      const visuals = qaWindow.__MARKET_QA__?.employeeVisuals as Record<string, unknown> | undefined;
      if (visuals) delete visuals[employee.id];
    };
  }, [employee.id]);
  useFrame((_, delta) => {
    if (!ref.current || !employee.runtime || !motionSnapshot.current) return;
    visualFrame.current += 1;
    const projected = projectCustomerMotion(motionSnapshot.current, runtimeNowMs());
    const [x, z] = scaleStorePoint([projected.x, projected.z]);
    const previousX = ref.current.position.x; const previousZ = ref.current.position.z;
    // The NavMesh projection is already continuous. A second lerp made workers
    // trail each snapshot and visibly brake before the next one arrived.
    ref.current.position.x = x;
    ref.current.position.z = z;
    const visualSpeed = Math.hypot(x - previousX, z - previousZ) / Math.max(0.001, frameDelta(delta));
    motion.current.speed = visualSpeed;
    motion.current.locomotionSpeed = visualSpeed / STORE_LAYOUT_SCALE;
    if (moving && Math.hypot(projected.headingX, projected.headingZ) > 0.5) {
      const heading = Math.atan2(projected.headingX, projected.headingZ);
      motion.current.yawDelta = heading - ref.current.rotation.y;
      ref.current.rotation.y = turnTowards(ref.current.rotation.y, heading, frameDelta(delta) * 3);
    } else if (employee.role === "cashier" && employee.runtime.state === "OPERATE_CHECKOUT") {
      ref.current.rotation.y = turnTowards(ref.current.rotation.y, Math.PI, frameDelta(delta) * 3.5);
    }
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    if (qaWindow.__MARKET_QA__) {
      const visuals = (qaWindow.__MARKET_QA__.employeeVisuals ??= {}) as Record<string, unknown>;
      visuals[employee.id] = {
        visualFrame: visualFrame.current,
        role: employee.role,
        level: employee.level,
        state: employee.runtime.state,
        x: ref.current.position.x,
        z: ref.current.position.z,
        speed: motionSnapshot.current.speed,
        snapshotCapturedAtMs: motionSnapshot.current.capturedAtMs,
        configuredSpeed: employee.runtime.speed,
      };
    }
  });
  const interaction = employee.runtime?.state === "PICKUP" || employee.runtime?.state === "DROPOFF" || employee.runtime?.state === "OPERATE_CHECKOUT";
  return <group ref={ref} position={position}><Avatar skin="#a96f50" shirt={color} hairColor="#3b2820" hat={employee.hat} body={body} hair={hair} scale={0.86} walking={moving} carrying={Boolean(employee.runtime?.carry.item)} motion={motion} animation={interaction ? roleAnimation[employee.role] : undefined} feedbackSource="npc" feedbackActorId={employee.id} /><EmployeeCarry carry={employee.runtime?.carry} offset={offset} /></group>;
}

function EmployeeCarry({ carry, offset }: { carry?: CarryState; offset: number }) {
  if (!carry?.item) return null;
  return <group position={[0, 0.9, 0.22]} rotation={[0, offset * 0.01, 0]}>{Array.from({ length: carry.item.quantity }, (_, index) => <mesh key={index} position={[(index % 2 - 0.5) * 0.14, Math.floor(index / 2) * 0.13, 0]} castShadow><boxGeometry args={[0.17, 0.12, 0.15]} /><meshStandardMaterial color="#d7af48" /></mesh>)}</group>;
}

function Customers({ customers, simulationTimeMs }: { customers: CustomerRuntimeState[]; simulationTimeMs: number }) {
  return <>{customers.map((customer) => <Suspense key={customer.id} fallback={null}><Customer customer={customer} simulationTimeMs={simulationTimeMs} /></Suspense>)}</>;
}

function runtimeNowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
