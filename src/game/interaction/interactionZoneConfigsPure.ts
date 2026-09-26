import type { InteractionZoneConfig } from "./InteractionZone";
import { fixtureAvailable } from "@/game/stations/fixture-availability";
import { scaleStorePosition, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE } from "@/game/world-scale";
import { isWorkstationId, isWorkstationUnlocked, WORKSTATIONS, WORKSTATION_IDS, type WorkstationId } from "@/game/stations/workstation-layout";
import {
  isStockingInteractionId,
  retailDepartmentFromStockingInteraction,
  retailStockingMagnets,
  RETAIL_DEPARTMENT_IDS,
  RETAIL_DEPARTMENTS,
  stockingInteractionId,
} from "@/game/stations/retail-layout";
import { farmAnimalMagnet, farmInteractionId, scaledFarmHarvestSensor, FARM_BARN, FARM_PLOTS } from "@/game/stations/farm-layout";
import { STOREFRONT_LAYOUT } from "@/game/stations/storefront-layout";
import { WAREHOUSE_ORDERS_TERMINAL, WAREHOUSE_RETURN_STATION } from "@/game/stations/warehouse-layout";
import { isProductionWorkstationId, productionMachineMagnet } from "@/game/stations/production-layout";
import { isRegisterInteractionId, REGISTER_INTERACTION_IDS, registerLane, registerPickupPosition } from "@/game/stations/register-layout";
import { checkoutAreaForLane } from "@/game/stations/checkout-layout";
import { isPurchaseInteractionId, purchaseIdFromInteraction, purchaseInteractionId, PURCHASE_POSITIONS } from "@/game/stations/purchase-layout";
import { PURCHASE_MARKER } from "@/game/stations/purchase-marker";
import { PURCHASE_CONTRIBUTION_PULSE_MS } from "@/game/progression/PurchaseState";
import { OPENING_PURCHASES } from "@/game/progression/MartCampaign";

/**
 * Engine-agnostic re-derivation of `interactionZoneConfigs()`
 * (`src/components/game/MarketScene.tsx`) for the PlayCanvas port. Every
 * dependency here is already pure (no `three`/`@react-three/*` import in its
 * module graph — confirmed the same way `PlayCanvasRuntime.ts` itself avoids
 * Three: `grep -rl "from \"three\"" src/game/stations …` finds nothing), so
 * this file can be imported from `PlayCanvasRuntime.ts` without pulling the
 * plain-three renderer into the PlayCanvas bundle the way a direct import
 * from `MarketScene.tsx` would (that module's own top-level imports include
 * `three`, `@react-three/fiber`, `@react-three/drei` and
 * `@react-three/rapier`).
 *
 * This is a byte-for-byte behavioral port of that function's logic (not a
 * simplification) — every id, magnet, radius, priority, dwell/repeat/exit
 * timing and channel below matches the reference 1:1. `MarketScene.tsx` is
 * never imported or modified by this file.
 */

type InteractionId = string;

interface ZoneDefinition { id: InteractionId; label: string; position: [number, number, number]; facing?: number }

const ZONES: ZoneDefinition[] = ([
  ...OPENING_PURCHASES.map((purchase) => ({ id: purchaseInteractionId(purchase.id), label: purchase.label, position: [...PURCHASE_POSITIONS[purchase.id]] as [number, number, number] })),
  ...REGISTER_INTERACTION_IDS.map((id) => ({ id, label: `Recoger dinero de caja ${registerLane(id) + 1}`, position: registerPickupPosition(registerLane(id)) })),
  ...WORKSTATION_IDS.filter((id) => id !== "shelf").map((id) => {
    const station = WORKSTATIONS[id as Exclude<WorkstationId, "shelf">];
    return { id: id as Exclude<WorkstationId, "shelf">, label: station.label, position: [...station.position] as [number, number, number], facing: station.facing };
  }),
  ...RETAIL_DEPARTMENT_IDS.map((departmentId) => {
    const department = RETAIL_DEPARTMENTS[departmentId];
    return { id: stockingInteractionId(departmentId), label: `Surtir ${department.label.toLowerCase()}`, position: [department.service[0], 0, department.service[1]] as [number, number, number] };
  }),
  { id: WAREHOUSE_RETURN_STATION.interactionId, label: WAREHOUSE_RETURN_STATION.label, position: [...WAREHOUSE_RETURN_STATION.position] as [number, number, number] },
  { id: FARM_BARN.interactionId, label: FARM_BARN.label, position: [...FARM_BARN.position] as [number, number, number] },
  { id: "orders", label: WAREHOUSE_ORDERS_TERMINAL.label, position: [...WAREHOUSE_ORDERS_TERMINAL.position] as [number, number, number] },
  { id: "door", label: "Sensor de entrada", position: [STOREFRONT_LAYOUT.sensor.centerX, 0, STOREFRONT_LAYOUT.sensor.centerZ] },
] as ZoneDefinition[]).map((zone) => ({ ...zone, position: scaleStorePosition(zone.position) }));

export function interactionZoneConfigs(
  checkoutLevel = 1,
  unlockedAreas: readonly string[] = [],
  activeCropIds: readonly string[] = [],
  availablePurchaseIds: readonly string[] = [],
): InteractionZoneConfig[] {
  const storeZones = ZONES.filter((zone) => (
    (!isPurchaseInteractionId(zone.id) || availablePurchaseIds.includes(purchaseIdFromInteraction(zone.id)))
    && (!retailDepartmentFromStockingInteraction(zone.id) || fixtureAvailable(`fixture:retail-${retailDepartmentFromStockingInteraction(zone.id)}-1`, unlockedAreas))
    && (!isRegisterInteractionId(zone.id) || registerLane(zone.id) === 0 || unlockedAreas.includes(checkoutAreaForLane(registerLane(zone.id))))
    && (!isWorkstationId(zone.id) || isWorkstationUnlocked(zone.id, unlockedAreas))
  )).flatMap((zone): InteractionZoneConfig[] => {
    const departmentId = retailDepartmentFromStockingInteraction(zone.id);
    const productionMagnet = isProductionWorkstationId(zone.id) ? productionMachineMagnet(zone.id, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE) : null;
    const animalMagnet = zone.id === "chicken" || zone.id === "chicken2" || zone.id === "cow"
      ? farmAnimalMagnet(zone.id, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE) : null;
    const returnMagnet = zone.id === "warehouseReturn" ? {
      x: WAREHOUSE_RETURN_STATION.position[0] * STORE_LAYOUT_SCALE,
      z: WAREHOUSE_RETURN_STATION.position[2] * STORE_LAYOUT_SCALE,
      halfExtents: [WAREHOUSE_RETURN_STATION.footprint.halfX * STORE_ELEMENT_SCALE, WAREHOUSE_RETURN_STATION.footprint.halfZ * STORE_ELEMENT_SCALE] as const,
      enterRadius: WAREHOUSE_RETURN_STATION.enterRadius,
      exitRadius: WAREHOUSE_RETURN_STATION.exitRadius,
    } : null;
    const barnMagnet = zone.id === FARM_BARN.interactionId ? {
      x: FARM_BARN.position[0] * STORE_LAYOUT_SCALE,
      z: FARM_BARN.position[2] * STORE_LAYOUT_SCALE,
      halfExtents: [FARM_BARN.footprint.halfX * STORE_ELEMENT_SCALE, FARM_BARN.footprint.halfZ * STORE_ELEMENT_SCALE] as const,
      enterRadius: WAREHOUSE_RETURN_STATION.enterRadius,
      exitRadius: WAREHOUSE_RETURN_STATION.exitRadius,
    } : null;
    const magnets = departmentId
      ? retailStockingMagnets(departmentId, STORE_LAYOUT_SCALE, STORE_ELEMENT_SCALE, unlockedAreas)
      : [productionMagnet ?? animalMagnet ?? returnMagnet ?? barnMagnet];
    return magnets.map((magnet) => {
      const doorSensor = zone.id === "door" ? STOREFRONT_LAYOUT.sensor : null;
      return {
        id: zone.id,
        type: zone.id,
        x: magnet?.x ?? zone.position[0],
        z: magnet?.z ?? zone.position[2],
        ...(magnet
          ? { halfExtents: magnet.halfExtents }
          : doorSensor
            ? { halfExtents: [doorSensor.actorHalfWidth * STORE_LAYOUT_SCALE, doorSensor.actorHalfDepth * STORE_LAYOUT_SCALE] as const }
            : {}),
        enterRadius: magnet?.enterRadius ?? (doorSensor
          ? doorSensor.enterMargin * STORE_LAYOUT_SCALE
          : (isPurchaseInteractionId(zone.id)
              ? PURCHASE_MARKER.enterRadius
              : zone.id === "warehouseReturn"
                ? WAREHOUSE_RETURN_STATION.enterRadius
                : isWorkstationId(zone.id) ? 0.8 : 0.75) * STORE_ELEMENT_SCALE),
        exitRadius: magnet?.exitRadius ?? (doorSensor
          ? doorSensor.exitMargin * STORE_LAYOUT_SCALE
          : (isPurchaseInteractionId(zone.id)
              ? PURCHASE_MARKER.exitRadius
              : zone.id === "warehouseReturn"
                ? WAREHOUSE_RETURN_STATION.exitRadius
                : isWorkstationId(zone.id) ? 1.0 : 0.9) * STORE_ELEMENT_SCALE),
        actorMask: ["player"],
        priority: isStockingInteractionId(zone.id) ? 80 : isPurchaseInteractionId(zone.id) ? 30 : ({ orders: 25, checkout: 100, mill: 70, bakery: 70, cheese: 70, juice: 70, chicken: 65, cow: 65, door: 20, warehouseReturn: 6, farmBarn: 6 } as Partial<Record<string, number>>)[zone.id] ?? 10,
        dwellMs: zone.id === "warehouseReturn" || zone.id === "farmBarn" ? WAREHOUSE_RETURN_STATION.dwellMs : zone.id === "checkout" ? 180 : zone.id === "orders" ? 700 : zone.id === "door" || isPurchaseInteractionId(zone.id) || isStockingInteractionId(zone.id) || isProductionWorkstationId(zone.id) ? 0 : 80,
        repeatEveryMs: zone.id === "warehouseReturn" || zone.id === "farmBarn" ? WAREHOUSE_RETURN_STATION.repeatEveryMs : zone.id === "orders" ? 60_000 : isPurchaseInteractionId(zone.id) ? PURCHASE_CONTRIBUTION_PULSE_MS : isStockingInteractionId(zone.id) || isProductionWorkstationId(zone.id) ? 180 : zone.id === "checkout" ? (checkoutLevel >= 2 ? 340 : 450) : zone.id === "door" ? 60_000 : 220,
        exitGraceMs: zone.id === "warehouseReturn" || zone.id === "farmBarn" ? WAREHOUSE_RETURN_STATION.exitGraceMs : 120,
        channel: zone.id === "door" || zone.id === "orders" || isPurchaseInteractionId(zone.id) || isRegisterInteractionId(zone.id) ? "passive" : zone.id === "checkout" ? "hands" : "transfer",
      } satisfies InteractionZoneConfig;
    });
  });
  const activeCrops = new Set(activeCropIds);
  const farmSensor = scaledFarmHarvestSensor(STORE_ELEMENT_SCALE);
  const farmZones = FARM_PLOTS.flatMap((plot): InteractionZoneConfig[] => {
    const id = farmInteractionId(plot.id);
    if (!activeCrops.has(plot.id) || !id) return [];
    const position = scaleStorePosition([...plot.position] as [number, number, number]);
    return [{
      id,
      type: "farm-plot",
      x: position[0],
      z: position[2],
      halfExtents: farmSensor.halfExtents,
      enterRadius: farmSensor.enterRadius,
      exitRadius: farmSensor.exitRadius,
      actorMask: ["player"],
      priority: 92,
      dwellMs: farmSensor.dwellMs,
      repeatEveryMs: farmSensor.repeatEveryMs,
      exitGraceMs: farmSensor.exitGraceMs,
      channel: "transfer",
    }];
  });
  return [...storeZones, ...farmZones];
}
