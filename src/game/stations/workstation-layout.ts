import { CHECKOUT_LANES } from "./checkout-layout";
import { FARM_ANIMAL_STATIONS } from "./farm-layout";
import { productionFixtureForWorkstation } from "./production-layout";
import { retailServicePoint } from "./retail-layout";

export type WorkstationId = "mill" | "bakery" | "chicken" | "cow" | "cheese" | "juice" | "shelf" | "checkout";

export interface WorkstationLayout {
  id: WorkstationId;
  label: string;
  position: readonly [number, number, number];
  facing: number;
  unlockArea?: string;
}

const tomatoShelf = retailServicePoint("tomatoes");
const mill = productionFixtureForWorkstation("mill");
const bakery = productionFixtureForWorkstation("bakery");
const cheese = productionFixtureForWorkstation("cheese");
const juice = productionFixtureForWorkstation("juice");

export const WORKSTATIONS: Record<WorkstationId, WorkstationLayout> = {
  checkout: { id: "checkout", label: "Atender la caja", position: CHECKOUT_LANES[0].cashierWork, facing: -2.74 },
  shelf: { id: "shelf", label: "Surtir expositor", position: [tomatoShelf[0], 0, tomatoShelf[1]], facing: 0 },
  mill: { id: "mill", label: "Usar molino", position: [mill.operatorWorkPoint[0], 0, mill.operatorWorkPoint[1]], facing: Math.PI, unlockArea: "flour-mill" },
  bakery: { id: "bakery", label: "Usar horno", position: [bakery.operatorWorkPoint[0], 0, bakery.operatorWorkPoint[1]], facing: Math.PI, unlockArea: "bread-oven" },
  cheese: { id: "cheese", label: "Usar quesería", position: [cheese.operatorWorkPoint[0], 0, cheese.operatorWorkPoint[1]], facing: 0, unlockArea: "cheese-maker" },
  juice: { id: "juice", label: "Usar máquina de zumos", position: [juice.operatorWorkPoint[0], 0, juice.operatorWorkPoint[1]], facing: 0, unlockArea: "juice-machine" },
  chicken: { id: "chicken", label: "Recoger huevos", position: FARM_ANIMAL_STATIONS.chicken.workPosition, facing: FARM_ANIMAL_STATIONS.chicken.facing, unlockArea: "chicken-coop" },
  cow: { id: "cow", label: "Recoger leche", position: FARM_ANIMAL_STATIONS.cow.workPosition, facing: FARM_ANIMAL_STATIONS.cow.facing, unlockArea: "cow-station" },
};

// Only hands-on store jobs live in the world. Farming has one invisible sensor
// per crop bed, while construction and upgrades are managed from the tablet UI
// instead of charging the player from floor buttons.
export const WORKSTATION_IDS = ["mill", "bakery", "chicken", "cow", "cheese", "juice", "shelf", "checkout"] as const satisfies readonly WorkstationId[];

export function isWorkstationId(id: string): id is WorkstationId {
  return (WORKSTATION_IDS as readonly string[]).includes(id);
}

export function isWorkstationUnlocked(id: WorkstationId, unlockedAreas: readonly string[]) {
  const area = WORKSTATIONS[id].unlockArea;
  return !area || unlockedAreas.includes(area);
}
