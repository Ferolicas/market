import { CHECKOUT_LANES } from "./checkout-layout";
import { retailServicePoint } from "./retail-layout";

export type WorkstationId = "farm" | "mill" | "bakery" | "chicken" | "cow" | "cheese" | "juice" | "shelf" | "checkout" | "office" | "upgrade-station" | "upgrade-speed" | "upgrade-capacity" | "upgrade-employee";

export interface WorkstationLayout {
  id: WorkstationId;
  label: string;
  padLabel: string;
  color: string;
  position: readonly [number, number, number];
  facing: number;
  unlockArea?: string;
  dedicatedPad?: boolean;
}

const tomatoShelf = retailServicePoint("tomatoes");

export const WORKSTATIONS: Record<WorkstationId, WorkstationLayout> = {
  checkout: { id: "checkout", label: "Atender la caja", padLabel: "PUESTO CAJERO", color: "#3f9a69", position: CHECKOUT_LANES[0].cashierWork, facing: -2.74, dedicatedPad: true },
  shelf: { id: "shelf", label: "Surtir expositor", padLabel: "SURTIR", color: "#3f7b4c", position: [tomatoShelf[0], 0, tomatoShelf[1]], facing: 0 },
  mill: { id: "mill", label: "Cargar molino", padLabel: "MOLINO", color: "#b47a3f", position: [-7.05, 0, -4.05], facing: -Math.PI / 2, unlockArea: "flour-mill" },
  bakery: { id: "bakery", label: "Hornear pan", padLabel: "PANADERÍA", color: "#b96d39", position: [-7.05, 0, -0.45], facing: -Math.PI / 2, unlockArea: "bread-oven" },
  cheese: { id: "cheese", label: "Procesar queso", padLabel: "QUESOS", color: "#d39f39", position: [-6.15, 0, -0.88], facing: Math.PI, unlockArea: "cheese-maker" },
  juice: { id: "juice", label: "Procesar zumo", padLabel: "ZUMOS", color: "#cc6841", position: [-7, 0, 1.55], facing: Math.PI / 2, unlockArea: "juice-machine" },
  chicken: { id: "chicken", label: "Recoger huevos", padLabel: "RECOGER HUEVOS", color: "#d49a34", position: [-3.45, 0, 9.65], facing: 0, unlockArea: "chicken-coop" },
  cow: { id: "cow", label: "Recoger leche", padLabel: "RECOGER LECHE", color: "#4382a1", position: [-1.5, 0, 9.65], facing: 0, unlockArea: "cow-station" },
  farm: { id: "farm", label: "Trabajar en la huerta", padLabel: "HUERTA", color: "#4f8b58", position: [-4.05, 0, 10.65], facing: -Math.PI / 2 },
  office: { id: "office", label: "Mapa y gerencia", padLabel: "GERENCIA", color: "#557a70", position: [7.05, 0, -5.35], facing: Math.PI / 2 },
  "upgrade-station": { id: "upgrade-station", label: "Financiar mejora de estación", padLabel: "ESTACIÓN", color: "#67a9de", position: [3.2, 0.035, -6.55], facing: 0, dedicatedPad: true },
  "upgrade-speed": { id: "upgrade-speed", label: "Mejorar velocidad", padLabel: "VELOCIDAD", color: "#67a9de", position: [4.75, 0.035, -6.55], facing: 0, dedicatedPad: true },
  "upgrade-capacity": { id: "upgrade-capacity", label: "Mejorar capacidad", padLabel: "CARGA", color: "#67a9de", position: [6.3, 0.035, -6.55], facing: 0, dedicatedPad: true },
  "upgrade-employee": { id: "upgrade-employee", label: "Contratar o formar empleado", padLabel: "EQUIPO", color: "#67a9de", position: [7.85, 0.035, -6.55], facing: 0, dedicatedPad: true },
};

export const WORKSTATION_IDS = Object.keys(WORKSTATIONS) as WorkstationId[];

export function isWorkstationId(id: string): id is WorkstationId {
  return id in WORKSTATIONS;
}

export function isWorkstationUnlocked(id: WorkstationId, unlockedAreas: readonly string[]) {
  const area = WORKSTATIONS[id].unlockArea;
  return !area || unlockedAreas.includes(area);
}
