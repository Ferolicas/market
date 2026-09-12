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
  yaw?: number;
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
    position: [-10.5, 0, -7.35],
    localFootprint: { centerX: 0, centerZ: -0.58, halfX: 0.65, halfZ: 0.58 },
    operatorWorkPoint: [-9.65, -6.55],
  },
  breadOven: {
    fixtureId: "breadOven",
    workstationId: "bakery",
    machineId: "bread-oven-1",
    obstacleId: "fixture:bread-oven",
    label: "HORNO",
    processLabel: "HARINA · PAN",
    accent: "#c96d3e",
    position: [-7.85, 0, -7.35],
    localFootprint: { centerX: 0, centerZ: -0.55, halfX: 0.76, halfZ: 0.55 },
    operatorWorkPoint: [-8.8, -6.55],
  },
  cheeseMaker: {
    fixtureId: "cheeseMaker",
    workstationId: "cheese",
    machineId: "cheese-maker-1",
    obstacleId: "fixture:cheese-maker",
    label: "QUESERÍA",
    processLabel: "LECHE · QUESO",
    accent: "#d8a92f",
    position: [-7.25, 0, -3.85],
    localFootprint: { centerX: 0, centerZ: -0.55, halfX: 0.6, halfZ: 0.55 },
    operatorWorkPoint: [-8.7, -4],
  },
  juiceMachine: {
    fixtureId: "juiceMachine",
    workstationId: "juice",
    machineId: "juice-machine-1",
    obstacleId: "fixture:juice-machine",
    label: "ZUMOS",
    processLabel: "NARANJA · ZUMO",
    accent: "#df7540",
    position: [-5.4, 0, -5.8],
    yaw: 0,
    localFootprint: { centerX: 0, centerZ: -0.55, halfX: 0.6, halfZ: 0.55 },
    operatorWorkPoint: [-5.4, -4.4],
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
  center: [-9, -5.9] as const,
  bounds: { left: -11.5, right: -6.5, rear: -8.55, front: -3.25 },
  doorway: { centerX: -9, halfWidth: 1.15 },
  walls: [
    cubicleWall("left", -11.5, -5.9, 0.07, 2.65),
    cubicleWall("right", -6.5, -5.9, 0.07, 2.65),
    cubicleWall("rear", -9, -8.55, 2.5, 0.07),
    cubicleWall("front-left", -10.825, -3.25, 0.675, 0.07),
    cubicleWall("front-right", -7.175, -3.25, 0.675, 0.07),
  ],
} as const;
