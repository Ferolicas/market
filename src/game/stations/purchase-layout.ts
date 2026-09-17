import { OPENING_PURCHASES, type OpeningPurchaseId } from "../progression/MartCampaign";
import { isStoreNavigationPoint } from "../navigation/NavMeshService";
import { overlapsStoreObstacle, scaleStorePoint, STORE_ELEMENT_SCALE, STORE_LAYOUT_SCALE, STORE_OBSTACLES } from "../world-scale";
import { CHECKOUT_LANE_IDS, CHECKOUT_LANES, checkoutQueuePosition } from "./checkout-layout";
import { FARM_ANIMAL_STATIONS, FARM_BARN, FARM_PLOT_FOOTPRINT, FARM_PLOTS, FARM_VISIBLE_FRONT_Z, FARM_WORKER_HOME, type FarmPlotId } from "./farm-layout";
import { ALL_PURCHASED_AREAS } from "./fixture-availability";
import { PURCHASE_MARKER } from "./purchase-marker";
import { registerPickupPosition } from "./register-layout";
import { RETAIL_DEPARTMENT_IDS, RETAIL_DEPARTMENTS } from "./retail-layout";
import { STORE_REAR_DOOR } from "./storefront-layout";
import { STOCKROOM_POINT, WAREHOUSE_RETURN_STATION } from "./warehouse-layout";
import { WORKSTATIONS } from "./workstation-layout";

/** Clear front-of-store service space, away from checkout and pantry sockets. */
export const PURCHASE_POINT: [number, number, number] = [-3.8, 0.06, 4.8];

export type PurchaseMarkerCorner = "lower-left" | "lower-right" | "upper-left" | "upper-right" | "authored";

/** Element-to-layout factor: footprints are authored in element units. */
const ELEMENT_TO_LAYOUT = STORE_ELEMENT_SCALE / STORE_LAYOUT_SCALE;
/** Marker centre to element corner, so the square clears the element by a hand. */
const CORNER_GAP = (PURCHASE_MARKER.halfSize + 0.14) * ELEMENT_TO_LAYOUT;
/** Marker centre to any socket the owner works from: the magnet plus a body. */
export const PURCHASE_MARKER_CLEARANCE = 1;
/** Farm markers stay in front of the wall's shadow line, like the beds do:
 * the square's front edge, not just its centre, clears the line by 0.3. */
const FARM_MARKER_MAX_Z = FARM_VISIBLE_FRONT_Z - 0.3 - PURCHASE_MARKER.halfSize * ELEMENT_TO_LAYOUT;
/** A marker must stand inside the walls (store) or the fences (farm), a body away. */
const STORE_MARKER_BOUNDS = { minX: -10.9, maxX: 10.9, minZ: -8.2, maxZ: 7.4 } as const;
const FARM_MARKER_BOUNDS = { minX: -10.45, maxX: 10.45, minZ: -17.6, maxZ: FARM_MARKER_MAX_Z } as const;
/** When a corner is taken, the marker slides along that edge towards the middle. */
const CORNER_SLIDE_STEP = 0.38;

interface Footprint { xmin: number; xmax: number; zmin: number; zmax: number; farm: boolean }

function obstacleFootprint(id: string): Footprint {
  const obstacle = STORE_OBSTACLES.find((candidate) => candidate.id === id);
  if (!obstacle) throw new Error(`purchase-layout: no obstacle ${id}`);
  const x = obstacle.x / STORE_LAYOUT_SCALE, z = obstacle.z / STORE_LAYOUT_SCALE;
  const halfX = obstacle.halfX / STORE_LAYOUT_SCALE, halfZ = obstacle.halfZ / STORE_LAYOUT_SCALE;
  return { xmin: x - halfX, xmax: x + halfX, zmin: z - halfZ, zmax: z + halfZ, farm: z < -9 };
}

function plotFootprint(id: FarmPlotId): Footprint {
  const plot = FARM_PLOTS.find((candidate) => candidate.id === id)!;
  const halfX = FARM_PLOT_FOOTPRINT.halfX * ELEMENT_TO_LAYOUT, halfZ = FARM_PLOT_FOOTPRINT.halfZ * ELEMENT_TO_LAYOUT;
  return { xmin: plot.position[0] - halfX, xmax: plot.position[0] + halfX, zmin: plot.position[2] - halfZ, zmax: plot.position[2] + halfZ, farm: true };
}

/** The thing each purchase buys or improves; its marker sits at one of its corners. */
const PURCHASE_ELEMENTS: Partial<Record<OpeningPurchaseId, () => Footprint>> = {
  "chicken-1": () => obstacleFootprint("fixture:chicken-coop"),
  "chicken-1-tier-2": () => obstacleFootprint("fixture:chicken-coop"),
  "chicken-1-tier-3": () => obstacleFootprint("fixture:chicken-coop"),
  "chicken-2": () => obstacleFootprint("fixture:chicken-coop-2"),
  "cow-1": () => obstacleFootprint("fixture:cow-station"),
  "cow-1-tier-2": () => obstacleFootprint("fixture:cow-station"),
  "cow-1-tier-3": () => obstacleFootprint("fixture:cow-station"),
  "tomato-2": () => plotFootprint("crop-tomato-2"),
  "tomato-3": () => plotFootprint("crop-tomato-3"),
  "wheat-1": () => plotFootprint("crop-wheat-1"),
  "corn-1": () => plotFootprint("crop-corn-1"),
  "apple-1": () => plotFootprint("crop-apple-1"),
  "orange-1": () => plotFootprint("crop-orange-1"),
  "egg-display-1": () => obstacleFootprint("fixture:retail-eggs-1"),
  "dairy-display-1": () => obstacleFootprint("fixture:retail-dairy-1"),
  "coffee-supply-1": () => plotFootprint("crop-coffee-1"),
  "preserves-supply-1": () => obstacleFootprint("fixture:retail-preserves-1"),
  "flour-mill-1": () => obstacleFootprint("fixture:flour-mill"),
  "bread-oven-1": () => obstacleFootprint("fixture:bread-oven"),
  "cheese-maker-1": () => obstacleFootprint("fixture:cheese-maker"),
  "juice-machine-1": () => obstacleFootprint("fixture:juice-machine"),
  "corn-canner-1": () => obstacleFootprint("fixture:corn-canner"),
};

/** Purchases with no element of their own, and the fallback for an element
 * whose four corners are all walled in or on a socket: measured spots on
 * the farm apron, the store front and beside the rear door. */
const AUTHORED_POSITIONS: Partial<Record<OpeningPurchaseId, [number, number]>> = {
  // Farmers have no element: their markers line the apron between the front
  // beds' corner markers and the fence, still in front of the wall's shadow.
  "farmer-1": [-8.8, -12.3],
  "farmer-2": [-6.1, -12.3],
  "farmer-3": [-1.4, -12.3],
  "player-2": [PURCHASE_POINT[0], PURCHASE_POINT[2]],
  "expansion-1": [5.2, -7.8],
  "chicken-1": [0.45, -12.6],
  "chicken-1-tier-2": [0.45, -12.6],
  "chicken-1-tier-3": [0.45, -12.6],
  "chicken-2": [8.8, -12.6],
  "cow-1": [5.85, -12.6],
  "cow-1-tier-2": [5.85, -12.6],
  "cow-1-tier-3": [5.85, -12.6],
  "tomato-2": [-6.3, -16.9],
  "tomato-3": [-3.6, -16.9],
  "wheat-1": [-3.6, -13.7],
  "corn-1": [-6.3, -13.7],
  "apple-1": [-9, -13.7],
  "orange-1": [7.2, -13.7],
  "egg-display-1": [-8.6, -1.75],
  "dairy-display-1": [-9.5, 4.3],
  "coffee-supply-1": [8.9, -12.5],
  "preserves-supply-1": [10.2, -2.8],
  "flour-mill-1": [-10.9, -5.2],
  "bread-oven-1": [-7.3, -5.9],
  "cheese-maker-1": [-6.4, -2.6],
  "juice-machine-1": [-5.4, -7.6],
  "corn-canner-1": [10.6, -5.6],
};

/** Every spot the owner stands on to work: a marker may never sit on one. */
export const PURCHASE_WORK_SOCKETS: { id: string; point: [number, number] }[] = [
  ...Object.values(WORKSTATIONS).map((station) => ({ id: `work:${station.id}`, point: [station.position[0], station.position[2]] as [number, number] })),
  ...RETAIL_DEPARTMENT_IDS.map((id) => ({ id: `service:${id}`, point: [...RETAIL_DEPARTMENTS[id].service] as [number, number] })),
  { id: "rear-door-inside", point: [...STORE_REAR_DOOR.insideApproach] as [number, number] },
  { id: "rear-door-outside", point: [...STORE_REAR_DOOR.outsideApproach] as [number, number] },
  { id: "stockroom", point: [...STOCKROOM_POINT] as [number, number] },
  { id: "warehouse-return", point: [WAREHOUSE_RETURN_STATION.position[0], WAREHOUSE_RETURN_STATION.position[2]] as [number, number] },
  { id: "farm-barn", point: [...FARM_BARN.workerPosition] as [number, number] },
  { id: "farm-worker-home", point: [...FARM_WORKER_HOME] as [number, number] },
  ...FARM_PLOTS.map((plot) => ({ id: `crop:${plot.id}`, point: [plot.position[0], plot.position[2]] as [number, number] })),
  ...Object.entries(FARM_ANIMAL_STATIONS).map(([id, station]) => ({ id: `animal:${id}`, point: [station.workPosition[0], station.workPosition[2]] as [number, number] })),
  ...CHECKOUT_LANE_IDS.flatMap((lane) => [
    { id: `checkout-${lane + 1}:cashier`, point: [CHECKOUT_LANES[lane].cashierWork[0], CHECKOUT_LANES[lane].cashierWork[2]] as [number, number] },
    { id: `checkout-${lane + 1}:front`, point: [...CHECKOUT_LANES[lane].customerFront] as [number, number] },
    { id: `checkout-${lane + 1}:bag`, point: [...CHECKOUT_LANES[lane].bagPickup] as [number, number] },
    { id: `checkout-${lane + 1}:register`, point: [registerPickupPosition(lane)[0], registerPickupPosition(lane)[2]] as [number, number] },
    ...[1, 2, 3].map((slot) => ({ id: `checkout-${lane + 1}:queue-${slot}`, point: checkoutQueuePosition(slot, lane) })),
  ]),
];

const CORNERS: { corner: PurchaseMarkerCorner; dx: number; dz: number }[] = [
  // Screen order for the fixed camera at +x/+z: lower-left is min x, max z.
  { corner: "lower-left", dx: -1, dz: 1 },
  { corner: "lower-right", dx: 1, dz: 1 },
  { corner: "upper-left", dx: -1, dz: -1 },
  { corner: "upper-right", dx: 1, dz: -1 },
];

function markerSpotIsFree(point: [number, number], farm: boolean) {
  const bounds = farm ? FARM_MARKER_BOUNDS : STORE_MARKER_BOUNDS;
  if (point[0] < bounds.minX || point[0] > bounds.maxX || point[1] < bounds.minZ || point[1] > bounds.maxZ) return false;
  if (!isStoreNavigationPoint(point, ALL_PURCHASED_AREAS)) return false;
  if (overlapsStoreObstacle(scaleStorePoint(point), 0.32 * STORE_LAYOUT_SCALE, ALL_PURCHASED_AREAS)) return false;
  return PURCHASE_WORK_SOCKETS.every((socket) => Math.hypot(socket.point[0] - point[0], socket.point[1] - point[1]) >= PURCHASE_MARKER_CLEARANCE);
}

/** The corner itself, then the same edge slid towards the element's middle:
 * a pen wedged against its neighbour still gets its marker in front of its
 * own left half instead of somewhere unrelated. */
function cornerCandidates(element: Footprint, dx: number, dz: number): [number, number][] {
  const cornerX = (dx < 0 ? element.xmin : element.xmax) + dx * CORNER_GAP;
  const cornerZ = (dz < 0 ? element.zmin : element.zmax) + dz * CORNER_GAP;
  const centreX = (element.xmin + element.xmax) / 2;
  const candidates: [number, number][] = [[cornerX, cornerZ]];
  for (let x = cornerX - dx * CORNER_SLIDE_STEP; dx < 0 ? x <= centreX : x >= centreX; x -= dx * CORNER_SLIDE_STEP) candidates.push([x, cornerZ]);
  return candidates;
}

function placeMarker(id: OpeningPurchaseId): { position: [number, number]; corner: PurchaseMarkerCorner } {
  const element = PURCHASE_ELEMENTS[id]?.();
  if (element) {
    for (const { corner, dx, dz } of CORNERS) {
      const point = cornerCandidates(element, dx, dz).find((candidate) => markerSpotIsFree(candidate, element.farm));
      if (point) return { position: [Math.round(point[0] * 1000) / 1000, Math.round(point[1] * 1000) / 1000], corner };
    }
  }
  const authored = AUTHORED_POSITIONS[id];
  if (!authored) throw new Error(`purchase-layout: no spot for ${id}`);
  return { position: authored, corner: "authored" };
}

/**
 * The pay marker of every purchase: a small square at the lower-left corner
 * (as the fixed camera sees it) of the thing it buys, the first free corner
 * clockwise when that one is walled in or on a work socket, and a measured
 * spot for purchases with no element of their own. purchase-layout.test.ts
 * checks every spot against the NavMesh, the obstacles and the sockets.
 */
export const PURCHASE_MARKER_PLACEMENTS: Record<OpeningPurchaseId, { position: [number, number]; corner: PurchaseMarkerCorner }> = Object.fromEntries(
  OPENING_PURCHASES.map((purchase) => [purchase.id, placeMarker(purchase.id)]),
) as Record<OpeningPurchaseId, { position: [number, number]; corner: PurchaseMarkerCorner }>;

export const PURCHASE_POSITIONS: Record<OpeningPurchaseId, [number, number, number]> = Object.fromEntries(
  OPENING_PURCHASES.map((purchase) => {
    const { position } = PURCHASE_MARKER_PLACEMENTS[purchase.id];
    return [purchase.id, [position[0], 0.06, position[1]]];
  }),
) as Record<OpeningPurchaseId, [number, number, number]>;

export type PurchaseInteractionId = `purchase:${OpeningPurchaseId}`;

export function purchaseInteractionId(id: OpeningPurchaseId): PurchaseInteractionId {
  return `purchase:${id}`;
}

export function isPurchaseInteractionId(id: string): id is PurchaseInteractionId {
  return id.startsWith("purchase:");
}

export function purchaseIdFromInteraction(id: PurchaseInteractionId): OpeningPurchaseId {
  return id.slice("purchase:".length) as OpeningPurchaseId;
}
