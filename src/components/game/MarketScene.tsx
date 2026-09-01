"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdaptiveDpr, ContactShadows, Environment, Lightformer, Line, OrthographicCamera, Text } from "@react-three/drei";
import { BallCollider, CapsuleCollider, CuboidCollider, Physics, RigidBody, useRapier, type RapierCollider, type RapierRigidBody } from "@react-three/rapier";
import { memo, Suspense, useEffect, useEffectEvent, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { Avatar, type CharacterAnimation } from "./Avatar";
import { CityPerimeter } from "./CityPerimeter";
import { Customer } from "./Customer";
import { KitFarm, KitFurniture } from "./MarketKit";
import { BasketProduct, HarvestBasket } from "./HarvestBasket";
import { dampFactor, frameDelta, turnTowards } from "@/game/locomotion";
import type { AvatarConfig, CarryState, CharacterId, CheckoutTransaction, CropState, CustomerRuntimeState, Employee, EmployeeRole, HairId, Inventory, ProductId, ProductionMachineState } from "@/game/types";
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
import { CHECKOUT_CAMERA_FRAME, CHECKOUT_CAMERA_POSITION as CHECKOUT_CAMERA_POSITION_COORDS, CHECKOUT_CAMERA_TARGET as CHECKOUT_CAMERA_TARGET_COORDS, checkoutQueuePosition } from "@/game/stations/checkout-layout";
import { retailServicePoint } from "@/game/stations/retail-layout";
import { isWorkstationId, isWorkstationUnlocked, WORKSTATIONS, WORKSTATION_IDS, type WorkstationId } from "@/game/stations/workstation-layout";
import { PRODUCTS } from "@/game/catalog";
import { farmInteractionId, farmPlotById, FARM_PLOTS, type FarmInteractionId } from "@/game/stations/farm-layout";
import { carryTotal, preferredStockingProduct } from "@/game/player/CarrySystem";
import { STOREFRONT_LAYOUT, storefrontDoorLeafCenter } from "@/game/stations/storefront-layout";

export type InteractionId = WorkstationId | FarmInteractionId | "supplier" | "door";
export interface InteractionPrompt { id: InteractionId; label: string; }
export interface InteractionVisualEvent { id: InteractionId; sequence: number; kind: "work" | "harvest" | "stock"; cropId?: string; productId?: ProductId; quantity?: number; }
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
  { id: "door", label: "Sensor de entrada", position: [0, 0, STOREFRONT_LAYOUT.z] },
] satisfies { id: InteractionId; label: string; position: [number, number, number]; facing?: number }[]).map((zone) => ({ ...zone, position: scaleStorePosition(zone.position) }));

interface MarketSceneProps {
  avatar: AvatarConfig;
  carry: CarryState;
  checkoutLevel: number;
  playerSpeedTier: number;
  customers: CustomerRuntimeState[];
  checkoutTransactions: CheckoutTransaction[];
  returnsBin: Inventory;
  returnedCartCount: number;
  crops: CropState[];
  productionMachines: ProductionMachineState[];
  shelves: Inventory;
  shelfTier: number;
  unlockedAreas: string[];
  lightsOn: boolean;
  simulationTimeMs: number;
  employees: Employee[];
  lastInteraction: InteractionVisualEvent | null;
  onInteract: (id: InteractionId) => void;
  onDistance: (meters: number) => void;
  onPrompt: (prompt: InteractionPrompt | null) => void;
  open: boolean;
  doorState: "CLOSED" | "OPENING" | "OPEN" | "CLOSING" | "BLOCKED";
  doorProgress: number;
  onDoorPresence: (active: boolean) => void;
  debug?: boolean;
}

export const MarketScene = memo(function MarketScene({ avatar, carry, customers, checkoutTransactions, returnsBin, returnedCartCount, crops, productionMachines, shelves, shelfTier, unlockedAreas, lightsOn, simulationTimeMs, employees, onPrompt, onInteract, onDistance, onDoorPresence, lastInteraction, open, doorProgress, checkoutLevel, playerSpeedTier, debug = false }: MarketSceneProps) {
  const playerFocus = useRef(new THREE.Vector3(...PLAYER_START));
  const basketTarget = useRef(new THREE.Vector3(...PLAYER_START));
  const [checkoutFocused, setCheckoutFocused] = useState(false);
  const stockableProduct = preferredStockingProduct(carry, shelves, shelfTier);
  const carriedProduct = stockableProduct ?? "tomatoes";
  const servicePoint = retailServicePoint(carriedProduct);
  const shelfPosition = scaleStorePosition([servicePoint[0], 0, servicePoint[1]]);
  const interactionLabels: Partial<Record<InteractionId, string>> = {
    shelf: `Surtir expositor de ${PRODUCTS[carriedProduct].name.toLowerCase()}`,
  };
  useEffect(() => {
    if (!debug) return;
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    qaWindow.__MARKET_QA__ ??= {};
    qaWindow.__MARKET_QA__.stockingTarget = { productId: stockableProduct, sensorEnabled: Boolean(stockableProduct), x: shelfPosition[0], z: shelfPosition[2] };
  }, [debug, shelfPosition, stockableProduct]);
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
          {lastInteraction?.kind === "harvest" && lastInteraction.cropId && lastInteraction.productId && <HarvestMagnetBurst key={lastInteraction.sequence} cropId={lastInteraction.cropId} productId={lastInteraction.productId} basketTarget={basketTarget} />}
          {lastInteraction?.kind === "stock" && lastInteraction.productId && <StockMagnetBurst key={lastInteraction.sequence} productId={lastInteraction.productId} quantity={lastInteraction.quantity ?? 1} basketTarget={basketTarget} />}
          {debug && <DebugWorld customers={customers} crops={crops} />}
        </Suspense>
        <Suspense fallback={null}><Employees employees={employees} simulationTimeMs={simulationTimeMs} /></Suspense>
        <Customers customers={customers} checkoutTransactions={checkoutTransactions} simulationTimeMs={simulationTimeMs} />
        <ContactShadows frames={1} position={[0, 0.015, 2 * STORE_LAYOUT_SCALE]} opacity={0.24} scale={34 * STORE_LAYOUT_SCALE} blur={2.6} far={8} />
      </group>
      <Physics timeStep={1 / 60} gravity={[0, -9.81, 0]}>
        <StoreColliders doorProgress={doorProgress} />
        <InteractionSensors checkoutLevel={checkoutLevel} shelfPosition={shelfPosition} shelfEnabled={Boolean(stockableProduct)} unlockedAreas={unlockedAreas} crops={crops} />
        <Suspense fallback={null}><Player avatar={avatar} carry={carry} crops={crops} checkoutLevel={checkoutLevel} playerSpeedTier={playerSpeedTier} unlockedAreas={unlockedAreas} debug={debug} onPrompt={onPrompt} onInteract={onInteract} onDistance={onDistance} onDoorPresence={onDoorPresence} onCheckoutFocus={setCheckoutFocused} lastInteraction={lastInteraction} playerFocus={playerFocus} basketTarget={basketTarget} shelfPosition={shelfPosition} shelfEnabled={Boolean(stockableProduct)} stockingProduct={carriedProduct} interactionLabels={interactionLabels} /></Suspense>
      </Physics>
      <LocalEnvironment />
      {debug && <DebugProbe />}
    </Canvas>
  );
}, sameMarketSceneProps);

function sameMarketSceneProps(previous: MarketSceneProps, next: MarketSceneProps) {
  if (previous.debug !== next.debug || previous.checkoutLevel !== next.checkoutLevel || previous.playerSpeedTier !== next.playerSpeedTier || previous.shelfTier !== next.shelfTier || previous.open !== next.open || previous.doorState !== next.doorState || previous.doorProgress !== next.doorProgress) return false;
  if (previous.crops !== next.crops || previous.productionMachines !== next.productionMachines || previous.shelves !== next.shelves || previous.unlockedAreas !== next.unlockedAreas || previous.lightsOn !== next.lightsOn || previous.simulationTimeMs !== next.simulationTimeMs) return false;
  if (previous.customers !== next.customers || previous.checkoutTransactions !== next.checkoutTransactions || previous.returnsBin !== next.returnsBin || previous.returnedCartCount !== next.returnedCartCount) return false;
  if (previous.lastInteraction !== next.lastInteraction || previous.onInteract !== next.onInteract || previous.onPrompt !== next.onPrompt || previous.onDistance !== next.onDistance || previous.onDoorPresence !== next.onDoorPresence) return false;
  const avatarKeys = ["body", "hair", "hairColor", "skin", "shirt", "hat"] as const;
  if (avatarKeys.some((key) => previous.avatar[key] !== next.avatar[key])) return false;
  if (previous.carry.capacity !== next.carry.capacity) return false;
  if ((Object.keys(previous.carry.items) as ProductId[]).some((productId) => previous.carry.items[productId] !== next.carry.items[productId])) return false;
  if ((Object.keys(next.carry.items) as ProductId[]).some((productId) => previous.carry.items[productId] !== next.carry.items[productId])) return false;
  return previous.employees === next.employees;
}

function LocalEnvironment() {
  return <Environment resolution={64} frames={1} environmentIntensity={0.28}>
    <Lightformer form="rect" intensity={2.4} color="#fff3d2" position={[0, 8, 2]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12]} />
    <Lightformer form="rect" intensity={1.4} color="#b8dfce" position={[8, 3, 4]} rotation={[0, -Math.PI / 2, 0]} scale={[7, 5]} />
    <Lightformer form="rect" intensity={1.1} color="#a8c7e8" position={[-8, 4, -2]} rotation={[0, Math.PI / 2, 0]} scale={[6, 5]} />
  </Environment>;
}

function HarvestMagnetBurst({ cropId, productId, basketTarget }: { cropId: string; productId: ProductId; basketTarget: RefObject<THREE.Vector3> }) {
  const particles = useRef<Array<THREE.Group | null>>([]);
  const elapsed = useRef(0);
  const plot = farmPlotById(cropId);
  const source = scaleStorePosition(plot ? [...plot.position] : [0, 0, 0]);
  // The engine awards one unit per crop harvest, so the visual contract must
  // also show exactly one physical piece entering the basket.
  const offsets: readonly [number, number, number][] = [[0, 0.08, 0]];

  useEffect(() => {
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    if (qaWindow.__MARKET_QA__) qaWindow.__MARKET_QA__.harvestBurst = { cropId, productId, visualUnits: offsets.length };
  }, [cropId, productId, offsets.length]);

  useFrame((_, delta) => {
    elapsed.current += frameDelta(delta);
    particles.current.forEach((particle, index) => {
      if (!particle) return;
      const t = THREE.MathUtils.clamp((elapsed.current - index * 0.045) / 0.52, 0, 1);
      particle.visible = t < 1 && elapsed.current >= index * 0.045;
      if (!particle.visible) return;
      const eased = 1 - Math.pow(1 - t, 3);
      const offset = offsets[index];
      particle.position.set(
        THREE.MathUtils.lerp(source[0] + offset[0] * STORE_ELEMENT_SCALE, basketTarget.current.x, eased),
        THREE.MathUtils.lerp(0.72 * STORE_ELEMENT_SCALE + offset[1], basketTarget.current.y, eased) + Math.sin(Math.PI * t) * 1.35,
        THREE.MathUtils.lerp(source[2] + offset[2] * STORE_ELEMENT_SCALE, basketTarget.current.z, eased),
      );
      particle.rotation.y += delta * (5.5 + index);
      particle.rotation.z = Math.sin(t * Math.PI * 3 + index) * 0.28;
      particle.scale.setScalar((0.86 + Math.sin(Math.PI * t) * 0.24) * (1 - t * 0.18));
    });
  });

  if (!plot) return null;
  return <group>{offsets.map((_, index) => <group key={index} ref={(node) => { particles.current[index] = node; }}>
    <BasketProduct productId={productId} scale={1.22} />
    <mesh position={[0.1, 0.1, 0]} rotation={[0, 0, Math.PI / 4]}>
      <octahedronGeometry args={[0.035, 0]} />
      <meshBasicMaterial color="#fff1a6" transparent opacity={0.9} depthWrite={false} />
    </mesh>
  </group>)}</group>;
}

function StockMagnetBurst({ productId, quantity, basketTarget }: { productId: ProductId; quantity: number; basketTarget: RefObject<THREE.Vector3> }) {
  const particles = useRef<Array<THREE.Group | null>>([]);
  const source = useRef(new THREE.Vector3());
  const sourceCaptured = useRef(false);
  const elapsed = useRef(0);
  const servicePoint = retailServicePoint(productId);
  const targetPosition = scaleStorePosition([servicePoint[0], 0, servicePoint[1]]);
  const particleCount = Math.min(5, Math.max(1, quantity));

  useFrame((_, delta) => {
    if (!sourceCaptured.current) {
      source.current.copy(basketTarget.current);
      sourceCaptured.current = true;
    }
    elapsed.current += frameDelta(delta);
    particles.current.forEach((particle, index) => {
      if (!particle) return;
      const t = THREE.MathUtils.clamp((elapsed.current - index * 0.065) / 0.5, 0, 1);
      particle.visible = t < 1 && elapsed.current >= index * 0.065;
      if (!particle.visible) return;
      const eased = t * t * (3 - 2 * t);
      const laneOffset = (index - (particleCount - 1) / 2) * 0.09;
      particle.position.set(
        THREE.MathUtils.lerp(source.current.x, targetPosition[0] + laneOffset, eased),
        THREE.MathUtils.lerp(source.current.y, 0.92 * STORE_ELEMENT_SCALE, eased) + Math.sin(Math.PI * t) * 0.82,
        THREE.MathUtils.lerp(source.current.z, targetPosition[2], eased),
      );
      particle.rotation.x += delta * (3.5 + index * 0.3);
      particle.rotation.y += delta * (5.2 + index * 0.45);
      particle.scale.setScalar(0.94 + Math.sin(Math.PI * t) * 0.18);
    });
  });

  return <group>{Array.from({ length: particleCount }, (_, index) => <group key={index} ref={(node) => { particles.current[index] = node; }}>
    <BasketProduct productId={productId} scale={1.16} />
    <mesh position={[0, 0.1, 0]}><octahedronGeometry args={[0.03, 0]} /><meshBasicMaterial color="#fff1a6" transparent opacity={0.82} depthWrite={false} /></mesh>
  </group>)}</group>;
}

function DebugWorld({ customers, crops }: { customers: CustomerRuntimeState[]; crops: CropState[] }) {
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
    {crops.filter((crop) => crop.status !== "LOCKED").map((crop) => {
      const plot = farmPlotById(crop.id);
      if (!plot) return null;
      const position = scaleStorePosition([...plot.position]);
      return <mesh key={`farm-sensor-${crop.id}`} position={[position[0], 0.065, position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72 * STORE_ELEMENT_SCALE, 0.78 * STORE_ELEMENT_SCALE, 28]} />
        <meshBasicMaterial color={plot.accent} transparent opacity={0.88} />
      </mesh>;
    })}
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
    const checkoutZoom = Math.min(size.width / CHECKOUT_CAMERA_FRAME.width, size.height / CHECKOUT_CAMERA_FRAME.height);
    camera.current.zoom = THREE.MathUtils.lerp(camera.current.zoom, THREE.MathUtils.lerp(overviewZoom, checkoutZoom, checkoutBlend.current), dampFactor(5, delta));
    camera.current.updateProjectionMatrix();
  });
  return <OrthographicCamera ref={camera} makeDefault position={[(PLAYER_START[0] + OVERVIEW_CAMERA_OFFSET.x) * WORLD_SCALE, 23.9 * WORLD_SCALE, (PLAYER_START[2] + OVERVIEW_CAMERA_OFFSET.z) * WORLD_SCALE]} near={0.1 * WORLD_SCALE} far={120 * WORLD_SCALE} />;
}

function Player({ avatar, carry, crops, checkoutLevel, playerSpeedTier, unlockedAreas, debug, onPrompt, onInteract, onDistance, onDoorPresence, onCheckoutFocus, lastInteraction, playerFocus, basketTarget, shelfPosition, shelfEnabled, stockingProduct, interactionLabels }: { avatar: AvatarConfig; carry: CarryState; crops: CropState[]; checkoutLevel: number; playerSpeedTier: number; unlockedAreas: readonly string[]; debug: boolean; onPrompt: (prompt: InteractionPrompt | null) => void; onInteract: (id: InteractionId) => void; onDistance: (meters: number) => void; onDoorPresence: (active: boolean) => void; onCheckoutFocus: (active: boolean) => void; lastInteraction: InteractionVisualEvent | null; playerFocus: RefObject<THREE.Vector3>; basketTarget: RefObject<THREE.Vector3>; shelfPosition: [number, number, number]; shelfEnabled: boolean; stockingProduct: ProductId; interactionLabels: Partial<Record<InteractionId, string>> }) {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const visual = useRef<THREE.Group>(null);
  const basketVisual = useRef<THREE.Group>(null);
  const basketWorldPosition = useRef(new THREE.Vector3());
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
  const cropSignature = crops.map((crop) => `${crop.id}:${crop.status === "LOCKED" ? 0 : 1}`).join("|");
  const director = useMemo(() => new InteractionDirector(interactionZoneConfigs(
    checkoutLevel,
    [shelfX, 0, shelfZ],
    unlockedSignature ? unlockedSignature.split("|") : [],
    cropSignature.split("|").filter((entry) => entry.endsWith(":1")).map((entry) => entry.slice(0, -2)),
    shelfEnabled,
  )), [checkoutLevel, shelfX, shelfZ, unlockedSignature, cropSignature, shelfEnabled]);
  const characterController = useRef<ReturnType<ReturnType<typeof useRapier>["world"]["createCharacterController"]> | null>(null);
  const { world, rapier } = useRapier();
  const [walking, setWalking] = useState(false);
  const [performingWorkstation, setPerformingWorkstation] = useState<WorkstationId | null>(null);
  const interactionAnimation: Partial<Record<InteractionId, CharacterAnimation>> = { mill: "LiftBox", bakery: "StockHigh", chicken: "PickupLow", cow: "PickupLow", cheese: "LiftBox", juice: "LiftBox", shelf: "StockLow", checkout: "ScanItem", supplier: "ReceiveOrder", door: "Enter" };
  const publishWorkstation = (id: WorkstationId | null) => {
    if (publishedWorkstation.current === id) return;
    publishedWorkstation.current = id;
    setPerformingWorkstation(id);
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
      const workHeading = currentWorkstation ? workstationFacing(currentWorkstation, stockingProduct) : null;
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
        if (event.signal === "tick" && (!isMovementLockingWorkstation(event.zone.id) || workstation.current.canPerform(event.zone.id))) onInteract(event.zone.id as InteractionId);
      }
    });
    const isMoving = velocity.current.length() > 0.12;
    avatarMotion.current.speed = velocity.current.length();
    avatarMotion.current.locomotionSpeed = velocity.current.length() / WORLD_SCALE;
    if (isMoving !== moving.current) { moving.current = isMoving; setWalking(isMoving); }
    playerFocus.current.copy(logicalPosition.current).multiplyScalar(1 / WORLD_SCALE);
    if (basketVisual.current) {
      basketVisual.current.getWorldPosition(basketWorldPosition.current);
      basketTarget.current.copy(basketWorldPosition.current).multiplyScalar(1 / WORLD_SCALE);
    } else {
      basketTarget.current.copy(playerFocus.current).add(new THREE.Vector3(0, 1.05, 0));
    }
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
    <group ref={visual}><Avatar {...avatar} scale={PLAYER_SCALE * WORLD_SCALE} walking={walking} carrying={carryTotal(carry) > 0} carryAccessory={<HarvestBasket ref={basketVisual} carry={carry} />} motion={avatarMotion} animation={!walking && lastInteraction?.kind === "work" && lastInteraction.id === performingWorkstation ? interactionAnimation[lastInteraction.id] : undefined} animationSpeed={walking ? PLAYER_WALK_ANIMATION_SPEED : undefined} feedbackSource="player" feedbackActorId="player" /></group>
  </RigidBody>;
}

function StoreColliders({ doorProgress }: { doorProgress: number }) {
  const wallHalfHeight = STOREFRONT_LAYOUT.wallHeight / 2;
  const door = STOREFRONT_LAYOUT.door;
  const doorHalfHeight = door.leafHeight / 2;
  const frameHalfHeight = (door.leafHeight + 0.16) / 2;
  return <RigidBody type="fixed" colliders={false}>
    <CuboidCollider args={[11.5 * STORE_LAYOUT_SCALE * WORLD_SCALE, 0.08 * WORLD_SCALE, 12.2 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[0, -0.08 * WORLD_SCALE, 3.7 * STORE_LAYOUT_SCALE * WORLD_SCALE]} friction={0.8} />
    {STORE_OBSTACLES.map((obstacle, index) => <CuboidCollider key={index} args={[obstacle.halfX * WORLD_SCALE, 0.9 * WORLD_SCALE, obstacle.halfZ * WORLD_SCALE]} position={[obstacle.x * WORLD_SCALE, 0.9 * WORLD_SCALE, obstacle.z * WORLD_SCALE]} />)}
    <CuboidCollider args={[0.15 * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, 11.9 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[-11.25 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, 3.75 * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    <CuboidCollider args={[0.15 * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, 11.9 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[11.25 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, 3.75 * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    <CuboidCollider args={[11.4 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, 0.15 * WORLD_SCALE]} position={[0, wallHalfHeight * WORLD_SCALE, -8.45 * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    <CuboidCollider args={[4.765 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, 0.12 * WORLD_SCALE]} position={[-6.585 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, (STOREFRONT_LAYOUT.z - 0.02) * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    <CuboidCollider args={[4.765 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, 0.12 * WORLD_SCALE]} position={[6.585 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, (STOREFRONT_LAYOUT.z - 0.02) * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    {[-1, 1].map((side) => <CuboidCollider key={`storefront-post-${side}`} args={[door.postWidth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE, frameHalfHeight * WORLD_SCALE, door.frameDepth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[side * door.outerPostX * STORE_LAYOUT_SCALE * WORLD_SCALE, frameHalfHeight * WORLD_SCALE, STOREFRONT_LAYOUT.z * STORE_LAYOUT_SCALE * WORLD_SCALE]} />)}
    <CuboidCollider args={[(door.outerPostX + door.postWidth * 0.5) * STORE_LAYOUT_SCALE * WORLD_SCALE, 0.07 * WORLD_SCALE, door.frameDepth * 0.55 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[0, (door.leafHeight + 0.07) * WORLD_SCALE, STOREFRONT_LAYOUT.z * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    {([-1, 1] as const).map((side) => <CuboidCollider key={`door-leaf-${side}`} args={[door.leafWidth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE, doorHalfHeight * WORLD_SCALE, door.leafDepth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[storefrontDoorLeafCenter(side, doorProgress) * STORE_LAYOUT_SCALE * WORLD_SCALE, doorHalfHeight * WORLD_SCALE, STOREFRONT_LAYOUT.z * STORE_LAYOUT_SCALE * WORLD_SCALE]} />)}
  </RigidBody>;
}

function highestPriorityWorkstation(activeZoneIds: readonly string[]) {
  return WORKSTATION_IDS.find((id) => id !== "shelf" && activeZoneIds.includes(id)) ?? null;
}

function isMovementLockingWorkstation(id: string): id is WorkstationId {
  return isWorkstationId(id) && id !== "shelf";
}

function workstationFacing(id: WorkstationId, carriedProduct?: ProductId) {
  if (id !== "shelf") return WORKSTATIONS[id].facing;
  return retailServicePoint(carriedProduct ?? "tomatoes")[1] > 0 ? 0 : Math.PI;
}

function InteractionSensors({ checkoutLevel, shelfPosition, shelfEnabled, unlockedAreas, crops }: { checkoutLevel: number; shelfPosition: [number, number, number]; shelfEnabled: boolean; unlockedAreas: readonly string[]; crops: CropState[] }) {
  return <RigidBody type="fixed" colliders={false}>
    {interactionZoneConfigs(checkoutLevel, shelfPosition, unlockedAreas, crops.filter((crop) => crop.status !== "LOCKED").map((crop) => crop.id), shelfEnabled).map((zone) => <BallCollider key={zone.id} args={[zone.enterRadius * WORLD_SCALE]} position={[zone.x * WORLD_SCALE, 0.6 * WORLD_SCALE, zone.z * WORLD_SCALE]} sensor name={`interaction:${zone.id}`} />)}
  </RigidBody>;
}

function interactionZoneConfigs(checkoutLevel = 1, shelfPosition?: [number, number, number], unlockedAreas: readonly string[] = [], activeCropIds: readonly string[] = [], shelfEnabled = true): InteractionZoneConfig[] {
  const storeZones = ZONES.filter((zone) => (zone.id !== "shelf" || shelfEnabled) && (!isWorkstationId(zone.id) || isWorkstationUnlocked(zone.id, unlockedAreas))).map((zone): InteractionZoneConfig => ({
    id: zone.id,
    type: zone.id,
    x: zone.id === "shelf" && shelfPosition ? shelfPosition[0] : zone.position[0],
    z: zone.id === "shelf" && shelfPosition ? shelfPosition[2] : zone.position[2],
    enterRadius: (zone.id === "door" ? 1.3 : isWorkstationId(zone.id) ? 0.44 : 0.75) * STORE_ELEMENT_SCALE,
    exitRadius: (zone.id === "door" ? 1.5 : isWorkstationId(zone.id) ? 0.58 : 0.9) * STORE_ELEMENT_SCALE,
    actorMask: ["player"],
    priority: ({ checkout: 100, shelf: 80, mill: 70, bakery: 70, cheese: 70, juice: 70, chicken: 65, cow: 65, door: 20, supplier: 5 } as Partial<Record<InteractionId, number>>)[zone.id] ?? 10,
    dwellMs: zone.id === "checkout" ? 180 : zone.id === "door" ? 0 : 80,
    repeatEveryMs: zone.id === "shelf" ? 180 : zone.id === "checkout" ? (checkoutLevel >= 2 ? 340 : 450) : zone.id === "door" ? 60_000 : 220,
    exitGraceMs: 120,
    channel: zone.id === "door" || zone.id === "supplier" ? "passive" : zone.id === "checkout" ? "hands" : "transfer",
  }));
  const activeCrops = new Set(activeCropIds);
  const farmZones = FARM_PLOTS.flatMap((plot): InteractionZoneConfig[] => {
    const id = farmInteractionId(plot.id);
    if (!activeCrops.has(plot.id) || !id) return [];
    const position = scaleStorePosition([...plot.position]);
    return [{
      id,
      type: "farm-plot",
      x: position[0],
      z: position[2],
      enterRadius: 0.86 * STORE_ELEMENT_SCALE,
      exitRadius: 1.02 * STORE_ELEMENT_SCALE,
      actorMask: ["player"],
      priority: 92,
      dwellMs: 35,
      repeatEveryMs: 280,
      exitGraceMs: 90,
      channel: "transfer",
    }];
  });
  return [...storeZones, ...farmZones];
}

function MarketBuilding({ open, doorProgress }: { open: boolean; doorProgress: number }) {
  const door = STOREFRONT_LAYOUT.door;
  const wallHeight = STOREFRONT_LAYOUT.wallHeight;
  const frontGlassHeight = wallHeight - 0.6;
  const frontGlassCenterY = frontGlassHeight / 2 + 0.3;
  return <group>
    <mesh receiveShadow position={[0, -0.08, -0.35]}><boxGeometry args={[23, 0.16, 17]} /><meshStandardMaterial color="#eee8dc" roughness={0.82} /></mesh>
    {[-7.6, -3.8, 0, 3.8, 7.6].map((x) => <mesh key={`floor-seam-x-${x}`} position={[x, 0.012, -0.35]}><boxGeometry args={[0.018, 0.008, 16.7]} /><meshStandardMaterial color="#d9d2c5" roughness={0.95} /></mesh>)}
    {[-6.8, -3.4, 0, 3.4, 6.8].map((z) => <mesh key={`floor-seam-z-${z}`} position={[0, 0.013, z - 0.35]}><boxGeometry args={[22.7, 0.008, 0.018]} /><meshStandardMaterial color="#d9d2c5" roughness={0.95} /></mesh>)}
    <mesh receiveShadow position={[0, -0.1, 11.9]}><boxGeometry args={[23, 0.14, 7.5]} /><meshStandardMaterial color="#d7e3db" roughness={0.94} /></mesh>
    <mesh receiveShadow position={[0, -0.09, 16.15]}><boxGeometry args={[25, 0.12, 1.2]} /><meshStandardMaterial color="#566a62" roughness={0.98} /></mesh>
    {[-6, 0, 6].map((x) => <mesh key={x} position={[x, -0.015, 16.1]}><boxGeometry args={[2.7, 0.02, 0.1]} /><meshStandardMaterial color="#f4d58d" /></mesh>)}
    <mesh receiveShadow position={[0, wallHeight / 2, -8.55]}><boxGeometry args={[23, wallHeight, 0.32]} /><meshStandardMaterial color="#eee8dc" roughness={0.88} /></mesh>
    <mesh position={[0, 0.68, -8.34]}><boxGeometry args={[22.6, 1.25, 0.12]} /><meshStandardMaterial color="#2f6958" roughness={0.78} /></mesh>
    {[-7.4, -3.7, 0, 3.7, 7.4].map((x) => <mesh key={`wall-panel-${x}`} position={[x, wallHeight * 0.54, -8.35]}><boxGeometry args={[3.3, wallHeight * 0.57, 0.08]} /><meshStandardMaterial color="#f7f2e8" roughness={0.86} /></mesh>)}
    <mesh position={[0, wallHeight - 0.82, -8.28]}><boxGeometry args={[5.6, 0.78, 0.18]} /><meshStandardMaterial color="#173f35" roughness={0.64} metalness={0.08} /></mesh>
    <Text position={[0, wallHeight - 0.82, -8.17]} fontSize={0.43} color="#fff3ce" anchorX="center">MINI MARKET</Text>
    <mesh receiveShadow position={[-11.35, wallHeight / 2, -0.35]}><boxGeometry args={[0.34, wallHeight, 16.5]} /><meshStandardMaterial color="#e5ded2" roughness={0.9} /></mesh>
    <mesh receiveShadow position={[11.35, wallHeight / 2, -0.35]}><boxGeometry args={[0.34, wallHeight, 16.5]} /><meshStandardMaterial color="#e5ded2" roughness={0.9} /></mesh>
    {[-6.585, 6.585].map((x) => <group key={x} position={[x, 0.3, 7.78]}>
      <mesh><boxGeometry args={[9.53, 0.6, 0.3]} /><meshStandardMaterial color="#e7dfd2" roughness={0.9} /></mesh>
      <mesh position={[0, frontGlassCenterY, 0]}><boxGeometry args={[9.34, frontGlassHeight, 0.07]} /><meshPhysicalMaterial color="#c7e4df" transparent opacity={0.12} transmission={0.35} clearcoat={1} clearcoatRoughness={0.08} roughness={0.08} depthWrite={false} /></mesh>
      {[-4.67, 0, 4.67].map((edge) => <mesh key={edge} position={[edge, frontGlassCenterY, 0.06]}><boxGeometry args={[0.1, frontGlassHeight, 0.12]} /><meshStandardMaterial color="#37564d" metalness={0.28} roughness={0.42} /></mesh>)}
    </group>)}
    <mesh receiveShadow position={[0, 0.035, 7.02]}><boxGeometry args={[3.75, 0.055, 1.05]} /><meshStandardMaterial color="#2b4b43" roughness={0.92} /></mesh>
    <group position={[0, door.leafHeight / 2, STOREFRONT_LAYOUT.z]}>
      {([-1, 1] as const).map((side) => <group key={side} position={[storefrontDoorLeafCenter(side, doorProgress), 0, 0]}>
        <mesh><boxGeometry args={[door.leafWidth, door.leafHeight, door.leafDepth]} /><meshPhysicalMaterial color="#c9e9e3" transparent opacity={0.28} transmission={0.5} clearcoat={1} clearcoatRoughness={0.04} roughness={0.06} envMapIntensity={1.9} depthWrite={false} /></mesh>
        {[-door.leafWidth / 2, door.leafWidth / 2].map((edge) => <mesh key={edge} position={[edge, 0, 0.07]}><boxGeometry args={[0.075, door.leafHeight + 0.02, 0.1]} /><meshStandardMaterial color="#294a41" metalness={0.62} roughness={0.25} /></mesh>)}
        <mesh position={[0, 0.9, 0.1]} rotation={[0, 0, -0.2]}><planeGeometry args={[0.075, door.leafHeight * 0.61]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.32} depthWrite={false} /></mesh>
      </group>)}
      {[-door.outerPostX, door.outerPostX].map((x) => <mesh key={x} position={[x, 0, 0.08]}><boxGeometry args={[door.postWidth, door.leafHeight + 0.16, door.frameDepth]} /><meshStandardMaterial color="#294a41" metalness={0.6} roughness={0.28} /></mesh>)}
      <mesh position={[0, door.leafHeight / 2 + 0.07, 0.08]}><boxGeometry args={[door.outerPostX * 2 + door.postWidth * 2, 0.14, 0.15]} /><meshStandardMaterial color="#294a41" metalness={0.6} roughness={0.28} /></mesh>
      <group position={[0, door.leafHeight / 2 + 0.38, 0.02]}>
        <mesh><boxGeometry args={[0.62, 0.24, 0.2]} /><meshStandardMaterial color="#203a33" metalness={0.42} roughness={0.32} /></mesh>
        <mesh position={[0, 0, 0.12]}><circleGeometry args={[0.065, 20]} /><meshStandardMaterial color={open ? "#72e8a9" : "#f08d73"} emissive={open ? "#2fac74" : "#b84f38"} emissiveIntensity={1.35} /></mesh>
      </group>
    </group>
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
  return <>{employees.map((employee, index) => <Npc key={employee.id} employee={employee} simulationTimeMs={simulationTimeMs} position={rolePositions[employee.role]} color={["#e7a959", "#6b9fc8", "#b56fa6", "#70a85d"][index % 4]} body={bodies[index % bodies.length]} hair={hair[index % hair.length]} />)}</>;
}

function Npc({ employee, simulationTimeMs, position, color, body = "adult-man", hair = "side-part" }: { employee: Employee; simulationTimeMs: number; position: [number, number, number]; color: string; body?: CharacterId; hair?: HairId }) {
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
  const carried = employee.runtime?.carry;
  return <group ref={ref} position={position}><Avatar skin="#a96f50" shirt={color} hairColor="#3b2820" hat={employee.hat} body={body} hair={hair} scale={0.86} walking={moving} carrying={Boolean(carried && carryTotal(carried) > 0)} carryAccessory={carried && carryTotal(carried) > 0 ? <HarvestBasket carry={carried} /> : undefined} motion={motion} animation={interaction ? roleAnimation[employee.role] : undefined} feedbackSource="npc" feedbackActorId={employee.id} /></group>;
}

function Customers({ customers, checkoutTransactions, simulationTimeMs }: { customers: CustomerRuntimeState[]; checkoutTransactions: CheckoutTransaction[]; simulationTimeMs: number }) {
  return <>{customers.map((customer) => <Suspense key={customer.id} fallback={null}>
    <Customer
      customer={customer}
      checkoutTransaction={customer.transactionId ? checkoutTransactions.find((transaction) => transaction.id === customer.transactionId) : undefined}
      simulationTimeMs={simulationTimeMs}
    />
  </Suspense>)}</>;
}

function runtimeNowMs() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
