"use client";

import { Float, RoundedBox, Text } from "@react-three/drei";
import type { ReactNode } from "react";

type Position = [number, number, number];

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

function Box({ args, position, color, children, rotation, radius = 0.035 }: { args: [number, number, number]; position?: Position; color: string; children?: ReactNode; rotation?: Position; radius?: number }) {
  return <RoundedBox args={args} position={position} rotation={rotation} radius={radius} smoothness={2} castShadow receiveShadow><meshStandardMaterial color={color} roughness={0.72} />{children}</RoundedBox>;
}

function Product({ position, color, shape = "box", scale = 1 }: { position: Position; color: string; shape?: "box" | "bottle" | "produce"; scale?: number }) {
  if (shape === "bottle") return <group position={position} scale={scale}><mesh castShadow><cylinderGeometry args={[0.055, 0.06, 0.22, 8]} /><meshStandardMaterial color={color} /></mesh><mesh position={[0, 0.14, 0]}><cylinderGeometry args={[0.025, 0.035, 0.07, 7]} /><meshStandardMaterial color="#f1e5c8" /></mesh></group>;
  if (shape === "produce") return <mesh position={position} scale={scale} castShadow><dodecahedronGeometry args={[0.09, 1]} /><meshStandardMaterial color={color} roughness={0.9} /></mesh>;
  return <Box args={[0.15 * scale, 0.23 * scale, 0.12 * scale]} position={position} color={color} radius={0.018} />;
}

function ProductRow({ y, z = 0.36, colors = ["#d76a4d", "#e5b84d", "#77a85d", "#6599ad"], count = 6, shape = "box" }: { y: number; z?: number; colors?: string[]; count?: number; shape?: "box" | "bottle" | "produce" }) {
  return <>{Array.from({ length: count }, (_, index) => <Product key={index} position={[(index - (count - 1) / 2) * 0.19, y, z]} color={colors[index % colors.length]} shape={shape} scale={0.9} />)}</>;
}

export function KitFurniture() {
  return <group>
    <WallShelf position={[-5.2, 0, -8.05]} width={2.05} />
    <WallShelf position={[-2.8, 0, -8.05]} width={2.05} />
    <WallShelf position={[-0.4, 0, -8.05]} width={2.05} />
    <WallShelf position={[2.0, 0, -8.05]} width={2.05} />
    <GlassFridge position={[5.25, 0, -8.0]} />
    <MetalRack position={[8.65, 0, -7.85]} />

    <Gondola position={[-4.0, 0, -2.2]} accent="#8d9c73" />
    <Gondola position={[0, 0, -2.2]} accent="#c0a05d" />
    <Gondola position={[4.0, 0, -2.2]} accent="#799d8b" />
    <ProduceTable position={[-4.1, 0, 2.45]} />
    <ChilledDisplay position={[0, 0, 2.45]} />
    <LowFreezer position={[4.05, 0, 2.45]} />

    <CheckoutKit position={[7.55, 0, 3.95]} />
    <CartBay position={[9.6, 0, 6.25]} />
    <BakeryKit position={[-8.75, 0, -0.45]} />
    <MillMachine position={[-8.75, 0, -4.05]} />
    <SupplierCorner position={[8.8, 0, -2.15]} />
    <TerminalModel position={[8.8, 0, -5.35]} label="MAPA" />
    <StoreUtilities />
  </group>;
}

function WallShelf({ position, width }: { position: Position; width: number }) {
  return <group position={position}>
    <Box args={[width, 2.25, 0.42]} position={[0, 1.13, 0]} color={palette.cream} radius={0.06} />
    <Box args={[width + 0.06, 0.16, 0.51]} position={[0, 0.12, 0.15]} color={palette.frame} />
    {[0.48, 1.03, 1.58, 2.1].map((y) => <group key={y}><Box args={[width - 0.08, 0.08, 0.55]} position={[0, y, 0.18]} color={palette.green} /><ProductRow y={y + 0.16} z={0.48} count={Math.floor(width * 4)} /></group>)}
    {[-1, 1].map((side) => <Box key={side} args={[0.09, 2.28, 0.56]} position={[side * width / 2, 1.14, 0.15]} color={palette.frame} />)}
  </group>;
}

function Gondola({ position, accent }: { position: Position; accent: string }) {
  return <group position={position}>
    <Box args={[1.9, 0.16, 0.9]} position={[0, 0.09, 0]} color={palette.frame} />
    <Box args={[1.72, 1.65, 0.13]} position={[0, 0.94, 0]} color={palette.cream} />
    {[-1, 1].map((side) => <group key={side} position={[0, 0, side * 0.31]} rotation={[0, side < 0 ? Math.PI : 0, 0]}>
      {[0.38, 0.83, 1.28].map((y) => <group key={y}><Box args={[1.82, 0.09, 0.62]} position={[0, y, 0]} color={accent} /><ProductRow y={y + 0.15} z={0.31} count={8} /></group>)}
    </group>)}
    <Box args={[1.95, 0.13, 0.98]} position={[0, 1.73, 0]} color={palette.frame} />
  </group>;
}

function ProduceTable({ position }: { position: Position }) {
  return <group position={position}>
    <Box args={[2.05, 0.18, 1.2]} position={[0, 0.18, 0]} color={palette.frame} />
    {[-0.72, 0, 0.72].map((x, column) => <group key={x} position={[x, 0.64, 0]} rotation={[0, 0, column === 1 ? 0 : (column ? -0.13 : 0.13)]}>
      <Box args={[0.62, 0.18, 0.95]} color={palette.wood} />
      {Array.from({ length: 9 }, (_, index) => <Product key={index} position={[(index % 3 - 1) * 0.15, 0.15, (Math.floor(index / 3) - 1) * 0.18]} color={["#d76a42", "#79a64f", "#e8b648"][column]} shape="produce" scale={0.88} />)}
    </group>)}
    {[-0.82, 0.82].map((x) => <Box key={x} args={[0.14, 0.6, 0.14]} position={[x, 0.38, 0]} color={palette.frame} />)}
  </group>;
}

function ChilledDisplay({ position }: { position: Position }) {
  return <group position={position}>
    <Box args={[2.05, 0.75, 1.15]} position={[0, 0.38, 0]} color="#d9ded8" radius={0.1} />
    <mesh position={[0, 0.79, 0]} rotation={[0, 0, 0]} castShadow><boxGeometry args={[1.92, 0.08, 1.03]} /><meshPhysicalMaterial color="#b9d9d4" transparent opacity={0.48} roughness={0.1} transmission={0.15} /></mesh>
    <ProductRow y={0.69} z={0.18} count={8} shape="produce" />
    <ProductRow y={0.69} z={-0.18} count={8} shape="produce" colors={["#d87355", "#c69d50", "#6aa06c"]} />
  </group>;
}

function LowFreezer({ position }: { position: Position }) {
  return <group position={position}>
    <Box args={[1.8, 0.9, 1.05]} position={[0, 0.45, 0]} color="#e9ede7" radius={0.12} />
    {[-0.43, 0.43].map((x) => <mesh key={x} position={[x, 0.92, 0]}><boxGeometry args={[0.78, 0.05, 0.9]} /><meshPhysicalMaterial color="#afcfcb" transparent opacity={0.55} roughness={0.12} /></mesh>)}
    <Box args={[1.84, 0.1, 1.08]} position={[0, 0.08, 0]} color={palette.frame} />
  </group>;
}

function GlassFridge({ position }: { position: Position }) {
  return <group position={position}>
    <Box args={[2.15, 2.35, 0.68]} position={[0, 1.18, 0]} color={palette.frame} radius={0.07} />
    {[-0.52, 0.52].map((x) => <group key={x} position={[x, 1.25, 0.36]}>
      <mesh><planeGeometry args={[0.92, 1.86]} /><meshPhysicalMaterial color="#c7dfda" transparent opacity={0.43} roughness={0.18} /></mesh>
      <Box args={[0.035, 0.72, 0.035]} position={[x < 0 ? 0.36 : -0.36, 0, 0.03]} color="#c6cfcc" />
      {[0.55, 0.05, -0.45].map((y) => <group key={y}><Box args={[0.86, 0.035, 0.35]} position={[0, y, -0.08]} color="#d8dfdc" /><ProductRow y={y + 0.12} z={0.03} count={4} shape="bottle" /></group>)}
    </group>)}
  </group>;
}

function MetalRack({ position }: { position: Position }) {
  return <group position={position}>
    {[-0.68, 0.68].map((x) => <Box key={x} args={[0.08, 2.25, 0.08]} position={[x, 1.12, 0]} color={palette.metal} />)}
    {[0.18, 0.78, 1.38, 2.0].map((y) => <group key={y}><Box args={[1.45, 0.08, 0.72]} position={[0, y, 0]} color={palette.metal} />{y < 1.9 && <><Parcel position={[-0.35, y + 0.2, 0]} /><Parcel position={[0.35, y + 0.2, 0]} small /></>}</group>)}
  </group>;
}

function CheckoutKit({ position }: { position: Position }) {
  return <group position={position} rotation={[0, Math.PI, 0]}>
    <Box args={[3.15, 0.78, 0.88]} position={[0, 0.39, 0]} color={palette.green} radius={0.11} />
    <Box args={[1.28, 0.07, 0.67]} position={[-0.67, 0.82, 0]} color="#27312f" />
    {[0.75, 1.16].map((x) => <mesh key={x} position={[x, 0.83, 0]}><cylinderGeometry args={[0.07, 0.07, 0.7, 12]} /><meshStandardMaterial color="#202927" /></mesh>)}
    <Box args={[0.5, 0.26, 0.42]} position={[0.72, 0.92, 0]} color="#26332f" radius={0.04} />
    <mesh position={[0.72, 1.04, 0.2]} rotation={[-0.5, 0, 0]}><planeGeometry args={[0.34, 0.18]} /><meshStandardMaterial color="#9dd3c1" emissive="#315c50" emissiveIntensity={0.25} /></mesh>
    <Box args={[0.22, 0.11, 0.35]} position={[1.05, 0.91, 0.35]} color="#e6e3d7" />
    <Box args={[0.17, 0.28, 0.1]} position={[0.25, 1.01, 0.35]} color="#26332f" />
    <Text position={[0, 0.4, -0.46]} rotation={[0, Math.PI, 0]} fontSize={0.18} color="#f7f3df">CAJA</Text>
  </group>;
}

function CartBay({ position }: { position: Position }) {
  return <group position={position}>
    {[0, -0.35].map((z, index) => <ShoppingCart key={z} position={[0, 0, z]} scale={1 - index * 0.08} />)}
    <ShoppingBasket position={[-0.8, 0.05, 0.05]} />
  </group>;
}

function ShoppingCart({ position, scale = 1 }: { position: Position; scale?: number }) {
  return <group position={position} scale={scale}>
    <mesh position={[0, 0.55, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.03, 0.03, 1.15, 8]} /><meshStandardMaterial color={palette.metal} /></mesh>
    <Box args={[0.82, 0.52, 0.62]} position={[0, 0.43, 0]} color="#799463" radius={0.06} />
    {[-0.33, 0.33].flatMap((x) => [-0.22, 0.22].map((z) => <mesh key={`${x}-${z}`} position={[x, 0.08, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.07, 0.07, 0.05, 10]} /><meshStandardMaterial color="#303634" /></mesh>))}
  </group>;
}

function ShoppingBasket({ position }: { position: Position }) {
  return <group position={position}><Box args={[0.62, 0.36, 0.42]} position={[0, 0.18, 0]} color="#708e55" radius={0.06} />{[-0.18, 0.18].map((x) => <mesh key={x} position={[x, 0.45, 0]} rotation={[0, 0, x < 0 ? -0.45 : 0.45]}><torusGeometry args={[0.24, 0.025, 6, 14, Math.PI]} /><meshStandardMaterial color="#344436" /></mesh>)}</group>;
}

function BakeryKit({ position }: { position: Position }) {
  return <group position={position}>
    <Box args={[1.45, 1.8, 0.92]} position={[0, 0.9, 0]} color="#c5cbc5" radius={0.12} />
    {[-0.35, 0.35].map((y) => <group key={y} position={[0, 1 + y, 0.47]}><Box args={[1.08, 0.47, 0.05]} color="#303836" /><mesh position={[0, 0, 0.035]}><planeGeometry args={[0.88, 0.3]} /><meshPhysicalMaterial color="#735242" transparent opacity={0.8} /></mesh></group>)}
    <Box args={[1.55, 0.75, 0.8]} position={[0, 0.38, 1.2]} color="#e2e4dd" radius={0.08} />
    <mesh position={[0, 0.79, 1.2]}><cylinderGeometry args={[0.07, 0.07, 0.2, 12]} /><meshStandardMaterial color={palette.metal} /></mesh>
    <Box args={[1.1, 0.08, 0.52]} position={[0, 0.8, 1.2]} color={palette.frame} />
    <Text position={[0, 0.25, 0.48]} fontSize={0.14} color="#f7f3df">HORNO</Text>
  </group>;
}

function MillMachine({ position }: { position: Position }) {
  return <group position={position}>
    <Box args={[1.35, 1.12, 0.95]} position={[0, 0.56, 0]} color="#d5b45f" radius={0.12} />
    <mesh position={[0, 1.48, 0]}><coneGeometry args={[0.48, 0.72, 12]} /><meshStandardMaterial color="#a97943" roughness={0.76} /></mesh>
    <mesh position={[0, 0.68, 0.5]} rotation={[Math.PI / 2, 0, 0]} castShadow><torusGeometry args={[0.3, 0.08, 8, 18]} /><meshStandardMaterial color={palette.frame} /></mesh>
    <mesh position={[0, 0.68, 0.55]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.08, 0.08, 0.16, 10]} /><meshStandardMaterial color="#b5c0bb" /></mesh>
    <Box args={[0.62, 0.16, 0.52]} position={[0, 0.12, 0.78]} color={palette.wood} />
    <Text position={[0, 0.28, 0.49]} fontSize={0.13} color="#3f4637">MOLINO</Text>
  </group>;
}

function SupplierCorner({ position }: { position: Position }) {
  return <group position={position}>
    <TerminalModel position={[0, 0, 0]} label="PEDIDOS" />
    <Pallet position={[-0.05, 0, -1.3]} />
    <Parcel position={[-0.3, 0.34, -1.3]} />
    <Parcel position={[0.25, 0.34, -1.3]} small />
    <Parcel position={[0.05, 0.73, -1.3]} />
  </group>;
}

function TerminalModel({ position, label }: { position: Position; label: string }) {
  return <group position={position}><Box args={[1.35, 1.2, 0.65]} position={[0, 0.6, 0]} color="#7396a0" radius={0.12} /><mesh position={[0, 0.8, 0.34]}><planeGeometry args={[0.88, 0.48]} /><meshStandardMaterial color="#cce6de" emissive="#315a50" emissiveIntensity={0.18} /></mesh><Text position={[0, 0.78, 0.36]} fontSize={0.13} color="#24453d">{label}</Text></group>;
}

function Pallet({ position }: { position: Position }) {
  return <group position={position}>{[-0.32, 0, 0.32].map((z) => <Box key={z} args={[1.1, 0.09, 0.18]} position={[0, 0.09, z]} color={palette.wood} />)}{[-0.43, 0, 0.43].map((x) => <Box key={x} args={[0.16, 0.11, 0.82]} position={[x, 0.02, 0]} color="#754c2f" />)}</group>;
}

function Parcel({ position, small = false }: { position: Position; small?: boolean }) {
  return <group position={position} scale={small ? 0.72 : 1}><Box args={[0.52, 0.44, 0.46]} position={[0, 0.22, 0]} color="#ba8050" radius={0.025} /><Box args={[0.08, 0.45, 0.47]} position={[0, 0.23, 0]} color="#d5ad70" radius={0.01} /></group>;
}

function StoreUtilities() {
  return <group>
    <WallClock position={[9.2, 2.2, -8.34]} />
    <SecurityCamera position={[-10.75, 2.55, -8.05]} />
    <SecurityCamera position={[10.65, 2.55, 7.2]} rotationY={Math.PI} />
    <HangingSign position={[7.25, 2.45, 1.65]} label="CAJAS" />
    <HangingSign position={[-3.8, 2.45, -3.35]} label="DESPENSA" />
    {[-7.2, -2.4, 2.4, 7.2].map((x) => <CeilingLamp key={x} position={[x, 2.85, -0.6]} />)}
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

function CeilingLamp({ position }: { position: Position }) {
  return <group position={position}><Box args={[2.0, 0.07, 0.42]} color="#ebeee7" radius={0.02} /><pointLight position={[0, -0.15, 0]} intensity={0.35} distance={5} color="#fff2c9" /></group>;
}

export function KitFarm() {
  const plots: { position: Position; crop: "wheat" | "carrot" | "tomato" | "lettuce" | "pumpkin" | "corn"; stage: number }[] = [
    { position: [-9.3, 0, 10.0], crop: "wheat", stage: 3 },
    { position: [-7.95, 0, 10.0], crop: "carrot", stage: 2 },
    { position: [-9.3, 0, 11.25], crop: "tomato", stage: 3 },
    { position: [-7.95, 0, 11.25], crop: "lettuce", stage: 3 },
  ];
  return <group>
    <Box args={[3.55, 0.08, 3.1]} position={[-8.65, 0.02, 10.65]} color="#d6bd84" radius={0.06} />
    {plots.map((plot) => <CropPlot key={`${plot.position[0]}-${plot.position[2]}`} {...plot} />)}
    <FenceLine position={[-10.3, 0, 10.65]} length={3.0} vertical />
    <FenceLine position={[-8.65, 0, 12.15]} length={3.3} />
    <FenceLine position={[-8.65, 0, 9.15]} length={3.3} />
    <FarmTools position={[-6.95, 0, 10.85]} />
    <CompostBin position={[-7.1, 0, 9.65]} />
    <MiniGreenhouse position={[-7.15, 0, 11.7]} />
    <Scarecrow position={[-8.65, 0, 10.65]} />
  </group>;
}

function CropPlot({ position, crop, stage }: { position: Position; crop: "wheat" | "carrot" | "tomato" | "lettuce" | "pumpkin" | "corn"; stage: number }) {
  return <group position={position}>
    <Box args={[1.12, 0.16, 1.04]} position={[0, 0.08, 0]} color={palette.soil} radius={0.03} />
    {Array.from({ length: 9 }, (_, index) => <Crop key={index} type={crop} stage={stage} position={[(index % 3 - 1) * 0.32, 0.12, (Math.floor(index / 3) - 1) * 0.29]} />)}
  </group>;
}

function Crop({ type, position, stage }: { type: "wheat" | "carrot" | "tomato" | "lettuce" | "pumpkin" | "corn"; position: Position; stage: number }) {
  const height = 0.16 + stage * 0.1;
  const fruitColor = { wheat: "#d9b449", carrot: "#dc7440", tomato: "#d65643", lettuce: "#78a952", pumpkin: "#dc8a36", corn: "#e4bd4a" }[type];
  if (type === "lettuce" || type === "pumpkin") return <Float speed={1} floatIntensity={0.015} rotationIntensity={0.03}><group position={position}>{Array.from({ length: 5 }, (_, index) => <mesh key={index} position={[(index - 2) * 0.025, height * 0.35, 0]} rotation={[0, 0, (index - 2) * 0.25]}><dodecahedronGeometry args={[type === "pumpkin" ? 0.13 : 0.11, 1]} /><meshStandardMaterial color={fruitColor} roughness={0.9} /></mesh>)}</group></Float>;
  return <Float speed={1.1} floatIntensity={0.02} rotationIntensity={0.05}><group position={position}><mesh position={[0, height / 2, 0]}><cylinderGeometry args={[0.015, 0.023, height, 6]} /><meshStandardMaterial color="#668e43" /></mesh>{[-1, 1].map((side) => <mesh key={side} position={[side * 0.045, height * 0.55, 0]} rotation={[0, 0, side * -0.65]}><coneGeometry args={[0.045, 0.18, 6]} /><meshStandardMaterial color="#71994c" /></mesh>)}<mesh position={[0, height, 0]}><dodecahedronGeometry args={[type === "wheat" ? 0.065 : 0.075, 0]} /><meshStandardMaterial color={fruitColor} roughness={0.9} /></mesh></group></Float>;
}

function FenceLine({ position, length, vertical = false }: { position: Position; length: number; vertical?: boolean }) {
  const count = Math.ceil(length / 0.8);
  return <group position={position} rotation={[0, vertical ? Math.PI / 2 : 0, 0]}>{Array.from({ length: count + 1 }, (_, index) => <Box key={index} args={[0.09, 0.68, 0.09]} position={[index * (length / count) - length / 2, 0.34, 0]} color={palette.wood} />)}{[0.2, 0.5].map((y) => <Box key={y} args={[length, 0.08, 0.08]} position={[0, y, 0]} color={palette.wood} />)}</group>;
}

function FarmTools({ position }: { position: Position }) {
  return <group position={position}>
    <WateringCan position={[0, 0.18, 0]} />
    <Box args={[0.42, 0.62, 0.26]} position={[0.55, 0.31, 0]} color="#b79b58" radius={0.08} />
    <Text position={[0.55, 0.34, 0.14]} fontSize={0.09} color="#4b5038">SEMILLAS</Text>
    <Box args={[0.65, 0.38, 0.5]} position={[-0.55, 0.19, 0]} color={palette.wood} radius={0.035} />
  </group>;
}

function WateringCan({ position }: { position: Position }) {
  return <group position={position}><mesh><cylinderGeometry args={[0.18, 0.21, 0.32, 12]} /><meshStandardMaterial color="#708f87" /></mesh><mesh position={[0.28, 0.04, 0]} rotation={[0, 0, -1.1]}><cylinderGeometry args={[0.055, 0.11, 0.48, 10]} /><meshStandardMaterial color="#708f87" /></mesh><mesh position={[-0.13, 0.15, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.18, 0.035, 7, 15, Math.PI]} /><meshStandardMaterial color="#708f87" /></mesh></group>;
}

function CompostBin({ position }: { position: Position }) {
  return <group position={position}><Box args={[0.78, 0.72, 0.72]} position={[0, 0.36, 0]} color="#6f5134" radius={0.04} />{[-0.26, 0, 0.26].map((y) => <Box key={y} args={[0.85, 0.08, 0.78]} position={[0, 0.38 + y, 0]} color="#9a6b3e" />)}<Box args={[0.87, 0.1, 0.8]} position={[0, 0.77, 0]} rotation={[0.08, 0, 0]} color="#754d30" /></group>;
}

function MiniGreenhouse({ position }: { position: Position }) {
  return <group position={position}>{[-0.46, 0.46].flatMap((x) => [-0.34, 0.34].map((z) => <Box key={`${x}-${z}`} args={[0.045, 0.85, 0.045]} position={[x, 0.43, z]} color={palette.frame} />))}<mesh position={[0, 0.48, 0]}><boxGeometry args={[1, 0.8, 0.76]} /><meshPhysicalMaterial color="#b8d8c7" transparent opacity={0.25} roughness={0.18} /></mesh><mesh position={[0, 0.94, 0]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.76, 0.76, 0.78]} /><meshPhysicalMaterial color="#b8d8c7" transparent opacity={0.28} roughness={0.18} /></mesh></group>;
}

function Scarecrow({ position }: { position: Position }) {
  return <group position={position}><Box args={[0.08, 1.25, 0.08]} position={[0, 0.72, 0]} color={palette.wood} /><Box args={[0.92, 0.07, 0.07]} position={[0, 1.04, 0]} color={palette.wood} /><mesh position={[0, 1.37, 0]}><sphereGeometry args={[0.2, 10, 8]} /><meshStandardMaterial color="#c79a57" /></mesh><mesh position={[0, 1.57, 0]}><coneGeometry args={[0.34, 0.25, 12]} /><meshStandardMaterial color="#a36936" /></mesh><Box args={[0.64, 0.52, 0.1]} position={[0, 0.94, 0]} color="#a75f45" /></group>;
}
