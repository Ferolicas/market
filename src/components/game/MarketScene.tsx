"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, Line, OrthographicCamera, Text } from "@react-three/drei";
import { BallCollider, CapsuleCollider, CuboidCollider, CylinderCollider, Physics, RigidBody, useRapier, type RapierCollider, type RapierRigidBody } from "@react-three/rapier";
import { Fragment, memo, Suspense, useEffect, useEffectEvent, useMemo, useRef, useState, type RefObject } from "react";
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
import { interactionZoneSensorPrimitives, type InteractionZoneConfig } from "@/game/interaction/InteractionZone";
import { cameraRelativeMovement, moveVelocity, playerMotionForTier, smoothYaw } from "@/game/player/PlayerController";
import { safeCanvasEvents } from "./safeCanvasEvents";
import { PerformanceMonitor } from "@/game/debug/PerformanceMonitor";
import { marketPerformanceProbeEnabled } from "@/game/debug/QaAccess";
import { createWalkableStoreGeometry, storePathfinder } from "@/game/navigation/NavMeshService";
import { captureEmployeeMotion, projectCustomerMotion, type CustomerMotionSnapshot } from "@/game/animation/CustomerVisualMotion";
import { CHECKOUT_CAMERA_FRAME, CHECKOUT_CAMERA_POSITION as CHECKOUT_CAMERA_POSITION_COORDS, CHECKOUT_CAMERA_TARGET as CHECKOUT_CAMERA_TARGET_COORDS, checkoutQueuePosition } from "@/game/stations/checkout-layout";
import { isStockingInteractionId, PRODUCT_RETAIL_DEPARTMENT, retailDepartmentFromStockingInteraction, retailDisplayPosition, retailStockingMagnet, retailStockLandingLocalPosition, RETAIL_DEPARTMENT_IDS, RETAIL_DEPARTMENTS, stockingInteractionId, type StockingInteractionId } from "@/game/stations/retail-layout";
import { isWorkstationId, isWorkstationUnlocked, WORKSTATIONS, WORKSTATION_IDS, type WorkstationId } from "@/game/stations/workstation-layout";
import { PRODUCTS } from "@/game/catalog";
import { farmInteractionId, farmPlotById, FARM_ACCESS_WAYPOINTS, FARM_GATE, FARM_PLOTS, FARM_WORKER_HOME, scaledFarmHarvestSensor, type FarmInteractionId } from "@/game/stations/farm-layout";
import { carryTotal, preferredStockingProduct } from "@/game/player/CarrySystem";
import {
  advanceRearDoorMotion,
  CLOSED_REAR_DOOR_MOTION,
  rearDoorActorPresent,
  rearDoorLeafCenter,
  rearDoorWallPanels,
  rearDoorWallSegments,
  STORE_REAR_DOOR,
  STOREFRONT_LAYOUT,
  storefrontDoorLeafCenter,
} from "@/game/stations/storefront-layout";
import { STORE_SERVICE_FIXTURE_IDS, STORE_SERVICE_FIXTURES } from "@/game/stations/store-service-layout";
import { WAREHOUSE_PICKUP_STATION } from "@/game/stations/warehouse-layout";
import { advanceAdaptiveQuality, INITIAL_ADAPTIVE_QUALITY_STATE } from "@/game/render/AdaptiveQuality";
import { createStaticMeshBatch } from "@/game/render/StaticMeshBatch";

export type InteractionId = Exclude<WorkstationId, "shelf"> | StockingInteractionId | FarmInteractionId | "supplier" | "door";
export interface InteractionPrompt { id: InteractionId; label: string; }
export interface InteractionVisualEvent {
  id: InteractionId;
  sequence: number;
  kind: "work" | "harvest" | "stock";
  cropId?: string;
  productId?: ProductId;
  quantity?: number;
  remainingQuantity?: number;
  carryStart?: number;
  cropStart?: number;
  shelfStart?: number;
}
const PLAYER_START = scaleStorePosition([0, 0, 6.25]);
const PLAYER_SCALE = 1.1;
const CAMERA_DISTANCE_FACTOR = 1.15;
const OVERVIEW_CAMERA_OFFSET = { x: 16, y: 23, z: 25.75 } as const;
const OVERVIEW_CAMERA_GROUND_FORWARD = { x: -OVERVIEW_CAMERA_OFFSET.x, y: -OVERVIEW_CAMERA_OFFSET.z } as const;
const MAX_VISUAL_TRANSFER_DELTA = 0.25;
const StaticCityPerimeter = memo(CityPerimeter);
// Drei keeps its `frames` counter in component scope. Parent world snapshots
// arrive at 10 Hz, so a normal rerender would reset frames=1 and render the
// whole scene into the contact atlas again. These authored props are static.
const StaticContactShadows = memo(ContactShadows, () => true);
// 1.4 × 0.86 = 1.20 DPR on a retina phone: enough headroom to recover GPU
// time while keeping labels, product silhouettes and bevels visibly crisp.
const MARKET_CANVAS_PERFORMANCE = { min: 0.86, max: 1, debounce: 3_000 } as const;
const MARKET_CANVAS_GL = { antialias: true, powerPreference: "high-performance" as const };

/** Transfer flights follow elapsed presentation time, not the locomotion
 * stabilizer's 50 ms cap. A bounded real frame delta keeps their wall-clock
 * duration consistent on slow devices without completing an entire burst in
 * one jump after a suspended/backgrounded tab resumes. */
function visualTransferDelta(delta: number) {
  return Math.min(MAX_VISUAL_TRANSFER_DELTA, Math.max(0, Number.isFinite(delta) ? delta : 0));
}

const ZONES: { id: InteractionId; label: string; position: [number, number, number]; facing?: number }[] = ([
  ...WORKSTATION_IDS.filter((id) => id !== "shelf").map((id) => {
    const station = WORKSTATIONS[id];
    return { id: id as Exclude<WorkstationId, "shelf">, label: station.label, position: [...station.position] as [number, number, number], facing: station.facing };
  }),
  ...RETAIL_DEPARTMENT_IDS.map((departmentId) => {
    const department = RETAIL_DEPARTMENTS[departmentId];
    return { id: stockingInteractionId(departmentId), label: `Surtir ${department.label.toLowerCase()}`, position: [department.service[0], 0, department.service[1]] as [number, number, number] };
  }),
  { id: WAREHOUSE_PICKUP_STATION.interactionId, label: WAREHOUSE_PICKUP_STATION.label, position: [...WAREHOUSE_PICKUP_STATION.position] },
  { id: "door", label: "Sensor de entrada", position: [STOREFRONT_LAYOUT.sensor.centerX, 0, STOREFRONT_LAYOUT.sensor.centerZ] },
] satisfies { id: InteractionId; label: string; position: [number, number, number]; facing?: number }[]).map((zone) => ({ ...zone, position: scaleStorePosition(zone.position) }));

interface MarketSceneProps {
  avatar: AvatarConfig;
  carry: CarryState;
  visualCarry: CarryState;
  warehousePickupEnabled: boolean;
  checkoutLevel: number;
  playerSpeedTier: number;
  customers: CustomerRuntimeState[];
  checkoutTransactions: CheckoutTransaction[];
  returnsBin: Inventory;
  returnedCartCount: number;
  crops: CropState[];
  visualCrops: CropState[];
  productionMachines: ProductionMachineState[];
  shelves: Inventory;
  visualShelves: Inventory;
  shelfTier: number;
  unlockedAreas: string[];
  lightsOn: boolean;
  simulationTimeMs: number;
  employees: Employee[];
  lastInteraction: InteractionVisualEvent | null;
  transferEvents: InteractionVisualEvent[];
  onTransferProgress: (sequence: number, remainingQuantity: number) => void;
  onInteract: (id: InteractionId) => void;
  onDistance: (meters: number) => void;
  onPrompt: (prompt: InteractionPrompt | null) => void;
  open: boolean;
  doorState: "CLOSED" | "OPENING" | "OPEN" | "CLOSING" | "BLOCKED";
  doorProgress: number;
  onDoorPresence: (active: boolean) => void;
  debug?: boolean;
}

export const MarketScene = memo(function MarketScene({ avatar, carry, visualCarry, warehousePickupEnabled, customers, checkoutTransactions, returnsBin, returnedCartCount, crops, visualCrops, productionMachines, shelves, visualShelves, shelfTier, unlockedAreas, lightsOn, simulationTimeMs, employees, onPrompt, onInteract, onDistance, onDoorPresence, lastInteraction, transferEvents, onTransferProgress, open, doorProgress, checkoutLevel, playerSpeedTier, debug = false }: MarketSceneProps) {
  const playerFocus = useRef(new THREE.Vector3(...PLAYER_START));
  const basketTarget = useRef(new THREE.Vector3(...PLAYER_START));
  const [checkoutFocused, setCheckoutFocused] = useState(false);
  const [canvasDpr, setCanvasDpr] = useState(initialMarketCanvasDpr);
  const [performanceProbe] = useState(() => typeof window !== "undefined" && marketPerformanceProbeEnabled(window.location.search));
  const stockableByDepartment = Object.fromEntries(RETAIL_DEPARTMENT_IDS.map((departmentId) => [
    departmentId,
    preferredStockingProduct(carry, shelves, shelfTier, RETAIL_DEPARTMENTS[departmentId].products),
  ])) as Record<(typeof RETAIL_DEPARTMENT_IDS)[number], ProductId | null>;
  const interactionLabels = Object.fromEntries(RETAIL_DEPARTMENT_IDS.flatMap((departmentId) => {
    const productId = stockableByDepartment[departmentId];
    return productId ? [[stockingInteractionId(departmentId), `Surtir ${PRODUCTS[productId].name.toLowerCase()}`]] : [];
  })) as Partial<Record<InteractionId, string>>;
  if (warehousePickupEnabled) interactionLabels.supplier = WAREHOUSE_PICKUP_STATION.label;
  const stockableProduct = preferredStockingProduct(carry, shelves, shelfTier);
  useEffect(() => {
    if (!debug) return;
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    qaWindow.__MARKET_QA__ ??= {};
    const targets = RETAIL_DEPARTMENT_IDS.map((departmentId) => {
      const department = RETAIL_DEPARTMENTS[departmentId];
      const [x, z] = scaleStorePoint([...department.service]);
      const display = retailDisplayPosition(departmentId);
      const [displayX, displayZ] = scaleStorePoint([display[0], display[2]]);
      const magnet = retailStockingMagnet(departmentId, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE);
      return {
        id: stockingInteractionId(departmentId),
        departmentId,
        productId: stockableByDepartment[departmentId],
        sensorEnabled: true,
        x,
        z,
        displayX,
        displayZ,
        magnetX: magnet.x,
        magnetZ: magnet.z,
        magnetHalfX: magnet.halfExtents[0],
        magnetHalfZ: magnet.halfExtents[1],
        magnetReach: magnet.enterRadius,
      };
    });
    qaWindow.__MARKET_QA__.stockingTargets = targets;
    qaWindow.__MARKET_QA__.stockingTarget = targets.find((target) => target.productId === stockableProduct) ?? { productId: null, sensorEnabled: false, x: 0, z: 0 };
    const [warehouseX, warehouseZ] = scaleStorePoint([WAREHOUSE_PICKUP_STATION.position[0], WAREHOUSE_PICKUP_STATION.position[2]]);
    qaWindow.__MARKET_QA__.warehousePickupTarget = {
      id: WAREHOUSE_PICKUP_STATION.interactionId,
      label: WAREHOUSE_PICKUP_STATION.label,
      sensorEnabled: warehousePickupEnabled,
      x: warehouseX,
      z: warehouseZ,
    };
    qaWindow.__MARKET_QA__.farmTargets = FARM_PLOTS.map((plot) => {
      const [x, z] = scaleStorePoint([plot.position[0], plot.position[2]]);
      return { id: plot.id, productId: plot.productId, x, z };
    });
    qaWindow.__MARKET_QA__.farmAccessWaypoints = FARM_ACCESS_WAYPOINTS.map((point) => scaleStorePoint([...point]));
    qaWindow.__MARKET_QA__.farmSideConnectors = FARM_GATE.sideConnectors.map((connector) => ({
      x: connector.center[0] * STORE_LAYOUT_SCALE,
      z: connector.center[2] * STORE_LAYOUT_SCALE,
      halfX: connector.halfX * STORE_ELEMENT_SCALE,
      halfZ: connector.halfZ * STORE_ELEMENT_SCALE,
    }));
    qaWindow.__MARKET_QA__.storefrontDoor = {
      x: STOREFRONT_LAYOUT.sensor.centerX * STORE_LAYOUT_SCALE,
      z: STOREFRONT_LAYOUT.z * STORE_LAYOUT_SCALE,
      sensorCenterZ: STOREFRONT_LAYOUT.sensor.centerZ * STORE_LAYOUT_SCALE,
      sensorHalfWidth: STOREFRONT_LAYOUT.sensor.actorHalfWidth * STORE_LAYOUT_SCALE,
      sensorHalfDepth: STOREFRONT_LAYOUT.sensor.actorHalfDepth * STORE_LAYOUT_SCALE,
    };
    qaWindow.__MARKET_QA__.serviceFixtureTargets = STORE_SERVICE_FIXTURE_IDS.map((fixtureId) => {
      const fixture = STORE_SERVICE_FIXTURES[fixtureId];
      const [x, z] = scaleStorePoint([fixture.position[0], fixture.position[2]]);
      const service = "service" in fixture ? scaleStorePoint([...fixture.service]) : null;
      return { id: fixtureId, obstacleId: fixture.obstacleId, x, z, serviceX: service?.[0] ?? null, serviceZ: service?.[1] ?? null };
    });
  }, [debug, stockableByDepartment, stockableProduct, warehousePickupEnabled]);
  return (
    <Canvas dpr={canvasDpr} events={safeCanvasEvents} shadows="percentage" performance={MARKET_CANVAS_PERFORMANCE} gl={MARKET_CANVAS_GL}>
      <AdaptiveQualityController canvasDpr={canvasDpr} onDprChange={setCanvasDpr} publishDiagnostics={performanceProbe} />
      <OverviewCamera playerFocus={playerFocus} checkoutFocused={checkoutFocused} />
      <color attach="background" args={["#b8dfce"]} />
      <fog attach="fog" args={["#b8dfce", 62 * WORLD_SCALE, 105 * WORLD_SCALE]} />
      <ambientLight intensity={1.15} />
      <MarketKeyLight publishDiagnostics={performanceProbe} />
      <group scale={WORLD_SCALE}>
        <Suspense fallback={null}>
          <group name="perf:city" scale={[STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE]}><StaticCityPerimeter /></group>
          <group name="perf:building" scale={[STORE_LAYOUT_SCALE, 1, STORE_LAYOUT_SCALE]}><MarketBuilding open={open} doorProgress={doorProgress} /></group>
          <group name="perf:furniture"><KitFurniture shelves={visualShelves} machines={productionMachines} customers={customers} checkoutTransactions={checkoutTransactions} returnsBin={returnsBin} returnedCartCount={returnedCartCount} lightsOn={lightsOn} unlockedAreas={unlockedAreas} /></group>
          <group name="perf:farm"><KitFarm crops={visualCrops} machines={productionMachines} nowMs={simulationTimeMs} unlockedAreas={unlockedAreas} /></group>
          {transferEvents.map((event) => event.kind === "harvest" && event.cropId && event.productId
            ? <HarvestMagnetBurst key={event.sequence} sequence={event.sequence} cropId={event.cropId} productId={event.productId} quantity={event.quantity ?? 1} basketTarget={basketTarget} onProgress={onTransferProgress} />
            : event.kind === "stock" && event.productId
              ? <StockMagnetBurst key={event.sequence} sequence={event.sequence} productId={event.productId} quantity={event.quantity ?? 1} shelfStart={event.shelfStart ?? 0} basketTarget={basketTarget} onProgress={onTransferProgress} />
              : null)}
          {debug && <DebugWorld customers={customers} crops={crops} />}
        </Suspense>
        <group name="perf:employees"><Suspense fallback={null}><Employees employees={employees} simulationTimeMs={simulationTimeMs} /></Suspense></group>
        <group name="perf:customers"><Customers customers={customers} checkoutTransactions={checkoutTransactions} simulationTimeMs={simulationTimeMs} /></group>
        <group name="perf:contact-shadows"><StaticContactShadows frames={1} position={[0, 0.015, 2 * STORE_LAYOUT_SCALE]} opacity={0.24} scale={34 * STORE_LAYOUT_SCALE} blur={2.6} far={8} /></group>
      </group>
      <Physics timeStep={1 / 60} gravity={[0, -9.81, 0]}>
        <StoreColliders doorProgress={doorProgress} />
        <RearDoorAssembly playerFocus={playerFocus} employees={employees} />
        <InteractionSensors checkoutLevel={checkoutLevel} unlockedAreas={unlockedAreas} crops={crops} warehousePickupEnabled={warehousePickupEnabled} />
        <group name="perf:player"><Suspense fallback={null}><Player avatar={avatar} carry={visualCarry} crops={crops} checkoutLevel={checkoutLevel} playerSpeedTier={playerSpeedTier} unlockedAreas={unlockedAreas} warehousePickupEnabled={warehousePickupEnabled} debug={debug} onPrompt={onPrompt} onInteract={onInteract} onDistance={onDistance} onDoorPresence={onDoorPresence} onCheckoutFocus={setCheckoutFocused} lastInteraction={lastInteraction} playerFocus={playerFocus} basketTarget={basketTarget} interactionLabels={interactionLabels} /></Suspense></group>
      </Physics>
      <LocalEnvironment />
      {(debug || performanceProbe) && <DebugProbe inspectScene={debug} publishInventory={performanceProbe} />}
    </Canvas>
  );
}, sameMarketSceneProps);

function sameMarketSceneProps(previous: MarketSceneProps, next: MarketSceneProps) {
  if (previous.debug !== next.debug || previous.warehousePickupEnabled !== next.warehousePickupEnabled || previous.checkoutLevel !== next.checkoutLevel || previous.playerSpeedTier !== next.playerSpeedTier || previous.shelfTier !== next.shelfTier || previous.open !== next.open || previous.doorState !== next.doorState || previous.doorProgress !== next.doorProgress) return false;
  if (previous.crops !== next.crops || previous.visualCrops !== next.visualCrops || previous.productionMachines !== next.productionMachines || previous.shelves !== next.shelves || previous.visualShelves !== next.visualShelves || previous.unlockedAreas !== next.unlockedAreas || previous.lightsOn !== next.lightsOn || previous.simulationTimeMs !== next.simulationTimeMs) return false;
  if (previous.customers !== next.customers || previous.checkoutTransactions !== next.checkoutTransactions || previous.returnsBin !== next.returnsBin || previous.returnedCartCount !== next.returnedCartCount) return false;
  if (previous.lastInteraction !== next.lastInteraction || previous.transferEvents !== next.transferEvents || previous.onTransferProgress !== next.onTransferProgress || previous.onInteract !== next.onInteract || previous.onPrompt !== next.onPrompt || previous.onDistance !== next.onDistance || previous.onDoorPresence !== next.onDoorPresence) return false;
  const avatarKeys = ["body", "hair", "hairColor", "skin", "shirt", "hat"] as const;
  if (avatarKeys.some((key) => previous.avatar[key] !== next.avatar[key])) return false;
  if (previous.carry.capacity !== next.carry.capacity) return false;
  if ((Object.keys(previous.carry.items) as ProductId[]).some((productId) => previous.carry.items[productId] !== next.carry.items[productId])) return false;
  if ((Object.keys(next.carry.items) as ProductId[]).some((productId) => previous.carry.items[productId] !== next.carry.items[productId])) return false;
  if (previous.visualCarry.capacity !== next.visualCarry.capacity) return false;
  if ((Object.keys(previous.visualCarry.items) as ProductId[]).some((productId) => previous.visualCarry.items[productId] !== next.visualCarry.items[productId])) return false;
  if ((Object.keys(next.visualCarry.items) as ProductId[]).some((productId) => previous.visualCarry.items[productId] !== next.visualCarry.items[productId])) return false;
  return previous.employees === next.employees;
}

const LocalEnvironment = memo(function LocalEnvironment() {
  return <Environment resolution={64} frames={1} environmentIntensity={0.28}>
    <Lightformer form="rect" intensity={2.4} color="#fff3d2" position={[0, 8, 2]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12]} />
    <Lightformer form="rect" intensity={1.4} color="#b8dfce" position={[8, 3, 4]} rotation={[0, -Math.PI / 2, 0]} scale={[7, 5]} />
    <Lightformer form="rect" intensity={1.1} color="#a8c7e8" position={[-8, 4, -2]} rotation={[0, Math.PI / 2, 0]} scale={[6, 5]} />
  </Environment>;
});

function initialMarketCanvasDpr() {
  if (typeof window === "undefined") return 1;
  const deviceDpr = Math.max(0.85, Math.min(1.4, window.devicePixelRatio || 1));
  const mobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 820;
  return mobile ? Math.max(0.85, deviceDpr * MARKET_CANVAS_PERFORMANCE.min) : deviceDpr;
}

function AdaptiveQualityController({ canvasDpr, onDprChange, publishDiagnostics }: { canvasDpr: number; onDprChange: (dpr: number) => void; publishDiagnostics: boolean }) {
  const quality = useRef({ ...INITIAL_ADAPTIVE_QUALITY_STATE });
  const degraded = useRef(false);
  useFrame((state, delta) => {
    const result = advanceAdaptiveQuality(quality.current, delta * 1_000);
    quality.current = result.state;
    if (result.regress) state.performance.regress();
    if (!result.regress || degraded.current) return;
    degraded.current = true;
    const deviceDpr = Math.max(0.85, Math.min(1.4, window.devicePixelRatio || 1));
    const performanceFactor = state.performance.min;
    const desiredDpr = Math.max(0.85, deviceDpr * performanceFactor);
    if (Math.abs(canvasDpr - desiredDpr) > 0.001) onDprChange(desiredDpr);
    if (publishDiagnostics) {
      window.dispatchEvent(new CustomEvent("market-quality-regress", { detail: {
        performance: performanceFactor,
        dpr: desiredDpr,
      } }));
    }
  });
  return null;
}

function MarketKeyLight({ publishDiagnostics }: { publishDiagnostics: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const [freezeStaticShadow] = useState(() => typeof window !== "undefined" && (
    window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 820
  ));
  useEffect(() => {
    const shadow = light.current?.shadow;
    if (!shadow) return;
    shadow.autoUpdate = !freezeStaticShadow;
    shadow.needsUpdate = true;
    if (publishDiagnostics) window.dispatchEvent(new CustomEvent("market-shadow-mode", { detail: freezeStaticShadow ? "static" : "dynamic" }));
    if (!freezeStaticShadow) return;
    // Assets resolve through Suspense; refresh a few bounded times, then keep
    // the premium furniture shadow atlas static on coarse/mobile hardware.
    const timers = [450, 1_800, 4_000].map((delay) => window.setTimeout(() => { shadow.needsUpdate = true; }, delay));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      shadow.autoUpdate = true;
      shadow.needsUpdate = true;
    };
  }, [freezeStaticShadow, publishDiagnostics]);
  return <directionalLight ref={light} position={[8 * WORLD_SCALE, 13 * WORLD_SCALE, 7 * WORLD_SCALE]} intensity={2.3} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-far={30 * WORLD_SCALE} />;
}

function HarvestMagnetBurst({ sequence, cropId, productId, quantity, basketTarget, onProgress }: { sequence: number; cropId: string; productId: ProductId; quantity: number; basketTarget: RefObject<THREE.Vector3>; onProgress: (sequence: number, remainingQuantity: number) => void }) {
  const particleCount = Math.min(20, Math.max(1, Math.floor(quantity)));
  const particles = useRef<Array<THREE.Group | null>>([]);
  const landed = useRef<boolean[]>([]);
  const elapsed = useRef(0);
  const publishedRemaining = useRef(particleCount);
  const completionPublished = useRef(false);
  const plot = farmPlotById(cropId);
  const source = scaleStorePosition(plot ? [...plot.position] : [0, 0, 0]);
  const offsets = useMemo<readonly [number, number, number][]>(() => Array.from({ length: particleCount }, (_, index) => [
    ((index % 3) - 1) * 0.28,
    0.06 + Math.floor(index / 3) * 0.025,
    (Math.floor(index / 3) - (Math.ceil(particleCount / 3) - 1) / 2) * 0.22,
  ]), [particleCount]);

  useEffect(() => {
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    if (qaWindow.__MARKET_QA__) {
      const previous = Array.isArray(qaWindow.__MARKET_QA__.harvestBursts) ? qaWindow.__MARKET_QA__.harvestBursts as unknown[] : [];
      qaWindow.__MARKET_QA__.harvestBursts = [...previous, { sequence, cropId, productId, visualUnits: offsets.length }].slice(-24);
      qaWindow.__MARKET_QA__.harvestBurst = { sequence, cropId, productId, visualUnits: offsets.length };
    }
  }, [cropId, productId, sequence, offsets.length]);

  useFrame((_, delta) => {
    elapsed.current += visualTransferDelta(delta);
    Array.from({ length: particleCount }, (_, index) => index).forEach((index) => {
      const t = THREE.MathUtils.clamp((elapsed.current - index * 0.045) / 0.52, 0, 1);
      if (t >= 1) landed.current[index] = true;
      const particle = particles.current[index];
      if (!particle) return;
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
    const remaining = particleCount - landed.current.filter(Boolean).length;
    if (remaining === publishedRemaining.current) return;
    publishedRemaining.current = remaining;
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    if (qaWindow.__MARKET_QA__) {
      const progress = Array.isArray(qaWindow.__MARKET_QA__.harvestBurstProgress) ? qaWindow.__MARKET_QA__.harvestBurstProgress as unknown[] : [];
      qaWindow.__MARKET_QA__.harvestBurstProgress = [...progress, { sequence, cropId, productId, remainingQuantity: remaining }].slice(-48);
      if (remaining === 0 && !completionPublished.current) {
        completionPublished.current = true;
        const completions = Array.isArray(qaWindow.__MARKET_QA__.harvestBurstCompletions) ? qaWindow.__MARKET_QA__.harvestBurstCompletions as unknown[] : [];
        qaWindow.__MARKET_QA__.harvestBurstCompletions = [...completions, { sequence, cropId, productId, quantity: particleCount }].slice(-24);
      }
    }
    onProgress(sequence, remaining);
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

function StockMagnetBurst({ sequence, productId, quantity, shelfStart, basketTarget, onProgress }: { sequence: number; productId: ProductId; quantity: number; shelfStart: number; basketTarget: RefObject<THREE.Vector3>; onProgress: (sequence: number, remainingQuantity: number) => void }) {
  const particleCount = Math.min(20, Math.max(1, Math.floor(quantity)));
  const particles = useRef<Array<THREE.Group | null>>([]);
  const sources = useRef<Array<THREE.Vector3 | null>>([]);
  const landed = useRef<boolean[]>([]);
  const elapsed = useRef(0);
  const publishedRemaining = useRef(particleCount);
  const completionPublished = useRef(false);
  const departmentId = PRODUCT_RETAIL_DEPARTMENT[productId];
  const displayPosition = retailDisplayPosition(departmentId);
  const particleTargets = useMemo(() => Array.from({ length: particleCount }, (_, index): [number, number, number] => {
    const landing = retailStockLandingLocalPosition(productId, shelfStart + index, shelfStart + particleCount);
    return [
      displayPosition[0] * STORE_LAYOUT_SCALE + landing[0] * STORE_ELEMENT_SCALE,
      landing[1] * STORE_ELEMENT_SCALE,
      displayPosition[2] * STORE_LAYOUT_SCALE + landing[2] * STORE_ELEMENT_SCALE,
    ];
  }), [displayPosition, particleCount, productId, shelfStart]);
  const targetPosition = particleTargets[0];
  const [targetX, targetY, targetZ] = targetPosition;

  useEffect(() => {
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    if (!qaWindow.__MARKET_QA__) return;
    const previous = Array.isArray(qaWindow.__MARKET_QA__.stockBursts) ? qaWindow.__MARKET_QA__.stockBursts as unknown[] : [];
    qaWindow.__MARKET_QA__.stockBursts = [...previous, { sequence, productId, departmentId, quantity: particleCount, target: { x: targetX, y: targetY, z: targetZ } }].slice(-24);
  }, [departmentId, particleCount, productId, sequence, targetX, targetY, targetZ]);

  useFrame((_, delta) => {
    elapsed.current += visualTransferDelta(delta);
    Array.from({ length: particleCount }, (_, index) => index).forEach((index) => {
      const started = elapsed.current >= index * 0.065;
      if (started && !sources.current[index]) sources.current[index] = basketTarget.current.clone();
      const t = THREE.MathUtils.clamp((elapsed.current - index * 0.065) / 0.5, 0, 1);
      if (t >= 1) landed.current[index] = true;
      const particle = particles.current[index];
      if (!particle) return;
      particle.visible = t < 1 && started;
      if (!particle.visible) return;
      const eased = t * t * (3 - 2 * t);
      const particleTarget = particleTargets[index];
      const source = sources.current[index] ?? basketTarget.current;
      particle.position.set(
        THREE.MathUtils.lerp(source.x, particleTarget[0], eased),
        THREE.MathUtils.lerp(source.y, particleTarget[1], eased) + Math.sin(Math.PI * t) * 0.82,
        THREE.MathUtils.lerp(source.z, particleTarget[2], eased),
      );
      particle.rotation.x += delta * (3.5 + index * 0.3);
      particle.rotation.y += delta * (5.2 + index * 0.45);
      particle.scale.setScalar(0.94 + Math.sin(Math.PI * t) * 0.18);
    });
    const remaining = particleCount - landed.current.filter(Boolean).length;
    if (remaining === publishedRemaining.current) return;
    publishedRemaining.current = remaining;
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    if (qaWindow.__MARKET_QA__) {
      const progress = Array.isArray(qaWindow.__MARKET_QA__.stockBurstProgress) ? qaWindow.__MARKET_QA__.stockBurstProgress as unknown[] : [];
      qaWindow.__MARKET_QA__.stockBurstProgress = [...progress, { sequence, productId, departmentId, remainingQuantity: remaining }].slice(-48);
      if (remaining === 0 && !completionPublished.current) {
        completionPublished.current = true;
        const completions = Array.isArray(qaWindow.__MARKET_QA__.stockBurstCompletions) ? qaWindow.__MARKET_QA__.stockBurstCompletions as unknown[] : [];
        qaWindow.__MARKET_QA__.stockBurstCompletions = [...completions, { sequence, productId, departmentId, quantity: particleCount }].slice(-24);
      }
    }
    onProgress(sequence, remaining);
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

function DebugProbe({ inspectScene, publishInventory }: { inspectScene: boolean; publishInventory: boolean }) {
  const monitor = useRef(new PerformanceMonitor());
  const get = useThree((state) => state.get);
  useEffect(() => {
    const rendererInfo = get().gl.info;
    const previousAutoReset = rendererInfo.autoReset;
    // WebGLRenderer can execute the shadow, environment and main passes in one
    // frame. Accumulate all of them and reset once at the next probe tick so a
    // late pass can never masquerade as the old one-draw-call sample.
    rendererInfo.autoReset = false;
    rendererInfo.reset();
    return () => {
      rendererInfo.reset();
      rendererInfo.autoReset = previousAutoReset;
    };
  }, [get]);
  useEffect(() => {
    if (!inspectScene) return;
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
      const retailPresentation: Partial<Record<(typeof RETAIL_DEPARTMENT_IDS)[number], Partial<Record<ProductId, number>>>> = {};
      for (const departmentId of RETAIL_DEPARTMENT_IDS) {
        const products: Partial<Record<ProductId, number>> = {};
        state.scene.getObjectByName(`retail-department:${departmentId}`)?.traverse((object) => {
          if (!object.name.startsWith("retail-product:")) return;
          const productId = object.name.slice("retail-product:".length) as ProductId;
          products[productId] = (products[productId] ?? 0) + 1;
        });
        retailPresentation[departmentId] = products;
      }
      qaWindow.__MARKET_QA__.retailPresentation = retailPresentation;
      qaWindow.__MARKET_QA__.serviceFixturePresentation = Object.fromEntries(STORE_SERVICE_FIXTURE_IDS.map((fixtureId) => {
        const fixture = STORE_SERVICE_FIXTURES[fixtureId];
        return [fixtureId, {
          fixtureVisible: Boolean(state.scene.getObjectByName(fixture.obstacleId)),
          contentVisible: fixtureId === "promotionalEndcap"
            ? Boolean(state.scene.getObjectByName("fixture:promotional-endcap-content"))
            : null,
        }];
      }));
    };
    publish();
    const timer = window.setInterval(publish, 250);
    return () => window.clearInterval(timer);
  }, [get, inspectScene]);
  useEffect(() => {
    if (!publishInventory) return;
    const timer = window.setTimeout(() => {
      const { scene } = get();
      const geometries = new Set<string>();
      const materials = new Set<string>();
      const groups: Record<string, { meshes: number; instancedMeshes: number; skinnedMeshes: number; shadowCasters: number; triangles: number }> = {};
      const staticBatch = { sourceMeshes: 0, batches: 0, savedDraws: 0 };
      let meshes = 0;
      let instancedMeshes = 0;
      let skinnedMeshes = 0;
      let shadowCasters = 0;
      scene.traverseVisible((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes += 1;
        if (object instanceof THREE.InstancedMesh) instancedMeshes += 1;
        if (object instanceof THREE.SkinnedMesh) skinnedMeshes += 1;
        if (object.castShadow) shadowCasters += 1;
        geometries.add(object.geometry.uuid);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        objectMaterials.forEach((material) => materials.add(material.uuid));
        let owner: THREE.Object3D | null = object;
        while (owner && !owner.name.startsWith("perf:")) owner = owner.parent;
        const groupName = owner?.name ?? "perf:other";
        const group = (groups[groupName] ??= { meshes: 0, instancedMeshes: 0, skinnedMeshes: 0, shadowCasters: 0, triangles: 0 });
        group.meshes += 1;
        if (object instanceof THREE.InstancedMesh) group.instancedMeshes += 1;
        if (object instanceof THREE.SkinnedMesh) group.skinnedMeshes += 1;
        if (object.castShadow) group.shadowCasters += 1;
        const primitiveTriangles = object.geometry.index
          ? object.geometry.index.count / 3
          : (object.geometry.getAttribute("position")?.count ?? 0) / 3;
        group.triangles += Math.round(primitiveTriangles * (object instanceof THREE.InstancedMesh ? object.count : 1));
      });
      scene.traverse((object) => {
        const stats = object.userData.staticBatchStats as { sourceMeshes?: number; batches?: number; savedDraws?: number } | undefined;
        if (!stats) return;
        staticBatch.sourceMeshes += stats.sourceMeshes ?? 0;
        staticBatch.batches += stats.batches ?? 0;
        staticBatch.savedDraws += stats.savedDraws ?? 0;
      });
      window.dispatchEvent(new CustomEvent("market-perf-inventory", { detail: {
        meshes,
        instancedMeshes,
        skinnedMeshes,
        shadowCasters,
        geometries: geometries.size,
        materials: materials.size,
        staticBatch,
        groups,
      } }));
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [get, publishInventory]);
  useFrame(({ gl }, delta) => {
    const metrics = monitor.current.sample(delta * 1_000, { drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0 });
    if (metrics) window.dispatchEvent(new CustomEvent("market-debug-metrics", { detail: metrics }));
    gl.info.reset();
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

function Player({ avatar, carry, crops, checkoutLevel, playerSpeedTier, unlockedAreas, warehousePickupEnabled, debug, onPrompt, onInteract, onDistance, onDoorPresence, onCheckoutFocus, lastInteraction, playerFocus, basketTarget, interactionLabels }: { avatar: AvatarConfig; carry: CarryState; crops: CropState[]; checkoutLevel: number; playerSpeedTier: number; unlockedAreas: readonly string[]; warehousePickupEnabled: boolean; debug: boolean; onPrompt: (prompt: InteractionPrompt | null) => void; onInteract: (id: InteractionId) => void; onDistance: (meters: number) => void; onDoorPresence: (active: boolean) => void; onCheckoutFocus: (active: boolean) => void; lastInteraction: InteractionVisualEvent | null; playerFocus: RefObject<THREE.Vector3>; basketTarget: RefObject<THREE.Vector3>; interactionLabels: Partial<Record<InteractionId, string>> }) {
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
  const unlockedSignature = unlockedAreas.join("|");
  const cropSignature = crops.map((crop) => `${crop.id}:${crop.status === "LOCKED" ? 0 : 1}`).join("|");
  const director = useMemo(() => new InteractionDirector(interactionZoneConfigs(
    checkoutLevel,
    unlockedSignature ? unlockedSignature.split("|") : [],
    cropSignature.split("|").filter((entry) => entry.endsWith(":1")).map((entry) => entry.slice(0, -2)),
    warehousePickupEnabled,
  )), [checkoutLevel, unlockedSignature, cropSignature, warehousePickupEnabled]);
  const playerMotion = useMemo(() => {
    const config = playerMotionForTier(playerSpeedTier);
    return {
      ...config,
      walkSpeed: config.walkSpeed * WORLD_SCALE,
      acceleration: config.acceleration * WORLD_SCALE,
      braking: config.braking * WORLD_SCALE,
    };
  }, [playerSpeedTier]);
  const characterController = useRef<ReturnType<ReturnType<typeof useRapier>["world"]["createCharacterController"]> | null>(null);
  const { world, rapier } = useRapier();
  const [walking, setWalking] = useState(false);
  const [performingWorkstation, setPerformingWorkstation] = useState<WorkstationId | null>(null);
  const interactionAnimation: Partial<Record<InteractionId, CharacterAnimation>> = { mill: "LiftBox", bakery: "StockHigh", chicken: "PickupLow", cow: "PickupLow", cheese: "LiftBox", juice: "LiftBox", checkout: "ScanItem", supplier: "ReceiveOrder", door: "Enter" };
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
      const nextVelocity = workLocked ? { x: 0, y: 0 } : moveVelocity(
        { x: velocity.current.x, y: velocity.current.y },
        intention,
        step,
        playerMotion,
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
      const workHeading = currentWorkstation ? workstationFacing(currentWorkstation) : null;
      if (workLocked && workHeading !== null) {
        const turn = smoothYaw(visual.current!.rotation.y, workHeading, angularVelocity.current, step, playerMotion);
        avatarMotion.current.yawDelta = workHeading - visual.current!.rotation.y;
        visual.current!.rotation.y = turn.yaw;
        angularVelocity.current = turn.angularVelocity;
      } else if (speed > 0.08) {
        const heading = Math.atan2(velocity.current.x, velocity.current.y);
        const turn = smoothYaw(visual.current!.rotation.y, heading, angularVelocity.current, step, playerMotion);
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
      qaWindow.__MARKET_QA__.player = {
        x: logicalPosition.current.x / WORLD_SCALE,
        z: logicalPosition.current.z / WORLD_SCALE,
        speed: avatarMotion.current.locomotionSpeed,
        speedCap: playerMotion.walkSpeed / WORLD_SCALE,
        speedTier: playerSpeedTier,
        basketMounted: Boolean(basketVisual.current),
        basketUnits: carryTotal(carry),
      };
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
    const foundZone = ZONES.find((zone) => active.includes(zone.id)
      && (!(isStockingInteractionId(zone.id) || zone.id === "supplier") || interactionLabels[zone.id]));
    const found = foundZone ? { id: foundZone.id, label: interactionLabels[foundZone.id] ?? foundZone.label } : null;
    if (found?.id !== nearest.current?.id || found?.label !== nearest.current?.label) { nearest.current = found; onPrompt(found); }
  });

  const worldStart = PLAYER_START.map((value) => value * WORLD_SCALE) as [number, number, number];
  return <RigidBody ref={body} type="kinematicPosition" colliders={false} position={worldStart} enabledRotations={[false, false, false]} canSleep={false} userData={{ actor: "player" }}>
    <CapsuleCollider ref={collider} args={[0.45 * WORLD_SCALE, 0.24 * WORLD_SCALE]} position={[0, 0.69 * WORLD_SCALE, 0]} friction={0} />
    <group ref={visual}><Avatar {...avatar} scale={PLAYER_SCALE * WORLD_SCALE} walking={walking} carrying={carryTotal(carry) > 0} carryAccessory={<HarvestBasket ref={basketVisual} carry={carry} />} motion={avatarMotion} animation={!walking && lastInteraction?.kind === "work" && lastInteraction.id === performingWorkstation ? interactionAnimation[lastInteraction.id] : undefined} feedbackSource="player" feedbackActorId="player" /></group>
  </RigidBody>;
}

function StoreColliders({ doorProgress }: { doorProgress: number }) {
  const wallHalfHeight = STOREFRONT_LAYOUT.wallHeight / 2;
  const door = STOREFRONT_LAYOUT.door;
  const doorHalfHeight = door.leafHeight / 2;
  const frameHalfHeight = (door.leafHeight + 0.16) / 2;
  const rearDoor = STORE_REAR_DOOR.door;
  const rearFrameHalfHeight = (rearDoor.leafHeight + 0.18) / 2;
  return <RigidBody type="fixed" colliders={false}>
    <CuboidCollider args={[13.35 * STORE_LAYOUT_SCALE * WORLD_SCALE, 0.08 * WORLD_SCALE, 17.15 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[0, -0.08 * WORLD_SCALE, -1.25 * STORE_LAYOUT_SCALE * WORLD_SCALE]} friction={0.8} />
    {STORE_OBSTACLES.map((obstacle, index) => <CuboidCollider key={index} args={[obstacle.halfX * WORLD_SCALE, 0.9 * WORLD_SCALE, obstacle.halfZ * WORLD_SCALE]} position={[obstacle.x * WORLD_SCALE, 0.9 * WORLD_SCALE, obstacle.z * WORLD_SCALE]} />)}
    <CuboidCollider args={[0.17 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, 8.25 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[-11.35 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, -0.35 * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    <CuboidCollider args={[0.17 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, 8.25 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[11.35 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, -0.35 * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    {rearDoorWallSegments().map((segment, index) => <CuboidCollider
      key={`rear-wall-collider-${index}`}
      args={[segment.width * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, STORE_REAR_DOOR.wallDepth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE]}
      position={[segment.centerX * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, STORE_REAR_DOOR.wallCenterZ * STORE_LAYOUT_SCALE * WORLD_SCALE]}
    />)}
    {([-1, 1] as const).map((side) => <CuboidCollider
      key={`rear-door-post-${side}`}
      args={[rearDoor.postWidth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE, rearFrameHalfHeight * WORLD_SCALE, rearDoor.frameDepth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE]}
      position={[(STORE_REAR_DOOR.x + side * rearDoor.outerPostOffset) * STORE_LAYOUT_SCALE * WORLD_SCALE, rearFrameHalfHeight * WORLD_SCALE, STORE_REAR_DOOR.z * STORE_LAYOUT_SCALE * WORLD_SCALE]}
    />)}
    <CuboidCollider
      args={[(rearDoor.outerPostOffset + rearDoor.postWidth * 0.5) * STORE_LAYOUT_SCALE * WORLD_SCALE, 0.09 * WORLD_SCALE, rearDoor.frameDepth * 0.55 * STORE_LAYOUT_SCALE * WORLD_SCALE]}
      position={[STORE_REAR_DOOR.x * STORE_LAYOUT_SCALE * WORLD_SCALE, (rearDoor.leafHeight + 0.09) * WORLD_SCALE, STORE_REAR_DOOR.z * STORE_LAYOUT_SCALE * WORLD_SCALE]}
    />
    <CuboidCollider args={[4.765 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, 0.12 * WORLD_SCALE]} position={[-6.585 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, (STOREFRONT_LAYOUT.z - 0.02) * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    <CuboidCollider args={[4.765 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, 0.12 * WORLD_SCALE]} position={[6.585 * STORE_LAYOUT_SCALE * WORLD_SCALE, wallHalfHeight * WORLD_SCALE, (STOREFRONT_LAYOUT.z - 0.02) * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    {[-1, 1].map((side) => <CuboidCollider key={`storefront-post-${side}`} args={[door.postWidth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE, frameHalfHeight * WORLD_SCALE, door.frameDepth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[side * door.outerPostX * STORE_LAYOUT_SCALE * WORLD_SCALE, frameHalfHeight * WORLD_SCALE, STOREFRONT_LAYOUT.z * STORE_LAYOUT_SCALE * WORLD_SCALE]} />)}
    <CuboidCollider args={[(door.outerPostX + door.postWidth * 0.5) * STORE_LAYOUT_SCALE * WORLD_SCALE, 0.07 * WORLD_SCALE, door.frameDepth * 0.55 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[0, (door.leafHeight + 0.07) * WORLD_SCALE, STOREFRONT_LAYOUT.z * STORE_LAYOUT_SCALE * WORLD_SCALE]} />
    {([-1, 1] as const).map((side) => <CuboidCollider key={`door-leaf-${side}`} args={[door.leafWidth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE, doorHalfHeight * WORLD_SCALE, door.leafDepth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE]} position={[storefrontDoorLeafCenter(side, doorProgress) * STORE_LAYOUT_SCALE * WORLD_SCALE, doorHalfHeight * WORLD_SCALE, STOREFRONT_LAYOUT.z * STORE_LAYOUT_SCALE * WORLD_SCALE]} />)}
  </RigidBody>;
}

/**
 * The rear door is presentation-local: it has no economic state to persist,
 * but its leaves and Rapier colliders always share the same animated progress.
 * Player and simulation employees both open it before reaching the threshold.
 */
function RearDoorAssembly({ playerFocus, employees }: { playerFocus: RefObject<THREE.Vector3>; employees: Employee[] }) {
  const motion = useRef({ ...CLOSED_REAR_DOOR_MOTION });
  const [progress, setProgress] = useState(0);
  const door = STORE_REAR_DOOR.door;
  const doorHalfHeight = door.leafHeight / 2;

  useEffect(() => {
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    if (!qaWindow.__MARKET_QA__) return;
    qaWindow.__MARKET_QA__.rearDoor = {
      x: STORE_REAR_DOOR.x * STORE_LAYOUT_SCALE,
      z: STORE_REAR_DOOR.z * STORE_LAYOUT_SCALE,
      insideApproach: scaleStorePoint([...STORE_REAR_DOOR.insideApproach]),
      outsideApproach: scaleStorePoint([...STORE_REAR_DOOR.outsideApproach]),
      clearHalfWidth: (STORE_REAR_DOOR.door.outerPostOffset - STORE_REAR_DOOR.door.postWidth / 2) * STORE_LAYOUT_SCALE,
      progress,
    };
  }, [progress]);

  useFrame((_, delta) => {
    const playerPresent = rearDoorActorPresent([
      playerFocus.current.x / STORE_LAYOUT_SCALE,
      playerFocus.current.z / STORE_LAYOUT_SCALE,
    ]);
    const employeePresent = employees.some((employee) => employee.runtime && rearDoorActorPresent([
      employee.runtime.x,
      employee.runtime.z,
    ]));
    const next = advanceRearDoorMotion(motion.current, playerPresent || employeePresent, delta * 1_000);
    motion.current = next;
    if (Math.abs(next.progress - progress) > 0.001) setProgress(next.progress);
  });

  return <>
    <group
      name="dynamic:rear-farm-door"
      scale={[STORE_LAYOUT_SCALE * WORLD_SCALE, WORLD_SCALE, STORE_LAYOUT_SCALE * WORLD_SCALE]}
      userData={{ progress }}
    >
      {([-1, 1] as const).map((side) => <group
        key={`rear-door-leaf-visual-${side}`}
        position={[rearDoorLeafCenter(side, progress), doorHalfHeight, STORE_REAR_DOOR.z]}
      >
        <mesh castShadow receiveShadow>
          <boxGeometry args={[door.leafWidth, door.leafHeight, door.leafDepth]} />
          <meshPhysicalMaterial color="#cbe8de" transparent opacity={0.42} transmission={0.32} clearcoat={1} clearcoatRoughness={0.06} roughness={0.13} metalness={0.04} depthWrite={false} />
        </mesh>
        {[-door.leafWidth / 2, door.leafWidth / 2].map((edge, index) => <mesh key={`rear-door-edge-${side}-${index}`} position={[edge, 0, 0.055]} castShadow>
          <boxGeometry args={[0.065, door.leafHeight + 0.02, 0.1]} />
          <meshStandardMaterial color="#294a41" metalness={0.72} roughness={0.24} />
        </mesh>)}
        <mesh position={[side * -0.27, 0, 0.075]}>
          <boxGeometry args={[0.055, 0.6, 0.055]} />
          <meshStandardMaterial color="#e4b95f" metalness={0.7} roughness={0.22} />
        </mesh>
      </group>)}
      <group position={[STORE_REAR_DOOR.x, door.leafHeight + 0.38, STORE_REAR_DOOR.z + 0.035]}>
        <mesh castShadow><boxGeometry args={[0.58, 0.22, 0.18]} /><meshStandardMaterial color="#203a33" metalness={0.5} roughness={0.3} /></mesh>
        <mesh position={[0, 0, 0.105]}><circleGeometry args={[0.058, 18]} /><meshStandardMaterial color={progress > 0.98 ? "#79ecad" : "#f0bd66"} emissive={progress > 0.98 ? "#36a878" : "#9d681d"} emissiveIntensity={1.15} /></mesh>
      </group>
    </group>
    <RigidBody type="fixed" colliders={false}>
      {([-1, 1] as const).map((side) => <CuboidCollider
        key={`rear-door-leaf-collider-${side}`}
        args={[door.leafWidth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE, doorHalfHeight * WORLD_SCALE, door.leafDepth * 0.5 * STORE_LAYOUT_SCALE * WORLD_SCALE]}
        position={[rearDoorLeafCenter(side, progress) * STORE_LAYOUT_SCALE * WORLD_SCALE, doorHalfHeight * WORLD_SCALE, STORE_REAR_DOOR.z * STORE_LAYOUT_SCALE * WORLD_SCALE]}
      />)}
    </RigidBody>
  </>;
}

function highestPriorityWorkstation(activeZoneIds: readonly string[]) {
  return WORKSTATION_IDS.find((id) => id !== "shelf" && activeZoneIds.includes(id)) ?? null;
}

function isMovementLockingWorkstation(id: string): id is WorkstationId {
  return isWorkstationId(id) && id !== "shelf";
}

function workstationFacing(id: WorkstationId) {
  return WORKSTATIONS[id].facing;
}

function InteractionSensors({ checkoutLevel, unlockedAreas, crops, warehousePickupEnabled }: { checkoutLevel: number; unlockedAreas: readonly string[]; crops: CropState[]; warehousePickupEnabled: boolean }) {
  return <RigidBody type="fixed" colliders={false}>
    {interactionZoneConfigs(checkoutLevel, unlockedAreas, crops.filter((crop) => crop.status !== "LOCKED").map((crop) => crop.id), warehousePickupEnabled).map((zone) => <InteractionSensorCollider key={zone.id} zone={zone} />)}
  </RigidBody>;
}

function InteractionSensorCollider({ zone }: { zone: InteractionZoneConfig }) {
  const centerY = 0.6 * WORLD_SCALE;
  const name = `interaction:${zone.id}`;
  if (!zone.halfExtents) {
    return <BallCollider args={[zone.enterRadius * WORLD_SCALE]} position={[zone.x * WORLD_SCALE, centerY, zone.z * WORLD_SCALE]} sensor name={name} />;
  }
  return <>
    {interactionZoneSensorPrimitives(zone).map((primitive, index) => <Fragment key={`${zone.id}-${primitive.kind}-${index}`}>
      {primitive.kind === "box"
        ? <CuboidCollider args={[primitive.halfX * WORLD_SCALE, centerY, primitive.halfZ * WORLD_SCALE]} position={[zone.x * WORLD_SCALE, centerY, zone.z * WORLD_SCALE]} sensor name={name} />
        : <CylinderCollider args={[centerY, primitive.radius * WORLD_SCALE]} position={[(zone.x + primitive.offsetX) * WORLD_SCALE, centerY, (zone.z + primitive.offsetZ) * WORLD_SCALE]} sensor name={name} />}
    </Fragment>)}
  </>;
}

function interactionZoneConfigs(checkoutLevel = 1, unlockedAreas: readonly string[] = [], activeCropIds: readonly string[] = [], warehousePickupEnabled = false): InteractionZoneConfig[] {
  const storeZones = ZONES.filter((zone) => (
    (zone.id !== "supplier" || warehousePickupEnabled)
    && (!isWorkstationId(zone.id) || isWorkstationUnlocked(zone.id, unlockedAreas))
  )).map((zone): InteractionZoneConfig => {
    const departmentId = retailDepartmentFromStockingInteraction(zone.id);
    const magnet = departmentId ? retailStockingMagnet(departmentId, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE) : null;
    const doorSensor = zone.id === "door" ? STOREFRONT_LAYOUT.sensor : null;
    return {
      id: zone.id,
      type: zone.id,
      x: magnet?.x ?? zone.position[0],
      z: magnet?.z ?? zone.position[2],
      ...(magnet
        ? { halfExtents: magnet.halfExtents }
        : doorSensor
          ? { halfExtents: [doorSensor.actorHalfWidth * STORE_LAYOUT_SCALE, doorSensor.actorHalfDepth * STORE_LAYOUT_SCALE] as const }
          : {}),
      // Retail reach expands from every fixture edge; other stations retain
      // their radial proximity volume around a single walkable service point.
      enterRadius: magnet?.enterRadius ?? (doorSensor
        ? doorSensor.enterMargin * STORE_LAYOUT_SCALE
        : (zone.id === "supplier" ? WAREHOUSE_PICKUP_STATION.enterRadius : isWorkstationId(zone.id) ? 0.44 : 0.75) * STORE_ELEMENT_SCALE),
      exitRadius: magnet?.exitRadius ?? (doorSensor
        ? doorSensor.exitMargin * STORE_LAYOUT_SCALE
        : (zone.id === "supplier" ? WAREHOUSE_PICKUP_STATION.exitRadius : isWorkstationId(zone.id) ? 0.58 : 0.9) * STORE_ELEMENT_SCALE),
      actorMask: ["player"],
      priority: isStockingInteractionId(zone.id) ? 80 : ({ checkout: 100, mill: 70, bakery: 70, cheese: 70, juice: 70, chicken: 65, cow: 65, door: 20, supplier: 5 } as Partial<Record<InteractionId, number>>)[zone.id] ?? 10,
      dwellMs: zone.id === "supplier" ? WAREHOUSE_PICKUP_STATION.dwellMs : zone.id === "checkout" ? 180 : zone.id === "door" || isStockingInteractionId(zone.id) ? 0 : 80,
      repeatEveryMs: zone.id === "supplier" ? WAREHOUSE_PICKUP_STATION.repeatEveryMs : isStockingInteractionId(zone.id) ? 180 : zone.id === "checkout" ? (checkoutLevel >= 2 ? 340 : 450) : zone.id === "door" ? 60_000 : 220,
      exitGraceMs: zone.id === "supplier" ? WAREHOUSE_PICKUP_STATION.exitGraceMs : 120,
      channel: zone.id === "door" || zone.id === "supplier" ? "passive" : zone.id === "checkout" ? "hands" : "transfer",
    };
  });
  const activeCrops = new Set(activeCropIds);
  const farmSensor = scaledFarmHarvestSensor(STORE_ELEMENT_SCALE);
  const farmZones = FARM_PLOTS.flatMap((plot): InteractionZoneConfig[] => {
    const id = farmInteractionId(plot.id);
    if (!activeCrops.has(plot.id) || !id) return [];
    const position = scaleStorePosition([...plot.position]);
    return [{
      id,
      type: "farm-plot",
      x: position[0],
      z: position[2],
      enterRadius: farmSensor.enterRadius,
      exitRadius: farmSensor.exitRadius,
      actorMask: ["player"],
      priority: 92,
      dwellMs: farmSensor.dwellMs,
      repeatEveryMs: farmSensor.repeatEveryMs,
      exitGraceMs: farmSensor.exitGraceMs,
      channel: "transfer",
    }];
  });
  return [...storeZones, ...farmZones];
}

function SceneStaticBatch({ rootRef }: { rootRef: { current: THREE.Group | null } }) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const batch = createStaticMeshBatch(root);
    root.userData.staticBatchStats = batch.stats;
    return () => {
      batch.dispose();
      delete root.userData.staticBatchStats;
    };
  }, [rootRef]);
  return null;
}

const MarketBuilding = memo(function MarketBuilding({ open, doorProgress }: { open: boolean; doorProgress: number }) {
  const root = useRef<THREE.Group>(null);
  const door = STOREFRONT_LAYOUT.door;
  const rearDoor = STORE_REAR_DOOR.door;
  const wallHeight = STOREFRONT_LAYOUT.wallHeight;
  const frontGlassHeight = wallHeight - 0.6;
  const frontGlassCenterY = frontGlassHeight / 2 + 0.3;
  return <group ref={root}>
    <SceneStaticBatch rootRef={root} />
    <mesh receiveShadow position={[0, -0.08, -0.35]}><boxGeometry args={[23, 0.16, 17]} /><meshStandardMaterial color="#eee8dc" roughness={0.82} /></mesh>
    {[-7.6, -3.8, 0, 3.8, 7.6].map((x) => <mesh key={`floor-seam-x-${x}`} position={[x, 0.012, -0.35]}><boxGeometry args={[0.018, 0.008, 16.7]} /><meshStandardMaterial color="#d9d2c5" roughness={0.95} /></mesh>)}
    {[-6.8, -3.4, 0, 3.4, 6.8].map((z) => <mesh key={`floor-seam-z-${z}`} position={[0, 0.013, z - 0.35]}><boxGeometry args={[22.7, 0.008, 0.018]} /><meshStandardMaterial color="#d9d2c5" roughness={0.95} /></mesh>)}
    <mesh receiveShadow position={[0, -0.1, 11.9]}><boxGeometry args={[23, 0.14, 7.5]} /><meshStandardMaterial color="#d7e3db" roughness={0.94} /></mesh>
    <mesh receiveShadow position={[0, -0.09, 16.15]}><boxGeometry args={[25, 0.12, 1.2]} /><meshStandardMaterial color="#566a62" roughness={0.98} /></mesh>
    {[-6, 0, 6].map((x) => <mesh key={x} position={[x, -0.015, 16.1]}><boxGeometry args={[2.7, 0.02, 0.1]} /><meshStandardMaterial color="#f4d58d" /></mesh>)}
    <mesh receiveShadow position={[STORE_REAR_DOOR.x, -0.015, -9.61]}><boxGeometry args={[2.58, 0.08, 2.2]} /><meshStandardMaterial color="#b8ab8f" roughness={0.96} /></mesh>
    {[-0.72, 0, 0.72].map((offset, index) => <mesh key={`rear-path-inlay-${index}`} position={[STORE_REAR_DOOR.x + offset, 0.03, -9.61]}><boxGeometry args={[0.035, 0.018, 2.08]} /><meshStandardMaterial color="#dfd3b8" roughness={0.88} /></mesh>)}
    {rearDoorWallSegments().map((segment, index) => <group key={`rear-wall-visual-${index}`}>
      <mesh receiveShadow position={[segment.centerX, wallHeight / 2, STORE_REAR_DOOR.wallCenterZ]}><boxGeometry args={[segment.width, wallHeight, STORE_REAR_DOOR.wallDepth]} /><meshStandardMaterial color="#eee8dc" roughness={0.88} /></mesh>
      <mesh position={[segment.centerX, 0.68, -8.34]}><boxGeometry args={[Math.max(0.01, segment.width - 0.08), 1.25, 0.12]} /><meshStandardMaterial color="#2f6958" roughness={0.78} /></mesh>
    </group>)}
    {rearDoorWallPanels().map((panel) => <mesh key={`wall-panel-${panel.centerX}`} position={[panel.centerX, wallHeight * 0.54, -8.35]}><boxGeometry args={[panel.width, wallHeight * 0.57, 0.08]} /><meshStandardMaterial color="#f7f2e8" roughness={0.86} /></mesh>)}
    <mesh position={[0, wallHeight - 0.82, -8.28]}><boxGeometry args={[5.6, 0.78, 0.18]} /><meshStandardMaterial color="#173f35" roughness={0.64} metalness={0.08} /></mesh>
    <Text position={[0, wallHeight - 0.82, -8.17]} fontSize={0.43} color="#fff3ce" anchorX="center">MINI MARKET</Text>
    <group name="rear-farm-door-frame" position={[STORE_REAR_DOOR.x, 0, STORE_REAR_DOOR.z]}>
      {([-1, 1] as const).map((side) => <mesh key={`rear-frame-post-${side}`} position={[side * rearDoor.outerPostOffset, (rearDoor.leafHeight + 0.18) / 2, 0.02]} castShadow receiveShadow><boxGeometry args={[rearDoor.postWidth, rearDoor.leafHeight + 0.18, rearDoor.frameDepth]} /><meshStandardMaterial color="#294a41" metalness={0.68} roughness={0.26} /></mesh>)}
      <mesh position={[0, rearDoor.leafHeight + 0.09, 0.02]} castShadow><boxGeometry args={[rearDoor.outerPostOffset * 2 + rearDoor.postWidth, 0.18, rearDoor.frameDepth]} /><meshStandardMaterial color="#294a41" metalness={0.68} roughness={0.26} /></mesh>
      <mesh position={[0, rearDoor.leafHeight + 0.48, 0.035]} castShadow><boxGeometry args={[2.18, 0.5, 0.16]} /><meshStandardMaterial color="#173f35" metalness={0.1} roughness={0.55} /></mesh>
      <Text position={[0, rearDoor.leafHeight + 0.49, 0.13]} fontSize={0.22} color="#fff3ce" anchorX="center" anchorY="middle" fontWeight={800}>ACCESO FINCA</Text>
      <mesh position={[0, 0.035, 0]} receiveShadow><boxGeometry args={[rearDoor.outerPostOffset * 2, 0.07, 0.54]} /><meshStandardMaterial color="#8e9894" metalness={0.42} roughness={0.38} /></mesh>
    </group>
    <mesh receiveShadow position={[-11.35, wallHeight / 2, -0.35]}><boxGeometry args={[0.34, wallHeight, 16.5]} /><meshStandardMaterial color="#e5ded2" roughness={0.9} /></mesh>
    <mesh receiveShadow position={[11.35, wallHeight / 2, -0.35]}><boxGeometry args={[0.34, wallHeight, 16.5]} /><meshStandardMaterial color="#e5ded2" roughness={0.9} /></mesh>
    {[-6.585, 6.585].map((x) => <group key={x} position={[x, 0.3, 7.78]}>
      <mesh><boxGeometry args={[9.53, 0.6, 0.3]} /><meshStandardMaterial color="#e7dfd2" roughness={0.9} /></mesh>
      <mesh position={[0, frontGlassCenterY, 0]}><boxGeometry args={[9.34, frontGlassHeight, 0.07]} /><meshPhysicalMaterial color="#c7e4df" transparent opacity={0.12} transmission={0.35} clearcoat={1} clearcoatRoughness={0.08} roughness={0.08} depthWrite={false} /></mesh>
      {[-4.67, 0, 4.67].map((edge) => <mesh key={edge} position={[edge, frontGlassCenterY, 0.06]}><boxGeometry args={[0.1, frontGlassHeight, 0.12]} /><meshStandardMaterial color="#37564d" metalness={0.28} roughness={0.42} /></mesh>)}
    </group>)}
    <mesh receiveShadow position={[0, 0.035, 7.02]}><boxGeometry args={[3.75, 0.055, 1.05]} /><meshStandardMaterial color="#2b4b43" roughness={0.92} /></mesh>
    <group name="dynamic:storefront-door" position={[0, door.leafHeight / 2, STOREFRONT_LAYOUT.z]}>
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
});

function Employees({ employees, simulationTimeMs }: { employees: Employee[]; simulationTimeMs: number }) {
  const rolePositions: Record<EmployeeRole, [number, number, number]> = {
    farmer: scaleStorePosition([FARM_WORKER_HOME[0], 0, FARM_WORKER_HOME[1]]),
    operator: scaleStorePosition([-4.8, 0, -0.9]),
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
