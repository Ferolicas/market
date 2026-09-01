import { CHECKOUT_LANES } from "./checkout-layout";
import { FARM_ANIMAL_STATIONS } from "./farm-layout";
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

export const WORKSTATIONS: Record<WorkstationId, WorkstationLayout> = {
  checkout: { id: "checkout", label: "Atender la caja", position: CHECKOUT_LANES[0].cashierWork, facing: -2.74 },
  shelf: { id: "shelf", label: "Surtir expositor", position: [tomatoShelf[0], 0, tomatoShelf[1]], facing: 0 },
  mill: { id: "mill", label: "Cargar molino", position: [-7.05, 0, -4.05], facing: -Math.PI / 2, unlockArea: "flour-mill" },
  bakery: { id: "bakery", label: "Hornear pan", position: [-7.05, 0, -0.45], facing: -Math.PI / 2, unlockArea: "bread-oven" },
  cheese: { id: "cheese", label: "Procesar queso", position: [-6.15, 0, -0.88], facing: Math.PI, unlockArea: "cheese-maker" },
  juice: { id: "juice", label: "Procesar zumo", position: [-7, 0, 1.55], facing: Math.PI / 2, unlockArea: "juice-machine" },
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
