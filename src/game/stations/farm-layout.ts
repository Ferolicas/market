import type { CropState } from "../types";

export type FarmPlotId = "crop-tomato-1" | "crop-tomato-2" | "crop-wheat-1" | "crop-corn-1";
export type FarmInteractionId = `farm:${FarmPlotId}`;

export interface FarmPlotLayout {
  id: FarmPlotId;
  productId: CropState["productId"];
  position: readonly [number, number, number];
  accent: string;
}

export const FARM_PLOTS: readonly FarmPlotLayout[] = [
  { id: "crop-tomato-1", productId: "tomatoes", position: [-9.45, 0, 10.1], accent: "#e34f3f" },
  { id: "crop-tomato-2", productId: "tomatoes", position: [-7.05, 0, 10.1], accent: "#ef6a4b" },
  { id: "crop-wheat-1", productId: "wheat", position: [-9.45, 0, 11.75], accent: "#e9b83f" },
  { id: "crop-corn-1", productId: "corn", position: [-7.05, 0, 11.75], accent: "#f0c438" },
] as const;

const FARM_PLOT_BY_ID = new Map<string, FarmPlotLayout>(FARM_PLOTS.map((plot) => [plot.id, plot]));

export function farmPlotById(id: string) {
  return FARM_PLOT_BY_ID.get(id);
}

export function farmInteractionId(cropId: string): FarmInteractionId | null {
  return FARM_PLOT_BY_ID.has(cropId) ? `farm:${cropId as FarmPlotId}` : null;
}

export function cropIdFromFarmInteraction(id: string): FarmPlotId | null {
  if (!id.startsWith("farm:")) return null;
  const cropId = id.slice(5);
  return FARM_PLOT_BY_ID.has(cropId) ? cropId as FarmPlotId : null;
}

export function isFarmInteractionId(id: string): id is FarmInteractionId {
  return cropIdFromFarmInteraction(id) !== null;
}
