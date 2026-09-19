class_name InputManager
extends RefCounted
## Port of src/game/input/InputManager.ts — pure input arbitration. No Godot
## Input calls: the scene layer feeds pointer/keyboard/gamepad vectors in.
## InputVector: { "x": float, "y": float, "magnitude": float }.

const ZERO_INPUT = { "x": 0, "y": 0, "magnitude": 0 }

static func radial_input(delta_x: float, delta_y: float, radius: float, deadzone: float) -> Dictionary:
	var safe_radius := maxf(1.0, radius)
	var safe_deadzone := minf(safe_radius - JS.EPSILON, maxf(0.0, deadzone))
	var length := JS.hypot(delta_x, delta_y)
	if length <= safe_deadzone: return ZERO_INPUT
	var magnitude := minf(1.0, (length - safe_deadzone) / (safe_radius - safe_deadzone))
	return { "x": delta_x / length, "y": delta_y / length, "magnitude": magnitude }

static func normalized_input(x: float, y: float, deadzone: float = 0) -> Dictionary:
	var length := JS.hypot(x, y)
	if length <= deadzone: return ZERO_INPUT
	var magnitude := minf(1.0, (length - deadzone) / maxf(JS.EPSILON, 1 - deadzone))
	return { "x": x / length, "y": y / length, "magnitude": magnitude }

static func strongest_input(inputs: Array) -> Dictionary:
	var strongest: Dictionary = ZERO_INPUT
	for candidate in inputs:
		if candidate.magnitude > strongest.magnitude: strongest = candidate
	return strongest

var _pointer: Dictionary = ZERO_INPUT
var _keyboard: Dictionary = ZERO_INPUT
var _gamepad: Dictionary = ZERO_INPUT

func set_pointer(input: Dictionary) -> void: _pointer = input
func set_keyboard(x: float, y: float) -> void: _keyboard = normalized_input(x, y)
func set_gamepad(x: float, y: float) -> void: _gamepad = normalized_input(x, y, 0.15)
func clear_pointer() -> void: _pointer = ZERO_INPUT
func clear_keyboard() -> void: _keyboard = ZERO_INPUT
func clear_gamepad() -> void: _gamepad = ZERO_INPUT
func clear_all() -> void:
	_pointer = ZERO_INPUT
	_keyboard = ZERO_INPUT
	_gamepad = ZERO_INPUT
func sample() -> Dictionary: return strongest_input([_pointer, _keyboard, _gamepad])

## Shared instance, like the TS module-level `inputManager` (no autoload needed).
static var input_manager: InputManager = InputManager.new()
