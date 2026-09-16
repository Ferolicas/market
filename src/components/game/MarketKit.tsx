"use client";

import { fixtureAvailable } from "@/game/stations/fixture-availability";

import { PerspectiveCamera, RenderTexture, RoundedBox, RoundedBoxGeometry, useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { scaleStorePosition, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE } from "@/game/world-scale";
import type { CheckoutTransaction, CropState, Inventory, ProductId, ProductionMachineState } from "@/game/types";
import { chickenFeedStatus, cropHarvestYield, cropProgress, machineInputCapacity } from "@/game/stations/StationSystem";
import { PRODUCTS } from "@/game/catalog";
import { PRODUCT_CONFIG } from "@/game/economy/products";
import { CHECKOUT_LANES, activeCheckoutForLane, checkoutBagLocation, checkoutHandoffForLane } from "@/game/stations/checkout-layout";
import { cropVisualSlotIndices } from "@/game/stations/crop-visual";
import { FARM_ANIMAL_STATIONS, FARM_FACILITIES, FARM_FIELD, FARM_GATE, FARM_PLOTS, farmGateOpenLeafTerminalPost } from "@/game/stations/farm-layout";
import { STORE_REAR_DOOR } from "@/game/stations/storefront-layout";
import { distributedFixtureQuantity, PANTRY_DISPLAY_POSITIONS, PRODUCE_BIN_COLUMNS, PRODUCE_BIN_PITCH, PRODUCE_DECK, produceDeckLocalPoint, PRODUCT_RETAIL_DEPARTMENT, RETAIL_DEPARTMENTS, RETAIL_FIXTURE_LEVELS, RETAIL_VISUAL_CAPACITY, retailDisplayPosition, retailFixtureDisplayPositions, retailStockLandingLocalPosition } from "@/game/stations/retail-layout";
import { shelfCapacityForTier } from "@/game/engine";
import { STORE_SERVICE_FIXTURES } from "@/game/stations/store-service-layout";
import { WAREHOUSE_RETURN_STATION } from "@/game/stations/warehouse-layout";
import { PRODUCTION_CUBICLE, STORE_PRODUCTION_FIXTURES, type ProductionFixtureLayout } from "@/game/stations/production-layout";
import { marketAsset } from "@/game/assets/AssetRegistry";
import { sameFarmPresentation, sameFurniturePresentation, type FarmPresentationProps, type FurniturePresentationProps } from "@/game/render/MarketPresentation";
import { createStaticMeshBatch } from "@/game/render/StaticMeshBatch";
import { BasketProduct } from "./HarvestBasket";
import { CannedCornModel, cornTinGeometry, cornLabelGeometry, cornTinMaterial, cornLabelMaterial } from "./CannedCornModel";
import { MarketText as Text } from "./MarketText";
import { useGlassTransmission } from "./MarketRenderProfile";
import { DeliveredModel, DeliveredProductInstances, deliveredProductId } from "./DeliveredModel";
import { FarmAnimal } from "./FarmAnimal";
import { DeliveredDairy } from "./DeliveredDairy";

type Position = [number, number, number];


interface InstanceTransform {
  position: Position;
  rotation?: Position;
  quaternion?: [number, number, number, number];
  scale?: Position;
}

const palette = {
  cream: "#eee8d8",
  light: "#faf6e9",
  frame: "#303a36",
  green: "#637b51",
  darkGreen: "#344c3e",
  wood: "#a46f3d",
  soil: "#765035",
  metal: "#87928e",
  fixtureSteel: "#222a2b",
  shelf: "#d9dcda",
  coldInterior: "#dcecef",
};

function StaticInstances({ transforms, children, castShadow = false, receiveShadow = false, capacity = transforms.length, component }: { transforms: readonly InstanceTransform[]; children: ReactNode; castShadow?: boolean; receiveShadow?: boolean; capacity?: number; component?: InstanceTransform }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const componentObject = new THREE.Object3D();
    const combinedMatrix = new THREE.Matrix4();
    if (component) {
      componentObject.position.set(...component.position);
      if (component.quaternion) componentObject.quaternion.set(...component.quaternion);
      else componentObject.rotation.set(...(component.rotation ?? [0, 0, 0]));
      componentObject.scale.set(...(component.scale ?? [1, 1, 1]));
      componentObject.updateMatrix();
    }
    transforms.forEach((transform, index) => {
      dummy.position.set(...transform.position);
      if (transform.quaternion) dummy.quaternion.set(...transform.quaternion);
      else dummy.rotation.set(...(transform.rotation ?? [0, 0, 0]));
      dummy.scale.set(...(transform.scale ?? [1, 1, 1]));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, component ? combinedMatrix.copy(dummy.matrix).multiply(componentObject.matrix) : dummy.matrix);
    });
    mesh.count = transforms.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [component, transforms]);
  return <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, capacity)]} castShadow={castShadow} receiveShadow={receiveShadow}>{children}</instancedMesh>;
}

function StaticBatchOptimizer({ rootRef, structureRevision }: { rootRef: { current: THREE.Group | null }; structureRevision: string }) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const batch = createStaticMeshBatch(root);
    root.userData.staticBatchStats = batch.stats;
    return () => {
      batch.dispose();
      delete root.userData.staticBatchStats;
    };
  }, [rootRef, structureRevision]);
  return null;
}

type KitSurface = "charcoal" | "cream" | "olive" | "wood";
const preparedSurfaceTextures = new WeakSet<THREE.Texture>();

function Box({ args, position, color, children, rotation, radius = 0.035 }: { args: [number, number, number]; position?: Position; color: string; children?: ReactNode; rotation?: Position; radius?: number }) {
  const surface = surfaceForColor(color);
  return <RoundedBox args={args} position={position} rotation={rotation} radius={radius} smoothness={2} receiveShadow>
    {surface ? <SurfaceMaterial surface={surface} /> : <meshStandardMaterial color={color} roughness={0.72} />}
    {children}
  </RoundedBox>;
}

function SurfaceMaterial({ surface }: { surface: KitSurface }) {
  // useTexture already shares one texture per URL. Cloning it for every box
  // created hundreds of identical GPU uploads during scene start-up.
  const preparedTexture = useTexture(`/textures/market-kit/${surface}.webp`, prepareSurfaceTexture);
  const roughness = surface === "charcoal" ? 0.68 : surface === "wood" ? 0.78 : 0.82;
  return <meshStandardMaterial map={preparedTexture} bumpMap={preparedTexture} bumpScale={surface === "wood" ? 0.012 : 0.008} roughness={roughness} metalness={surface === "charcoal" ? 0.06 : 0.01} />;
}

function prepareSurfaceTexture(texture: THREE.Texture) {
  if (preparedSurfaceTextures.has(texture)) return;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  preparedSurfaceTextures.add(texture);
}

function surfaceForColor(color: string): KitSurface | null {
  if (color === palette.cream || color === palette.light) return "cream";
  if (color === palette.frame) return "charcoal";
  if (color === palette.green) return "olive";
  if (color === palette.wood) return "wood";
  return null;
}

function DepartmentSign({ label, color, position = [0, 1.82, 0.03], width = 1.72 }: { label: string; color: string; position?: Position; width?: number }) {
  return <group position={position}>
    <Box args={[width + 0.1, 0.42, 0.07]} position={[0, -0.025, -0.035]} color={palette.frame} radius={0.055} />
    <Box args={[width, 0.31, 0.09]} color={color} radius={0.045} />
    <Text position={[0, 0, 0.052]} fontSize={0.135} color="#fffaf0" anchorX="center" anchorY="middle" fontWeight={800}>{label}</Text>
  </group>;
}

/** Ground azimuth of the fixed overview camera (OVERVIEW_CAMERA_OFFSET x/z):
 * every shelf tag turns to it so its counter reads from the play view. */
const CAMERA_AZIMUTH = Math.atan2(16, 25.75);

type StockCounts = Readonly<Partial<Record<ProductId, number>>>;

/**
 * Live stock screen of one SKU, mounted above its fixture: a rendered photo
 * of the product, its name, the exact units on this fixture over the
 * fixture's share of the shelf capacity, and what is still missing. The photo
 * is rendered once into a small texture (RenderTexture frames={1}); only the
 * two counter texts change while playing.
 */
function StockScreen({ productId, count, capacity, position, fixtureYaw = 0 }: { productId: ProductId; count: number; capacity: number; position: Position; fixtureYaw?: number }) {
  const missing = Math.max(0, capacity - count);
  const full = capacity > 0 && missing === 0;
  const accent = RETAIL_DEPARTMENTS[PRODUCT_RETAIL_DEPARTMENT[productId]].color;
  return <group name={`retail-stock-screen:${productId}`} position={position} rotation={[-0.35, CAMERA_AZIMUTH - THREE.MathUtils.degToRad(fixtureYaw), 0, "YXZ"]}>
    <Box args={[0.06, 0.16, 0.06]} position={[0, -0.5, -0.03]} color={palette.frame} radius={0.01} />
    <Box args={[0.76, 0.86, 0.06]} position={[0, 0, -0.03]} color="#1a2325" radius={0.04} />
    <mesh position={[0, 0, 0.004]}><planeGeometry args={[0.68, 0.78]} /><meshStandardMaterial color="#0f1e23" emissive="#12303a" emissiveIntensity={0.55} roughness={0.35} /></mesh>
    <mesh position={[0, 0.405, 0.006]}><planeGeometry args={[0.68, 0.06]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} roughness={0.5} /></mesh>
    <mesh position={[0, 0.13, 0.008]}>
      <planeGeometry args={[0.4, 0.4]} />
      <meshBasicMaterial transparent toneMapped={false}>
        <RenderTexture attach="map" width={160} height={160} frames={1}>
          <PerspectiveCamera makeDefault position={[0, 0.05, 0.46]} fov={30} near={0.05} far={5} />
          <ambientLight intensity={1.4} />
          <directionalLight position={[1.2, 2, 1.6]} intensity={2.2} />
          <directionalLight position={[-1.4, 0.6, -0.8]} intensity={0.7} />
          <group rotation={[0.28, -0.7, 0]}><BasketProduct productId={productId} scale={1} /></group>
        </RenderTexture>
      </meshBasicMaterial>
    </mesh>
    <Text position={[0, 0.34, 0.01]} fontSize={0.07} color="#e9f6f2" anchorX="center" anchorY="middle" fontWeight={800}>{PRODUCTS_LABELS[productId]}</Text>
    <group name="dynamic:stock-screen">
      <Text position={[0, -0.16, 0.01]} fontSize={0.15} color="#ffffff" anchorX="center" anchorY="middle" fontWeight={800}>{`${count}/${capacity}`}</Text>
      <Text position={[0, -0.325, 0.01]} fontSize={0.082} color={full ? "#8ce6a1" : "#ffcf6b"} anchorX="center" anchorY="middle" fontWeight={800}>{full ? "LLENO" : `faltan ${missing}`}</Text>
    </group>
    <mesh position={[0.29, 0.405, 0.012]}><circleGeometry args={[0.014, 10]} /><meshBasicMaterial color="#5bf08a" toneMapped={false} /></mesh>
  </group>;
}

/** Rail above a fixture's department sign that carries its stock screens:
 * two posts rise from the top bar beside the sign and a bar joins them. */
function ScreenRail({ barY, railY, halfWidth, z }: { barY: number; railY: number; halfWidth: number; z: number }) {
  const posts = useMemo<InstanceTransform[]>(() => [-halfWidth, halfWidth].map((x) => ({ position: [x, (barY + railY) / 2, z], scale: [0.05, railY - barY, 0.05] })), [barY, halfWidth, railY, z]);
  return <group>
    <StaticInstances transforms={posts}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={palette.fixtureSteel} metalness={0.4} roughness={0.4} /></StaticInstances>
    <Box args={[halfWidth * 2 + 0.05, 0.05, 0.05]} position={[0, railY, z]} color={palette.fixtureSteel} radius={0.01} />
  </group>;
}

function RetailProduct({ productId, position, scale = 1 }: { productId: ProductId; position: Position; scale?: number }) {
  if (productId === "cannedCorn") return <CannedCornModel position={position} scale={scale} />;
  const delivered = deliveredProductId(productId);
  if (delivered) return <group name={`retail-product:${productId}`}><DeliveredModel id={delivered} position={position} scale={scale} /></group>;
  if (productId === "oranges") return <mesh name={`retail-product:${productId}`} castShadow position={position} scale={scale}>
    <icosahedronGeometry args={[0.09, 1]} /><meshStandardMaterial color="#D58236" roughness={0.58} />
  </mesh>;
  if (productId === "tomatoes") return <group name={`retail-product:${productId}`} position={position} scale={scale}>
    <mesh castShadow scale={[1, 0.86, 1]}><sphereGeometry args={[0.09, 14, 10]} /><meshStandardMaterial color="#d94838" roughness={0.78} /></mesh>
    <mesh position={[0, 0.078, 0]} rotation={[0, 0, Math.PI]}><coneGeometry args={[0.052, 0.045, 5]} /><meshStandardMaterial color="#37743e" roughness={0.9} /></mesh>
  </group>;
  if (productId === "apples") return <group name={`retail-product:${productId}`} position={position} scale={scale}>
    <mesh castShadow scale={[0.92, 1, 0.92]}><sphereGeometry args={[0.085, 14, 10]} /><meshStandardMaterial color="#bd3432" roughness={0.72} /></mesh>
    <mesh position={[0, 0.102, 0]}><cylinderGeometry args={[0.009, 0.012, 0.065, 6]} /><meshStandardMaterial color="#5b3c27" /></mesh>
    <mesh position={[0.045, 0.112, 0]} rotation={[0, 0, -0.55]} scale={[1, 0.35, 0.55]}><sphereGeometry args={[0.045, 8, 5]} /><meshStandardMaterial color="#4e873f" roughness={0.9} /></mesh>
  </group>;
  if (productId === "corn") return <group name={`retail-product:${productId}`} position={position} scale={scale}>
    <mesh castShadow scale={[0.62, 1.22, 0.62]}><sphereGeometry args={[0.075, 12, 8]} /><meshStandardMaterial color="#f0bf36" roughness={0.85} /></mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[side * 0.048, -0.02, 0]} rotation={[0, 0, side * 0.38]} scale={[0.45, 1, 0.35]}><sphereGeometry args={[0.082, 9, 6]} /><meshStandardMaterial color="#5d9348" roughness={0.95} /></mesh>)}
  </group>;
  if (productId === "eggs") return <mesh name={`retail-product:${productId}`} castShadow position={position} scale={[0.78 * scale, 1.08 * scale, 0.78 * scale]}><sphereGeometry args={[0.073, 12, 9]} /><meshStandardMaterial color="#f4e9d0" roughness={0.93} /></mesh>;
  if (productId === "milk" || productId === "juice") return <group name={`retail-product:${productId}`} position={position} scale={scale}>
    <mesh castShadow><cylinderGeometry args={[0.055, 0.064, 0.22, 10]} /><meshStandardMaterial color={productId === "milk" ? "#f7f3e9" : "#ee8643"} roughness={0.58} /></mesh>
    <mesh position={[0, 0.135, 0]}><cylinderGeometry args={[0.03, 0.034, 0.055, 9]} /><meshStandardMaterial color={productId === "milk" ? "#4e91bc" : "#438653"} roughness={0.6} /></mesh>
    <mesh position={[0, 0, 0.061]}><planeGeometry args={[0.075, 0.09]} /><meshStandardMaterial color={productId === "milk" ? "#5a9ec8" : "#fff0c6"} /></mesh>
  </group>;
  if (productId === "cheese") return <mesh name={`retail-product:${productId}`} castShadow position={position} rotation={[0, Math.PI / 2, 0]} scale={scale}><cylinderGeometry args={[0.105, 0.105, 0.14, 3]} /><meshStandardMaterial color="#edbd3e" roughness={0.78} /></mesh>;
  if (productId === "bread") return <group name={`retail-product:${productId}`} position={position} scale={scale}>
    <RoundedBox args={[0.22, 0.16, 0.15]} radius={0.065} smoothness={3} castShadow><meshStandardMaterial color="#b97336" roughness={0.9} /></RoundedBox>
    {[-0.05, 0.02, 0.085].map((x) => <mesh key={x} position={[x, 0.073, 0]} rotation={[0, 0, -0.3]}><boxGeometry args={[0.012, 0.06, 0.158]} /><meshStandardMaterial color="#e7bd75" /></mesh>)}
  </group>;
  const packageColor = productId === "coffee" ? "#6b3d2d" : productId === "flour" ? "#eee4cc" : "#d5ab42";
  const label = productId === "coffee" ? "CAFÉ" : productId === "flour" ? "HARINA" : "TRIGO";
  return <group name={`retail-product:${productId}`} position={position} scale={scale}>
    <Box args={[0.17, 0.24, 0.12]} color={packageColor} radius={0.022} />
    <Text position={[0, 0, 0.064]} fontSize={0.037} color={productId === "coffee" ? "#fff1d0" : "#59462d"} anchorX="center" anchorY="middle" fontWeight={800}>{label}</Text>
  </group>;
}

const TOMATO_BODY: InstanceTransform = { position: [0, 0, 0], scale: [1, 0.86, 1] };
const ORANGE_BODY: InstanceTransform = { position: [0, 0, 0] };
const TOMATO_CROWN: InstanceTransform = { position: [0, 0.078, 0], rotation: [0, 0, Math.PI] };
const APPLE_BODY: InstanceTransform = { position: [0, 0, 0], scale: [0.92, 1, 0.92] };
const APPLE_STEM: InstanceTransform = { position: [0, 0.102, 0] };
const APPLE_LEAF: InstanceTransform = { position: [0.045, 0.112, 0], rotation: [0, 0, -0.55], scale: [1, 0.35, 0.55] };
const CORN_BODY: InstanceTransform = { position: [0, 0, 0], scale: [0.62, 1.22, 0.62] };
const CORN_HUSK_LEFT: InstanceTransform = { position: [-0.048, -0.02, 0], rotation: [0, 0, -0.38], scale: [0.45, 1, 0.35] };
const CORN_HUSK_RIGHT: InstanceTransform = { position: [0.048, -0.02, 0], rotation: [0, 0, 0.38], scale: [0.45, 1, 0.35] };
const EGG_BODY: InstanceTransform = { position: [0, 0, 0], scale: [0.78, 1.08, 0.78] };
const BOTTLE_CAP: InstanceTransform = { position: [0, 0.135, 0] };
const BOTTLE_LABEL: InstanceTransform = { position: [0, 0, 0.061] };
const CHEESE_WEDGE: InstanceTransform = { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] };
const BREAD_SCORE_LEFT: InstanceTransform = { position: [-0.05, 0.073, 0], rotation: [0, 0, -0.3] };
const BREAD_SCORE_MIDDLE: InstanceTransform = { position: [0.02, 0.073, 0], rotation: [0, 0, -0.3] };
const BREAD_SCORE_RIGHT: InstanceTransform = { position: [0.085, 0.073, 0], rotation: [0, 0, -0.3] };
const PACKAGE_LABEL: InstanceTransform = { position: [0, 0, 0.064] };

/** One instanced render batch per authoritative SKU. Empty named anchors keep
 * scene QA and exact landing inspection unit-addressable without multiplying
 * draw calls for every tomato, carton or package. */
function RetailProductBatch({ productId, transforms, capacity }: { productId: ProductId; transforms: readonly InstanceTransform[]; capacity: number }) {
  const anchors = transforms.map((transform, index) => <group
    key={`${productId}-anchor-${index}`}
    name={`retail-product:${productId}`}
    position={transform.position}
    rotation={transform.rotation}
    scale={transform.scale}
  />);
  if (transforms.length === 0) return <group name={`retail-stock:${productId}`} />;
  const delivered = deliveredProductId(productId);
  if (delivered) return <group name={`retail-stock:${productId}`}>{anchors}<DeliveredProductInstances id={delivered} transforms={transforms} capacity={capacity} /></group>;
  if (productId === "cannedCorn") return <group name="retail-stock:cannedCorn">
    {anchors}
    <StaticInstances transforms={transforms} capacity={capacity} castShadow><primitive object={cornTinGeometry} attach="geometry" /><primitive object={cornTinMaterial} attach="material" /></StaticInstances>
    <StaticInstances transforms={transforms} capacity={capacity}><primitive object={cornLabelGeometry} attach="geometry" /><primitive object={cornLabelMaterial} attach="material" /></StaticInstances>
  </group>;
  if (productId === "tomatoes") return <group name={`retail-stock:${productId}`}>
    {anchors}
    <StaticInstances transforms={transforms} capacity={capacity} component={TOMATO_BODY} castShadow><sphereGeometry args={[0.09, 14, 10]} /><meshStandardMaterial color="#d94838" roughness={0.78} /></StaticInstances>
    <StaticInstances transforms={transforms} capacity={capacity} component={TOMATO_CROWN}><coneGeometry args={[0.052, 0.045, 5]} /><meshStandardMaterial color="#37743e" roughness={0.9} /></StaticInstances>
  </group>;
  if (productId === "oranges") return <group name={`retail-stock:${productId}`}>
    {anchors}
    <StaticInstances transforms={transforms} capacity={capacity} component={ORANGE_BODY} castShadow><icosahedronGeometry args={[0.09, 1]} /><meshStandardMaterial color="#D58236" roughness={0.58} /></StaticInstances>
  </group>;
  if (productId === "apples") return <group name={`retail-stock:${productId}`}>
    {anchors}
    <StaticInstances transforms={transforms} capacity={capacity} component={APPLE_BODY} castShadow><sphereGeometry args={[0.085, 14, 10]} /><meshStandardMaterial color="#bd3432" roughness={0.72} /></StaticInstances>
    <StaticInstances transforms={transforms} capacity={capacity} component={APPLE_STEM}><cylinderGeometry args={[0.009, 0.012, 0.065, 6]} /><meshStandardMaterial color="#5b3c27" /></StaticInstances>
    <StaticInstances transforms={transforms} capacity={capacity} component={APPLE_LEAF}><sphereGeometry args={[0.045, 8, 5]} /><meshStandardMaterial color="#4e873f" roughness={0.9} /></StaticInstances>
  </group>;
  if (productId === "corn") return <group name={`retail-stock:${productId}`}>
    {anchors}
    <StaticInstances transforms={transforms} capacity={capacity} component={CORN_BODY} castShadow><sphereGeometry args={[0.075, 12, 8]} /><meshStandardMaterial color="#f0bf36" roughness={0.85} /></StaticInstances>
    <StaticInstances transforms={transforms} capacity={capacity} component={CORN_HUSK_LEFT}><sphereGeometry args={[0.082, 9, 6]} /><meshStandardMaterial color="#5d9348" roughness={0.95} /></StaticInstances>
    <StaticInstances transforms={transforms} capacity={capacity} component={CORN_HUSK_RIGHT}><sphereGeometry args={[0.082, 9, 6]} /><meshStandardMaterial color="#5d9348" roughness={0.95} /></StaticInstances>
  </group>;
  if (productId === "eggs") return <group name={`retail-stock:${productId}`}>
    {anchors}
    <StaticInstances transforms={transforms} capacity={capacity} component={EGG_BODY} castShadow><sphereGeometry args={[0.073, 12, 9]} /><meshStandardMaterial color="#f4e9d0" roughness={0.93} /></StaticInstances>
  </group>;
  if (productId === "milk" || productId === "juice") {
    const bottleColor = productId === "milk" ? "#f7f3e9" : "#ee8643";
    const accent = productId === "milk" ? "#4e91bc" : "#438653";
    const label = productId === "milk" ? "#5a9ec8" : "#fff0c6";
    return <group name={`retail-stock:${productId}`}>
      {anchors}
      <StaticInstances transforms={transforms} capacity={capacity} castShadow><cylinderGeometry args={[0.055, 0.064, 0.22, 10]} /><meshStandardMaterial color={bottleColor} roughness={0.58} /></StaticInstances>
      <StaticInstances transforms={transforms} capacity={capacity} component={BOTTLE_CAP}><cylinderGeometry args={[0.03, 0.034, 0.055, 9]} /><meshStandardMaterial color={accent} roughness={0.6} /></StaticInstances>
      <StaticInstances transforms={transforms} capacity={capacity} component={BOTTLE_LABEL}><planeGeometry args={[0.075, 0.09]} /><meshStandardMaterial color={label} /></StaticInstances>
    </group>;
  }
  if (productId === "cheese") return <group name={`retail-stock:${productId}`}>
    {anchors}
    <StaticInstances transforms={transforms} capacity={capacity} component={CHEESE_WEDGE} castShadow><cylinderGeometry args={[0.105, 0.105, 0.14, 3]} /><meshStandardMaterial color="#edbd3e" roughness={0.78} /></StaticInstances>
  </group>;
  if (productId === "bread") return <group name={`retail-stock:${productId}`}>
    {anchors}
    <StaticInstances transforms={transforms} capacity={capacity} castShadow><RoundedBoxGeometry args={[0.22, 0.16, 0.15]} radius={0.065} smoothness={3} /><meshStandardMaterial color="#b97336" roughness={0.9} /></StaticInstances>
    {[BREAD_SCORE_LEFT, BREAD_SCORE_MIDDLE, BREAD_SCORE_RIGHT].map((component, index) => <StaticInstances key={index} transforms={transforms} capacity={capacity} component={component}><boxGeometry args={[0.012, 0.06, 0.158]} /><meshStandardMaterial color="#e7bd75" /></StaticInstances>)}
  </group>;
  const packageColor = productId === "coffee" ? "#6b3d2d" : productId === "flour" ? "#eee4cc" : "#d5ab42";
  const labelColor = productId === "coffee" ? "#fff1d0" : "#765a34";
  return <group name={`retail-stock:${productId}`}>
    {anchors}
    <StaticInstances transforms={transforms} capacity={capacity} castShadow><RoundedBoxGeometry args={[0.17, 0.24, 0.12]} radius={0.022} smoothness={2} /><meshStandardMaterial color={packageColor} roughness={0.72} /></StaticInstances>
    <StaticInstances transforms={transforms} capacity={capacity} component={PACKAGE_LABEL}><planeGeometry args={[0.11, 0.075]} /><meshStandardMaterial color={labelColor} roughness={0.75} /></StaticInstances>
  </group>;
}

function AuthoritativeRetailStock({ productId, count }: { productId: ProductId; count: number }) {
  const visualCount = Math.min(RETAIL_VISUAL_CAPACITY[productId], Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)));
  const scale = productId === "eggs" || productId === "tomatoes" || productId === "oranges" || productId === "apples" || productId === "corn" ? 0.9 : 0.92;
  const transforms = useMemo<InstanceTransform[]>(() => Array.from({ length: visualCount }, (_, ordinal) => ({
    position: retailStockLandingLocalPosition(productId, ordinal, visualCount),
    rotation: productId === "tomatoes" || productId === "oranges" || productId === "apples" || productId === "corn" ? [PRODUCE_DECK.tilt, 0, 0] : undefined,
    scale: [scale, scale, scale],
  })), [productId, scale, visualCount]);
  return <RetailProductBatch productId={productId} transforms={transforms} capacity={RETAIL_VISUAL_CAPACITY[productId]} />;
}

function StoreElement({ position, yaw = 0, children }: { position: Position; yaw?: number; children: ReactNode }) {
  return <group position={scaleStorePosition(position)} rotation={[0, THREE.MathUtils.degToRad(yaw), 0]} scale={STORE_ELEMENT_SCALE}>{children}</group>;
}

type ProduceCounts = StockCounts;
const PRODUCE_PRODUCTS = RETAIL_DEPARTMENTS.produce.products;

/** Share of one produce table (stock or capacity) for every produce SKU. */
function produceFixtureCounts(source: (productId: ProductId) => number, fixtureIndex: number, fixtureCount: number): ProduceCounts {
  return Object.fromEntries(PRODUCE_PRODUCTS.map((productId) => [productId, distributedFixtureQuantity(source(productId), fixtureIndex, fixtureCount)]));
}

type EnvironmentFrameHandler = (model: THREE.Group, delta: number, elapsed: number) => void;
type EnvironmentUpdateHandler = (model: THREE.Group) => void;

export function EnvironmentModel({ id, onFrame, onUpdate, isolateMaterials = false }: { id: string; onFrame?: EnvironmentFrameHandler; onUpdate?: EnvironmentUpdateHandler; isolateMaterials?: boolean }) {
  const gltf = useGLTF(marketAsset(id).asset);
  const model = useMemo(() => {
    const copy = gltf.scene.clone(true);
    copy.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      if (isolateMaterials) {
        object.material = Array.isArray(object.material)
          ? object.material.map((material) => material.clone())
          : object.material.clone();
      }
    });
    return copy;
  }, [gltf.scene, isolateMaterials]);
  useEffect(() => {
    if (!isolateMaterials) return;
    return () => model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }, [isolateMaterials, model]);
  useEffect(() => onUpdate?.(model), [model, onUpdate]);
  const dynamic = Boolean(onFrame || onUpdate || isolateMaterials);
  return <group name={dynamic ? "dynamic:environment" : undefined}>{onFrame && <EnvironmentFrameDriver model={model} onFrame={onFrame} />}<primitive object={model} dispose={null} /></group>;
}

function EnvironmentFrameDriver({ model, onFrame }: { model: THREE.Group; onFrame: EnvironmentFrameHandler }) {
  useFrame(({ clock }, delta) => onFrame(model, delta, clock.elapsedTime));
  return null;
}

export const KitFurniture = memo(function KitFurniture({ shelves, shelfTier, machines, customers, checkoutTransactions, returnsBin, returnedCartCount, lightsOn, dynamicCeilingLights, unlockedAreas }: FurniturePresentationProps) {
  const root = useRef<THREE.Group>(null);
  const structureRevision = unlockedAreas.join("|");
  const machine = (id: string) => machines.find((candidate) => candidate.id === id);
  // Every fixture shows its own share of the store capacity of each SKU.
  const fixtureCapacity = (productId: ProductId, fixtureIndex = 0) => distributedFixtureQuantity(
    shelfCapacityForTier(shelfTier, productId, unlockedAreas),
    fixtureIndex,
    retailFixtureDisplayPositions(PRODUCT_RETAIL_DEPARTMENT[productId], unlockedAreas).length,
  );
  const coldDoorActive = customers.some((customer) => ["WAIT_FOR_ACCESS", "PICK_PRODUCT"].includes(customer.state) && ["milk", "cheese"].includes(customer.shoppingList[customer.currentLine]?.productId ?? ""));
  const activeCheckouts = useMemo(() => [activeCheckoutForLane(checkoutTransactions, 0), activeCheckoutForLane(checkoutTransactions, 1)] as const, [checkoutTransactions]);
  const checkoutHandoffs = useMemo(() => [checkoutHandoffForLane(checkoutTransactions, 0, customers), checkoutHandoffForLane(checkoutTransactions, 1, customers)] as const, [checkoutTransactions, customers]);
  const checkoutHandoffLocations = useMemo(() => [checkoutBagLocation(checkoutHandoffs[0], customers), checkoutBagLocation(checkoutHandoffs[1], customers)] as const, [checkoutHandoffs, customers]);
  useEffect(() => {
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    if (qaWindow.__MARKET_QA__) {
      qaWindow.__MARKET_QA__.checkoutPresentation = activeCheckouts.map((transaction) => transaction?.id ?? null);
      qaWindow.__MARKET_QA__.checkoutHandoffPresentation = checkoutHandoffs.map((transaction) => transaction?.id ?? null);
      qaWindow.__MARKET_QA__.checkoutBagPresentation = checkoutHandoffLocations.map((location, lane) => location ?? (activeCheckouts[lane] ? "counter" : null));
      qaWindow.__MARKET_QA__.retailColdDoorActive = coldDoorActive;
    }
  }, [activeCheckouts, checkoutHandoffs, checkoutHandoffLocations, coldDoorActive]);
  return <group ref={root}>
    {fixtureAvailable("fixture:retail-preserves-1", unlockedAreas) && <StoreElement position={retailDisplayPosition("preserves")} yaw={RETAIL_DEPARTMENTS.preserves.yaw}><MemoGondola position={[0, 0, 0]} productId="cannedCorn" count={shelves.cannedCorn} capacity={fixtureCapacity("cannedCorn")} /></StoreElement>}
    {fixtureAvailable("fixture:retail-bakery-1", unlockedAreas) && (<StoreElement position={retailDisplayPosition("bakery")} yaw={RETAIL_DEPARTMENTS.bakery.yaw}><MemoBakeryDisplay stock={{ bread: shelves.bread, flour: shelves.flour, wheat: shelves.wheat }} capacity={{ bread: fixtureCapacity("bread"), flour: fixtureCapacity("flour"), wheat: fixtureCapacity("wheat") }} /></StoreElement>)}
    {fixtureAvailable("fixture:retail-pantry-1", unlockedAreas) && (PANTRY_DISPLAY_POSITIONS.map((position, index) => <StoreElement key={`pantry-${index}`} position={[...position]} yaw={RETAIL_DEPARTMENTS.pantry.yaw}><MemoGondola position={[0, 0, 0]} count={distributedFixtureQuantity(shelves.coffee, index, PANTRY_DISPLAY_POSITIONS.length)} capacity={fixtureCapacity("coffee", index)} /></StoreElement>))}
    {fixtureAvailable("fixture:retail-eggs-1", unlockedAreas) && (<StoreElement position={retailDisplayPosition("eggs")} yaw={RETAIL_DEPARTMENTS.eggs.yaw}><MemoEggDisplay count={shelves.eggs} capacity={fixtureCapacity("eggs")} /></StoreElement>)}
    {retailFixtureDisplayPositions("produce", unlockedAreas).map((position, index, fixtures) => <StoreElement key={`produce-${index}`} position={[...position]} yaw={RETAIL_DEPARTMENTS.produce.yaw}><MemoProduceTable position={[0, 0, 0]} stock={produceFixtureCounts((productId) => shelves[productId], index, fixtures.length)} capacity={produceFixtureCounts((productId) => shelfCapacityForTier(shelfTier, productId, unlockedAreas), index, fixtures.length)} /></StoreElement>)}
    {fixtureAvailable("fixture:retail-dairy-1", unlockedAreas) && (<StoreElement position={retailDisplayPosition("dairy")} yaw={RETAIL_DEPARTMENTS.dairy.yaw}><MemoChilledDisplay position={[0, 0, 0]} stock={{ milk: shelves.milk, cheese: shelves.cheese }} capacity={{ milk: fixtureCapacity("milk"), cheese: fixtureCapacity("cheese") }} open={coldDoorActive} /></StoreElement>)}
    {fixtureAvailable("fixture:retail-drinks-1", unlockedAreas) && (<StoreElement position={retailDisplayPosition("drinks")} yaw={RETAIL_DEPARTMENTS.drinks.yaw}><MemoDrinksDisplay position={[0, 0, 0]} count={shelves.juice} capacity={fixtureCapacity("juice")} /></StoreElement>)}
    <StoreElement position={[...CHECKOUT_LANES[0].counter]}><MemoCheckoutKit position={[0, 0, 0]} lane={0} transaction={activeCheckouts[0]} handoffTransaction={checkoutHandoffs[0]} handoffBagAtCounter={checkoutHandoffLocations[0] === "counter"} /></StoreElement>
    <StoreElement position={[...CHECKOUT_LANES[0].cashierWork]}><MemoCashierWorkArea /></StoreElement>
    {unlockedAreas.includes("checkout-2")
      ? <><StoreElement position={[...CHECKOUT_LANES[1].counter]}><MemoCheckoutKit position={[0, 0, 0]} lane={1} transaction={activeCheckouts[1]} handoffTransaction={checkoutHandoffs[1]} handoffBagAtCounter={checkoutHandoffLocations[1] === "counter"} /></StoreElement><StoreElement position={[...CHECKOUT_LANES[1].cashierWork]}><MemoCashierWorkArea /></StoreElement></>
      : !unlockedAreas.includes("purchase-campaign") && <StoreElement position={[...CHECKOUT_LANES[1].counter]}><MemoClosedCheckoutKit lane={1} /></StoreElement>}
    <StoreElement position={[...STORE_SERVICE_FIXTURES.returns.position]}><MemoReturnsCubicle inventory={returnsBin} /></StoreElement>
    <StoreElement position={[...STORE_SERVICE_FIXTURES.cartBay.position]}><MemoCartBay position={[0, 0, 0]} count={returnedCartCount} /></StoreElement>
    {fixtureAvailable("fixture:production-cubicle-shell", unlockedAreas) && (<MemoProductionBakeryCubicle />)}
    {fixtureAvailable("fixture:bread-oven", unlockedAreas) && (<StoreElement position={[...STORE_PRODUCTION_FIXTURES.breadOven.position]}><MemoBakeryKit position={[0, 0, 0]} machine={machine("bread-oven-1")} /></StoreElement>)}
    {fixtureAvailable("fixture:flour-mill", unlockedAreas) && (<StoreElement position={[...STORE_PRODUCTION_FIXTURES.flourMill.position]}><MemoMillMachine position={[0, 0, 0]} machine={machine("flour-mill-1")} /></StoreElement>)}
    {fixtureAvailable("fixture:cheese-maker", unlockedAreas) && (<StoreElement position={[...STORE_PRODUCTION_FIXTURES.cheeseMaker.position]}><MemoProcessMachine kind="cheese" machine={machine("cheese-maker-1")} /></StoreElement>)}
    {fixtureAvailable("fixture:juice-machine", unlockedAreas) && (<StoreElement position={[...STORE_PRODUCTION_FIXTURES.juiceMachine.position]}><MemoProcessMachine kind="juice" machine={machine("juice-machine-1")} /></StoreElement>)}
    {fixtureAvailable("fixture:corn-canner", unlockedAreas) && <StoreElement position={[...STORE_PRODUCTION_FIXTURES.cornCanner.position]}><CornCanner machine={machine("corn-canner-1")} /></StoreElement>}
    <StoreElement position={[...STORE_SERVICE_FIXTURES.orders.position]}><MemoSupplierCorner position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[...WAREHOUSE_RETURN_STATION.position]}><MemoWarehouseReturnBasket /></StoreElement>
    <MemoStoreUtilities lightsOn={lightsOn} dynamicCeilingLights={dynamicCeilingLights} />
    {/* Last child: its effect runs after every sibling placed its instances. */}
    <StaticBatchOptimizer rootRef={root} structureRevision={structureRevision} />
  </group>;
}, sameFurniturePresentation);

/**
 * Structural prop equality for fixture components. World ticks structured-
 * clone the save, so `machine`, `transaction` and `inventory` objects change
 * identity every 200 ms while their content rarely does, and inline
 * `position` arrays are recreated on every render. Comparing by value keeps a
 * stock change or a checkout scan from re-rendering every other department.
 */
function sameFixtureProps(previous: Record<string, unknown>, next: Record<string, unknown>) {
  const keys = Object.keys(previous);
  if (keys.length !== Object.keys(next).length) return false;
  return keys.every((key) => sameFixtureValue(previous[key], next[key]));
}

function sameFixtureValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameFixtureValue(value, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    return leftKeys.every((key) => sameFixtureValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
  }
  return false;
}

const MemoBakeryDisplay = memo(BakeryDisplay, sameFixtureProps);
const MemoGondola = memo(Gondola, sameFixtureProps);
const MemoEggDisplay = memo(EggDisplay, sameFixtureProps);
const MemoProduceTable = memo(ProduceTable, sameFixtureProps);
const MemoChilledDisplay = memo(ChilledDisplay, sameFixtureProps);
const MemoDrinksDisplay = memo(DrinksDisplay, sameFixtureProps);
const MemoCheckoutKit = memo(CheckoutKit, sameFixtureProps);
const MemoCashierWorkArea = memo(CashierWorkArea, sameFixtureProps);
const MemoClosedCheckoutKit = memo(ClosedCheckoutKit, sameFixtureProps);
const MemoReturnsCubicle = memo(ReturnsCubicle, sameFixtureProps);
const MemoCartBay = memo(CartBay, sameFixtureProps);
const MemoProductionBakeryCubicle = memo(ProductionBakeryCubicle, sameFixtureProps);
const MemoBakeryKit = memo(BakeryKit, sameFixtureProps);
const MemoMillMachine = memo(MillMachine, sameFixtureProps);
const MemoProcessMachine = memo(ProcessMachine, sameFixtureProps);
const MemoSupplierCorner = memo(SupplierCorner, sameFixtureProps);
const MemoTerminalModel = memo(TerminalModel, sameFixtureProps);
const MemoStoreUtilities = memo(StoreUtilities, sameFixtureProps);
const MemoWarehouseReturnBasket = memo(WarehouseReturnBasket, sameFixtureProps);
// Farm: a harvest changes one plot; the other plots, paddocks and props keep
// their trees instead of reconciling the whole garden in the same task.
const MemoGardenFloor = memo(GardenFloor, sameFixtureProps);
const MemoDormantCropPlot = memo(DormantCropPlot, sameFixtureProps);
const MemoCropPlot = memo(CropPlot, sameFixtureProps);
const MemoFarmTools = memo(FarmTools, sameFixtureProps);
const MemoCompostBin = memo(CompostBin, sameFixtureProps);
const MemoMiniGreenhouse = memo(MiniGreenhouse, sameFixtureProps);
const MemoScarecrow = memo(Scarecrow, sameFixtureProps);
const MemoFarmWaterTank = memo(FarmWaterTank, sameFixtureProps);
const MemoAnimalPaddock = memo(AnimalPaddock, sameFixtureProps);
const MemoAnimalStation = memo(AnimalStation, sameFixtureProps);

const PRODUCTS_LABELS: Record<ProductId, string> = {
  cannedCorn: "MAÍZ EN LATA",
  tomatoes: "TOMATES",
  apples: "MANZANAS",
  oranges: "NARANJAS",
  corn: "MAÍZ",
  eggs: "HUEVOS",
  milk: "LECHE",
  cheese: "QUESO",
  juice: "ZUMOS",
  bread: "PAN",
  flour: "HARINA",
  wheat: "TRIGO",
  coffee: "CAFÉ",
};

function FixtureUprights({ width, height, z = -0.34 }: { width: number; height: number; z?: number }) {
  const posts = useMemo<InstanceTransform[]>(() => [-1, 1].flatMap((side) => [z - 0.03, z + 0.09].map((postZ) => ({
    position: [side * (width / 2 - 0.055), height / 2, postZ],
    scale: [0.07, height, 0.07],
  }))), [height, width, z]);
  return <StaticInstances transforms={posts} castShadow receiveShadow>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color={palette.fixtureSteel} metalness={0.58} roughness={0.34} />
  </StaticInstances>;
}

function CommercialShelfBank({ levels, width, depth, z = 0, front = 1, accent }: { levels: readonly number[]; width: number; depth: number; z?: number; front?: -1 | 1; accent: string }) {
  const decks = useMemo<InstanceTransform[]>(() => levels.map((y) => ({ position: [0, y, z], scale: [width, 0.065, depth] })), [depth, levels, width, z]);
  const lips = useMemo<InstanceTransform[]>(() => levels.map((y) => ({ position: [0, y + 0.025, z + front * (depth / 2 - 0.006)], scale: [width + 0.035, 0.105, 0.035] })), [depth, front, levels, width, z]);
  const accents = useMemo<InstanceTransform[]>(() => levels.map((y) => ({ position: [0, y + 0.075, z + front * (depth / 2 + 0.017)], scale: [width * 0.92, 0.062, 0.018] })), [depth, front, levels, width, z]);
  const tags = useMemo<InstanceTransform[]>(() => levels.flatMap((y) => [-0.31, 0, 0.31].map((offset) => ({ position: [offset * width, y + 0.075, z + front * (depth / 2 + 0.029)], scale: [0.25, 0.055, 0.012] }))), [depth, front, levels, width, z]);
  return <group>
    <StaticInstances transforms={decks} receiveShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={palette.shelf} roughness={0.66} /></StaticInstances>
    <StaticInstances transforms={lips} castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={palette.fixtureSteel} metalness={0.45} roughness={0.36} /></StaticInstances>
    <StaticInstances transforms={accents}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={accent} roughness={0.5} /></StaticInstances>
    <StaticInstances transforms={tags}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#fff8e7" roughness={0.78} /></StaticInstances>
  </group>;
}

function CommercialBackPanel({ width, height, z, color = "#c5cac7" }: { width: number; height: number; z: number; color?: string }) {
  const slats = useMemo<InstanceTransform[]>(() => Array.from({ length: 7 }, (_, index) => ({
    position: [0, 0.22 + index * Math.max(0.2, (height - 0.34) / 6), z + 0.042],
    scale: [width * 0.86, 0.012, 0.012],
  })), [height, width, z]);
  return <group>
    <Box args={[width, height, 0.075]} position={[0, height / 2, z]} color={color} radius={0.018} />
    <StaticInstances transforms={slats}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#747d79" metalness={0.38} roughness={0.42} /></StaticInstances>
  </group>;
}

function Gondola({ position, count, capacity, productId = "coffee" }: { position: Position; count: number; capacity: number; productId?: "coffee" | "cannedCorn" }) {
  const department = RETAIL_DEPARTMENTS[PRODUCT_RETAIL_DEPARTMENT[productId]];
  const accent = department.color;
  // Fill the service-facing side first so the visible stock and its proximity
  // magnet share one face of the gondola at low inventory.
  const sides = [1, -1] as const;
  return <group name={`retail-department:${department.id}`} position={position}>
    <Box args={[2.24, 0.16, 1.12]} position={[0, 0.08, 0]} color={palette.fixtureSteel} radius={0.035} />
    <CommercialBackPanel width={2.08} height={1.82} z={0} color="#b69a77" />
    <FixtureUprights width={2.18} height={1.92} z={0} />
    {sides.map((side) => <CommercialShelfBank key={side} levels={RETAIL_FIXTURE_LEVELS.pantry} width={2.08} depth={0.52} z={side * 0.28} front={side} accent={accent} />)}
    <AuthoritativeRetailStock productId={productId} count={count} />
    <Box args={[2.3, 0.14, 1.08]} position={[0, 1.88, 0]} color={palette.fixtureSteel} radius={0.03} />
    <ScreenRail barY={1.95} railY={2.43} halfWidth={1.1} z={0.12} />
    <StockScreen productId={productId} count={count} capacity={capacity} position={[0, 2.9, 0.12]} fixtureYaw={department.yaw} />
    <DepartmentSign label={department.label} color={accent} position={[0, 2.15, 0]} width={2.02} />
  </group>;
}

function BakeryDisplay({ stock, capacity }: { stock: StockCounts; capacity: StockCounts }) {
  const levels = RETAIL_FIXTURE_LEVELS.bakery;
  const yaw = RETAIL_DEPARTMENTS.bakery.yaw;
  return <group name="retail-department:bakery">
    <Box args={[2.24, 0.16, 0.78]} position={[0, 0.08, -0.11]} color={palette.fixtureSteel} radius={0.035} />
    <CommercialBackPanel width={2.08} height={1.9} z={-0.34} color="#d8c3a2" />
    <FixtureUprights width={2.18} height={2} z={-0.34} />
    <CommercialShelfBank levels={levels} width={2.08} depth={0.52} z={0.02} front={1} accent={RETAIL_DEPARTMENTS.bakery.color} />
    <AuthoritativeRetailStock productId="bread" count={stock.bread ?? 0} />
    <AuthoritativeRetailStock productId="flour" count={stock.flour ?? 0} />
    <AuthoritativeRetailStock productId="wheat" count={stock.wheat ?? 0} />
    <ScreenRail barY={2.05} railY={2.52} halfWidth={1.12} z={0.1} />
    <StockScreen productId="bread" count={stock.bread ?? 0} capacity={capacity.bread ?? 0} position={[-0.78, 2.99, 0.1]} fixtureYaw={yaw} />
    <StockScreen productId="flour" count={stock.flour ?? 0} capacity={capacity.flour ?? 0} position={[0, 2.99, 0.1]} fixtureYaw={yaw} />
    <StockScreen productId="wheat" count={stock.wheat ?? 0} capacity={capacity.wheat ?? 0} position={[0.78, 2.99, 0.1]} fixtureYaw={yaw} />
    <Box args={[2.3, 0.14, 0.78]} position={[0, 1.98, -0.1]} color={palette.fixtureSteel} radius={0.03} />
    <DepartmentSign label={RETAIL_DEPARTMENTS.bakery.label} color={RETAIL_DEPARTMENTS.bakery.color} position={[0, 2.25, 0.08]} width={2.02} />
  </group>;
}

/** Produce table seen from the isometric camera at +x/+z: four tilted bins,
 * one per SKU, each headed by its own slot sign at the back of the table so
 * nothing stands between the camera and the units on the deck. The department
 * header hangs above the signs on the same rear rail. */
function ProduceTable({ position, stock, capacity }: { position: Position; stock: ProduceCounts; capacity: ProduceCounts }) {
  const deckTilt: Position = [PRODUCE_DECK.tilt, 0, 0];
  const legs = useMemo<InstanceTransform[]>(() => [-1.08, 1.08].flatMap((x) => [-0.58, 0.58].map((z) => ({ position: [x, 0.39, z], scale: [0.09, 0.7, 0.09] }))), []);
  const decks = useMemo<InstanceTransform[]>(() => PRODUCE_BIN_COLUMNS.map((x) => ({ position: [x, PRODUCE_DECK.center[1], PRODUCE_DECK.center[2]], rotation: [PRODUCE_DECK.tilt, 0, 0], scale: [PRODUCE_DECK.width, PRODUCE_DECK.thickness, PRODUCE_DECK.depth] })), []);
  const dividers = useMemo<InstanceTransform[]>(() => [-2, -1, 0, 1, 2].map((slot) => ({ position: produceDeckLocalPoint(slot * PRODUCE_BIN_PITCH, 0.1, 0), rotation: [PRODUCE_DECK.tilt, 0, 0], scale: [0.03, 0.2, PRODUCE_DECK.depth + 0.04] })), []);
  const signPosts = useMemo<InstanceTransform[]>(() => PRODUCE_BIN_COLUMNS.map((x) => ({ position: [x, 1.12, -0.68], scale: [0.045, 0.54, 0.045] })), []);
  const headerPosts = useMemo<InstanceTransform[]>(() => [-1.1, 1.1].map((x) => ({ position: [x, 1.52, -0.7], scale: [0.055, 1.7, 0.055] })), []);
  return <group name="retail-department:produce" position={position}>
    <Box args={[2.42, 0.12, 1.5]} position={[0, 0.08, 0]} color={palette.fixtureSteel} radius={0.035} />
    <StaticInstances transforms={legs} castShadow><RoundedBoxGeometry args={[1, 1, 1]} radius={0.1} smoothness={2} /><meshStandardMaterial color={palette.fixtureSteel} metalness={0.34} roughness={0.42} /></StaticInstances>
    <Box args={[2.28, 0.54, 1.34]} position={[0, 0.43, 0]} color={palette.wood} radius={0.055} />
    <StaticInstances transforms={decks} receiveShadow><RoundedBoxGeometry args={[1, 1, 1]} radius={0.06} smoothness={2} /><meshStandardMaterial color={palette.fixtureSteel} metalness={0.3} roughness={0.44} /></StaticInstances>
    <StaticInstances transforms={dividers}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#6e482d" roughness={0.9} /></StaticInstances>
    <Box args={[2.32, 0.07, 0.035]} position={produceDeckLocalPoint(0, 0.055, 0.585)} rotation={deckTilt} color="#6e482d" radius={0.012} />
    <Box args={[2.32, 0.17, 0.035]} position={produceDeckLocalPoint(0, 0.1, -0.6)} rotation={deckTilt} color="#6e482d" radius={0.012} />
    {PRODUCE_PRODUCTS.map((productId) => <AuthoritativeRetailStock key={productId} productId={productId} count={stock[productId] ?? 0} />)}
    <StaticInstances transforms={signPosts} castShadow><RoundedBoxGeometry args={[1, 1, 1]} radius={0.08} smoothness={2} /><meshStandardMaterial color={palette.fixtureSteel} metalness={0.34} roughness={0.42} /></StaticInstances>
    {PRODUCE_PRODUCTS.map((productId, index) => <ProduceSlotSign key={productId} productId={productId} x={PRODUCE_BIN_COLUMNS[index]} count={stock[productId] ?? 0} capacity={capacity[productId] ?? 0} />)}
    <StaticInstances transforms={headerPosts} castShadow><RoundedBoxGeometry args={[1, 1, 1]} radius={0.08} smoothness={2} /><meshStandardMaterial color={palette.fixtureSteel} metalness={0.34} roughness={0.42} /></StaticInstances>
    <Box args={[2.3, 0.12, 0.08]} position={[0, 2.36, -0.7]} color={palette.fixtureSteel} radius={0.025} />
    <DepartmentSign label={RETAIL_DEPARTMENTS.produce.label} color={RETAIL_DEPARTMENTS.produce.color} position={[0, 2.33, -0.64]} width={2.2} />
  </group>;
}

/** Slot sign of one produce bin: a replica of the SKU, its name, the exact
 * units on this table over the table's share of the shelf capacity, and how
 * many are still missing. Only the counter texts change at runtime. */
function ProduceSlotSign({ productId, x, count, capacity }: { productId: ProductId; x: number; count: number; capacity: number }) {
  const missing = Math.max(0, capacity - count);
  const full = capacity > 0 && missing === 0;
  return <group name={`retail-slot-sign:${productId}`} position={[x, 1.69, -0.66]}>
    <Box args={[0.56, 0.7, 0.05]} position={[0, 0, -0.02]} color={palette.frame} radius={0.04} />
    <Box args={[0.52, 0.66, 0.06]} color={RETAIL_DEPARTMENTS.produce.color} radius={0.035} />
    <Box args={[0.46, 0.3, 0.02]} position={[0, -0.15, 0.035]} color="#fbf5e6" radius={0.02} />
    <group name={`retail-product:${productId}`} position={[0, 0.215, 0.07]}><BasketProduct productId={productId} scale={1.05} /></group>
    <Text position={[0, 0.06, 0.036]} fontSize={0.064} color="#fffaf0" anchorX="center" anchorY="middle" fontWeight={800}>{PRODUCTS_LABELS[productId]}</Text>
    <group name="dynamic:produce-sign">
      <Text position={[0, -0.09, 0.05]} fontSize={0.12} color="#24402c" anchorX="center" anchorY="middle" fontWeight={800}>{`${count}/${capacity}`}</Text>
      <Text position={[0, -0.235, 0.05]} fontSize={0.08} color={full ? "#2f7d3a" : "#b8641a"} anchorX="center" anchorY="middle" fontWeight={800}>{full ? "LLENO" : `faltan ${missing}`}</Text>
    </group>
  </group>;
}

function ChilledDisplay({ position, stock, capacity, open }: { position: Position; stock: StockCounts; capacity: StockCounts; open: boolean }) {
  return <group name="retail-department:dairy" position={position}>
    <DeliveredDairy open={open} />
    <AuthoritativeRetailStock productId="milk" count={stock.milk ?? 0} />
    <AuthoritativeRetailStock productId="cheese" count={stock.cheese ?? 0} />
    <DepartmentSign label={RETAIL_DEPARTMENTS.dairy.label} color={RETAIL_DEPARTMENTS.dairy.color} position={[0, 1.86, 0.08]} width={2.02} />
    <ScreenRail barY={1.58} railY={2.12} halfWidth={1.12} z={0.1} />
    <StockScreen productId="milk" count={stock.milk ?? 0} capacity={capacity.milk ?? 0} position={[-0.55, 2.58, 0.1]} fixtureYaw={RETAIL_DEPARTMENTS.dairy.yaw} />
    <StockScreen productId="cheese" count={stock.cheese ?? 0} capacity={capacity.cheese ?? 0} position={[0.55, 2.58, 0.1]} fixtureYaw={RETAIL_DEPARTMENTS.dairy.yaw} />
  </group>;
}

function DrinksDisplay({ position, count, capacity }: { position: Position; count: number; capacity: number }) {
  const levels = RETAIL_FIXTURE_LEVELS.drinks;
  return <group name="retail-department:drinks" position={position}>
    <Box args={[2.3, 0.17, 0.9]} position={[0, 0.085, 0]} color={palette.fixtureSteel} radius={0.04} />
    <CommercialBackPanel width={2.2} height={2.08} z={-0.36} color="#d8d3c6" />
    <FixtureUprights width={2.28} height={2.2} z={-0.31} />
    <CommercialShelfBank levels={levels} width={2.13} depth={0.67} front={1} accent={RETAIL_DEPARTMENTS.drinks.color} />
    <AuthoritativeRetailStock productId="juice" count={count} />
    <Box args={[2.38, 0.18, 0.92]} position={[0, 2.18, 0]} color={palette.fixtureSteel} radius={0.04} />
    <ScreenRail barY={2.27} railY={2.7} halfWidth={1.12} z={0.1} />
    <StockScreen productId="juice" count={count} capacity={capacity} position={[0, 3.14, 0.1]} fixtureYaw={RETAIL_DEPARTMENTS.drinks.yaw} />
    <DepartmentSign label={RETAIL_DEPARTMENTS.drinks.label} color={RETAIL_DEPARTMENTS.drinks.color} position={[0, 2.42, 0.07]} width={2} />
  </group>;
}

function EggDisplay({ count, capacity }: { count: number; capacity: number }) {
  return <group name="retail-department:eggs">
    <DeliveredModel id="egg-display" />
    <AuthoritativeRetailStock productId="eggs" count={count} />
    <ScreenRail barY={2.1} railY={2.36} halfWidth={0.73} z={0.1} />
    <StockScreen productId="eggs" count={count} capacity={capacity} position={[0, 2.83, 0.1]} fixtureYaw={RETAIL_DEPARTMENTS.eggs.yaw} />
  </group>;
}

function CheckoutKit({ position, lane, transaction, handoffTransaction, handoffBagAtCounter }: { position: Position; lane: 0 | 1; transaction?: CheckoutTransaction; handoffTransaction?: CheckoutTransaction; handoffBagAtCounter: boolean }) {
  const scanning = transaction?.state === "SCANNING" || transaction?.state === "BAGGING";
  const bagged = transaction?.pendingItems.reduce((total, line) => total + line.bagged, 0) ?? 0;
  const total = transaction?.pendingItems.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
  const handoffBagged = handoffTransaction?.pendingItems.reduce((sum, line) => sum + line.bagged, 0) ?? 0;
  const handoffTotal = handoffTransaction?.pendingItems.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
  const hasSeparateHandoffBag = Boolean(handoffTransaction && handoffBagAtCounter);
  const units = transaction?.pendingItems.flatMap((line) => Array.from({ length: line.quantity }, (_, unit) => ({
    productId: line.productId,
    loaded: unit < line.loaded,
    scanned: unit < line.scanned,
    bagged: unit < line.bagged,
  }))) ?? [];
  return <group name="dynamic:checkout" position={position}>
    <pointLight position={[0, 2.7, -1.7]} color="#fff0d2" intensity={0.72} distance={5.8} decay={1.7} />
    <Box args={[4.45, 0.92, 1.18]} position={[0, 0.46, 0]} color={palette.darkGreen} radius={0.14} />
    <Box args={[4.24, 0.16, 1.08]} position={[0, 0.98, 0]} color="#d8dedb" radius={0.09} />
    <Box args={[2.55, 0.08, 0.82]} position={[-0.66, 1.08, 0]} color="#252d2b" radius={0.035} />
    {Array.from({ length: 9 }, (_, index) => <mesh key={`belt-${index}`} position={[-1.7 + index * 0.28, 1.125, 0]}><boxGeometry args={[0.025, 0.018, 0.78]} /><meshStandardMaterial color="#68726f" metalness={0.35} roughness={0.48} /></mesh>)}
    <Box args={[0.52, 0.11, 0.94]} position={[0.64, 1.1, 0]} color="#1f2a27" radius={0.035} />
    <mesh position={[0.64, 1.165, 0]}><boxGeometry args={[0.27, 0.018, 0.57]} /><meshStandardMaterial color="#8fe8c5" emissive={scanning ? "#60ffbd" : "#2d6553"} emissiveIntensity={scanning ? 2.2 : 0.5} /></mesh>
    {scanning && <pointLight position={[0.64, 1.35, 0]} color="#64ffc2" intensity={1.4} distance={1.4} />}
    <Box args={[0.86, 0.18, 0.62]} position={[1.28, 1.13, -0.18]} color="#24302d" radius={0.08} />
    <mesh position={[1.28, 1.61, -0.13]} rotation={[-0.23, 0, 0]}><boxGeometry args={[0.72, 0.62, 0.1]} /><meshStandardMaterial color="#25322f" roughness={0.42} /></mesh>
    <mesh position={[1.28, 1.62, -0.07]} rotation={[-0.23, 0, 0]}><planeGeometry args={[0.56, 0.42]} /><meshStandardMaterial color="#bde9d8" emissive={transaction ? "#4d9b80" : "#27463d"} emissiveIntensity={0.8} /></mesh>
    <Text position={[1.28, 1.63, -0.01]} rotation={[-0.23, 0, 0]} fontSize={0.11} color="#173f35" anchorX="center">{transaction ? `${bagged}/${total}` : "LISTA"}</Text>
    <Box args={[0.32, 0.13, 0.5]} position={[1.78, 1.16, 0.24]} color="#e8ece7" radius={0.055} />
    <mesh position={[1.78, 1.26, 0.26]} rotation={[-0.42, 0, 0]}><planeGeometry args={[0.21, 0.18]} /><meshStandardMaterial color={transaction?.state === "PAYMENT" ? "#91f2be" : "#77948a"} emissive="#42a776" emissiveIntensity={transaction?.state === "PAYMENT" ? 1.4 : 0.18} /></mesh>
    <Box args={[0.92, 0.5, 0.82]} position={[1.67, 0.48, 0]} color="#eff1e8" radius={0.09} />
    {transaction && <CheckoutBag fill={total ? bagged / total : 0} position={hasSeparateHandoffBag ? [1.34, 1.02, 0.24] : undefined} />}
    {hasSeparateHandoffBag && <CheckoutBag fill={handoffTotal ? handoffBagged / handoffTotal : 1} position={transaction ? [1.94, 1.02, -0.24] : undefined} />}
    {!transaction && !handoffTransaction && <CheckoutBag fill={0} />}
    {units.map((unit, index) => unit.loaded && !unit.bagged ? <CheckoutProductUnit key={`${unit.productId}-${index}`} productId={unit.productId} index={index} scanned={unit.scanned} /> : null)}
    <mesh position={[-1.55, 2.32, -0.48]}><boxGeometry args={[0.06, 2.35, 0.06]} /><meshStandardMaterial color="#4b5b56" metalness={0.4} /></mesh>
    <mesh position={[-1.55, 3.08, -0.44]}><boxGeometry args={[0.98, 0.58, 0.12]} /><meshStandardMaterial color="#f4e4ad" roughness={0.55} /></mesh>
    <Text position={[-1.55, 3.09, -0.36]} fontSize={0.24} color="#24453d" anchorX="center">CAJA {lane + 1}</Text>
  </group>;
}

function ClosedCheckoutKit({ lane }: { lane: 0 | 1 }) {
  return <group name="fixture:closed-checkout">
    <Box args={[4.45, 0.92, 1.18]} position={[0, 0.46, 0]} color={palette.darkGreen} radius={0.14} />
    <Box args={[4.24, 0.16, 1.08]} position={[0, 0.98, 0]} color="#d8dedb" radius={0.09} />
    <Box args={[3.72, 0.13, 0.42]} position={[0, 1.1, 0]} color="#26332f" radius={0.045} />
    <Box args={[1.74, 0.46, 0.08]} position={[0, 1.48, 0.04]} color="#f1dfad" radius={0.055} />
    <Text position={[0, 1.48, 0.085]} fontSize={0.15} color="#315044" anchorX="center" anchorY="middle" fontWeight={800}>CAJA {lane + 1} · CERRADA</Text>
  </group>;
}

function CheckoutProductUnit({ productId, index, scanned }: { productId: ProductId; index: number; scanned: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const target = useMemo(() => new THREE.Vector3(scanned ? 1.48 : Math.min(0.15, -1.66 + index * 0.29), scanned ? 1.38 : 1.25, scanned ? 0.18 : 0), [index, scanned]);
  useFrame((_, delta) => { if (ref.current) ref.current.position.lerp(target, 1 - Math.exp(-8 * delta)); });
  return <group ref={ref} position={[-2.05, 1.45, 0.42]}><RetailProduct productId={productId} position={[0, 0, 0]} scale={1.18} /></group>;
}

function CheckoutBag({ fill, position = [1.67, 1.02, 0] }: { fill: number; position?: Position }) {
  return <group position={position} scale={[1, 0.72 + fill * 0.28, 1]}>
    <mesh><boxGeometry args={[0.56, 0.72, 0.42]} /><meshStandardMaterial color="#c7935e" roughness={0.92} /></mesh>
    <mesh position={[0, 0.41, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.18, 0.025, 7, 16, Math.PI]} /><meshStandardMaterial color="#8b623d" /></mesh>
    {fill > 0 && <mesh position={[0, 0.26, 0]}><boxGeometry args={[0.4, 0.12, 0.3]} /><meshStandardMaterial color="#e0b44a" /></mesh>}
  </group>;
}

function CashierWorkArea() {
  return <group>
    <Box args={[1.34, 0.045, 0.9]} position={[0, 0.022, 0]} color="#293532" radius={0.12} />
    {[-0.42, -0.21, 0, 0.21, 0.42].map((x) => <mesh key={x} position={[x, 0.049, 0]}><boxGeometry args={[0.035, 0.012, 0.68]} /><meshStandardMaterial color="#4a5b56" roughness={0.9} /></mesh>)}
  </group>;
}

function ReturnsCubicle({ inventory }: { inventory: Inventory }) {
  const units = (Object.entries(inventory) as [ProductId, number][]).flatMap(([productId, quantity]) => Array.from({ length: Math.min(6, quantity) }, () => productId)).slice(0, 6);
  return <group name="fixture:returns" rotation={[0, Math.PI, 0]}>
    <Box args={[1.35, 1.25, 1.05]} position={[0, 0.63, 0]} color="#d5c3aa" radius={0.08} />
    <Box args={[1.05, 0.72, 0.82]} position={[0, 0.86, 0.04]} color="#735847" radius={0.06} />
    <mesh position={[0, 1.31, 0.54]}><boxGeometry args={[1.42, 0.34, 0.08]} /><meshStandardMaterial color="#e7bb62" /></mesh>
    <Text position={[0, 1.31, 0.59]} fontSize={0.15} color="#493821" anchorX="center">DEVOLUCIONES</Text>
    {units.map((productId, index) => <RetailProduct key={`${productId}-${index}`} productId={productId} position={[(index % 3 - 1) * 0.24, 0.62 + Math.floor(index / 3) * 0.2, 0.48]} />)}
  </group>;
}

function CartBay({ position, count }: { position: Position; count: number }) {
  return <group name="fixture:cart-bay" position={position}>
    <Box args={[2.1, 0.07, 1.45]} position={[0, 0.035, 0]} color="#596864" radius={0.022} />
    {[-0.96, 0.96].map((x) => <group key={x}>
      <Box args={[0.075, 1.34, 1.45]} position={[x, 0.67, 0]} color="#53645f" radius={0.018} />
      <Box args={[0.16, 0.14, 1.48]} position={[x, 0.18, 0]} color="#d6a745" radius={0.025} />
      <mesh position={[x, 1.35, 0]}><sphereGeometry args={[0.1, 16, 12]} /><meshStandardMaterial color="#f0c45e" emissive="#765318" emissiveIntensity={0.18} roughness={0.38} /></mesh>
    </group>)}
    <Box args={[2.08, 0.4, 0.12]} position={[0, 1.5, -0.66]} color="#f1e8cf" radius={0.045} />
    <Text position={[0, 1.5, -0.59]} fontSize={0.16} color="#28483e" anchorX="center" anchorY="middle" fontWeight={800}>CARROS</Text>
    {Array.from({ length: Math.max(2, Math.min(4, count)) }, (_, index) => <ShoppingCart key={index} position={[0, 0, 0.42 - index * 0.26]} scale={1 - index * 0.055} />)}
  </group>;
}

type CartTubeSegment = readonly [from: Position, to: Position, radius: number];

function cartTubeTransform([from, to, radius]: CartTubeSegment): InstanceTransform {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return {
    position: start.add(end).multiplyScalar(0.5).toArray() as Position,
    quaternion: quaternion.toArray() as [number, number, number, number],
    scale: [radius, length, radius],
  };
}

function CartTubeInstances({ segments, color }: { segments: readonly CartTubeSegment[]; color: string }) {
  const transforms = useMemo(() => segments.map(cartTubeTransform), [segments]);
  return <StaticInstances transforms={transforms} castShadow>
    <cylinderGeometry args={[1, 1, 1, 8]} />
    <meshStandardMaterial color={color} metalness={0.68} roughness={0.27} />
  </StaticInstances>;
}

function ShoppingCart({ position, scale = 1 }: { position: Position; scale?: number }) {
  const tubeGroups = useMemo(() => {
    const top = { leftBack: [-0.46, 0.88, -0.35] as Position, rightBack: [0.46, 0.88, -0.35] as Position, leftFront: [-0.46, 0.88, 0.42] as Position, rightFront: [0.46, 0.88, 0.42] as Position };
    const bottom = { leftBack: [-0.34, 0.43, -0.25] as Position, rightBack: [0.34, 0.43, -0.25] as Position, leftFront: [-0.34, 0.43, 0.33] as Position, rightFront: [0.34, 0.43, 0.33] as Position };
    const metal: CartTubeSegment[] = [
      [[-0.44, 0.18, -0.28], top.leftBack, 0.022], [[0.44, 0.18, -0.28], top.rightBack, 0.022],
      ...([[top.leftBack, top.rightBack], [top.leftFront, top.rightFront], [top.leftBack, top.leftFront], [top.rightBack, top.rightFront], [bottom.leftBack, bottom.rightBack], [bottom.leftFront, bottom.rightFront], [bottom.leftBack, bottom.leftFront], [bottom.rightBack, bottom.rightFront], [top.leftBack, bottom.leftBack], [top.rightBack, bottom.rightBack], [top.leftFront, bottom.leftFront], [top.rightFront, bottom.rightFront]] as const).map(([from, to]) => [from, to, 0.015] as CartTubeSegment),
      ...[-0.27, -0.09, 0.09, 0.27].map((x) => [[x, 0.43, -0.25], [x * 1.3, 0.88, 0.42], 0.009] as CartTubeSegment),
      ...[-0.1, 0.08, 0.26].flatMap((z) => [-1, 1].map((side) => [[side * 0.36, 0.48, z], [side * 0.45, 0.84, z + 0.05], 0.009] as CartTubeSegment)),
      ...[-0.34, 0.34].map((x) => [[x, 0.13, -0.26], [x, 0.24, 0.32], 0.02] as CartTubeSegment),
    ];
    return { metal, grip: [[[-0.52, 1.02, -0.43], [0.52, 1.02, -0.43], 0.035] as CartTubeSegment] };
  }, []);
  const wheelTransforms = useMemo<InstanceTransform[]>(() => [-0.33, 0.33].flatMap((x) => [-0.23, 0.28].map((z) => ({ position: [x, 0.085, z], rotation: [0, 0, Math.PI / 2] }))), []);
  const forkTransforms = useMemo<InstanceTransform[]>(() => [-0.33, 0.33].flatMap((x) => [-0.23, 0.28].map((z) => ({ position: [x, 0.15, z], scale: [0.045, 0.13, 0.045] }))), []);
  return <group position={position} scale={scale}>
    <CartTubeInstances segments={tubeGroups.grip} color="#315f4d" />
    <CartTubeInstances segments={tubeGroups.metal} color="#9aa5a2" />
    <Box args={[0.72, 0.035, 0.58]} position={[0, 0.27, 0.04]} color="#9da8a5" radius={0.01} />
    <Box args={[0.74, 0.27, 0.045]} position={[0, 0.7, -0.29]} color="#466f60" radius={0.025} />
    <StaticInstances transforms={forkTransforms}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#6d7774" metalness={0.42} roughness={0.4} /></StaticInstances>
    <StaticInstances transforms={wheelTransforms}><cylinderGeometry args={[0.075, 0.075, 0.055, 14]} /><meshStandardMaterial color="#272d2c" roughness={0.65} /></StaticInstances>
    <StaticInstances transforms={wheelTransforms}><cylinderGeometry args={[0.034, 0.034, 0.058, 12]} /><meshStandardMaterial color="#adb7b4" metalness={0.62} roughness={0.3} /></StaticInstances>
  </group>;
}

const PRODUCTION_LAYOUT_TO_LOCAL = STORE_LAYOUT_SCALE / STORE_ELEMENT_SCALE;

function ProductionBakeryCubicle() {
  const { bounds, center, walls } = PRODUCTION_CUBICLE;
  const floorWidth = (bounds.right - bounds.left) * PRODUCTION_LAYOUT_TO_LOCAL;
  const floorDepth = (bounds.front - bounds.rear) * PRODUCTION_LAYOUT_TO_LOCAL;
  return <group name="production:professional-bakery">
    <StoreElement position={[center[0], 0, center[1]]}>
      <Box args={[floorWidth, 0.055, floorDepth]} position={[0, 0.025, 0]} color="#e7e1d3" radius={0.018} />
      {Array.from({ length: 7 }, (_, index) => <Box key={`floor-line-x-${index}`} args={[0.016, 0.009, floorDepth - 0.08]} position={[(index - 3) * floorWidth / 7, 0.059, 0]} color="#c9c7bf" radius={0.002} />)}
      {Array.from({ length: 8 }, (_, index) => <Box key={`floor-line-z-${index}`} args={[floorWidth - 0.08, 0.009, 0.016]} position={[0, 0.059, (index - 3.5) * floorDepth / 8]} color="#c9c7bf" radius={0.002} />)}
    </StoreElement>
    {walls.map((wall) => <StoreElement key={wall.id} position={[...wall.position]}>
      <GlassPartition width={wall.halfX * 2 * PRODUCTION_LAYOUT_TO_LOCAL} depth={wall.halfZ * 2 * PRODUCTION_LAYOUT_TO_LOCAL} />
    </StoreElement>)}
    <StoreElement position={[center[0], 0, bounds.front]}>
      <Box args={[2.05, 0.43, 0.14]} position={[0, 2.32, 0]} color="#233a34" radius={0.055} />
      <Text position={[0, 2.35, 0.081]} fontSize={0.165} color="#fff3d2" anchorX="center" anchorY="middle" fontWeight={900}>PANADERÍA · OBRADOR</Text>
      <Text position={[0, 2.35, -0.081]} rotation={[0, Math.PI, 0]} fontSize={0.165} color="#fff3d2" anchorX="center" anchorY="middle" fontWeight={900}>PANADERÍA · OBRADOR</Text>
      {/* Floor top is 0.0525. Keep the entire threshold above it: coincident
          top faces caused depth flicker even while the simulation was idle. */}
      <group name="bakery-entrance-threshold"><Box args={[1.85, 0.035, 0.5]} position={[0, 0.082, 0]} color="#3d514b" radius={0.008} /></group>
    </StoreElement>
  </group>;
}

function GlassPartition({ width, depth }: { width: number; depth: number }) {
  const alongX = width >= depth;
  const postPositions: Position[] = alongX
    ? [[-width / 2, 1.2, 0], [width / 2, 1.2, 0]]
    : [[0, 1.2, -depth / 2], [0, 1.2, depth / 2]];
  return <group>
    <mesh position={[0, 1.2, 0]} receiveShadow>
      <boxGeometry args={[width, 2.28, depth]} />
      <meshStandardMaterial color="#bde5df" transparent opacity={0.24} roughness={0.08} metalness={0.05} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
    {postPositions.map((position, index) => <Box key={index} args={[0.07, 2.48, 0.07]} position={position} color="#263c37" radius={0.012} />)}
    <Box args={[alongX ? width + 0.05 : 0.075, 0.075, alongX ? 0.075 : depth + 0.05]} position={[0, 2.43, 0]} color="#263c37" radius={0.012} />
    <Box args={[alongX ? width : 0.045, 0.15, alongX ? 0.045 : depth]} position={[0, 1.08, 0]} color="#d5eee8" radius={0.006} />
    <Box args={[alongX ? width + 0.04 : 0.09, 0.12, alongX ? 0.09 : depth + 0.04]} position={[0, 0.08, 0]} color="#52645f" radius={0.012} />
  </group>;
}

function machineStatus(machine?: ProductionMachineState) {
  if (!machine || machine.status === "LOCKED") return { label: "BLOQUEADA", color: "#9ea7a3" };
  if (machine.output > 0 || machine.status === "OUTPUT_READY" || machine.status === "FULL") return { label: "RECOGER", color: "#54d998" };
  if (machine.status === "PROCESSING") return { label: "EN PROCESO", color: "#f0ad55" };
  return { label: "CARGAR", color: "#7fc8e8" };
}

function ProductionMachineIdentity({ fixture, machine }: { fixture: ProductionFixtureLayout; machine?: ProductionMachineState }) {
  const status = machineStatus(machine);
  const ingredient = machine ? Object.keys(PRODUCT_CONFIG[machine.productId]?.recipe ?? {})[0] as ProductId | undefined : undefined;
  const queued = machine && ingredient ? (machine.input[ingredient] ?? 0) + Number(machine.status === "PROCESSING") * Number(PRODUCT_CONFIG[machine.productId]?.recipe?.[ingredient] ?? 0) : 0;
  const queueCapacity = machine && ingredient ? machineInputCapacity(machine, ingredient) : 0;
  return <group>
    <Box args={[1.22, 0.13, 1.05]} position={[0, 0.065, -0.53]} color="#55635f" radius={0.035} />
    <Box args={[1.08, 0.06, 0.9]} position={[0, 0.145, -0.53]} color="#c7ceca" radius={0.02} />
    {/* One readable board: what the machine is, what it has ready, what is
        queued to work through and what it is waiting for, at a size that can
        be read while walking past. */}
    <group position={[0, 2.3, 0.12]}>
      <Box args={[1.52, 1.1, 0.12]} color="#223832" radius={0.06} />
      <Text position={[0, 0.39, 0.068]} fontSize={0.19} color="#fff5d8" anchorX="center" anchorY="middle" fontWeight={900}>{fixture.label}</Text>
      <Text position={[0, 0.22, 0.069]} fontSize={0.082} color={fixture.accent} anchorX="center" anchorY="middle" fontWeight={800}>{fixture.processLabel}</Text>
      <group name="dynamic:machine-status">
        <Text position={[-0.63, 0.0, 0.07]} fontSize={0.13} color="#bcd9cc" anchorX="left" anchorY="middle" fontWeight={800}>LISTO</Text>
        <Text position={[0.63, 0.0, 0.07]} fontSize={0.26} color={machine && machine.output > 0 ? "#8ce6a1" : "#ffffff"} anchorX="right" anchorY="middle" fontWeight={900}>{`${machine?.output ?? 0}/${machine?.outputCapacity ?? 0}`}</Text>
        <Text position={[-0.63, -0.22, 0.07]} fontSize={0.11} color="#bcd9cc" anchorX="left" anchorY="middle" fontWeight={800}>{ingredient ? PRODUCTS[ingredient].name.toUpperCase() : "COLA"}</Text>
        <Text position={[0.63, -0.22, 0.07]} fontSize={0.17} color={queued > 0 ? "#ffd98a" : "#ffffff"} anchorX="right" anchorY="middle" fontWeight={900}>{`${queued}/${queueCapacity}`}</Text>
        <Text position={[0.63, -0.43, 0.07]} fontSize={0.155} color={status.color} anchorX="right" anchorY="middle" fontWeight={900}>{status.label}</Text>
        <mesh position={[-0.6, -0.43, 0.07]}><sphereGeometry args={[0.05, 12, 8]} /><meshBasicMaterial color={status.color} toneMapped={false} /></mesh>
      </group>
      <Text position={[0, 0.39, -0.068]} rotation={[0, Math.PI, 0]} fontSize={0.19} color="#fff5d8" anchorX="center" anchorY="middle" fontWeight={900}>{fixture.label}</Text>
    </group>
  </group>;
}

function BakeryKit({ position, machine }: { position: Position; machine?: ProductionMachineState }) {
  const processing = machine?.status === "PROCESSING";
  const fixture = STORE_PRODUCTION_FIXTURES.breadOven;
  return <group position={position}>
    <ProductionMachineIdentity fixture={fixture} machine={machine} />
    <DeliveredModel id="oven" position={[0, 0.175, -0.55]} />
    {processing && <pointLight position={[0, 0.95, 0.52]} intensity={0.8} distance={2.2} color="#df8b43" />}
  </group>;
}

function MillMachine({ position, machine }: { position: Position; machine?: ProductionMachineState }) {
  const fixture = STORE_PRODUCTION_FIXTURES.flourMill;
  return <group position={position}>
    <ProductionMachineIdentity fixture={fixture} machine={machine} />
    <DeliveredModel id="mill" position={[0, 0.175, -0.58]} />
  </group>;
}

function ProcessMachine({ kind, machine }: { kind: "cheese" | "juice"; machine?: ProductionMachineState }) {
  const processing = machine?.status === "PROCESSING";
  const fixture = kind === "cheese" ? STORE_PRODUCTION_FIXTURES.cheeseMaker : STORE_PRODUCTION_FIXTURES.juiceMachine;
  return <group>
    <ProductionMachineIdentity fixture={fixture} machine={machine} />
    {kind === "cheese" ? <EnvironmentModel id="equipment_cheese_maker" /> : <DeliveredModel id="juicer" position={[0, 0.175, -0.55]} />}
    {kind === "cheese" ? <>
      <Box args={[0.09, 0.78, 0.09]} position={[-0.4, 1.18, -0.35]} color="#4c5855" radius={0.012} />
      <Box args={[0.88, 0.1, 0.12]} position={[0, 1.52, -0.35]} color="#4c5855" radius={0.015} />
      <mesh position={[0, 0.58, 0.08]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.29, 0.29, 0.16, 18]} /><meshStandardMaterial color="#e7b938" roughness={0.72} /></mesh>
    </> : null}
    {processing && <pointLight position={[0, 0.65, 0.45]} intensity={0.45} distance={1.6} color={kind === "cheese" ? "#ffd75c" : "#ff6b43"} />}
    <group name="dynamic:machine-output">
      {Array.from({ length: Math.min(4, machine?.output ?? 0) }, (_, index) => <RetailProduct key={index} productId={kind} position={[0.34 + (index % 2) * 0.13, 0.16 + Math.floor(index / 2) * 0.12, 0.45]} scale={0.8} />)}
    </group>
  </group>;
}

/** Original compact machine; existing delivered models are never replaced. */
function CornCanner({ machine }: { machine?: ProductionMachineState }) {
  return <group name="fixture:corn-canner">
    <ProductionMachineIdentity fixture={STORE_PRODUCTION_FIXTURES.cornCanner} machine={machine} />
    <Box args={[1.2, 0.85, 1.1]} position={[0, 0.6, -0.55]} color="#97aaa4" radius={0.04} />
    <Box args={[1.1, 0.12, 0.7]} position={[0, 1.09, -0.48]} color="#334840" radius={0.02} />
    <Box args={[0.14, 0.65, 0.14]} position={[0.4, 1.45, -0.8]} color="#65833d" radius={0.02} />
    <Box args={[0.65, 0.15, 0.4]} position={[0.12, 1.74, -0.65]} color="#65833d" radius={0.02} />
    <mesh position={[-0.03, 1.47, -0.55]}><cylinderGeometry args={[0.1, 0.1, 0.35, 12]} /><meshStandardMaterial color="#c2cdca" metalness={0.6} roughness={0.4} /></mesh>
    <mesh position={[0.44, 0.85, 0.012]}><sphereGeometry args={[0.045, 8, 6]} /><meshStandardMaterial color={machine?.status === "PROCESSING" ? "#77e686" : "#d1ae56"} /></mesh>
    <group name="dynamic:machine-output">
      {Array.from({ length: Math.min(4, machine?.output ?? 0) }, (_, index) => <CannedCornModel key={index} position={[-0.4 + index * 0.2, 1.26, -0.3]} />)}
    </group>
    <CannedCornModel position={[-0.03, 1.26, -0.55]} />
  </group>;
}

/** Orders block on the rear wall: the PEDIDOS terminal faces the sales floor
 * while the delivery dock and pallet back onto the wall behind it. The group
 * origin is the shared physics/NavMesh footprint centre. */
function SupplierCorner({ position }: { position: Position }) {
  return <group name={STORE_SERVICE_FIXTURES.orders.obstacleId} position={position}>
    <MemoTerminalModel position={[0, 0, 0.62]} label="PEDIDOS" />
    {/* The dock door is a 2.2 × 1.45 panel centred on its origin: lift it onto
     * the floor and flatten it against the rear wall behind the pallet. */}
    <group position={[0, 0.52, -0.9]} scale={0.72}><EnvironmentModel id="equipment_delivery_dock" /></group>
    <Pallet position={[-0.05, 0, -0.68]} />
    <Parcel position={[-0.3, 0.34, -0.68]} />
    <Parcel position={[0.25, 0.34, -0.68]} small />
    <Parcel position={[0.05, 0.73, -0.68]} />
  </group>;
}

/**
 * Worker return crate beside the farm door. The owner/player empties their
 * complete basket through its proximity magnet, and automated stockers use it
 * for shelf overflow. Customers never interact with it. Authored in element
 * units; the group scales to the station footprint of 0.84 × 0.64.
 */
function WarehouseReturnBasket() {
  const slats = useMemo<InstanceTransform[]>(() => [0.18, 0.4, 0.62, 0.84].map((y) => ({ position: [0, y, 0], scale: [1.08, 0.03, 0.42] })), []);
  return <group name={WAREHOUSE_RETURN_STATION.obstacleId}>
    <Box args={[1.04, 0.06, 0.4]} position={[0, 0.03, 0]} color={palette.wood} radius={0.018} />
    {([-1, 1] as const).map((side) => <Box key={`side-${side}`} args={[0.045, 0.9, 0.4]} position={[side * 0.5, 0.51, 0]} color={palette.wood} radius={0.012} />)}
    {([-1, 1] as const).map((side) => <Box key={`end-${side}`} args={[1.04, 0.9, 0.045]} position={[0, 0.51, side * 0.18]} color={palette.wood} radius={0.012} />)}
    {[-0.5, 0, 0.5].map((x) => <Box key={`post-${x}`} args={[0.06, 0.96, 0.06]} position={[x, 0.48, 0.2]} color="#7a5230" radius={0.01} />)}
    <StaticInstances transforms={slats}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#c9955b" roughness={0.9} /></StaticInstances>
    <Box args={[0.98, 0.02, 0.34]} position={[0, 0.08, 0]} color="#8c6a3f" radius={0.006} />
    <Box args={[0.035, 1.34, 0.035]} position={[-0.62, 0.67, -0.14]} color={palette.frame} radius={0.008} />
    <Box args={[0.62, 0.26, 0.03]} position={[-0.62, 1.42, -0.14]} color="#173f35" radius={0.02} />
    <Text position={[-0.62, 1.46, -0.122]} fontSize={0.075} color="#fff3ce" anchorX="center" anchorY="middle" fontWeight={800}>DEVOLVER</Text>
    <Text position={[-0.62, 1.375, -0.122]} fontSize={0.058} color="#9fd8c0" anchorX="center" anchorY="middle" fontWeight={800}>AL ALMACÉN</Text>
  </group>;
}

function TerminalModel({ position, label }: { position: Position; label: string }) {
  return <group position={position}>
    <Box args={[1.18, 0.82, 0.62]} position={[0, 0.41, 0]} color={palette.darkGreen} radius={0.11} />
    <Box args={[1.38, 0.12, 0.76]} position={[0, 0.86, 0.04]} color={palette.cream} radius={0.055} />
    <Box args={[0.76, 0.1, 0.48]} position={[0, 0.96, 0.08]} color="#303b38" radius={0.035} />
    {[-0.24, -0.08, 0.08, 0.24].map((x) => <mesh key={x} position={[x, 1.025, 0.16]} rotation={[-0.25, 0, 0]}><boxGeometry args={[0.09, 0.025, 0.18]} /><meshStandardMaterial color="#85938d" roughness={0.58} metalness={0.12} /></mesh>)}
    <Box args={[0.76, 0.64, 0.1]} position={[0, 1.38, 0.03]} rotation={[-0.14, 0, 0]} color="#202b28" radius={0.06} />
    <mesh position={[0, 1.39, 0.091]} rotation={[-0.14, 0, 0]}><planeGeometry args={[0.62, 0.48]} /><meshStandardMaterial color="#c7eadc" emissive="#40806a" emissiveIntensity={0.34} roughness={0.45} /></mesh>
    <Text position={[0, 1.42, 0.101]} rotation={[-0.14, 0, 0]} fontSize={0.105} color="#173f35" anchorX="center" anchorY="middle" fontWeight={800}>{label}</Text>
    <mesh position={[-0.48, 0.63, 0.32]}><sphereGeometry args={[0.035, 10, 7]} /><meshBasicMaterial color="#8ce0a6" toneMapped={false} /></mesh>
  </group>;
}

function Pallet({ position }: { position: Position }) {
  return <group position={position}>{[-0.32, 0, 0.32].map((z) => <Box key={z} args={[1.1, 0.09, 0.18]} position={[0, 0.09, z]} color={palette.wood} />)}{[-0.43, 0, 0.43].map((x) => <Box key={x} args={[0.16, 0.11, 0.82]} position={[x, 0.02, 0]} color="#754c2f" />)}</group>;
}

function Parcel({ position, small = false }: { position: Position; small?: boolean }) {
  return <group position={position} scale={small ? 0.72 : 1}><Box args={[0.52, 0.44, 0.46]} position={[0, 0.22, 0]} color="#ba8050" radius={0.025} /><Box args={[0.08, 0.45, 0.47]} position={[0, 0.23, 0]} color="#d5ad70" radius={0.01} /></group>;
}

function StoreUtilities({ lightsOn, dynamicCeilingLights }: { lightsOn: boolean; dynamicCeilingLights: boolean }) {
  return <group>
    <StoreElement position={[STORE_REAR_DOOR.adjacentRackPosition[0], 2.2, -8.34]}><WallClock position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[-10.75, 2.55, -8.05]}><SecurityCamera position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[10.65, 2.55, 7.2]}><SecurityCamera position={[0, 0, 0]} rotationY={Math.PI} /></StoreElement>
    <StoreElement position={[7.25, 2.45, 1.65]}><HangingSign position={[0, 0, 0]} label="CAJAS" /></StoreElement>
    <StoreElement position={[-3.8, 2.45, -3.35]}><HangingSign position={[0, 0, 0]} label="DESPENSA" /></StoreElement>
    {[-7.2, -2.4, 2.4, 7.2].map((x) => <StoreElement key={x} position={[x, 2.85, -0.6]}><CeilingLamp position={[0, 0, 0]} on={lightsOn} dynamicLight={dynamicCeilingLights} /></StoreElement>)}
  </group>;
}

function WallClock({ position }: { position: Position }) {
  return <group position={position} rotation={[0, 0, 0]}><mesh><cylinderGeometry args={[0.34, 0.34, 0.08, 24]} /><meshStandardMaterial color="#f7f2e2" /></mesh><mesh position={[0, -0.045, 0.05]} rotation={[Math.PI / 2, 0, 0]}><boxGeometry args={[0.025, 0.25, 0.025]} /><meshStandardMaterial color="#303735" /></mesh><mesh position={[0.09, 0.02, 0.055]} rotation={[Math.PI / 2, 0, -0.85]}><boxGeometry args={[0.02, 0.18, 0.02]} /><meshStandardMaterial color="#303735" /></mesh></group>;
}

function SecurityCamera({ position, rotationY = 0 }: { position: Position; rotationY?: number }) {
  return <group position={position} rotation={[0, rotationY, 0]}><Box args={[0.42, 0.22, 0.2]} position={[0, 0, 0]} color="#e6e9e3" radius={0.07} /><mesh position={[0, 0, 0.12]}><circleGeometry args={[0.06, 12]} /><meshStandardMaterial color="#202725" /></mesh><Box args={[0.06, 0.35, 0.06]} position={[0, 0.22, -0.05]} color={palette.frame} /></group>;
}

function HangingSign({ position, label }: { position: Position; label: string }) {
  return <group position={position}>
    <Box args={[1.55, 0.46, 0.09]} color={palette.darkGreen} radius={0.04} />
    <Text position={[0, 0, 0.052]} fontSize={0.175} color="#fff1cc" anchorX="center" anchorY="middle" fontWeight={900}>{label}</Text>
    <Text position={[0, 0, -0.052]} rotation={[0, Math.PI, 0]} fontSize={0.175} color="#fff1cc" anchorX="center" anchorY="middle" fontWeight={900}>{label}</Text>
    {[-0.56, 0.56].map((x) => <Box key={x} args={[0.025, 0.55, 0.025]} position={[x, 0.45, 0]} color={palette.frame} />)}
  </group>;
}

function CeilingLamp({ position, on, dynamicLight }: { position: Position; on: boolean; dynamicLight: boolean }) {
  const updateMaterials = useCallback((model: THREE.Group) => model.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshStandardMaterial)) return;
    node.material.emissive.set(on ? "#fff0b8" : "#000000");
    node.material.emissiveIntensity = on ? 1.1 : 0;
  }), [on]);
  return <group name="dynamic:ceiling-lamp" position={position}><EnvironmentModel id="equipment_ceiling_light" isolateMaterials onUpdate={updateMaterials} />{on && dynamicLight && <pointLight position={[0, -0.15, 0]} intensity={0.18} distance={4} color="#fff2c9" />}</group>;
}

type FarmCropKind = "tomato" | "apple" | "orange" | "wheat" | "corn";

const FARM_LOCAL_LAYOUT_SCALE = STORE_LAYOUT_SCALE / STORE_ELEMENT_SCALE;
const FARM_LOCAL_HALF_WIDTH = FARM_FIELD.size[0] * FARM_LOCAL_LAYOUT_SCALE * 0.5;
const FARM_LOCAL_HALF_DEPTH = FARM_FIELD.size[2] * FARM_LOCAL_LAYOUT_SCALE * 0.5;
const FARM_RIGHT_FENCE_LOCAL_Z = (FARM_GATE.rightFence.center[2] - FARM_FIELD.center[2]) * FARM_LOCAL_LAYOUT_SCALE;
const FARM_FRONT_FENCE_LOCAL_X = (FARM_GATE.leftFrontFence.center[0] - FARM_FIELD.center[0]) * FARM_LOCAL_LAYOUT_SCALE;
const FARM_FRONT_FENCE_LOCAL_Z = (FARM_GATE.leftFrontFence.center[2] - FARM_FIELD.center[2]) * FARM_LOCAL_LAYOUT_SCALE;
const FARM_FRONT_FENCE_MIN_X = FARM_GATE.leftFrontFence.center[0] - FARM_GATE.leftFrontFence.halfX * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE);
const FARM_FRONT_FENCE_MAX_X = FARM_GATE.leftFrontFence.center[0] + FARM_GATE.leftFrontFence.halfX * (STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE);
const FARM_RIGHT_FRONT_FENCE_LOCAL_X = (FARM_GATE.rightFrontFence.center[0] - FARM_FIELD.center[0]) * FARM_LOCAL_LAYOUT_SCALE;
const FARM_WALL_CONNECTING_FENCES = [
  ...FARM_GATE.accessCorridorFences,
  ...FARM_GATE.perimeterWallFences,
].map((fence) => ({
  x: (fence.center[0] - FARM_FIELD.center[0]) * FARM_LOCAL_LAYOUT_SCALE,
  z: (fence.center[2] - FARM_FIELD.center[2]) * FARM_LOCAL_LAYOUT_SCALE,
  halfZ: fence.halfZ,
}));
const TOMATO_GRID = Array.from({ length: 15 }, (_, index): [number, number] => [((index % 5) - 2) * 0.3, (Math.floor(index / 5) - 1) * 0.3]);
const WHEAT_GRID = Array.from({ length: 28 }, (_, index): [number, number] => [((index % 7) - 3) * 0.215, (Math.floor(index / 7) - 1.5) * 0.205]);
const CORN_GRID = Array.from({ length: 12 }, (_, index): [number, number] => [((index % 4) - 1.5) * 0.39, (Math.floor(index / 4) - 1) * 0.31]);
/** Three young apple trees along the bed. */
const APPLE_GRID: readonly [number, number][] = [[-0.62, 0.06], [0, -0.1], [0.62, 0.06]];
const BED_TIMBERS: readonly InstanceTransform[] = [
  { position: [0, 0.17, -0.62], scale: [2.05, 0.21, 0.1] },
  { position: [0, 0.17, 0.62], scale: [2.05, 0.21, 0.1] },
  { position: [-0.98, 0.17, 0], scale: [0.1, 0.21, 1.18] },
  { position: [0.98, 0.17, 0], scale: [0.1, 0.21, 1.18] },
  ...[-0.98, 0.98].flatMap((x) => [-0.62, 0.62].map((z): InstanceTransform => ({ position: [x, 0.26, z], scale: [0.14, 0.38, 0.14] }))),
];
const BED_FURROWS: readonly InstanceTransform[] = [-0.32, 0, 0.32].map((z) => ({ position: [0, 0.255, z], scale: [1.72, 0.025, 0.11] }));
const BED_DRIP_LINES: readonly InstanceTransform[] = [-0.16, 0.16].map((z) => ({ position: [0, 0.286, z], rotation: [0, 0, Math.PI / 2], scale: [1, 1.72, 1] }));
const EMPTY_SEED_HOLES: readonly InstanceTransform[] = TOMATO_GRID.map(([x, z]) => ({ position: [x, 0.282, z], scale: [1, 0.32, 1] }));
const GARDEN_PATH_STONES: readonly InstanceTransform[] = [
  ...Array.from({ length: 35 }, (_, index): InstanceTransform => ({
    position: [12.25 - index * 0.43, 0.055, 3.28 + Math.sin(index * 0.72) * 0.08],
    rotation: [0, (index % 5 - 2) * 0.08, 0],
    scale: [0.9 + (index % 3) * 0.07, 1, 0.72 + (index % 2) * 0.08],
  })),
  ...Array.from({ length: 16 }, (_, index): InstanceTransform => ({
    position: [-2.15 + Math.sin(index * 1.1) * 0.045, 0.052, 3.05 - index * 0.43],
    rotation: [0, (index % 4 - 1.5) * 0.1, 0],
    scale: [0.78 + (index % 2) * 0.08, 1, 0.88],
  })),
];
const GARDEN_GRASS_TUFTS: readonly InstanceTransform[] = Array.from({ length: 52 }, (_, index): InstanceTransform => {
  const side = index % 2 ? 1 : -1;
  const lane = Math.floor(index / 2);
  return {
    position: [side * (5.25 + (lane % 7) * 0.72), 0.13, -3.7 + (lane % 13) * 0.58],
    rotation: [0, index * 0.73, (index % 3 - 1) * 0.08],
    scale: [0.7 + (index % 3) * 0.12, 0.75 + (index % 4) * 0.1, 0.7],
  };
});
const GARDEN_FLOWERS: readonly InstanceTransform[] = [
  [-11.9, -3.6], [-11.6, 3.35], [10.95, -3.65], [11.25, 2.9], [-8.8, 3.82], [7.8, -3.86],
].map(([x, z], index) => ({ position: [x, 0.26 + (index % 2) * 0.035, z], scale: [0.85, 0.85, 0.85] }));
const FARM_FENCE_POSTS: readonly InstanceTransform[] = [
  ...Array.from({ length: 15 }, (_, index): InstanceTransform => ({ position: [-FARM_LOCAL_HALF_WIDTH + index * (FARM_LOCAL_HALF_WIDTH * 2 / 14), 0.54, -FARM_LOCAL_HALF_DEPTH], scale: [0.1, 1.08, 0.1] })),
  ...Array.from({ length: 11 }, (_, index): InstanceTransform => ({
    position: [
      (FARM_FRONT_FENCE_MIN_X + index * ((FARM_FRONT_FENCE_MAX_X - FARM_FRONT_FENCE_MIN_X) / 10) - FARM_FIELD.center[0]) * FARM_LOCAL_LAYOUT_SCALE,
      0.54,
      FARM_FRONT_FENCE_LOCAL_Z,
    ],
    scale: [0.1, 1.08, 0.1],
  })),
  { position: [FARM_RIGHT_FRONT_FENCE_LOCAL_X, 0.54, FARM_FRONT_FENCE_LOCAL_Z], scale: [0.1, 1.08, 0.1] },
  ...Array.from({ length: 6 }, (_, index): InstanceTransform => ({ position: [-FARM_LOCAL_HALF_WIDTH, 0.54, -FARM_LOCAL_HALF_DEPTH + index * (FARM_LOCAL_HALF_DEPTH * 2 / 5)], scale: [0.1, 1.08, 0.1] })),
  ...Array.from({ length: 6 }, (_, index): InstanceTransform => ({ position: [FARM_LOCAL_HALF_WIDTH, 0.54, -FARM_LOCAL_HALF_DEPTH + index * (FARM_LOCAL_HALF_DEPTH * 2 / 5)], scale: [0.1, 1.08, 0.1] })),
  ...FARM_WALL_CONNECTING_FENCES.flatMap((fence): InstanceTransform[] => [
    { position: [fence.x, 0.54, fence.z], scale: [0.1, 1.08, 0.1] },
    { position: [fence.x, 0.54, fence.z + fence.halfZ], scale: [0.1, 1.08, 0.1] },
  ]),
];
const FARM_FENCE_RAILS: readonly InstanceTransform[] = [
  { position: [0, 0.38, -FARM_LOCAL_HALF_DEPTH], scale: [FARM_LOCAL_HALF_WIDTH * 2, 0.075, 0.075] },
  { position: [0, 0.72, -FARM_LOCAL_HALF_DEPTH], scale: [FARM_LOCAL_HALF_WIDTH * 2, 0.075, 0.075] },
  { position: [FARM_FRONT_FENCE_LOCAL_X, 0.38, FARM_FRONT_FENCE_LOCAL_Z], scale: [FARM_GATE.leftFrontFence.halfX * 2, 0.075, 0.075] },
  { position: [FARM_FRONT_FENCE_LOCAL_X, 0.72, FARM_FRONT_FENCE_LOCAL_Z], scale: [FARM_GATE.leftFrontFence.halfX * 2, 0.075, 0.075] },
  { position: [FARM_RIGHT_FRONT_FENCE_LOCAL_X, 0.38, FARM_FRONT_FENCE_LOCAL_Z], scale: [FARM_GATE.rightFrontFence.halfX * 2, 0.075, 0.075] },
  { position: [FARM_RIGHT_FRONT_FENCE_LOCAL_X, 0.72, FARM_FRONT_FENCE_LOCAL_Z], scale: [FARM_GATE.rightFrontFence.halfX * 2, 0.075, 0.075] },
  { position: [-FARM_LOCAL_HALF_WIDTH, 0.38, 0], scale: [0.075, 0.075, FARM_LOCAL_HALF_DEPTH * 2] },
  { position: [-FARM_LOCAL_HALF_WIDTH, 0.72, 0], scale: [0.075, 0.075, FARM_LOCAL_HALF_DEPTH * 2] },
  { position: [FARM_LOCAL_HALF_WIDTH, 0.38, FARM_RIGHT_FENCE_LOCAL_Z], scale: [0.075, 0.075, FARM_GATE.rightFence.halfZ * 2] },
  { position: [FARM_LOCAL_HALF_WIDTH, 0.72, FARM_RIGHT_FENCE_LOCAL_Z], scale: [0.075, 0.075, FARM_GATE.rightFence.halfZ * 2] },
  ...FARM_WALL_CONNECTING_FENCES.flatMap((fence): InstanceTransform[] => [
    { position: [fence.x, 0.38, fence.z], scale: [0.075, 0.075, fence.halfZ * 2] },
    { position: [fence.x, 0.72, fence.z], scale: [0.075, 0.075, fence.halfZ * 2] },
  ]),
];
const READY_SPARKLES: readonly InstanceTransform[] = [
  { position: [-0.78, 0.1, -0.42], scale: [0.7, 0.7, 0.7] },
  { position: [0.8, 0.18, 0.31], scale: [0.55, 0.55, 0.55] },
  { position: [0.62, 0.08, -0.48], scale: [0.42, 0.42, 0.42] },
];
const FARM_BENCH_LEGS: readonly InstanceTransform[] = [-0.56, 0.56].flatMap((x) => [-0.24, 0.24].map((z): InstanceTransform => ({ position: [x, 0.48, z], scale: [0.09, 0.96, 0.09] })));
const GREENHOUSE_SEEDLINGS: readonly InstanceTransform[] = TOMATO_GRID.slice(0, 6).map(([x, z]) => ({ position: [x * 0.55, 0.28, z * 0.52], scale: [0.5, 0.5, 0.5] }));

export const KitFarm = memo(function KitFarm({ crops, machines, nowMs, unlockedAreas }: FarmPresentationProps) {
  const root = useRef<THREE.Group>(null);
  const structureRevision = unlockedAreas.join("|");
  const cropsById = useMemo(() => new Map(crops.map((crop) => [crop.id, crop])), [crops]);
  const chicken = machines.find((machine) => machine.id === "chicken-coop-1");
  const secondChicken = machines.find((machine) => machine.id === "chicken-coop-2");
  const cow = machines.find((machine) => machine.id === "cow-station-1");
  return <group ref={root}>
    <StoreElement position={[...FARM_FIELD.center]}><MemoGardenFloor /></StoreElement>
    {FARM_PLOTS.map((plot) => {
      const crop = cropsById.get(plot.id);
      if (unlockedAreas.includes("purchase-campaign") && (!crop || crop.status === "LOCKED")) return null;
      return <StoreElement key={plot.id} position={[plot.position[0], plot.position[1], plot.position[2]]}>
        {!crop || crop.status === "LOCKED"
          ? <MemoDormantCropPlot />
          : <MemoCropPlot
              position={[0, 0, 0]}
              crop={farmCropKind(crop.productId)}
              status={crop.status}
              progress={cropProgress(crop, nowMs)}
              available={crop.available}
              yieldCapacity={cropHarvestYield(crop.productId, crop.tier, crop.baseYield)}
              accent={plot.accent}
              label={PRODUCTS_LABELS[crop.productId]}
            />}
      </StoreElement>;
    })}
    <StoreElement position={[...FARM_FACILITIES.tools.position]}><MemoFarmTools position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[...FARM_FACILITIES.compost.position]}><MemoCompostBin position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[...FARM_FACILITIES.greenhouse.position]}><MemoMiniGreenhouse position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[...FARM_FACILITIES.scarecrow.position]}><MemoScarecrow position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[...FARM_FACILITIES.waterTank.position]}><MemoFarmWaterTank /></StoreElement>
    {fixtureAvailable("fixture:chicken-coop", unlockedAreas) && <StoreElement position={[...FARM_ANIMAL_STATIONS.chicken.position]}>
      <MemoAnimalPaddock kind="chicken" />
      {unlockedAreas.includes("chicken-coop") && chicken && <MemoAnimalStation kind="chicken" machine={chicken} />}
    </StoreElement>}
    {fixtureAvailable("fixture:cow-station", unlockedAreas) && <StoreElement position={[...FARM_ANIMAL_STATIONS.cow.position]}>
      <MemoAnimalPaddock kind="cow" />
      {unlockedAreas.includes("cow-station") && cow && <MemoAnimalStation kind="cow" machine={cow} />}
    </StoreElement>}
    {fixtureAvailable("fixture:chicken-coop-2", unlockedAreas) && <StoreElement position={[...FARM_ANIMAL_STATIONS.chicken2.position]}>
      <MemoAnimalPaddock kind="chicken" />
      {unlockedAreas.includes("chicken-coop-2") && secondChicken && <MemoAnimalStation kind="chicken" machine={secondChicken} />}
    </StoreElement>}
    {/* Last child: its effect runs after every sibling placed its instances. */}
    <StaticBatchOptimizer rootRef={root} structureRevision={structureRevision} />
  </group>;
}, sameFarmPresentation);

function DormantCropPlot() {
  return <group name="dynamic:farm-crop">
    <RaisedCropBed status="EMPTY" />
    <StaticInstances transforms={[-0.32, 0, 0.32].map((z) => ({ position: [0, 0.302, z] as Position, scale: [1.55, 0.024, 0.13] as Position }))} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#9f7544" roughness={1} />
    </StaticInstances>
  </group>;
}

function farmCropKind(productId: CropState["productId"]): FarmCropKind {
  if (productId === "apples") return "apple";
  if (productId === "oranges") return "orange";
  if (productId === "wheat") return "wheat";
  if (productId === "corn") return "corn";
  return "tomato";
}

function GardenFloor() {
  const gardenShape = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-FARM_LOCAL_HALF_WIDTH + 0.5, -FARM_LOCAL_HALF_DEPTH);
    shape.quadraticCurveTo(-FARM_LOCAL_HALF_WIDTH, -FARM_LOCAL_HALF_DEPTH, -FARM_LOCAL_HALF_WIDTH, -FARM_LOCAL_HALF_DEPTH + 0.55);
    shape.lineTo(-FARM_LOCAL_HALF_WIDTH, FARM_LOCAL_HALF_DEPTH - 0.42);
    shape.quadraticCurveTo(-FARM_LOCAL_HALF_WIDTH, FARM_LOCAL_HALF_DEPTH, -FARM_LOCAL_HALF_WIDTH + 0.62, FARM_LOCAL_HALF_DEPTH);
    shape.lineTo(FARM_LOCAL_HALF_WIDTH - 0.8, FARM_LOCAL_HALF_DEPTH);
    shape.quadraticCurveTo(FARM_LOCAL_HALF_WIDTH, FARM_LOCAL_HALF_DEPTH, FARM_LOCAL_HALF_WIDTH, FARM_LOCAL_HALF_DEPTH - 0.74);
    shape.lineTo(FARM_LOCAL_HALF_WIDTH, -FARM_LOCAL_HALF_DEPTH + 0.52);
    shape.quadraticCurveTo(FARM_LOCAL_HALF_WIDTH, -FARM_LOCAL_HALF_DEPTH, FARM_LOCAL_HALF_WIDTH - 0.62, -FARM_LOCAL_HALF_DEPTH);
    shape.closePath();
    return shape;
  }, []);
  return <group>
    <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.035, 1.035, 1]} receiveShadow><shapeGeometry args={[gardenShape]} /><meshStandardMaterial color="#315d36" roughness={1} /></mesh>
    <mesh position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><shapeGeometry args={[gardenShape]} /><meshStandardMaterial color="#59934f" roughness={0.98} /></mesh>
    <RoundedBox args={[10.6, 0.045, 0.78]} position={[7.8, 0.055, 3.35]} radius={0.2} smoothness={2} receiveShadow><meshStandardMaterial color="#b79a70" roughness={1} /></RoundedBox>
    <RoundedBox args={[14.7, 0.043, 0.74]} position={[-4.35, 0.054, 3.35]} radius={0.18} smoothness={2} receiveShadow><meshStandardMaterial color="#baa078" roughness={1} /></RoundedBox>
    <RoundedBox args={[0.82, 0.042, 7.15]} position={[-2.15, 0.053, 0]} radius={0.18} smoothness={2} receiveShadow><meshStandardMaterial color="#b79a70" roughness={1} /></RoundedBox>
    <RoundedBox args={[8.25, 0.038, 0.58]} position={[-6.25, 0.052, -0.02]} radius={0.16} smoothness={2} receiveShadow><meshStandardMaterial color="#a98e68" roughness={1} /></RoundedBox>
    <StaticInstances transforms={GARDEN_PATH_STONES} receiveShadow><cylinderGeometry args={[0.23, 0.23, 0.04, 8]} /><meshStandardMaterial color="#a7a08c" roughness={0.96} /></StaticInstances>
    <StaticInstances transforms={GARDEN_GRASS_TUFTS} castShadow><coneGeometry args={[0.065, 0.24, 5]} /><meshStandardMaterial color="#366f3b" roughness={1} /></StaticInstances>
    <StaticInstances transforms={GARDEN_FLOWERS} castShadow><dodecahedronGeometry args={[0.075, 0]} /><meshStandardMaterial color="#ffe395" emissive="#9a6b2a" emissiveIntensity={0.12} roughness={0.82} /></StaticInstances>
    <StaticInstances transforms={FARM_FENCE_POSTS} castShadow receiveShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#765035" roughness={0.92} /></StaticInstances>
    <StaticInstances transforms={FARM_FENCE_RAILS} castShadow receiveShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#91633e" roughness={0.9} /></StaticInstances>
    <FarmEntranceGate />
  </group>;
}

function FarmEntranceGate() {
  const frontPost: Position = [
    (FARM_GATE.frontPost[0] - FARM_FIELD.center[0]) * FARM_LOCAL_LAYOUT_SCALE,
    0,
    (FARM_GATE.frontPost[2] - FARM_FIELD.center[2]) * FARM_LOCAL_LAYOUT_SCALE,
  ];
  const innerPostOffsetX = (FARM_GATE.innerPost[0] - FARM_GATE.frontPost[0]) * FARM_LOCAL_LAYOUT_SCALE;
  const innerPostOffsetZ = (FARM_GATE.innerPost[2] - FARM_GATE.frontPost[2]) * FARM_LOCAL_LAYOUT_SCALE;
  const openLeafOffsetX = (FARM_GATE.openLeaf.center[0] - FARM_GATE.innerPost[0]) * FARM_LOCAL_LAYOUT_SCALE;
  const openLeafOffsetZ = (FARM_GATE.openLeaf.center[2] - FARM_GATE.innerPost[2]) * FARM_LOCAL_LAYOUT_SCALE;
  const openLeafTerminalPost = farmGateOpenLeafTerminalPost(STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE);
  const openLeafTerminalOffsetX = (openLeafTerminalPost[0] - FARM_GATE.innerPost[0]) * FARM_LOCAL_LAYOUT_SCALE;
  const openLeafTerminalOffsetZ = (openLeafTerminalPost[1] - FARM_GATE.innerPost[2]) * FARM_LOCAL_LAYOUT_SCALE;
  const openLeafDepth = FARM_GATE.openLeaf.halfZ * 2;
  return <group position={frontPost}>
    {[[0, 0], [innerPostOffsetX, innerPostOffsetZ]].map(([x, z], index) => <group key={`farm-gate-post-${index}`} position={[x, 0, z]}>
      <Box args={[0.19, 1.38, 0.19]} position={[0, 0.69, 0]} color="#68472f" radius={0.025} />
      <mesh position={[0, 1.48, 0]}><sphereGeometry args={[0.12, 10, 7]} /><meshStandardMaterial color="#d6b35e" roughness={0.7} /></mesh>
    </group>)}
    {/* Park the open leaf behind the right post, flush with the east fence,
        so the rear-door path is physically and visually unobstructed. */}
    <group position={[innerPostOffsetX, 0, innerPostOffsetZ]}>
      <Box args={[0.09, 0.09, openLeafDepth]} position={[openLeafOffsetX, 0.5, openLeafOffsetZ]} color="#b27a43" />
      <Box args={[0.09, 0.09, openLeafDepth]} position={[openLeafOffsetX, 0.98, openLeafOffsetZ]} color="#b27a43" />
      <Box args={[FARM_GATE.openLeaf.terminalPostDepth, 1.02, FARM_GATE.openLeaf.terminalPostDepth]} position={[openLeafTerminalOffsetX, 0.74, openLeafTerminalOffsetZ]} color="#8c5b37" />
    </group>
  </group>;
}

function CropPlot({ position, crop, status, progress, available, yieldCapacity, accent, label }: { position: Position; crop: FarmCropKind; status: CropState["status"]; progress: number; available: number; yieldCapacity: number; accent: string; label: string }) {
  const stage = status === "READY" ? 4 : Math.max(0, Math.min(3, Math.floor(progress * 4)));
  const growth = [0.18, 0.4, 0.66, 0.86, 1][stage];
  return <group name="dynamic:farm-crop" position={position}>
    <StationSign
      position={[1.35, 0, 0.25]}
      height={1.05}
      title={label}
      rows={status === "READY"
        ? [{ label: "LISTOS", value: `${available}/${yieldCapacity}`, tone: available > 0 ? "#8ce6a1" : "#ffffff" }]
        : [{ label: status === "EMPTY" ? "SEMBRANDO" : "CRECIENDO", value: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)} %`, tone: "#ffd98a" }]}
    />
    <RaisedCropBed status={status} />
    {status === "EMPTY" ? <SeedBed /> : <CropCanopy crop={crop} growth={growth} ready={status === "READY"} available={available} yieldCapacity={yieldCapacity} />}
    {status === "READY" && available > 0 && <ReadyHarvestGlow accent={accent} />}
  </group>;
}

function RaisedCropBed({ status }: { status: CropState["status"] }) {
  const soilColor = status === "EMPTY" ? "#704b31" : status === "READY" ? "#4b3426" : "#563a29";
  return <group>
    <RoundedBox args={[1.92, 0.22, 1.18]} position={[0, 0.15, 0]} radius={0.13} smoothness={3} receiveShadow><meshStandardMaterial color={soilColor} roughness={1} /></RoundedBox>
    <StaticInstances transforms={BED_TIMBERS} castShadow receiveShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#8b5b35" roughness={0.88} /></StaticInstances>
    <StaticInstances transforms={BED_FURROWS} receiveShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#3e2b21" roughness={1} /></StaticInstances>
    <StaticInstances transforms={BED_DRIP_LINES}><cylinderGeometry args={[0.012, 0.012, 1, 6]} /><meshStandardMaterial color="#314b45" roughness={0.72} metalness={0.08} /></StaticInstances>
  </group>;
}

function SeedBed() {
  return <StaticInstances transforms={EMPTY_SEED_HOLES} receiveShadow><cylinderGeometry args={[0.035, 0.048, 0.018, 9]} /><meshStandardMaterial color="#2e211a" roughness={1} /></StaticInstances>;
}

function CropCanopy({ crop, growth, ready, available, yieldCapacity }: { crop: FarmCropKind; growth: number; ready: boolean; available: number; yieldCapacity: number }) {
  const grid = crop === "wheat" ? WHEAT_GRID : crop === "corn" ? CORN_GRID : crop === "apple" ? APPLE_GRID : TOMATO_GRID;
  const fullHeight = crop === "corn" ? 1.06 : crop === "apple" ? 0.82 : crop === "wheat" ? 0.76 : 0.68;
  const height = Math.max(0.12, fullHeight * growth);
  const stems = useMemo<InstanceTransform[]>(() => grid.map(([x, z], index) => ({
    position: [x, 0.25 + height / 2, z],
    rotation: [0, index * 0.49, (index % 3 - 1) * 0.025],
    scale: crop === "apple" ? [2.6, height, 2.6] : [1, height, 1],
  })), [crop, grid, height]);
  const leaves = useMemo<InstanceTransform[]>(() => grid.flatMap(([x, z], index) => [-1, 1].map((side): InstanceTransform => (crop === "apple"
    // Two overlapping crowns per trunk make a round canopy that grows with the tree.
    ? {
      position: [x + side * 0.08, 0.3 + height + 0.06 * growth, z + side * 0.04],
      rotation: [0, index * 0.77 + side * 0.4, 0],
      scale: [1.9 + growth, 1.5 + growth * 0.9, 1.9 + growth],
    }
    : {
      position: [x + side * (crop === "corn" ? 0.075 : 0.055), 0.28 + height * (side > 0 ? 0.5 : 0.68), z],
      rotation: [0, index * 0.77, side * (crop === "corn" ? 0.72 : 0.56)],
      scale: crop === "corn" ? [1.25, 0.23, 0.48] : crop === "wheat" ? [0.48, 0.12, 0.24] : [0.9, 0.2, 0.42],
    }))), [crop, grid, growth, height]);
  const fruitGrowth = Math.max(0, Math.min(1, (growth - 0.52) / 0.48));
  const fruits = useMemo<InstanceTransform[]>(() => {
    if (fruitGrowth <= 0) return [];
    const authored = crop === "apple"
      ? grid.flatMap(([x, z], tree) => Array.from({ length: 6 }, (_, slot): InstanceTransform => {
          const angle = slot * Math.PI / 3 + tree * 0.45;
          // On the crown surface (crown radius ≈ 0.33 when ripe), never inside it.
          return {
            position: [x + Math.cos(angle) * 0.37, 0.3 + height + 0.04 + Math.sin(angle * 1.7 + tree) * 0.12, z + Math.sin(angle) * 0.33],
            scale: [fruitGrowth, fruitGrowth, fruitGrowth],
          };
        }))
      : crop === "tomato" || crop === "orange"
      ? grid.flatMap(([x, z], index) => [-1, 1].map((side): InstanceTransform => ({
          position: [x + side * 0.075, 0.31 + height * (0.56 + (index % 2) * 0.13), z + (index % 3 - 1) * 0.025],
          scale: [fruitGrowth, fruitGrowth * 0.88, fruitGrowth],
        })))
      : grid.map(([x, z], index): InstanceTransform => ({
          position: crop === "wheat" ? [x, 0.27 + height, z] : [x + (index % 2 ? 0.08 : -0.08), 0.31 + height * 0.66, z],
          rotation: crop === "corn" ? [0, index * 0.41, index % 2 ? -0.28 : 0.28] : [0, index * 0.31, 0],
          scale: crop === "corn" ? [fruitGrowth * 0.68, fruitGrowth * 1.7, fruitGrowth * 0.68] : [fruitGrowth, fruitGrowth, fruitGrowth],
        }));
    if (!ready) return authored;
    return cropVisualSlotIndices(available, yieldCapacity, authored.length).map((index) => authored[index]);
  }, [available, crop, fruitGrowth, grid, height, ready, yieldCapacity]);
  const fruitColor = crop === "orange" ? (ready ? "#D58236" : growth > 0.78 ? "#b78b3e" : "#79a24b") : crop === "apple" ? (ready ? "#cf3a33" : growth > 0.78 ? "#c9803a" : "#8fae4a") : crop === "tomato" ? (ready ? "#df4035" : growth > 0.78 ? "#d98339" : "#79a24b") : crop === "wheat" ? (ready ? "#e8bd4c" : "#a4b15b") : (ready ? "#f2c53f" : "#83a950");
  return <group>
    <StaticInstances transforms={stems} castShadow><cylinderGeometry args={[crop === "wheat" ? 0.01 : 0.018, crop === "wheat" ? 0.015 : 0.024, 1, 6]} /><meshStandardMaterial color={crop === "apple" ? "#6b4a30" : crop === "wheat" && ready ? "#b89337" : "#4d7d3d"} roughness={0.94} /></StaticInstances>
    <StaticInstances transforms={leaves} castShadow><sphereGeometry args={[0.115, 7, 5]} /><meshStandardMaterial color={crop === "corn" ? "#4f8a43" : crop === "wheat" ? "#729348" : crop === "apple" ? "#3f7f3d" : "#438345"} roughness={0.96} /></StaticInstances>
    {fruits.length > 0 && <StaticInstances transforms={fruits} castShadow>
      {crop === "orange" ? <icosahedronGeometry args={[0.068, 1]} /> : crop === "apple" ? <sphereGeometry args={[0.064, 10, 8]} /> : crop === "tomato" ? <dodecahedronGeometry args={[0.068, 0]} /> : crop === "wheat" ? <coneGeometry args={[0.045, 0.17, 6]} /> : <sphereGeometry args={[0.075, 8, 6]} />}
      <meshStandardMaterial color={fruitColor} emissive={ready ? fruitColor : "#000000"} emissiveIntensity={ready ? 0.14 : 0} roughness={0.84} />
    </StaticInstances>}
  </group>;
}

function ReadyHarvestGlow({ accent }: { accent: string }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const pulse = (Math.sin(clock.elapsedTime * 2.25) + 1) / 2;
    ring.current.rotation.z = clock.elapsedTime * 0.16;
    ring.current.scale.setScalar(0.96 + pulse * 0.045);
    const material = ring.current.material;
    if (material instanceof THREE.MeshBasicMaterial) material.opacity = 0.17 + pulse * 0.11;
  });
  return <group position={[0, 0.295, 0]}>
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.76, 0.84, 28]} /><meshBasicMaterial color={accent} transparent opacity={0.2} depthWrite={false} toneMapped={false} /></mesh>
    <StaticInstances transforms={READY_SPARKLES}><octahedronGeometry args={[0.045, 0]} /><meshBasicMaterial color={accent} toneMapped={false} /></StaticInstances>
  </group>;
}

function AnimalPaddock({ kind }: { kind: "chicken" | "cow" }) {
  const width = kind === "cow" ? 3.35 : 2.75;
  const depth = kind === "cow" ? 2.25 : 1.95;
  const posts = useMemo<InstanceTransform[]>(() => [
    ...[-width / 2, width / 2].flatMap((x) => [-depth / 2, 0, depth / 2].map((z) => ({ position: [x, 0.46, z] as Position, scale: [0.085, 0.92, 0.085] as Position }))),
    ...[-width / 4, 0, width / 4].flatMap((x) => [-depth / 2, depth / 2].map((z) => ({ position: [x, 0.46, z] as Position, scale: [0.085, 0.92, 0.085] as Position }))),
  ], [depth, width]);
  const rails = useMemo<InstanceTransform[]>(() => [
    ...[-depth / 2, depth / 2].flatMap((z) => [0.32, 0.67].map((y) => ({ position: [0, y, z] as Position, scale: [width, 0.07, 0.07] as Position }))),
    ...[-width / 2, width / 2].flatMap((x) => [0.32, 0.67].map((y) => ({ position: [x, y, 0] as Position, scale: [0.07, 0.07, depth] as Position }))),
  ], [depth, width]);
  return <group>
    {/* Bevel radius must be smaller than half the thickness. The old 0.16
        inverted the thin shape and raised its surface through the legs. */}
    <RoundedBox name={`farm-paddock-ground:${kind}`} args={[width + 0.22, 0.075, depth + 0.22]} position={[0, 0.035, 0]} radius={0.025} smoothness={2} receiveShadow><meshStandardMaterial color={kind === "cow" ? "#6d9b55" : "#78a65b"} roughness={1} /></RoundedBox>
    <StaticInstances transforms={posts} castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#6d4930" roughness={0.94} /></StaticInstances>
    <StaticInstances transforms={rails} castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#95643c" roughness={0.92} /></StaticInstances>
    <group position={[width * 0.31, 0.18, -depth * 0.27]}>
      <RoundedBox args={[kind === "cow" ? 0.72 : 0.5, 0.28, 0.38]} radius={0.07} smoothness={2}><meshStandardMaterial color="#668c86" metalness={0.12} roughness={0.64} /></RoundedBox>
      <mesh position={[0, 0.16, 0]}><boxGeometry args={[kind === "cow" ? 0.58 : 0.38, 0.04, 0.25]} /><meshStandardMaterial color="#91c4cf" transparent opacity={0.78} roughness={0.22} /></mesh>
    </group>
  </group>;
}


/**
 * Readable board on a post, facing the camera: the numbers the owner plays
 * with (feed in the trough, eggs ready, units on the bed) belong in the world
 * at a size that can be read while walking, not in 13 cm of floating text.
 */
function StationSign({ position, title, rows, height = 1.35 }: {
  position: Position;
  title: string;
  rows: readonly { label: string; value: string; tone?: string }[];
  height?: number;
}) {
  const boardHeight = 0.42 + rows.length * 0.36;
  return <group name="dynamic:station-sign" position={position}>
    <mesh position={[0, height / 2 - 0.1, 0]} castShadow><cylinderGeometry args={[0.055, 0.065, height, 8]} /><meshStandardMaterial color="#6d5136" roughness={0.9} /></mesh>
    <group position={[0, height + boardHeight / 2 - 0.16, 0.04]} rotation={[-0.16, 0, 0]}>
      <RoundedBox args={[1.42, boardHeight, 0.09]} radius={0.08} smoothness={3} castShadow><meshStandardMaterial color="#1f3b33" roughness={0.78} /></RoundedBox>
      <RoundedBox args={[1.32, boardHeight - 0.1, 0.02]} position={[0, 0, 0.05]} radius={0.06} smoothness={3}><meshStandardMaterial color="#2c5749" roughness={0.7} /></RoundedBox>
      <Text position={[0, boardHeight / 2 - 0.18, 0.07]} fontSize={0.155} color="#ffe6a8" anchorX="center" anchorY="middle" fontWeight={900}>{title}</Text>
      {rows.map((row, index) => <group key={row.label} position={[0, boardHeight / 2 - 0.52 - index * 0.36, 0.07]}>
        <Text position={[-0.58, 0, 0]} fontSize={0.125} color="#bcd9cc" anchorX="left" anchorY="middle" fontWeight={800}>{row.label}</Text>
        <Text position={[0.58, 0, 0]} fontSize={0.23} color={row.tone ?? "#ffffff"} anchorX="right" anchorY="middle" fontWeight={900}>{row.value}</Text>
      </group>)}
    </group>
  </group>;
}

function AnimalStation({ kind, machine }: { kind: "chicken" | "cow"; machine: ProductionMachineState }) {
  const feed = chickenFeedStatus(machine);
  const hungry = feed.occupied === 0;
  return <group name="dynamic:farm-animal">
    <StationSign
      position={[kind === "cow" ? 1.95 : 1.75, 0, 0.1]}
      title={kind === "cow" ? "VACA" : "GALLINA"}
      rows={[
        { label: kind === "cow" ? "TRIGO" : "TOMATES", value: `${feed.occupied}/${feed.capacity}`, tone: hungry ? "#ffb27a" : "#ffffff" },
        { label: kind === "cow" ? "LECHE" : "HUEVOS", value: `${machine.output}/${machine.outputCapacity}`, tone: machine.output > 0 ? "#8ce6a1" : "#ffffff" },
      ]}
    />
    <EnvironmentModel id={kind === "chicken" ? "chicken_coop" : "cow_station"} />
    {kind === "chicken" ? <ChickenCharacter active={machine.status === "PROCESSING"} /> : <CowCharacter active={machine.status === "PROCESSING"} />}
    <group position={[kind === "cow" ? 0.62 : 0.44, 0.02, 0.42]} scale={0.72} visible={machine.output > 0}><EnvironmentModel id={kind === "chicken" ? "egg_output_tray" : "milk_output_can"} /></group>
  </group>;
}

function ChickenCharacter({ active }: { active: boolean }) { return <FarmAnimal kind="chicken" active={active} />; }
function CowCharacter({ active }: { active: boolean }) { return <FarmAnimal kind="cow" active={active} />; }

function FarmTools({ position }: { position: Position }) {
  return <group position={position}>
    <StaticInstances transforms={FARM_BENCH_LEGS} castShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#755033" roughness={0.9} /></StaticInstances>
    <Box args={[1.32, 0.13, 0.64]} position={[0, 0.92, 0]} color={palette.wood} radius={0.045} />
    <Box args={[1.16, 0.09, 0.52]} position={[0, 0.3, 0]} color="#8e6038" radius={0.025} />
    <group position={[0.32, 0.98, 0.02]} scale={0.62}><EnvironmentModel id="farm_tool_set" /></group>
    <WateringCan position={[-0.32, 1.12, 0]} />
    <SeedSack position={[0.32, 0.47, 0]} />
    <HarvestBasket position={[-0.48, 0.22, 0.5]} />
  </group>;
}

function FarmWaterTank() {
  return <group>
    <mesh position={[0, 0.72, 0]} castShadow receiveShadow><cylinderGeometry args={[0.5, 0.56, 1.38, 18]} /><meshStandardMaterial color="#769994" metalness={0.24} roughness={0.56} /></mesh>
    {[0.25, 0.68, 1.1].map((y) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.52, 0.025, 7, 18]} /><meshStandardMaterial color="#4d6763" metalness={0.38} roughness={0.45} /></mesh>)}
    <mesh position={[0, 1.46, 0]}><coneGeometry args={[0.6, 0.24, 18]} /><meshStandardMaterial color="#49675f" metalness={0.18} roughness={0.62} /></mesh>
    <mesh position={[0.48, 0.48, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.045, 0.045, 0.34, 9]} /><meshStandardMaterial color="#4f6661" metalness={0.42} roughness={0.38} /></mesh>
    <RoundedBox args={[0.8, 0.22, 0.52]} position={[0.9, 0.16, 0]} radius={0.06} smoothness={2}><meshStandardMaterial color="#687a74" roughness={0.72} /></RoundedBox>
  </group>;
}

function HarvestBasket({ position }: { position: Position }) {
  return <group position={position}>
    <mesh position={[0, 0.16, 0]}><cylinderGeometry args={[0.26, 0.2, 0.3, 12, 1, true]} /><meshStandardMaterial color="#a96f39" roughness={0.92} side={THREE.DoubleSide} /></mesh>
    {[0.04, 0.15, 0.27].map((y) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.22 + y * 0.11, 0.018, 6, 16]} /><meshStandardMaterial color="#704628" roughness={0.9} /></mesh>)}
    <mesh position={[0, 0.34, 0]}><torusGeometry args={[0.24, 0.025, 7, 18, Math.PI]} /><meshStandardMaterial color="#80502d" roughness={0.9} /></mesh>
  </group>;
}

function SeedSack({ position }: { position: Position }) {
  return <group position={position}>
    <mesh scale={[0.85, 1.2, 0.66]}><sphereGeometry args={[0.22, 14, 10]} /><meshStandardMaterial color="#b99559" roughness={1} /></mesh>
    <mesh position={[0, 0.27, 0]}><torusGeometry args={[0.085, 0.025, 6, 12]} /><meshStandardMaterial color="#765338" /></mesh>
  </group>;
}

function WateringCan({ position }: { position: Position }) {
  return <group position={position} scale={0.72}><mesh><cylinderGeometry args={[0.18, 0.21, 0.32, 12]} /><meshStandardMaterial color="#668c86" metalness={0.12} roughness={0.6} /></mesh><mesh position={[0.28, 0.04, 0]} rotation={[0, 0, -1.1]}><cylinderGeometry args={[0.055, 0.11, 0.48, 10]} /><meshStandardMaterial color="#668c86" metalness={0.12} roughness={0.6} /></mesh><mesh position={[-0.13, 0.15, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.18, 0.035, 7, 15, Math.PI]} /><meshStandardMaterial color="#668c86" metalness={0.12} roughness={0.6} /></mesh></group>;
}

function CompostBin({ position }: { position: Position }) {
  return <group position={position}><Box args={[0.78, 0.72, 0.72]} position={[0, 0.36, 0]} color="#5f4934" radius={0.08} />{[-0.26, 0, 0.26].map((offset) => <Box key={offset} args={[0.85, 0.075, 0.78]} position={[0, 0.38 + offset, 0]} color="#89603c" />)}<Box args={[0.87, 0.1, 0.8]} position={[0, 0.77, 0]} rotation={[0.08, 0, 0]} color="#68462f" radius={0.04} /><mesh position={[0, 0.84, 0]}><sphereGeometry args={[0.18, 8, 6]} /><meshStandardMaterial color="#41633a" roughness={1} /></mesh></group>;
}

function MiniGreenhouse({ position }: { position: Position }) {
  const paneTransmission = useGlassTransmission(0.12);
  return <group position={position}>
    <Box args={[1.12, 0.14, 0.88]} position={[0, 0.12, 0]} color="#68472f" radius={0.05} />
    {[-0.46, 0.46].flatMap((x) => [-0.34, 0.34].map((z) => <Box key={`${x}-${z}`} args={[0.045, 0.85, 0.045]} position={[x, 0.55, z]} color={palette.frame} />))}
    <mesh position={[0, 0.6, 0]}><boxGeometry args={[1, 0.8, 0.76]} /><meshPhysicalMaterial color="#b8e2d0" transparent opacity={0.2} roughness={0.12} transmission={paneTransmission} /></mesh>
    <mesh position={[0, 1.06, 0]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.76, 0.76, 0.78]} /><meshPhysicalMaterial color="#b8e2d0" transparent opacity={0.24} roughness={0.12} transmission={paneTransmission} /></mesh>
    <StaticInstances transforms={GREENHOUSE_SEEDLINGS} castShadow><coneGeometry args={[0.06, 0.25, 6]} /><meshStandardMaterial color="#559147" roughness={0.95} /></StaticInstances>
  </group>;
}

function Scarecrow({ position }: { position: Position }) {
  return <group position={position}><Box args={[0.08, 1.25, 0.08]} position={[0, 0.72, 0]} color={palette.wood} /><Box args={[0.92, 0.07, 0.07]} position={[0, 1.04, 0]} color={palette.wood} /><mesh position={[0, 1.37, 0]}><sphereGeometry args={[0.2, 10, 8]} /><meshStandardMaterial color="#c79a57" roughness={0.94} /></mesh><mesh position={[0, 1.57, 0]}><coneGeometry args={[0.34, 0.25, 12]} /><meshStandardMaterial color="#a36936" roughness={0.92} /></mesh><Box args={[0.64, 0.52, 0.1]} position={[0, 0.94, 0]} color="#a75f45" radius={0.06} /></group>;
}
