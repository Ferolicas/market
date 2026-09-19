class_name StoreServiceLayout
extends RefCounted
## Port of src/game/stations/store-service-layout.ts.
##
## Physical service furniture shared by rendering, physics, navigation and
## customer routes. Footprints are authored in unscaled StoreElement
## coordinates; the world-scale layer applies the same element/layout factors
## as MarketKit. Fixture keys: id, obstacleId, position [x, y, z],
## footprint { halfX, halfZ }, service [x, z] (optional), approach (optional).

const STORE_SERVICE_FIXTURES = {
	"orders": {
		"id": "orders",
		"obstacleId": "fixture:orders",
		# Supplier terminal, pallet and delivery dock against the rear wall where
		# the decorative operations bays stood. The dock backs onto the wall and
		# the PEDIDOS terminal faces the sales floor; the footprint covers both.
		"position": [0.9, 0, -7.3],
		"footprint": { "halfX": 0.95, "halfZ": 1.2 },
		"service": [0.9, -5.2],
	},
	"returns": {
		"id": "returns",
		"obstacleId": "fixture:returns",
		"position": [9.85, 0, 5.45],
		"footprint": { "halfX": 0.74, "halfZ": 0.66 },
		# The cubicle faces negative Z toward the checkout-side aisle. The small
		# X offset keeps the socket clear of the counter's padded corner.
		"service": [10.05, 4.3],
		"approach": [[10.25, 2.75], [10.25, 4.3]],
	},
	"cartBay": {
		"id": "cartBay",
		"obstacleId": "fixture:cart-bay",
		"position": [3.05, 0, 6.55],
		"footprint": { "halfX": 1.08, "halfZ": 0.76 },
		# The open aisle-facing side is on negative Z, clear of the entrance.
		"service": [3.05, 5.25],
		"approach": [[2.2, 5.25]],
	},
}

const STORE_SERVICE_FIXTURE_IDS = ["orders", "returns", "cartBay"]
const RETURNS_POINT = STORE_SERVICE_FIXTURES.returns.service
const CART_RETURN_POINT = STORE_SERVICE_FIXTURES.cartBay.service
const CART_BAY_POINT = [STORE_SERVICE_FIXTURES.cartBay.position[0], STORE_SERVICE_FIXTURES.cartBay.position[2]]

## Conservative route used only while the NavMesh is still building. It follows
## the same open aisle that the generated NavMesh selects between returns and
## the cart bay, so a customer never cuts through checkout or retail furniture.
const RETURNS_TO_CART_FALLBACK = [
	[10.25, 4.3],
	[10.8, 4.3],
	[10.8, 6.5],
	[5, 6.5],
	[4.5, 5.2],
	CART_RETURN_POINT,
]
