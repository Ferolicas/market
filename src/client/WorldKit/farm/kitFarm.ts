import * as THREE from "three";
import type { CropState, ProductId, ProductionMachineState } from "@/game/types";
import { FARM_ANIMAL_STATIONS, FARM_BARN, FARM_FIELD, FARM_PLOTS, type FarmPlotLayout } from "@/game/stations/farm-layout";
import { fixtureAvailable } from "@/game/stations/fixture-availability";
import { cropHarvestYield, cropProgress } from "@/game/stations/StationSystem";
import { makeStoreElement } from "../storeElement";
import { buildAnimalPaddock, buildAnimalStation } from "./animalStation";
import { buildCropPlot, buildDormantCropPlot, farmCropKind } from "./cropPlot";
import { buildFarmBarn } from "./farmBarn";
import { buildGardenFloor } from "./gardenFloor";

/**
 * Faithful port of `KitFarm`, the top-level entry from `MarketKit.tsx`
 * (lines ~1145-1188). Assembles the static shell (`GardenFloor`/
 * `FarmEntranceGate`, `FarmBarn`), the eight crop plots and the three animal
 * stations (two chicken coops, one cow), gating each piece by
 * `fixtureAvailable()`/`unlockedAreas` exactly like the source.
 *
 * `PRODUCTS_LABELS` is duplicated here (13 entries, copied verbatim from
 * `MarketKit.tsx` line 500) rather than imported from that module: importing
 * from `MarketKit.tsx` would pull its entire React/R3F/drei/GLTF module
 * graph into this framework-free tree — the whole reason this port exists —
 * for one plain object literal.
 */
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

export interface FarmBuildProps {
  crops: readonly CropState[];
  machines: readonly ProductionMachineState[];
  nowMs: number;
  unlockedAreas: readonly string[];
}

function buildFarmPlot(plot: FarmPlotLayout) {
  const element = makeStoreElement([plot.position[0], plot.position[1], plot.position[2]]);

  const dormant = buildDormantCropPlot([0, 0, 0]);
  element.add(dormant);

  const cropHandle = buildCropPlot([0, 0, 0], {
    crop: farmCropKind(plot.productId),
    accent: plot.accent,
    label: PRODUCTS_LABELS[plot.productId],
  });
  element.add(cropHandle.group);

  function update(crop: CropState | undefined, unlockedAreas: readonly string[], nowMs: number) {
    // Mirrors KitFarm's `unlockedAreas.includes("purchase-campaign") &&
    // (!crop || crop.status === "LOCKED") -> return null` early-out.
    const gated = unlockedAreas.includes("purchase-campaign") && (!crop || crop.status === "LOCKED");
    element.visible = !gated;
    if (gated) return;

    const isDormant = !crop || crop.status === "LOCKED";
    dormant.visible = isDormant;
    cropHandle.group.visible = !isDormant;
    if (!isDormant && crop) {
      cropHandle.update({
        status: crop.status,
        progress: cropProgress(crop, nowMs),
        available: crop.available,
        yieldCapacity: cropHarvestYield(crop.productId, crop.tier, crop.baseYield),
      });
    }
  }

  return { id: plot.id, element, update };
}

function buildAnimalStationGroup(kind: "chicken" | "cow", position: readonly [number, number, number], fixtureId: string, areaId: string) {
  const element = makeStoreElement([position[0], position[1], position[2]]);
  element.add(buildAnimalPaddock(kind));

  const station = buildAnimalStation(kind, [0, 0, 0]);
  station.group.visible = false;
  element.add(station.group);

  function update(unlockedAreas: readonly string[], machine: ProductionMachineState | undefined) {
    element.visible = fixtureAvailable(fixtureId, unlockedAreas);
    const showStation = unlockedAreas.includes(areaId) && Boolean(machine);
    station.group.visible = showStation;
    if (showStation && machine) station.update(machine);
  }

  return { element, update };
}

/** `KitFarm`: the whole farm estate, gated exactly like the source. */
export function buildFarm(props: FarmBuildProps): { group: THREE.Group; update: (next: FarmBuildProps) => void } {
  const group = new THREE.Group();

  const gardenElement = makeStoreElement([FARM_FIELD.center[0], FARM_FIELD.center[1], FARM_FIELD.center[2]]);
  gardenElement.add(buildGardenFloor());
  group.add(gardenElement);

  const plots = FARM_PLOTS.map((plot) => buildFarmPlot(plot));
  for (const plot of plots) group.add(plot.element);

  const barnElement = makeStoreElement([FARM_BARN.position[0], FARM_BARN.position[1], FARM_BARN.position[2]]);
  barnElement.add(buildFarmBarn());
  group.add(barnElement);

  const chicken1 = buildAnimalStationGroup("chicken", FARM_ANIMAL_STATIONS.chicken.position, "fixture:chicken-coop", "chicken-coop");
  const cow1 = buildAnimalStationGroup("cow", FARM_ANIMAL_STATIONS.cow.position, "fixture:cow-station", "cow-station");
  const chicken2 = buildAnimalStationGroup("chicken", FARM_ANIMAL_STATIONS.chicken2.position, "fixture:chicken-coop-2", "chicken-coop-2");
  group.add(chicken1.element, cow1.element, chicken2.element);

  function update(next: FarmBuildProps) {
    const cropsById = new Map(next.crops.map((crop) => [crop.id, crop]));
    for (const plot of plots) plot.update(cropsById.get(plot.id), next.unlockedAreas, next.nowMs);

    const machineById = new Map(next.machines.map((machine) => [machine.id, machine]));
    chicken1.update(next.unlockedAreas, machineById.get("chicken-coop-1"));
    cow1.update(next.unlockedAreas, machineById.get("cow-station-1"));
    chicken2.update(next.unlockedAreas, machineById.get("chicken-coop-2"));
  }

  update(props);
  return { group, update };
}
