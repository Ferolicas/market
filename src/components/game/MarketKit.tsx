"use client";

import { RoundedBox, Text, useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { scaleStorePosition, STORE_ELEMENT_SCALE } from "@/game/world-scale";
import type { CheckoutTransaction, CropState, CustomerRuntimeState, Inventory, ProductId, ProductionMachineState } from "@/game/types";
import { cropProgress } from "@/game/stations/StationSystem";
import { CHECKOUT_LANES, activeCheckoutForLane, checkoutBagLocation, checkoutHandoffForLane } from "@/game/stations/checkout-layout";
import { FARM_PLOTS } from "@/game/stations/farm-layout";
import { RETAIL_DEPARTMENTS, retailDisplayPosition } from "@/game/stations/retail-layout";
import { marketAsset } from "@/game/assets/AssetRegistry";

type Position = [number, number, number];

const WALL_SHELF_LOW_LEVELS = [0.48, 1.03] as const;
const WALL_SHELF_TALL_LEVELS = [0.48, 1.03, 1.58, 2.1] as const;
const GONDOLA_LEVELS = [0.38, 0.83, 1.28] as const;

interface InstanceTransform {
  position: Position;
  rotation?: Position;
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
};

function StaticInstances({ transforms, children, castShadow = false, receiveShadow = false }: { transforms: readonly InstanceTransform[]; children: ReactNode; castShadow?: boolean; receiveShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    transforms.forEach((transform, index) => {
      dummy.position.set(...transform.position);
      dummy.rotation.set(...(transform.rotation ?? [0, 0, 0]));
      dummy.scale.set(...(transform.scale ?? [1, 1, 1]));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.count = transforms.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [transforms]);
  return <instancedMesh ref={ref} args={[undefined, undefined, transforms.length]} castShadow={castShadow} receiveShadow={receiveShadow}>{children}</instancedMesh>;
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

function ShelfMerchandising({ levels, width, z, accent }: { levels: readonly number[]; width: number; z: number; accent: string }) {
  const rails = useMemo<InstanceTransform[]>(() => levels.map((y) => ({ position: [0, y, z], scale: [width, 0.045, 0.035] })), [levels, width, z]);
  const tags = useMemo<InstanceTransform[]>(() => levels.flatMap((y) => [-0.3, 0.3].map((offset) => ({ position: [offset * width, y + 0.018, z + 0.021], scale: [0.22, 0.075, 0.018] }))), [levels, width, z]);
  return <group>
    <StaticInstances transforms={rails} receiveShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={accent} roughness={0.58} metalness={0.08} /></StaticInstances>
    <StaticInstances transforms={tags}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#fff6dc" roughness={0.72} /></StaticInstances>
  </group>;
}

function RetailProduct({ productId, position, scale = 1 }: { productId: ProductId; position: Position; scale?: number }) {
  if (productId === "tomatoes") return <group position={position} scale={scale}>
    <mesh castShadow scale={[1, 0.86, 1]}><sphereGeometry args={[0.09, 14, 10]} /><meshStandardMaterial color="#d94838" roughness={0.78} /></mesh>
    <mesh position={[0, 0.078, 0]} rotation={[0, 0, Math.PI]}><coneGeometry args={[0.052, 0.045, 5]} /><meshStandardMaterial color="#37743e" roughness={0.9} /></mesh>
  </group>;
  if (productId === "apples") return <group position={position} scale={scale}>
    <mesh castShadow scale={[0.92, 1, 0.92]}><sphereGeometry args={[0.085, 14, 10]} /><meshStandardMaterial color="#bd3432" roughness={0.72} /></mesh>
    <mesh position={[0, 0.102, 0]}><cylinderGeometry args={[0.009, 0.012, 0.065, 6]} /><meshStandardMaterial color="#5b3c27" /></mesh>
    <mesh position={[0.045, 0.112, 0]} rotation={[0, 0, -0.55]} scale={[1, 0.35, 0.55]}><sphereGeometry args={[0.045, 8, 5]} /><meshStandardMaterial color="#4e873f" roughness={0.9} /></mesh>
  </group>;
  if (productId === "corn") return <group position={position} scale={scale}>
    <mesh castShadow scale={[0.62, 1.22, 0.62]}><sphereGeometry args={[0.075, 12, 8]} /><meshStandardMaterial color="#f0bf36" roughness={0.85} /></mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[side * 0.048, -0.02, 0]} rotation={[0, 0, side * 0.38]} scale={[0.45, 1, 0.35]}><sphereGeometry args={[0.082, 9, 6]} /><meshStandardMaterial color="#5d9348" roughness={0.95} /></mesh>)}
  </group>;
  if (productId === "eggs") return <mesh castShadow position={position} scale={[0.78 * scale, 1.08 * scale, 0.78 * scale]}><sphereGeometry args={[0.073, 12, 9]} /><meshStandardMaterial color="#f4e9d0" roughness={0.93} /></mesh>;
  if (productId === "milk" || productId === "juice") return <group position={position} scale={scale}>
    <mesh castShadow><cylinderGeometry args={[0.055, 0.064, 0.22, 10]} /><meshStandardMaterial color={productId === "milk" ? "#f7f3e9" : "#ee8643"} roughness={0.58} /></mesh>
    <mesh position={[0, 0.135, 0]}><cylinderGeometry args={[0.03, 0.034, 0.055, 9]} /><meshStandardMaterial color={productId === "milk" ? "#4e91bc" : "#438653"} roughness={0.6} /></mesh>
    <mesh position={[0, 0, 0.061]}><planeGeometry args={[0.075, 0.09]} /><meshStandardMaterial color={productId === "milk" ? "#5a9ec8" : "#fff0c6"} /></mesh>
  </group>;
  if (productId === "cheese") return <mesh castShadow position={position} rotation={[0, Math.PI / 2, 0]} scale={scale}><cylinderGeometry args={[0.105, 0.105, 0.14, 3]} /><meshStandardMaterial color="#edbd3e" roughness={0.78} /></mesh>;
  if (productId === "bread") return <group position={position} scale={scale}>
    <RoundedBox args={[0.22, 0.16, 0.15]} radius={0.065} smoothness={3} castShadow><meshStandardMaterial color="#b97336" roughness={0.9} /></RoundedBox>
    {[-0.05, 0.02, 0.085].map((x) => <mesh key={x} position={[x, 0.073, 0]} rotation={[0, 0, -0.3]}><boxGeometry args={[0.012, 0.06, 0.158]} /><meshStandardMaterial color="#e7bd75" /></mesh>)}
  </group>;
  const packageColor = productId === "coffee" ? "#6b3d2d" : productId === "flour" ? "#eee4cc" : "#d5ab42";
  const label = productId === "coffee" ? "CAFÉ" : productId === "flour" ? "HARINA" : "TRIGO";
  return <group position={position} scale={scale}>
    <Box args={[0.17, 0.24, 0.12]} color={packageColor} radius={0.022} />
    <Text position={[0, 0, 0.064]} fontSize={0.037} color={productId === "coffee" ? "#fff1d0" : "#59462d"} anchorX="center" anchorY="middle" fontWeight={800}>{label}</Text>
  </group>;
}

function RetailProductRow({ productId, count, y, z = 0.36, spacing = 0.19 }: { productId: ProductId; count: number; y: number; z?: number; spacing?: number }) {
  return <>{Array.from({ length: count }, (_, index) => <RetailProduct key={`${productId}-${index}`} productId={productId} position={[(index - (count - 1) / 2) * spacing, y, z]} scale={0.92} />)}</>;
}

function StoreElement({ position, children }: { position: Position; children: ReactNode }) {
  return <group position={scaleStorePosition(position)} scale={STORE_ELEMENT_SCALE}>{children}</group>;
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
  return <>{onFrame && <EnvironmentFrameDriver model={model} onFrame={onFrame} />}<primitive object={model} dispose={null} /></>;
}

function EnvironmentFrameDriver({ model, onFrame }: { model: THREE.Group; onFrame: EnvironmentFrameHandler }) {
  useFrame(({ clock }, delta) => onFrame(model, delta, clock.elapsedTime));
  return null;
}

export function KitFurniture({ shelves, machines, customers, checkoutTransactions, returnsBin, returnedCartCount, lightsOn, unlockedAreas }: { shelves: Inventory; machines: ProductionMachineState[]; customers: CustomerRuntimeState[]; checkoutTransactions: CheckoutTransaction[]; returnsBin: Inventory; returnedCartCount: number; lightsOn: boolean; unlockedAreas: string[] }) {
  const machine = (id: string) => machines.find((candidate) => candidate.id === id);
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
    }
  }, [activeCheckouts, checkoutHandoffs, checkoutHandoffLocations]);
  return <group>
    <StoreElement position={[-5.2, 0, -8.05]}><WallShelf position={[0, 0, 0]} width={2.05} productId="bread" count={shelves.bread} low /></StoreElement>
    <StoreElement position={[-2.8, 0, -8.05]}><WallShelf position={[0, 0, 0]} width={2.05} productId="coffee" count={shelves.coffee} /></StoreElement>
    <StoreElement position={[-0.4, 0, -8.05]}><WallShelf position={[0, 0, 0]} width={2.05} productId="juice" count={shelves.juice} /></StoreElement>
    <StoreElement position={[2.0, 0, -8.05]}><WallShelf position={[0, 0, 0]} width={2.05} productId="flour" count={shelves.flour} /></StoreElement>
    <StoreElement position={[5.25, 0, -8.0]}><GlassFridge position={[0, 0, 0]} milk={shelves.milk} cheese={shelves.cheese} open={coldDoorActive} /></StoreElement>
    <StoreElement position={[8.65, 0, -7.85]}><MetalRack position={[0, 0, 0]} /></StoreElement>

    <StoreElement position={retailDisplayPosition("bakery")}><Gondola position={[0, 0, 0]} productId="bread" count={shelves.bread} single /></StoreElement>
    <StoreElement position={retailDisplayPosition("pantry")}><Gondola position={[0, 0, 0]} productId="coffee" count={shelves.coffee} /></StoreElement>
    <StoreElement position={retailDisplayPosition("eggs")}><EggDisplay count={shelves.eggs} /></StoreElement>
    <StoreElement position={retailDisplayPosition("produce")}><ProduceTable position={[0, 0, 0]} tomatoes={shelves.tomatoes} apples={shelves.apples} corn={shelves.corn} /></StoreElement>
    <StoreElement position={retailDisplayPosition("dairy")}><ChilledDisplay position={[0, 0, 0]} milk={shelves.milk} cheese={shelves.cheese} /></StoreElement>
    <StoreElement position={retailDisplayPosition("drinks")}><DrinksDisplay position={[0, 0, 0]} count={shelves.juice} /></StoreElement>
    <StoreElement position={[-7.0, 0, 3.15]}><ProduceRack position={[0, 0, 0]} count={shelves.corn} /></StoreElement>
    {unlockedAreas.includes("endcap-display") && <StoreElement position={[6.4, 0, -2.2]}><EnvironmentModel id="shelf_endcap" /><group position={[0, 0, 0.72]} scale={0.72}><EnvironmentModel id="display_promo_basket" /></group></StoreElement>}

    <StoreElement position={[...CHECKOUT_LANES[0].counter]}><CheckoutKit position={[0, 0, 0]} lane={0} transaction={activeCheckouts[0]} handoffTransaction={checkoutHandoffs[0]} handoffBagAtCounter={checkoutHandoffLocations[0] === "counter"} /></StoreElement>
    <StoreElement position={[...CHECKOUT_LANES[0].cashierWork]}><CashierWorkArea /></StoreElement>
    {unlockedAreas.includes("checkout-2") && <><StoreElement position={[...CHECKOUT_LANES[1].counter]}><CheckoutKit position={[0, 0, 0]} lane={1} transaction={activeCheckouts[1]} handoffTransaction={checkoutHandoffs[1]} handoffBagAtCounter={checkoutHandoffLocations[1] === "counter"} /></StoreElement><StoreElement position={[...CHECKOUT_LANES[1].cashierWork]}><CashierWorkArea /></StoreElement></>}
    <StoreElement position={[9.85, 0, 5.45]}><ReturnsCubicle inventory={returnsBin} /></StoreElement>
    <StoreElement position={[3.05, 0, 6.55]}><CartBay position={[0, 0, 0]} count={returnedCartCount} /></StoreElement>
    {unlockedAreas.includes("bread-oven") && <StoreElement position={[-8.75, 0, -0.45]}><BakeryKit position={[0, 0, 0]} machine={machine("bread-oven-1")} /></StoreElement>}
    <StoreElement position={[-9.0, 0, 2.05]}><PrepSink position={[0, 0, 0]} /></StoreElement>
    {unlockedAreas.includes("flour-mill") && <StoreElement position={[-8.75, 0, -4.05]}><MillMachine position={[0, 0, 0]} machine={machine("flour-mill-1")} /></StoreElement>}
    {unlockedAreas.includes("cheese-maker") && <StoreElement position={[-6.15, 0, -2.2]}><ProcessMachine kind="cheese" machine={machine("cheese-maker-1")} /></StoreElement>}
    {unlockedAreas.includes("juice-machine") && <StoreElement position={[-5.65, 0, 1.55]}><ProcessMachine kind="juice" machine={machine("juice-machine-1")} /></StoreElement>}
    <StoreElement position={[8.8, 0, -2.15]}><SupplierCorner position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[8.8, 0, -5.35]}><TerminalModel position={[0, 0, 0]} label="MAPA" /></StoreElement>
    <StoreUtilities lightsOn={lightsOn} />
  </group>;
}

const PRODUCTS_LABELS: Record<ProductId, string> = {
  tomatoes: "TOMATES",
  apples: "MANZANAS",
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

function departmentColor(productId: ProductId) {
  return RETAIL_DEPARTMENTS[productId === "tomatoes" || productId === "apples" || productId === "corn" ? "produce"
    : productId === "eggs" ? "eggs"
      : productId === "milk" || productId === "cheese" ? "dairy"
        : productId === "juice" ? "drinks"
          : productId === "coffee" ? "pantry" : "bakery"].color;
}

function WallShelf({ position, width, productId, count, low = false }: { position: Position; width: number; productId: ProductId; count: number; low?: boolean }) {
  const perRow = Math.floor(width * 4);
  const levels = low ? WALL_SHELF_LOW_LEVELS : WALL_SHELF_TALL_LEVELS;
  return <group position={position}>
    <EnvironmentModel id={low ? "shelf_wall_low" : "shelf_wall_tall"} />
    {levels.map((y, row) => <RetailProductRow key={y} productId={productId} y={y + 0.16} z={0.48} count={Math.min(perRow, Math.max(0, count - row * perRow))} />)}
    <ShelfMerchandising levels={levels} width={1.86} z={0.53} accent={departmentColor(productId)} />
    <DepartmentSign label={PRODUCTS_LABELS[productId]} color={departmentColor(productId)} position={[0, low ? 1.42 : 2.42, 0.08]} width={1.88} />
  </group>;
}

function Gondola({ position, productId, count, single = false }: { position: Position; productId: ProductId; count: number; single?: boolean }) {
  return <group position={position}>
    <EnvironmentModel id={single ? "shelf_gondola_single" : "shelf_gondola_double"} />
    {(single ? [1] : [-1, 1]).map((side, sideIndex) => <group key={side} position={[0, 0, side * 0.31]} rotation={[0, side < 0 ? Math.PI : 0, 0]}>
      {GONDOLA_LEVELS.map((y, row) => <RetailProductRow key={y} productId={productId} y={y + 0.15} z={0.31} count={Math.min(8, Math.max(0, count - (sideIndex * 3 + row) * 8))} />)}
      <ShelfMerchandising levels={GONDOLA_LEVELS} width={1.86} z={0.35} accent={departmentColor(productId)} />
    </group>)}
    <Box args={[2.05, 0.13, 0.86]} position={[0, 0.08, 0]} color={palette.frame} radius={0.045} />
    <DepartmentSign label={productId === "bread" ? RETAIL_DEPARTMENTS.bakery.label : RETAIL_DEPARTMENTS.pantry.label} color={productId === "bread" ? RETAIL_DEPARTMENTS.bakery.color : RETAIL_DEPARTMENTS.pantry.color} position={[0, 1.82, 0]} width={1.85} />
  </group>;
}

function ProduceTable({ position, tomatoes, apples, corn }: { position: Position; tomatoes: number; apples: number; corn: number }) {
  const productIds: ProductId[] = ["tomatoes", "apples", "corn"];
  const counts = [tomatoes, apples, corn];
  return <group position={position}>
    <EnvironmentModel id="display_produce_mixed" />
    <DepartmentSign label={RETAIL_DEPARTMENTS.produce.label} color={RETAIL_DEPARTMENTS.produce.color} position={[0, 1.86, 0.04]} width={1.94} />
    {[-0.72, 0, 0.72].map((x, column) => <group key={x} position={[x, 0.64, 0]} rotation={[0, 0, column === 1 ? 0 : (column ? -0.13 : 0.13)]}>
      {Array.from({ length: Math.min(9, counts[column]) }, (_, index) => <RetailProduct key={index} productId={productIds[column]} position={[(index % 3 - 1) * 0.15, 0.15, (Math.floor(index / 3) - 1) * 0.18]} scale={0.88} />)}
    </group>)}
    {productIds.map((productId, index) => <Text key={productId} position={[(index - 1) * 0.72, 1.2, 0.48]} fontSize={0.105} color="#f8f1dc" anchorX="center" fontWeight={800}>{PRODUCTS_LABELS[productId]}</Text>)}
  </group>;
}

function ProduceRack({ position, count }: { position: Position; count: number }) {
  return <group position={position}>
    <EnvironmentModel id="display_produce_tomato" />
    {[0.38, 0.88, 1.36].map((y, row) => <group key={y} position={[0, y, 0]} rotation={[row === 2 ? -0.12 : -0.2, 0, 0]}>
      {[-0.52, 0, 0.52].map((x, column) => <group key={x}>
        {Array.from({ length: Math.min(5, Math.max(0, count - (row * 3 + column) * 5)) }, (_, index) => <RetailProduct key={index} productId="corn" position={[x + (index % 2) * 0.13 - 0.06, 0.19, (Math.floor(index / 2) - 1) * 0.16]} scale={0.8} />)}
      </group>)}
    </group>)}
  </group>;
}

function ChilledDisplay({ position, milk, cheese }: { position: Position; milk: number; cheese: number }) {
  return <group position={position}>
    <EnvironmentModel id="display_refrigerated_open" />
    <DepartmentSign label={RETAIL_DEPARTMENTS.dairy.label} color={RETAIL_DEPARTMENTS.dairy.color} position={[0, 2.28, 0.03]} width={1.9} />
    {[0.56, 1.05, 1.54].map((y, row) => <group key={y}>
      <group position={[-0.49, 0, 0]}><RetailProductRow productId="milk" y={y} z={0.34} spacing={0.18} count={Math.min(4, Math.max(0, milk - row * 4))} /></group>
      <group position={[0.49, 0, 0]}><RetailProductRow productId="cheese" y={y} z={0.34} spacing={0.18} count={Math.min(4, Math.max(0, cheese - row * 4))} /></group>
    </group>)}
    <mesh position={[0, 1.12, 0.08]}><planeGeometry args={[1.92, 1.62]} /><meshBasicMaterial color="#bce7ee" transparent opacity={0.065} depthWrite={false} /></mesh>
  </group>;
}

function DrinksDisplay({ position, count }: { position: Position; count: number }) {
  return <group position={position}>
    <EnvironmentModel id="display_refrigerated_open" />
    <DepartmentSign label={RETAIL_DEPARTMENTS.drinks.label} color={RETAIL_DEPARTMENTS.drinks.color} position={[0, 2.28, 0.03]} width={1.9} />
    {[0.52, 1.02, 1.52].map((y, row) => <RetailProductRow key={y} productId="juice" y={y} z={0.33} count={Math.min(7, Math.max(0, count - row * 7))} />)}
  </group>;
}

function EggDisplay({ count }: { count: number }) {
  return <group>
    <EnvironmentModel id="display_eggs" />
    <DepartmentSign label={RETAIL_DEPARTMENTS.eggs.label} color={RETAIL_DEPARTMENTS.eggs.color} position={[0, 1.86, 0.04]} width={1.48} />
    {[0.5, 0.93, 1.36].map((y, row) => <EggCarton key={y} position={[0, y, 0.24]} count={Math.min(6, Math.max(0, count - row * 6))} />)}
  </group>;
}

function EggCarton({ position, count }: { position: Position; count: number }) {
  return <group position={position}>
    <Box args={[1.22, 0.1, 0.48]} color="#bca47a" radius={0.025} />
    {Array.from({ length: count }, (_, index) => <RetailProduct key={index} productId="eggs" position={[(index % 6 - 2.5) * 0.19, 0.1, 0]} scale={0.9} />)}
    <Text position={[0, -0.01, 0.255]} fontSize={0.075} color="#604f36" anchorX="center" fontWeight={800}>HUEVOS FRESCOS</Text>
  </group>;
}

function GlassFridge({ position, milk, cheese, open }: { position: Position; milk: number; cheese: number; open: boolean }) {
  return <group position={position}>
    <EnvironmentModel id="display_refrigerated_doors" onFrame={(model, delta) => model.traverse((node) => { if (node.name.startsWith("Door")) node.rotation.y = THREE.MathUtils.lerp(node.rotation.y, open ? (node.name.endsWith(".001") ? -0.55 : 0.55) : 0, 1 - Math.exp(-7 * delta)); })} />
    {[-0.52, 0.52].map((x, door) => <group key={x} position={[x, 1.25, 0.36]}>
      {[0.55, 0.05, -0.45].map((y, row) => <group key={y}><Box args={[0.86, 0.035, 0.35]} position={[0, y, -0.08]} color="#d8dfdc" /><RetailProductRow productId={door ? "cheese" : "milk"} y={y + 0.12} z={0.03} spacing={0.18} count={Math.min(4, Math.max(0, (door ? cheese : milk) - row * 4))} /></group>)}
    </group>)}
  </group>;
}

function MetalRack({ position }: { position: Position }) {
  return <group position={position}><EnvironmentModel id="rack_stockroom" /></group>;
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
  return <group position={position}>
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
  return <group>
    <Box args={[1.35, 1.25, 1.05]} position={[0, 0.63, 0]} color="#d5c3aa" radius={0.08} />
    <Box args={[1.05, 0.72, 0.82]} position={[0, 0.86, 0.04]} color="#735847" radius={0.06} />
    <mesh position={[0, 1.31, 0.54]}><boxGeometry args={[1.42, 0.34, 0.08]} /><meshStandardMaterial color="#e7bb62" /></mesh>
    <Text position={[0, 1.31, 0.59]} fontSize={0.15} color="#493821" anchorX="center">DEVOLUCIONES</Text>
    {units.map((productId, index) => <RetailProduct key={`${productId}-${index}`} productId={productId} position={[(index % 3 - 1) * 0.24, 0.62 + Math.floor(index / 3) * 0.2, 0.48]} />)}
  </group>;
}

function CartBay({ position, count }: { position: Position; count: number }) {
  return <group position={position}>
    <Box args={[2.1, 0.08, 1.45]} position={[0, 0.04, 0]} color="#5d6e68" radius={0.025} />
    {[-0.96, 0.96].map((x) => <group key={x}><mesh position={[x, 0.65, 0]}><boxGeometry args={[0.07, 1.3, 1.45]} /><meshStandardMaterial color="#667772" metalness={0.4} /></mesh><mesh position={[x, 1.31, 0]}><sphereGeometry args={[0.11, 12, 8]} /><meshStandardMaterial color="#e7b759" emissive="#765318" emissiveIntensity={0.25} /></mesh></group>)}
    <mesh position={[0, 1.48, -0.66]}><boxGeometry args={[2.05, 0.38, 0.1]} /><meshStandardMaterial color="#f2e6bd" /></mesh>
    <Text position={[0, 1.48, -0.59]} fontSize={0.16} color="#2f4d43" anchorX="center">CARROS</Text>
    {Array.from({ length: Math.max(2, Math.min(4, count)) }, (_, index) => <ShoppingCart key={index} position={[0, 0, 0.42 - index * 0.26]} scale={1 - index * 0.055} />)}
  </group>;
}

function ShoppingCart({ position, scale = 1 }: { position: Position; scale?: number }) {
  return <group position={position} scale={scale}>
    <mesh position={[0, 0.84, -0.3]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.035, 0.035, 1.05, 8]} /><meshStandardMaterial color="#4f6945" /></mesh>
    {[-0.38, 0.38].map((x) => <group key={x}>
      <Box args={[0.035, 0.52, 0.68]} position={[x, 0.55, 0]} color={palette.metal} radius={0.01} />
      {[-0.25,-0.08,0.09,0.26].map((z) => <Box key={z} args={[0.035, 0.44, 0.025]} position={[x,0.59,z]} color={palette.metal} radius={0.008} />)}
    </group>)}
    {[-0.27,-0.09,0.09,0.27].map((x) => <Box key={x} args={[0.025, 0.44, 0.64]} position={[x,0.59,0]} color={palette.metal} radius={0.008} />)}
    {[-0.28,0.28].map((z) => <Box key={z} args={[0.82, 0.035, 0.035]} position={[0,0.38,z]} color={palette.metal} radius={0.01} />)}
    {[-0.35,0.35].map((x) => <Box key={x} args={[0.045,0.52,0.045]} position={[x,0.29,-0.21]} rotation={[0,0,x<0?-0.12:0.12]} color={palette.metal} />)}
    {[-0.33, 0.33].flatMap((x) => [-0.22, 0.22].map((z) => <mesh key={`${x}-${z}`} position={[x, 0.08, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.07, 0.07, 0.05, 10]} /><meshStandardMaterial color="#303634" /></mesh>))}
  </group>;
}

function BakeryKit({ position, machine }: { position: Position; machine?: ProductionMachineState }) {
  const processing = machine?.status === "PROCESSING";
  return <group position={position}>
    <EnvironmentModel id="equipment_bread_oven" onFrame={(model, delta) => model.traverse((node) => { if (node.name.startsWith("OvenGlass")) node.rotation.x = THREE.MathUtils.lerp(node.rotation.x, processing ? 0 : -0.55, 1 - Math.exp(-6 * delta)); })} />
    <group position={[1.35, 0, 0]} scale={0.72}><EnvironmentModel id="display_bakery" /></group>
    {processing && <pointLight position={[0, 0.95, 0.52]} intensity={0.8} distance={2.2} color="#df8b43" />}
  </group>;
}

function PrepSink({ position }: { position: Position }) {
  return <group position={position} rotation={[0, Math.PI / 2, 0]}>
    {[-0.65, 0.65].flatMap((x) => [-0.3, 0.3].map((z) => <Box key={`${x}-${z}`} args={[0.07, 0.82, 0.07]} position={[x, 0.41, z]} color={palette.metal} />))}
    <Box args={[1.55, 0.18, 0.78]} position={[0, 0.82, 0]} color="#aeb9b6" radius={0.07} />
    <Box args={[0.92, 0.12, 0.55]} position={[0, 0.8, 0]} color="#59635f" radius={0.09} />
    <mesh position={[0, 1.13, -0.12]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.2, 0.035, 8, 18, Math.PI]} /><meshStandardMaterial color="#929e9a" metalness={0.38} roughness={0.35} /></mesh>
    <mesh position={[0.2, 1.12, 0.04]}><cylinderGeometry args={[0.035, 0.035, 0.26, 10]} /><meshStandardMaterial color="#929e9a" metalness={0.38} roughness={0.35} /></mesh>
    <Box args={[1.38, 0.08, 0.64]} position={[0, 0.18, 0]} color={palette.metal} />
  </group>;
}

function MillMachine({ position, machine }: { position: Position; machine?: ProductionMachineState }) {
  const processing = machine?.status === "PROCESSING";
  return <group position={position}>
    <EnvironmentModel id="equipment_flour_mill" onFrame={(model, delta) => { if (!processing) return; model.traverse((node) => { if (node.name.startsWith("Wheel")) node.rotation.z += delta * 4.8; }); }} />
  </group>;
}

function ProcessMachine({ kind, machine }: { kind: "cheese" | "juice"; machine?: ProductionMachineState }) {
  const processing = machine?.status === "PROCESSING";
  return <group>
    <EnvironmentModel id={kind === "cheese" ? "equipment_cheese_maker" : "equipment_juice_machine"} onFrame={(model, _, elapsed) => { if (processing) model.rotation.y = Math.sin(elapsed * 4) * 0.018; }} />
    {processing && <pointLight position={[0, 0.65, 0.45]} intensity={0.45} distance={1.6} color={kind === "cheese" ? "#ffd75c" : "#ff6b43"} />}
    {Array.from({ length: Math.min(4, machine?.output ?? 0) }, (_, index) => <RetailProduct key={index} productId={kind} position={[0.34 + (index % 2) * 0.13, 0.16 + Math.floor(index / 2) * 0.12, 0.45]} scale={0.8} />)}
  </group>;
}

function SupplierCorner({ position }: { position: Position }) {
  return <group position={position}>
    <TerminalModel position={[0, 0, 0]} label="PEDIDOS" />
    <group position={[0, 0, -1.35]} scale={0.72}><EnvironmentModel id="equipment_delivery_dock" /></group>
    <Pallet position={[-0.05, 0, -1.3]} />
    <Parcel position={[-0.3, 0.34, -1.3]} />
    <Parcel position={[0.25, 0.34, -1.3]} small />
    <Parcel position={[0.05, 0.73, -1.3]} />
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

function StoreUtilities({ lightsOn }: { lightsOn: boolean }) {
  return <group>
    <StoreElement position={[9.2, 2.2, -8.34]}><WallClock position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[-10.75, 2.55, -8.05]}><SecurityCamera position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[10.65, 2.55, 7.2]}><SecurityCamera position={[0, 0, 0]} rotationY={Math.PI} /></StoreElement>
    <StoreElement position={[7.25, 2.45, 1.65]}><HangingSign position={[0, 0, 0]} label="CAJAS" /></StoreElement>
    <StoreElement position={[-3.8, 2.45, -3.35]}><HangingSign position={[0, 0, 0]} label="DESPENSA" /></StoreElement>
    {[-7.2, -2.4, 2.4, 7.2].map((x) => <StoreElement key={x} position={[x, 2.85, -0.6]}><CeilingLamp position={[0, 0, 0]} on={lightsOn} /></StoreElement>)}
  </group>;
}

function WallClock({ position }: { position: Position }) {
  return <group position={position} rotation={[0, 0, 0]}><mesh><cylinderGeometry args={[0.34, 0.34, 0.08, 24]} /><meshStandardMaterial color="#f7f2e2" /></mesh><mesh position={[0, -0.045, 0.05]} rotation={[Math.PI / 2, 0, 0]}><boxGeometry args={[0.025, 0.25, 0.025]} /><meshStandardMaterial color="#303735" /></mesh><mesh position={[0.09, 0.02, 0.055]} rotation={[Math.PI / 2, 0, -0.85]}><boxGeometry args={[0.02, 0.18, 0.02]} /><meshStandardMaterial color="#303735" /></mesh></group>;
}

function SecurityCamera({ position, rotationY = 0 }: { position: Position; rotationY?: number }) {
  return <group position={position} rotation={[0, rotationY, 0]}><Box args={[0.42, 0.22, 0.2]} position={[0, 0, 0]} color="#e6e9e3" radius={0.07} /><mesh position={[0, 0, 0.12]}><circleGeometry args={[0.06, 12]} /><meshStandardMaterial color="#202725" /></mesh><Box args={[0.06, 0.35, 0.06]} position={[0, 0.22, -0.05]} color={palette.frame} /></group>;
}

function HangingSign({ position, label }: { position: Position; label: string }) {
  return <group position={position}><Box args={[1.35, 0.42, 0.08]} color={palette.darkGreen} radius={0.04} /><Text position={[0, 0, 0.05]} fontSize={0.15} color="#f6efd9">{label}</Text>{[-0.48, 0.48].map((x) => <Box key={x} args={[0.025, 0.55, 0.025]} position={[x, 0.45, 0]} color={palette.frame} />)}</group>;
}

function CeilingLamp({ position, on }: { position: Position; on: boolean }) {
  const updateMaterials = useCallback((model: THREE.Group) => model.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshStandardMaterial)) return;
    node.material.emissive.set(on ? "#fff0b8" : "#000000");
    node.material.emissiveIntensity = on ? 1.1 : 0;
  }), [on]);
  return <group position={position}><EnvironmentModel id="equipment_ceiling_light" isolateMaterials onUpdate={updateMaterials} />{on && <pointLight position={[0, -0.15, 0]} intensity={0.18} distance={4} color="#fff2c9" />}</group>;
}

type FarmCropKind = "tomato" | "wheat" | "corn";

const FARM_CENTER: Position = [-8.25, 0, 10.925];
const TOMATO_GRID = Array.from({ length: 15 }, (_, index): [number, number] => [((index % 5) - 2) * 0.3, (Math.floor(index / 5) - 1) * 0.3]);
const WHEAT_GRID = Array.from({ length: 28 }, (_, index): [number, number] => [((index % 7) - 3) * 0.215, (Math.floor(index / 7) - 1.5) * 0.205]);
const CORN_GRID = Array.from({ length: 12 }, (_, index): [number, number] => [((index % 4) - 1.5) * 0.39, (Math.floor(index / 4) - 1) * 0.31]);
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
  ...Array.from({ length: 23 }, (_, index): InstanceTransform => ({
    position: [-3.05 + index * 0.36, 0.055, Math.sin(index * 0.9) * 0.045],
    rotation: [0, (index % 5 - 2) * 0.08, 0],
    scale: [0.9 + (index % 3) * 0.07, 1, 0.72 + (index % 2) * 0.08],
  })),
  ...Array.from({ length: 9 }, (_, index): InstanceTransform => ({
    position: [Math.sin(index * 1.1) * 0.035, 0.052, -1.68 + index * 0.41],
    rotation: [0, (index % 4 - 1.5) * 0.1, 0],
    scale: [0.78 + (index % 2) * 0.08, 1, 0.88],
  })),
];
const GARDEN_GRASS_TUFTS: readonly InstanceTransform[] = Array.from({ length: 34 }, (_, index): InstanceTransform => {
  const side = index % 2 ? 1 : -1;
  const lane = Math.floor(index / 2);
  return {
    position: [side * (2.15 + (lane % 4) * 0.27), 0.13, -1.5 + (lane % 9) * 0.37],
    rotation: [0, index * 0.73, (index % 3 - 1) * 0.08],
    scale: [0.7 + (index % 3) * 0.12, 0.75 + (index % 4) * 0.1, 0.7],
  };
});
const GARDEN_FLOWERS: readonly InstanceTransform[] = [
  [-2.78, -1.28], [-2.92, 1.16], [2.72, -1.34], [2.84, 1.18], [-2.55, 1.55], [2.44, 1.58],
].map(([x, z], index) => ({ position: [x, 0.26 + (index % 2) * 0.035, z], scale: [0.85, 0.85, 0.85] }));
const READY_SPARKLES: readonly InstanceTransform[] = [
  { position: [-0.78, 0.1, -0.42], scale: [0.7, 0.7, 0.7] },
  { position: [0.8, 0.18, 0.31], scale: [0.55, 0.55, 0.55] },
  { position: [0.62, 0.08, -0.48], scale: [0.42, 0.42, 0.42] },
];
const FARM_BENCH_LEGS: readonly InstanceTransform[] = [-0.56, 0.56].flatMap((x) => [-0.24, 0.24].map((z): InstanceTransform => ({ position: [x, 0.48, z], scale: [0.09, 0.96, 0.09] })));
const GREENHOUSE_SEEDLINGS: readonly InstanceTransform[] = TOMATO_GRID.slice(0, 6).map(([x, z]) => ({ position: [x * 0.55, 0.28, z * 0.52], scale: [0.5, 0.5, 0.5] }));

export function KitFarm({ crops, machines, nowMs, unlockedAreas }: { crops: CropState[]; machines: ProductionMachineState[]; nowMs: number; unlockedAreas: string[] }) {
  const cropsById = useMemo(() => new Map(crops.map((crop) => [crop.id, crop])), [crops]);
  const chicken = machines.find((machine) => machine.id === "chicken-coop-1");
  const cow = machines.find((machine) => machine.id === "cow-station-1");
  return <group>
    <StoreElement position={FARM_CENTER}><GardenFloor /></StoreElement>
    {FARM_PLOTS.map((plot) => {
      const crop = cropsById.get(plot.id);
      return <StoreElement key={plot.id} position={[plot.position[0], plot.position[1], plot.position[2]]}>
        {!crop || crop.status === "LOCKED"
          ? <DormantCropPlot />
          : <CropPlot position={[0, 0, 0]} crop={farmCropKind(crop.productId)} status={crop.status} progress={cropProgress(crop, nowMs)} accent={plot.accent} />}
      </StoreElement>;
    })}
    <StoreElement position={[-4.65, 0, 9.45]}><FarmTools position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[-10.85, 0, 9.28]}><CompostBin position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[-5.08, 0, 12.52]}><MiniGreenhouse position={[0, 0, 0]} /></StoreElement>
    <StoreElement position={[-10.8, 0, 12.52]}><Scarecrow position={[0, 0, 0]} /></StoreElement>
    {unlockedAreas.includes("chicken-coop") && chicken && <StoreElement position={[-3.45, 0, 10.8]}><AnimalStation kind="chicken" machine={chicken} /></StoreElement>}
    {unlockedAreas.includes("cow-station") && cow && <StoreElement position={[-1.5, 0, 10.8]}><AnimalStation kind="cow" machine={cow} /></StoreElement>}
  </group>;
}

function DormantCropPlot() {
  return <group>
    <RaisedCropBed status="EMPTY" />
    <StaticInstances transforms={[-0.32, 0, 0.32].map((z) => ({ position: [0, 0.302, z] as Position, scale: [1.55, 0.024, 0.13] as Position }))} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#9f7544" roughness={1} />
    </StaticInstances>
  </group>;
}

function farmCropKind(productId: CropState["productId"]): FarmCropKind {
  if (productId === "wheat") return "wheat";
  if (productId === "corn") return "corn";
  return "tomato";
}

function GardenFloor() {
  const gardenShape = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-3.18, -1.7);
    shape.quadraticCurveTo(-3.48, -1.42, -3.4, -0.92);
    shape.lineTo(-3.34, 1.28);
    shape.quadraticCurveTo(-3.2, 1.82, -2.7, 1.9);
    shape.lineTo(2.65, 1.86);
    shape.quadraticCurveTo(3.18, 1.78, 3.34, 1.34);
    shape.lineTo(3.43, -1.18);
    shape.quadraticCurveTo(3.28, -1.72, 2.76, -1.84);
    shape.closePath();
    return shape;
  }, []);
  return <group>
    <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.035, 1.035, 1]} receiveShadow><shapeGeometry args={[gardenShape]} /><meshStandardMaterial color="#315d36" roughness={1} /></mesh>
    <mesh position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><shapeGeometry args={[gardenShape]} /><meshStandardMaterial color="#57934a" roughness={0.98} /></mesh>
    <StaticInstances transforms={GARDEN_PATH_STONES} receiveShadow><cylinderGeometry args={[0.23, 0.23, 0.04, 8]} /><meshStandardMaterial color="#a7a08c" roughness={0.96} /></StaticInstances>
    <StaticInstances transforms={GARDEN_GRASS_TUFTS} castShadow><coneGeometry args={[0.065, 0.24, 5]} /><meshStandardMaterial color="#366f3b" roughness={1} /></StaticInstances>
    <StaticInstances transforms={GARDEN_FLOWERS} castShadow><dodecahedronGeometry args={[0.075, 0]} /><meshStandardMaterial color="#ffe395" emissive="#9a6b2a" emissiveIntensity={0.12} roughness={0.82} /></StaticInstances>
  </group>;
}

function CropPlot({ position, crop, status, progress, accent }: { position: Position; crop: FarmCropKind; status: CropState["status"]; progress: number; accent: string }) {
  const stage = status === "READY" ? 4 : Math.max(0, Math.min(3, Math.floor(progress * 4)));
  const growth = [0.18, 0.4, 0.66, 0.86, 1][stage];
  return <group position={position}>
    <RaisedCropBed status={status} />
    {status === "EMPTY" ? <SeedBed /> : <CropCanopy crop={crop} growth={growth} ready={status === "READY"} />}
    {status === "READY" && <ReadyHarvestGlow accent={accent} />}
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

function CropCanopy({ crop, growth, ready }: { crop: FarmCropKind; growth: number; ready: boolean }) {
  const grid = crop === "wheat" ? WHEAT_GRID : crop === "corn" ? CORN_GRID : TOMATO_GRID;
  const fullHeight = crop === "corn" ? 1.06 : crop === "wheat" ? 0.76 : 0.68;
  const height = Math.max(0.12, fullHeight * growth);
  const stems = useMemo<InstanceTransform[]>(() => grid.map(([x, z], index) => ({
    position: [x, 0.25 + height / 2, z],
    rotation: [0, index * 0.49, (index % 3 - 1) * 0.025],
    scale: [1, height, 1],
  })), [grid, height]);
  const leaves = useMemo<InstanceTransform[]>(() => grid.flatMap(([x, z], index) => [-1, 1].map((side): InstanceTransform => ({
    position: [x + side * (crop === "corn" ? 0.075 : 0.055), 0.28 + height * (side > 0 ? 0.5 : 0.68), z],
    rotation: [0, index * 0.77, side * (crop === "corn" ? 0.72 : 0.56)],
    scale: crop === "corn" ? [1.25, 0.23, 0.48] : crop === "wheat" ? [0.48, 0.12, 0.24] : [0.9, 0.2, 0.42],
  }))), [crop, grid, height]);
  const fruitGrowth = Math.max(0, Math.min(1, (growth - 0.52) / 0.48));
  const fruits = useMemo<InstanceTransform[]>(() => {
    if (fruitGrowth <= 0) return [];
    if (crop === "tomato") return grid.flatMap(([x, z], index) => [-1, 1].map((side): InstanceTransform => ({
      position: [x + side * 0.075, 0.31 + height * (0.56 + (index % 2) * 0.13), z + (index % 3 - 1) * 0.025],
      scale: [fruitGrowth, fruitGrowth * 0.88, fruitGrowth],
    })));
    return grid.map(([x, z], index): InstanceTransform => ({
      position: crop === "wheat" ? [x, 0.27 + height, z] : [x + (index % 2 ? 0.08 : -0.08), 0.31 + height * 0.66, z],
      rotation: crop === "corn" ? [0, index * 0.41, index % 2 ? -0.28 : 0.28] : [0, index * 0.31, 0],
      scale: crop === "corn" ? [fruitGrowth * 0.68, fruitGrowth * 1.7, fruitGrowth * 0.68] : [fruitGrowth, fruitGrowth, fruitGrowth],
    }));
  }, [crop, fruitGrowth, grid, height]);
  const fruitColor = crop === "tomato" ? (ready ? "#df4035" : growth > 0.78 ? "#d98339" : "#79a24b") : crop === "wheat" ? (ready ? "#e8bd4c" : "#a4b15b") : (ready ? "#f2c53f" : "#83a950");
  return <group>
    <StaticInstances transforms={stems} castShadow><cylinderGeometry args={[crop === "wheat" ? 0.01 : 0.018, crop === "wheat" ? 0.015 : 0.024, 1, 6]} /><meshStandardMaterial color={crop === "wheat" && ready ? "#b89337" : "#4d7d3d"} roughness={0.94} /></StaticInstances>
    <StaticInstances transforms={leaves} castShadow><sphereGeometry args={[0.115, 7, 5]} /><meshStandardMaterial color={crop === "corn" ? "#4f8a43" : crop === "wheat" ? "#729348" : "#438345"} roughness={0.96} /></StaticInstances>
    {fruits.length > 0 && <StaticInstances transforms={fruits} castShadow>
      {crop === "tomato" ? <dodecahedronGeometry args={[0.068, 0]} /> : crop === "wheat" ? <coneGeometry args={[0.045, 0.17, 6]} /> : <sphereGeometry args={[0.075, 8, 6]} />}
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

function AnimalStation({ kind, machine }: { kind: "chicken" | "cow"; machine: ProductionMachineState }) {
  return <group>
    <EnvironmentModel id={kind === "chicken" ? "chicken_coop" : "cow_station"} />
    {kind === "chicken" ? <ChickenCharacter active={machine.status === "PROCESSING"} /> : <CowCharacter active={machine.status === "PROCESSING"} />}
    <group position={[kind === "cow" ? 0.62 : 0.44, 0.02, 0.42]} scale={0.72} visible={machine.output > 0}><EnvironmentModel id={kind === "chicken" ? "egg_output_tray" : "milk_output_can"} /></group>
  </group>;
}

function ChickenCharacter({ active }: { active: boolean }) {
  const root = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (root.current) { root.current.position.y = 0.48 + (active ? Math.sin(clock.elapsedTime * 7) * 0.025 : 0); root.current.rotation.y = Math.sin(clock.elapsedTime * 0.8) * 0.28; } });
  return <group ref={root} position={[0, 0.48, 0]}><EnvironmentModel id="chicken_character" /></group>;
}

function CowCharacter({ active }: { active: boolean }) {
  const head = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (head.current) head.current.rotation.y = Math.sin(clock.elapsedTime * (active ? 1.8 : 0.7)) * 0.1; });
  return <group ref={head} position={[-0.12, 0.02, 0]}><EnvironmentModel id="cow_character" /></group>;
}

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
  return <group position={position}>
    <Box args={[1.12, 0.14, 0.88]} position={[0, 0.12, 0]} color="#68472f" radius={0.05} />
    {[-0.46, 0.46].flatMap((x) => [-0.34, 0.34].map((z) => <Box key={`${x}-${z}`} args={[0.045, 0.85, 0.045]} position={[x, 0.55, z]} color={palette.frame} />))}
    <mesh position={[0, 0.6, 0]}><boxGeometry args={[1, 0.8, 0.76]} /><meshPhysicalMaterial color="#b8e2d0" transparent opacity={0.2} roughness={0.12} transmission={0.12} /></mesh>
    <mesh position={[0, 1.06, 0]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.76, 0.76, 0.78]} /><meshPhysicalMaterial color="#b8e2d0" transparent opacity={0.24} roughness={0.12} transmission={0.12} /></mesh>
    <StaticInstances transforms={GREENHOUSE_SEEDLINGS} castShadow><coneGeometry args={[0.06, 0.25, 6]} /><meshStandardMaterial color="#559147" roughness={0.95} /></StaticInstances>
  </group>;
}

function Scarecrow({ position }: { position: Position }) {
  return <group position={position}><Box args={[0.08, 1.25, 0.08]} position={[0, 0.72, 0]} color={palette.wood} /><Box args={[0.92, 0.07, 0.07]} position={[0, 1.04, 0]} color={palette.wood} /><mesh position={[0, 1.37, 0]}><sphereGeometry args={[0.2, 10, 8]} /><meshStandardMaterial color="#c79a57" roughness={0.94} /></mesh><mesh position={[0, 1.57, 0]}><coneGeometry args={[0.34, 0.25, 12]} /><meshStandardMaterial color="#a36936" roughness={0.92} /></mesh><Box args={[0.64, 0.52, 0.1]} position={[0, 0.94, 0]} color="#a75f45" radius={0.06} /></group>;
}
