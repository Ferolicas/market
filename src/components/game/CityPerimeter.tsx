"use client";

import { Instance, Instances } from "@react-three/drei";

type Position = [number, number, number];

const buildingColors = ["#d9a27d", "#d7c28d", "#9eb9b0", "#b79ab3", "#9cafc7", "#c9a58c"];

export function CityPerimeter() {
  return <Instances limit={180} castShadow={false} receiveShadow frustumCulled>
    <boxGeometry />
    <meshStandardMaterial roughness={0.92} />
    <group>
    <Block args={[54, 0.1, 52]} position={[0, -0.2, 3.5]} color="#abc7a6" />
    <Road args={[36, 0.09, 3.8]} position={[0, -0.125, -12.35]} horizontal />
    <Road args={[36, 0.09, 3.8]} position={[0, -0.125, 18.25]} horizontal />
    <Road args={[3.8, 0.09, 34.4]} position={[-15.85, -0.12, 2.95]} />
    <Road args={[3.8, 0.09, 34.4]} position={[15.85, -0.12, 2.95]} />

    <Block args={[26.8, 0.1, 1.1]} position={[0, -0.07, -10]} color="#d9d7c9" />
    <Block args={[26.8, 0.1, 1.1]} position={[0, -0.07, 16.05]} color="#d9d7c9" />
    <Block args={[1.1, 0.1, 25]} position={[-13.45, -0.07, 3]} color="#d9d7c9" />
    <Block args={[1.1, 0.1, 25]} position={[13.45, -0.07, 3]} color="#d9d7c9" />

    <Crosswalk position={[0, -0.065, 17.95]} />
    <Crosswalk position={[-15.55, -0.065, 9.2]} rotation />
    {[-11, -5.5, 5.5, 11].map((x) => <ParkingSpace key={`parking-${x}`} x={x} />)}

    {[
      [-10.5, 0, -16.3, 5.2, 5.3, 3.6],
      [-4.4, 0, -16.7, 4.7, 4.5, 3.2],
      [1.3, 0, -16.5, 5.1, 6.1, 3.5],
      [7.3, 0, -16.2, 5, 4.9, 3.4],
      [19.2, 0, -7.1, 4.6, 5.5, 3.1],
      [19.4, 0, -0.8, 4.8, 4.2, 3.2],
      [19.1, 0, 5.2, 4.5, 5.9, 3],
      [-19.1, 0, -6.2, 4.4, 4.8, 3.2],
      [-19.3, 0, 0.1, 4.8, 5.8, 3],
      [-19.1, 0, 6.7, 4.5, 4.4, 3.2],
    ].map(([x, y, z, width, height, depth], index) => <CityBuilding
      key={`building-${index}`}
      position={[x, y, z]}
      size={[width, height, depth]}
      color={buildingColors[index % buildingColors.length]}
      rotation={Math.abs(x) > 15 ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : 0}
    />)}

    {[
      [-12.7, -9.1], [-12.7, -4], [-12.7, 2], [-12.7, 8], [-12.7, 13.2],
      [12.7, -9.1], [12.7, -4], [12.7, 2], [12.7, 8], [12.7, 13.2],
      [-10, 20.7], [-4, 20.7], [4, 20.7], [10, 20.7],
    ].map(([x, z], index) => <Tree key={`tree-${index}`} position={[x, 0, z]} variant={index % 3} />)}

    {[
      [-13.1, -7], [-13.1, 5], [-13.1, 13], [13.1, -7], [13.1, 5], [13.1, 13],
      [-8, -10.5], [8, -10.5], [-8, 16.55], [8, 16.55],
    ].map(([x, z], index) => <StreetLight key={`light-${index}`} position={[x, 0, z]} />)}

    <Car position={[-8.2, 0, 18.25]} color="#d96d55" />
    <Car position={[7.1, 0, 18.25]} color="#5f8fa8" rotation={Math.PI} />
    <Car position={[-15.85, 0, -2.5]} color="#d5ae54" rotation={Math.PI / 2} />
    <Car position={[15.85, 0, 8]} color="#78966b" rotation={-Math.PI / 2} />
    <BusStop position={[-11.2, 0, 20.35]} />
    <Bench position={[9.4, 0, 20.55]} />
    </group>
  </Instances>;
}

function Road({ args, position, horizontal = false }: { args: Position; position: Position; horizontal?: boolean }) {
  const marks = horizontal ? [-14, -9.5, -5, -0.5, 4, 8.5, 13] : [-13, -8.5, -4, 0.5, 5, 9.5, 14];
  return <group>
    <Block args={args} position={position} color="#65716f" />
    {marks.map((offset) => <Block
      key={offset}
      args={horizontal ? [2.2, 0.018, 0.08] : [0.08, 0.018, 2.2]}
      position={horizontal ? [offset, position[1] + 0.055, position[2]] : [position[0], position[1] + 0.055, offset + position[2] - 3]}
      color="#f1df9b"
    />)}
  </group>;
}

function Crosswalk({ position, rotation = false }: { position: Position; rotation?: boolean }) {
  return <group position={position} rotation={[0, rotation ? Math.PI / 2 : 0, 0]}>
    {[-1.25, -0.75, -0.25, 0.25, 0.75, 1.25].map((x) => <Block key={x} args={[0.28, 0.025, 2.3]} position={[x, 0, 0]} color="#ecebe2" />)}
  </group>;
}

function ParkingSpace({ x }: { x: number }) {
  return <group position={[x, -0.06, 20.55]}>
    <Block args={[2.4, 0.04, 0.07]} position={[0, 0, -1.15]} color="#f2eee0" />
    <Block args={[0.07, 0.04, 2.3]} position={[-1.2, 0, 0]} color="#f2eee0" />
    <Block args={[0.07, 0.04, 2.3]} position={[1.2, 0, 0]} color="#f2eee0" />
  </group>;
}

function CityBuilding({ position, size, color, rotation }: { position: Position; size: Position; color: string; rotation: number }) {
  const [width, height, depth] = size;
  return <group position={position} rotation={[0, rotation, 0]}>
    <Block args={[width, height, depth]} position={[0, height / 2, 0]} color={color} />
    <Block args={[width + 0.18, 0.18, depth + 0.18]} position={[0, height + 0.09, 0]} color="#5c6965" />
    {[-0.28, 0.28].flatMap((xFactor) => [0.32, 0.64].map((yFactor) => <mesh key={`${xFactor}-${yFactor}`} position={[xFactor * width, yFactor * height, depth / 2 + 0.012]}>
      <planeGeometry args={[width * 0.22, height * 0.17]} />
      <meshStandardMaterial color="#b9d9d2" emissive="#31534e" emissiveIntensity={0.08} roughness={0.22} />
    </mesh>))}
    <Block args={[width * 0.22, height * 0.25, 0.08]} position={[0, height * 0.125, depth / 2 + 0.05]} color="#50635d" />
    <Block args={[width * 0.52, 0.16, 0.5]} position={[0, height * 0.82, depth / 2 + 0.26]} color="#efe2bd" />
  </group>;
}

function Tree({ position, variant }: { position: Position; variant: number }) {
  const colors = ["#628758", "#75985e", "#587d68"];
  return <group position={position}>
    <mesh position={[0, 0.52, 0]}><cylinderGeometry args={[0.09, 0.13, 1.04, 7]} /><meshStandardMaterial color="#806242" roughness={1} /></mesh>
    <mesh position={[0, 1.35, 0]}><dodecahedronGeometry args={[0.65 + variant * 0.05, 1]} /><meshStandardMaterial color={colors[variant]} roughness={1} /></mesh>
    <mesh position={[0.32, 1.2, 0.08]}><dodecahedronGeometry args={[0.38, 1]} /><meshStandardMaterial color={colors[(variant + 1) % colors.length]} roughness={1} /></mesh>
  </group>;
}

function StreetLight({ position }: { position: Position }) {
  return <group position={position}>
    <mesh position={[0, 1.25, 0]}><cylinderGeometry args={[0.035, 0.055, 2.5, 7]} /><meshStandardMaterial color="#46514e" roughness={0.8} /></mesh>
    <Block args={[0.55, 0.05, 0.05]} position={[0.24, 2.46, 0]} color="#46514e" />
    <mesh position={[0.49, 2.38, 0]}><sphereGeometry args={[0.12, 8, 6]} /><meshStandardMaterial color="#ffe7a6" emissive="#e5b957" emissiveIntensity={0.45} /></mesh>
  </group>;
}

function Car({ position, color, rotation = 0 }: { position: Position; color: string; rotation?: number }) {
  return <group position={position} rotation={[0, rotation, 0]}>
    <Block args={[2.25, 0.48, 1.05]} position={[0, 0.38, 0]} color={color} />
    <Block args={[1.18, 0.45, 0.9]} position={[0.08, 0.78, 0]} color="#a8c7c6" />
    {[-0.72, 0.72].flatMap((x) => [-0.53, 0.53].map((z) => <mesh key={`${x}-${z}`} position={[x, 0.19, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.18, 0.18, 0.1, 10]} /><meshStandardMaterial color="#303735" /></mesh>))}
    <Block args={[0.18, 0.13, 0.06]} position={[-1.13, 0.43, -0.3]} color="#f5d99a" />
    <Block args={[0.18, 0.13, 0.06]} position={[-1.13, 0.43, 0.3]} color="#f5d99a" />
  </group>;
}

function Bench({ position }: { position: Position }) {
  return <group position={position} rotation={[0, Math.PI, 0]}>
    <Block args={[1.6, 0.12, 0.5]} position={[0, 0.48, 0]} color="#9a693e" />
    <Block args={[1.6, 0.55, 0.1]} position={[0, 0.78, 0.2]} color="#a77443" />
    {[-0.58, 0.58].map((x) => <Block key={x} args={[0.09, 0.5, 0.09]} position={[x, 0.23, 0]} color="#4e5955" />)}
  </group>;
}

function BusStop({ position }: { position: Position }) {
  return <group position={position}>
    <Block args={[2.7, 0.1, 0.12]} position={[0, 2.15, 0]} color="#50625d" />
    <Block args={[0.1, 2.1, 0.1]} position={[-1.25, 1.05, 0]} color="#50625d" />
    <Block args={[0.1, 2.1, 0.1]} position={[1.25, 1.05, 0]} color="#50625d" />
    <mesh position={[0, 1.13, 0.03]}><planeGeometry args={[2.35, 1.8]} /><meshPhysicalMaterial color="#b7d6d0" transparent opacity={0.32} roughness={0.2} /></mesh>
    <Bench position={[0, 0, -0.22]} />
  </group>;
}

function Block({ args, position, color }: { args: Position; position: Position; color: string }) {
  return <Instance position={position} scale={args} color={color} />;
}
