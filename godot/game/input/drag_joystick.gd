class_name DragJoystick
extends RefCounted
## Port of src/game/input/DragJoystick.ts — pure pointer-drag joystick logic.
## The scene layer passes pointer ids and screen coordinates in.
## DragSample: { "input": InputVector, "thumbX": float, "thumbY": float }.

var _active_pointer_id: Variant = null
var _origin_x := 0.0
var _origin_y := 0.0
var _radius := 72.0

var pointer_id: Variant:
	get: return _active_pointer_id
var origin: Vector2:
	get: return Vector2(_origin_x, _origin_y)
var visual_radius: float:
	get: return _radius

func begin(new_pointer_id: int, x: float, y: float, viewport_width: float, viewport_height: float) -> bool:
	if _active_pointer_id != null: return false
	_active_pointer_id = new_pointer_id
	_origin_x = x
	_origin_y = y
	_radius = minf(96.0, maxf(56.0, minf(viewport_width, viewport_height) * 0.1))
	return true

## DragSample or null when the pointer is not the active one.
func move(moving_pointer_id: int, x: float, y: float) -> Variant:
	if moving_pointer_id != _active_pointer_id: return null
	var delta_x := x - _origin_x
	var delta_y := y - _origin_y
	var length := JS.hypot(delta_x, delta_y)
	var thumb_scale := _radius / length if length > _radius else 1.0
	return {
		"input": InputManager.radial_input(delta_x, delta_y, _radius, maxf(6.0, _radius * 0.1)),
		"thumbX": delta_x * thumb_scale,
		"thumbY": delta_y * thumb_scale,
	}

## `ending_pointer_id` null ends whichever pointer is active.
func end(ending_pointer_id: Variant = null) -> bool:
	if ending_pointer_id != null and ending_pointer_id != _active_pointer_id: return false
	_active_pointer_id = null
	return true
