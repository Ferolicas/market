export type StoreServiceFixtureId = "promotionalEndcap" | "returns" | "cartBay";

export interface StoreServiceFixture {
  id: StoreServiceFixtureId;
  obstacleId: string;
  position: readonly [x: number, y: number, z: number];
  footprint: Readonly<{ halfX: number; halfZ: number }>;
  service?: readonly [x: number, z: number];
  approach?: readonly (readonly [x: number, z: number])[];
}

/**
 * Physical service furniture shared by rendering, Rapier, Recast and customer
 * routes. Footprints are authored in unscaled StoreElement coordinates; the
 * world-scale layer applies the same element/layout factors as MarketKit.
 */
export const STORE_SERVICE_FIXTURES = {
  promotionalEndcap: {
    id: "promotionalEndcap",
    obstacleId: "fixture:promotional-endcap",
    position: [6.4, 0, -2.2],
    // The fixture is rotated 90 degrees: its 0.78 depth lies on X and its
    // 1.18 width lies on Z. A small envelope includes uprights and sign.
    footprint: { halfX: 0.42, halfZ: 0.62 },
  },
  returns: {
    id: "returns",
    obstacleId: "fixture:returns",
    position: [9.85, 0, 5.45],
    footprint: { halfX: 0.74, halfZ: 0.66 },
    // The cubicle faces negative Z toward the checkout-side aisle. The small
    // X offset keeps the socket clear of the counter's padded corner.
    service: [10.05, 4.3],
    approach: [[10.25, 2.75], [10.25, 4.3]],
  },
  cartBay: {
    id: "cartBay",
    obstacleId: "fixture:cart-bay",
    position: [3.05, 0, 6.55],
    footprint: { halfX: 1.08, halfZ: 0.76 },
    // The open aisle-facing side is on negative Z, clear of the entrance.
    service: [3.05, 5.25],
    approach: [[2.2, 5.25]],
  },
} as const satisfies Record<StoreServiceFixtureId, StoreServiceFixture>;

export const STORE_SERVICE_FIXTURE_IDS = Object.keys(STORE_SERVICE_FIXTURES) as StoreServiceFixtureId[];
export const RETURNS_POINT = STORE_SERVICE_FIXTURES.returns.service;
export const CART_RETURN_POINT = STORE_SERVICE_FIXTURES.cartBay.service;
export const CART_BAY_POINT = [STORE_SERVICE_FIXTURES.cartBay.position[0], STORE_SERVICE_FIXTURES.cartBay.position[2]] as const;

/**
 * Conservative route used only while Recast is still building. It follows the
 * same open aisle that the generated NavMesh selects between returns and the
 * cart bay, so a customer never cuts through checkout or retail furniture.
 */
export const RETURNS_TO_CART_FALLBACK = [
  [10.25, 4.3],
  [10.25, 2.75],
  [10.25, 0],
  [9.85, -0.3],
  [5.2, -0.3],
  [2.6, 1.05],
  [2.25, 1.4],
  [2.25, 3.55],
  [4.5, 5.2],
  [...CART_RETURN_POINT],
] as const satisfies readonly (readonly [x: number, z: number])[];
