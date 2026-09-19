class_name NavMeshService
extends RefCounted
## Port of src/game/navigation/NavMeshService.ts — pure geometry only.
##
## The web version builds a Recast solo NavMesh from a grid of walkable cells
## and queries it for paths. Here the walkability predicate, the navigation
## bounds, the wall bands and the walkable-cell geometry are ported 1:1; the
## Recast build/query is replaced by TODO hooks for Godot's NavigationServer3D
## (see `rebuild`, `find_path`, `pathfinder_backend`).

const NAVIGATION_CELL_SIZE = 0.36
const NAVMESH_FURNITURE_PADDING = 0.31 * WorldScale.STORE_LAYOUT_SCALE

static var STORE_NAVIGATION_BOUNDS: Dictionary = {
	"minX": -13,
	"maxX": 13,
	"minZ": FarmLayout.FARM_FIELD.center[2] - FarmLayout.FARM_FIELD.size[2] / 2 - 0.5,
	"maxZ": 15.7,
}

const STORE_WALL_BANDS = {
	"front": { "minZ": 7.55, "maxZ": 8.08, "maxAbsX": 11.55, "doorHalfWidth": 1.82 },
	"rear": {
		"minZ": StorefrontLayout.STORE_REAR_DOOR.wallCenterZ - StorefrontLayout.STORE_REAR_DOOR.wallDepth / 2 - 0.01,
		"maxZ": -8.2,
		"maxAbsX": StorefrontLayout.STORE_REAR_DOOR.wallHalfWidth + 0.05,
		"doorMinX": StorefrontLayout.STORE_REAR_DOOR.x - StorefrontLayout.STORE_REAR_DOOR.door.outerPostOffset + StorefrontLayout.STORE_REAR_DOOR.door.postWidth / 2,
		"doorMaxX": StorefrontLayout.STORE_REAR_DOOR.x + StorefrontLayout.STORE_REAR_DOOR.door.outerPostOffset - StorefrontLayout.STORE_REAR_DOOR.door.postWidth / 2,
	},
	"side": { "minAbsX": 11.13, "maxAbsX": 11.58, "minZ": -8.72, "maxZ": 8.08 },
}

## Recast agent parameters of the web build, kept for the NavigationServer3D
## port: cell size 0.18, cell height 0.1, agent radius 2 cells (0.36),
## height 18 cells, climb 2 cells; query half extents (1.5, 2, 1.5).
const RECAST_BUILD_PARAMETERS = { "cs": 0.18, "ch": 0.1, "walkableRadius": 2, "walkableHeight": 18, "walkableClimb": 2 }
const PATH_QUERY_HALF_EXTENTS = Vector3(1.5, 2, 1.5)

# ---------------------------------------------------------------------------
# Instance API (one NavMesh per structure revision), mirroring the TS class.
# ---------------------------------------------------------------------------

var _revision := -1
var _ready := false
## TODO(godot): replace with a NavigationServer3D map RID / NavigationMesh
## baked from `create_walkable_store_geometry(areas)` (scene layer owns the
## NavigationRegion3D). Until then paths come from `pathfinder_backend`.
var _map_rid: RID = RID()

## Rebuilds the navigation data for `structure_revision`. Returns true when the
## service can answer `find_path`. Synchronous here (the web build awaited
## Recast's WASM init).
func rebuild(areas: Array, structure_revision: int) -> bool:
	if _revision == structure_revision and _ready: return true
	# TODO(godot): bake a NavigationMesh from create_walkable_store_geometry(areas)
	# with RECAST_BUILD_PARAMETERS (agent_radius = cs * walkableRadius) and
	# register it on a NavigationServer3D map; set _map_rid.
	_ready = pathfinder_backend.is_valid()
	_revision = structure_revision if _ready else -1
	return _ready

## Straight path between two world points (Vector3, y ignored). Empty when no
## backend is ready.
func find_path(start: Vector3, end: Vector3) -> Array:
	if not _ready: return []
	# TODO(godot): NavigationServer3D.map_get_path(_map_rid, start, end, true)
	# once the region is baked; `pathfinder_backend` is the injectable stand-in.
	var path: Array = pathfinder_backend.call([start.x, start.z], [end.x, end.z])
	var out := []
	for point in path: out.append(Vector3(point[0], 0, point[1]))
	return out

func dispose() -> void:
	# TODO(godot): NavigationServer3D.free_rid(_map_rid) when a map is owned.
	_map_rid = RID()
	_ready = false
	_revision = -1

# ---------------------------------------------------------------------------
# Module-level store navigation (ensureStoreNavigation / storePathfinder).
# ---------------------------------------------------------------------------

## Injectable pathfinder: Callable(start: [x, z], end: [x, z]) -> Array of [x, z]
## in layout units. The scene layer installs one backed by NavigationServer3D;
## tests may install a deterministic stub. Invalid → navigation never "ready".
static var pathfinder_backend: Callable = Callable()

static var _store_navigation: NavMeshService = NavMeshService.new()
static var _store_navigation_ready := false
static var _store_navigation_revision := -1
static var _requested_signature := ""
static var _navigation_generation := 0

## Synchronous counterpart of the async TS function: true once a pathfinder
## backend is installed and built for this revision/areas signature.
static func ensure_store_navigation(structure_revision: int, areas: Array = []) -> bool:
	var sorted_areas := areas.duplicate()
	sorted_areas.sort()
	var signature := "%d:%s" % [structure_revision, "|".join(PackedStringArray(sorted_areas))]
	if signature != _requested_signature:
		_requested_signature = signature
		_navigation_generation += 1
		_store_navigation_ready = false
	if _store_navigation_ready and _store_navigation_revision == _navigation_generation: return true
	var success := _store_navigation.rebuild(areas, _navigation_generation)
	_store_navigation_ready = success
	if success: _store_navigation_revision = _navigation_generation
	return success

## Path in layout units ([x, z] points) or [] while navigation is not ready.
static func store_pathfinder(start: Array, end: Array) -> Array:
	if not _store_navigation_ready: return []
	var path := _store_navigation.find_path(Vector3(start[0], 0, start[1]), Vector3(end[0], 0, end[1]))
	var out := []
	for point in path: out.append([point.x, point.z])
	return out

## Pure walkability predicate shared by mesh generation and layout tests.
## The rear service entrance is cut from the same authored layout used by the
## visible wall and physics colliders, so navigation can never target a false
## decorative opening.
static func is_store_navigation_point(point: Array, areas: Array = []) -> bool:
	var x: float = point[0]
	var z: float = point[1]
	if x < STORE_NAVIGATION_BOUNDS.minX or x > STORE_NAVIGATION_BOUNDS.maxX or z < STORE_NAVIGATION_BOUNDS.minZ or z > STORE_NAVIGATION_BOUNDS.maxZ: return false
	if WorldScale.overlaps_store_obstacle(WorldScale.scale_store_point([x, z]), NAVMESH_FURNITURE_PADDING, areas): return false

	var abs_x := absf(x)
	var front: Dictionary = STORE_WALL_BANDS.front
	if z > front.minZ and z < front.maxZ and abs_x < front.maxAbsX and abs_x > front.doorHalfWidth: return false
	var rear: Dictionary = STORE_WALL_BANDS.rear
	var inside_rear_door: bool = x > rear.doorMinX and x < rear.doorMaxX
	if z > rear.minZ and z < rear.maxZ and abs_x < rear.maxAbsX and not inside_rear_door: return false
	var side: Dictionary = STORE_WALL_BANDS.side
	if abs_x > side.minAbsX and abs_x < side.maxAbsX and z > side.minZ and z < side.maxZ: return false
	return true

## Geometry used by the NavMesh bake and by the debug overlay, kept from one
## source: one flat quad per walkable cell. Returns
## { "positions": PackedVector3Array, "indices": PackedInt32Array } ready for
## ArrayMesh / NavigationMesh.add_polygon (triangles wound like the TS version).
static func create_walkable_store_geometry(areas: Array = []) -> Dictionary:
	var cell: float = NAVIGATION_CELL_SIZE
	var positions := PackedVector3Array()
	var indices := PackedInt32Array()
	var z: float = STORE_NAVIGATION_BOUNDS.minZ
	while z < STORE_NAVIGATION_BOUNDS.maxZ:
		var x: float = STORE_NAVIGATION_BOUNDS.minX
		while x < STORE_NAVIGATION_BOUNDS.maxX:
			var center := [x + cell / 2, z + cell / 2]
			if is_store_navigation_point(center, areas):
				var base := positions.size()
				positions.append(Vector3(x, 0, z))
				positions.append(Vector3(x + cell, 0, z))
				positions.append(Vector3(x + cell, 0, z + cell))
				positions.append(Vector3(x, 0, z + cell))
				indices.append_array(PackedInt32Array([base, base + 2, base + 1, base, base + 3, base + 2]))
			x += cell
		z += cell
	return { "positions": positions, "indices": indices }
