class_name MarketJoystickOverlay
extends Control
## Pointer feedback for the original floating DragJoystick; input stays in the world.
var world: MarketWorld

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

func _process(_delta: float) -> void:
	visible = is_instance_valid(world) and world.driveable and world.joystick.pointer_id != null
	if visible: queue_redraw()

func _draw() -> void:
	if not is_instance_valid(world) or world.joystick.pointer_id == null: return
	var center := world.joystick.origin
	var radius := world.joystick.visual_radius
	var alpha := 0.88 if DisplayServer.is_touchscreen_available() else 0.58
	draw_circle(center + Vector2(0, 5), radius, Color(0.22, 0.24, 0.17, 0.25 * alpha))
	draw_circle(center, radius, Color(0.933, 0.91, 0.851, 0.66 * alpha))
	draw_arc(center, radius - 1, 0, TAU, 64, Color(1, 0.976, 0.898, alpha), 2, true)
	draw_arc(center, radius * 0.8, 0, TAU, 64, Color(1, 1, 1, 0.27 * alpha), 1, true)
	var thumb := center + world.joystick_thumb
	draw_circle(thumb + Vector2(0, 4), 22, Color(0.23, 0.27, 0.16, 0.3 * alpha))
	draw_circle(thumb, 22, Color(0.416, 0.471, 0.286, alpha))
	draw_arc(thumb, 21, 0, TAU, 48, Color(0.827, 0.851, 0.722, alpha), 2, true)
