class_name NavMeshService
extends RefCounted
## src/game/navigation/NavMeshService.ts. Real Recast bake and queries through
## NavigationServer3D, using the original walkable grid and agent dimensions.

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
var _map_rid: RID = RID()
var _region_rid: RID = RID()
var _mesh: NavigationMesh

func rebuild(areas: Array, structure_revision: int) -> bool:
	if _revision == structure_revision and _ready: return true
	var geometry := create_walkable_store_geometry(areas)
	var faces := PackedVector3Array()
	# Three uses counterclockwise front faces; Godot source faces are clockwise.
	for triangle in range(0, geometry.indices.size(), 3):
		for corner in [0, 2, 1]: faces.append(geometry.positions[geometry.indices[triangle + corner]])
	var source := NavigationMeshSourceGeometryData3D.new()
	source.add_faces(faces, Transform3D.IDENTITY)
	var mesh := NavigationMesh.new()
	mesh.cell_size = RECAST_BUILD_PARAMETERS.cs
	mesh.cell_height = RECAST_BUILD_PARAMETERS.ch
	mesh.agent_radius = RECAST_BUILD_PARAMETERS.cs * RECAST_BUILD_PARAMETERS.walkableRadius
	mesh.agent_height = RECAST_BUILD_PARAMETERS.ch * RECAST_BUILD_PARAMETERS.walkableHeight
	mesh.agent_max_climb = RECAST_BUILD_PARAMETERS.ch * RECAST_BUILD_PARAMETERS.walkableClimb
	mesh.agent_max_slope = 60
	mesh.region_min_size = 8
	mesh.region_merge_size = 20
	mesh.edge_max_length = 12 * mesh.cell_size
	mesh.edge_max_error = 1.3
	mesh.vertices_per_polygon = 6
	mesh.detail_sample_distance = 6
	mesh.detail_sample_max_error = 1
	mesh.filter_low_hanging_obstacles = true
	mesh.filter_ledge_spans = true
	mesh.filter_walkable_low_height_spans = true
	NavigationServer3D.bake_from_source_geometry_data(mesh, source)
	if mesh.get_polygon_count() == 0: return false
	dispose()
	_mesh = mesh
	_map_rid = NavigationServer3D.map_create()
	NavigationServer3D.map_set_cell_size(_map_rid, mesh.cell_size)
	NavigationServer3D.map_set_cell_height(_map_rid, mesh.cell_height)
	NavigationServer3D.map_set_use_async_iterations(_map_rid, false)
	NavigationServer3D.map_set_active(_map_rid, true)
	_region_rid = NavigationServer3D.region_create()
	NavigationServer3D.region_set_use_async_iterations(_region_rid, false)
	NavigationServer3D.region_set_navigation_mesh(_region_rid, mesh)
	NavigationServer3D.region_set_map(_region_rid, _map_rid)
	NavigationServer3D.map_force_update(_map_rid)
	_revision = structure_revision
	_ready = true
	return true

func find_path(start: Vector3, end: Vector3) -> Array:
	if not _ready: return []
	var projected_start := NavigationServer3D.map_get_closest_point(_map_rid, start)
	var projected_end := NavigationServer3D.map_get_closest_point(_map_rid, end)
	# Recast's nearest-polygon query is bounded by these half-extents.
	for pair in [[start, projected_start], [end, projected_end]]:
		var distance: Vector3 = (pair[0] - pair[1]).abs()
		if distance.x > PATH_QUERY_HALF_EXTENTS.x or distance.y > PATH_QUERY_HALF_EXTENTS.y or distance.z > PATH_QUERY_HALF_EXTENTS.z: return []
	return Array(NavigationServer3D.map_get_path(_map_rid, projected_start, projected_end, true))

func dispose() -> void:
	if _region_rid.is_valid(): NavigationServer3D.free_rid(_region_rid)
	if _map_rid.is_valid(): NavigationServer3D.free_rid(_map_rid)
	_region_rid = RID()
	_map_rid = RID()
	_mesh = null
	_ready = false
	_revision = -1

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		if _region_rid.is_valid(): NavigationServer3D.free_rid(_region_rid)
		if _map_rid.is_valid(): NavigationServer3D.free_rid(_map_rid)

static var _store_navigation: NavMeshService = NavMeshService.new()
static var _store_navigation_ready := false
static var _store_navigation_revision := -1
static var _requested_signature := ""
static var _navigation_generation := 0

## Synchronous counterpart of the async TS function: true once a pathfinder
## navigation is baked for this revision/areas signature.
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
static func dispose_store_navigation() -> void:
	_store_navigation.dispose()
	_store_navigation_ready = false
	_store_navigation_revision = -1

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
