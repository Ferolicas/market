class_name MarketDisplayMetrics
extends RefCounted
## iOS window_get_size() is backing pixels; Three/R3F size uses CSS points.
## Keep UIKit density separate from adaptive 3D resolution and safe areas.
static func logical_size(physical_size: Vector2i, density: float) -> Vector2i:
	var scale := maxf(1.0, density)
	return Vector2i(maxi(1, roundi(physical_size.x / scale)), maxi(1, roundi(physical_size.y / scale)))

static func current_size() -> Vector2i:
	var physical_size := DisplayServer.window_get_size()
	return logical_size(physical_size, DisplayServer.screen_get_scale()) if OS.has_feature("ios") else physical_size
