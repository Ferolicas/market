export type ProductionWorkstationId = "mill" | "bakery" | "cheese" | "juice";
export type ProductionFixtureId = "flourMill" | "breadOven" | "cheeseMaker" | "juiceMachine";

export interface ProductionFixtureLayout {
  fixtureId: ProductionFixtureId;
  workstationId: ProductionWorkstationId;
  machineId: string;
  obstacleId: string;
  label: string;
  processLabel: string;
  accent: string;
  position: readonly [number, number, number];
  /** Bounds of the solid machine in local StoreElement coordinates. */
  localFootprint: { centerX: number; centerZ: number; halfX: number; halfZ: number };
  /** Walkable destination for automated operators, in authored layout units. */
  operatorWorkPoint: readonly [number, number];
}

/** Reach measured outwards from every side and rounded corner of a machine. */
export const PRODUCTION_MAGNET_REACH = { enter: 0.72, exit: 0.9 } as const;

/**
 * A compact, professional production room in the rear-left corner. Machine
 * origins sit on their public/front edge; their solid bodies extend towards
 * negative Z, matching the authored GLB orientation.
 */
export const STORE_PRODUCTION_FIXTURES: Record<ProductionFixtureId, ProductionFixtureLayout> = {
  flourMill: {
    fixtureId: "flourMill",
    workstationId: "mill",
    machineId: "flour-mill-1",
    obstacleId: "fixture:flour-mill",
    label: "MOLINO",
    processLabel: "TRIGO · HARINA",
    accent: "#c99a45",
    position: [-9.75, 0, -5.95],
    localFootprint: { centerX: 0, centerZ: -0.58, halfX: 0.65, halfZ: 0.58 },
    operatorWorkPoint: [-8.7, -5.3],
  },
  breadOven: {
    fixtureId: "breadOven",
    workstationId: "bakery",
    machineId: "bread-oven-1",
    obstacleId: "fixture:bread-oven",
    label: "HORNO",
    processLabel: "HARINA · PAN",
    accent: "#c96d3e",
    position: [-6.75, 0, -5.95],
    localFootprint: { centerX: 0, centerZ: -0.55, halfX: 0.76, halfZ: 0.55 },
    operatorWorkPoint: [-8, -5.3],
  },
  cheeseMaker: {
    fixtureId: "cheeseMaker",
    workstationId: "cheese",
    machineId: "cheese-maker-1",
    obstacleId: "fixture:cheese-maker",
    label: "QUESERÍA",
    processLabel: "LECHE · QUESO",
    accent: "#d8a92f",
    position: [-9.75, 0, -3.25],
    localFootprint: { centerX: 0, centerZ: -0.55, halfX: 0.6, halfZ: 0.55 },
    operatorWorkPoint: [-8.7, -4.9],
  },
  juiceMachine: {
    fixtureId: "juiceMachine",
    workstationId: "juice",
    machineId: "juice-machine-1",
    obstacleId: "fixture:juice-machine",
    label: "ZUMOS",
    processLabel: "TOMATE · ZUMO",
    accent: "#df7540",
    position: [-6.75, 0, -3.25],
    localFootprint: { centerX: 0, centerZ: -0.55, halfX: 0.6, halfZ: 0.55 },
    operatorWorkPoint: [-8, -4.9],
  },
};

export const PRODUCTION_FIXTURE_IDS = Object.keys(STORE_PRODUCTION_FIXTURES) as ProductionFixtureId[];
export const PRODUCTION_WORKSTATION_IDS = ["mill", "bakery", "cheese", "juice"] as const satisfies readonly ProductionWorkstationId[];

export const PRODUCTION_MACHINE_POINTS: Record<string, [number, number]> = Object.fromEntries(
  PRODUCTION_FIXTURE_IDS.map((fixtureId) => {
    const fixture = STORE_PRODUCTION_FIXTURES[fixtureId];
    return [fixture.machineId, [...fixture.operatorWorkPoint]];
  }),
);

export function isProductionWorkstationId(id: string): id is ProductionWorkstationId {
  return (PRODUCTION_WORKSTATION_IDS as readonly string[]).includes(id);
}

export function productionFixtureForWorkstation(id: ProductionWorkstationId) {
  return STORE_PRODUCTION_FIXTURES[PRODUCTION_FIXTURE_IDS.find((fixtureId) => (
    STORE_PRODUCTION_FIXTURES[fixtureId].workstationId === id
  ))!];
}

/** Complete rounded-rectangle interaction volume in scaled simulation units. */
export function productionMachineMagnet(id: ProductionWorkstationId, layoutScale: number, elementScale: number) {
  const fixture = productionFixtureForWorkstation(id);
  return {
    x: fixture.position[0] * layoutScale + fixture.localFootprint.centerX * elementScale,
    z: fixture.position[2] * layoutScale + fixture.localFootprint.centerZ * elementScale,
    halfExtents: [
      fixture.localFootprint.halfX * elementScale,
      fixture.localFootprint.halfZ * elementScale,
    ] as const,
    enterRadius: PRODUCTION_MAGNET_REACH.enter * elementScale,
    exitRadius: PRODUCTION_MAGNET_REACH.exit * elementScale,
  };
}

const cubicleWall = (id: string, x: number, z: number, halfX: number, halfZ: number) => ({
  id: `fixture:production-cubicle-${id}`,
  position: [x, 0, z] as const,
  /** Half extents in authored layout units, converted by each consumer. */
  halfX,
  halfZ,
});

export const PRODUCTION_CUBICLE = {
  center: [-8.25, -4.925] as const,
  bounds: { left: -10.92, right: -5.58, rear: -7.7, front: -2.15 },
  doorway: { centerX: -8.25, halfWidth: 1.15 },
  walls: [
    cubicleWall("left", -10.92, -4.925, 0.07, 2.775),
    cubicleWall("right", -5.58, -4.925, 0.07, 2.775),
    cubicleWall("rear", -8.25, -7.7, 2.67, 0.07),
    cubicleWall("front-left", -10.16, -2.15, 0.76, 0.07),
    cubicleWall("front-right", -6.34, -2.15, 0.76, 0.07),
  ],
} as const;
