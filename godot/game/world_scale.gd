class_name WorldScale

const STORE_LAYOUT_SCALE: float = 2.0
const STORE_ELEMENT_SCALE: float = 1.6
const WORLD_SCALE: float = 3.0

const LAYOUT: float = STORE_LAYOUT_SCALE * WORLD_SCALE

const WORLD_UNITS_TO_LAYOUT: float = 1.0 / STORE_LAYOUT_SCALE
const LAYOUT_TO_WORLD_UNITS: float = STORE_LAYOUT_SCALE

const CHARACTER_SCENE_SCALE_BODY: float = 1.0

const MINUTE_MS: float = 60000.0

const STORE_OBSTACLES: Array = [
    {"id": "checkout-1", "x": 0.0, "z": 0.0, "halfX": 2.5, "halfZ": 1.0},
    {"id": "checkout-2", "x": 8.0, "z": 0.0, "halfX": 2.5, "halfZ": 1.0},
    {"id": "checkout-3", "x": 16.0, "z": 0.0, "halfX": 2.5, "halfZ": 1.0},
    {"id": "store-front-wall", "x": 19.0, "z": -8.5, "halfX": 0.5, "halfZ": 12.0},
    {"id": "store-back-wall", "x": 19.0, "z": 12.5, "halfX": 0.5, "halfZ": 12.0},
    {"id": "farm-center", "x": 25.0, "z": 0.0, "halfX": 5.0, "halfZ": 5.0},
]

func store_obstacles_for_areas(areas: Array) -> Array:
    var result = []
    for area in areas:
        var obstacle = JS.find(STORE_OBSTACLES, func(candidate): return candidate.id == area.obstacleId)
        if obstacle:
            result.append(obstacle)
    return result

func store_obstacle_by_id(obstacle_id: String) -> Dictionary:
    return JS.find(STORE_OBSTACLES, func(candidate): return candidate.id == obstacle_id)

func world_position_to_layout(world_position: Array) -> Array:
    return [world_position[0] / WORLD_SCALE, world_position[2] / WORLD_SCALE]

func layout_to_world_position(layout_position: Array) -> Array:
    return [layout_position[0] * WORLD_SCALE, 0.0, layout_position[1] * WORLD_SCALE]

func scaled_store_position(layout_position: Array) -> Array:
    return [layout_position[0] * LAYOUT, 0.0, layout_position[1] * LAYOUT]

func world_position_to_scaled_store(layout_position: Array) -> Array:
    return [layout_position[0] / LAYOUT, 0.0, layout_position[1] / LAYOUT]

func scale_store_position(node_position: Array) -> Array:
    return [node_position[0] / (STORE_LAYOUT_SCALE * STORE_ELEMENT_SCALE), 0.0, node_position[2] / (STORE_LAYOUT_SCALE * STORE_ELEMENT_SCALE)]

func character_scene_scale(body: String) -> float:
    return CHARACTER_SCENE_SCALE_BODY * WORLD_SCALE

func is_within_door_passable_zone(x: float, z: float, layout_x: float, layout_z: float) -> bool:
    var half_width = STOREFRONT_LAYOUT.door.outerPostX / 2.0
    var local_x = x / WORLD_SCALE - layout_x
    var local_z = z / WORLD_SCALE - layout_z
    return abs(local_x) <= half_width and abs(local_z) <= STOREFRONT_LAYOUT.door.innerDepth

func store_layout_scale() -> float:
    return STORE_LAYOUT_SCALE

func store_element_scale() -> float:
    return STORE_ELEMENT_SCALE

func world_scale() -> float:
    return WORLD_SCALE

func layout_to_world_scale_factor() -> float:
    return LAYOUT

func scaled_layout_to_world_units(value: float) -> float:
    return value * LAYOUT

func scaled_world_units_to_layout(value: float) -> float:
    return value / LAYOUT

func business_minutes_to_ms(business_minutes: float) -> float:
    return business_minutes * MINUTE_MS

func ms_to_business_minutes(ms: float) -> float:
    return ms / MINUTE_MS

func is_valid_layout_position(x: float, z: float) -> bool:
    return x >= -10.0 and x <= 30.0 and z >= -10.0 and z <= 30.0