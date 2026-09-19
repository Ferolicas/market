class_name LocomotionController
extends RefCounted
## Port of src/game/animation/LocomotionController.ts.
##
## Three's AnimationAction is modelled by the inner `LocomotionAction` class:
## time, clip duration, effective weight/time scale, enabled, scheduled
## (active in the mixer) and fade requests. Scene code binds one action per
## animation of an AnimationPlayer/AnimationTree and applies `time`,
## `time_scale`, `weight` and the fade requests each frame; this controller
## only decides clips, phases, time scales and cross-fades.

## Calibrated from the support minima in the authored market walk cycle.
const GAIT_FOOT_CONTACT_PHASES := { "left": 0.125, "right": 0.625 }

## Forward speed of each in-place locomotion clip at time scale 1, in model
## units per second (bodies are 0.98 units tall). Measured offline on the
## delivered cast as the median backward speed of the planted foot across the
## cycle: Walk 0.31–0.39, Run 0.87–1.22, CarryWalk 0.20–0.28, CarryRun
## 0.41–0.55, BasketWalk 0.44–0.57 depending on leg length. Multiply by the
## actor's render scale to get the speed its feet cover on the floor; the
## ratio body speed / that value is the time scale that keeps feet planted.
const CLIP_NATURAL_SPEED := {
	"Walk": 0.35,
	"Enter": 0.35,
	"Exit": 0.35,
	"TurnLeft": 0.35,
	"TurnRight": 0.35,
	"Run": 1.07,
	"CarryWalk": 0.24,
	"CarryRun": 0.46,
	"BasketWalk": 0.52,
}

const GAIT_TIME_SCALE_RANGE := { "min": 0.6, "max": 2.8 }
## Body speed over the natural walk speed above which a walk cycle would have
## to spin so fast that the actor should run instead (and below which it may
## walk again).
const RUN_GAIT_RATIO := { "start": 2.4, "stop": 2.12 }

const FULL_GROUNDING_SUPPORT := ["Walk", "CarryWalk", "Run", "CarryRun", "TurnLeft", "TurnRight"]
const CYCLIC_GAITS := ["Walk", "Run", "CarryWalk", "CarryRun"]

## Time scale that keeps the feet planted for a body moving at `speed`
## (same units as `naturalSpeed × rootScale`). null for non-gait clips.
static func gait_time_scale(clip: String, speed: float, root_scale: float) -> Variant:
	if not CLIP_NATURAL_SPEED.has(clip): return null
	var natural: float = CLIP_NATURAL_SPEED[clip]
	var floor_speed := natural * maxf(1e-5, root_scale)
	return clampf(speed / floor_speed, GAIT_TIME_SCALE_RANGE.min, GAIT_TIME_SCALE_RANGE.max)

## Work clips share the avatar controller, so unknown/non-gait names deliberately get partial support.
static func locomotion_grounding_support(clip: String) -> float:
	return 1.0 if FULL_GROUNDING_SUPPORT.has(clip) else 0.25

## Minimal stand-in for THREE.AnimationAction (see class doc).
class LocomotionAction extends RefCounted:
	var name: String
	var duration: float
	var time := 0.0
	var enabled := true
	var paused := false
	var weight := 1.0
	var time_scale := 1.0
	## Fade requests for the scene layer: seconds of the pending fade-in/out
	## (0 when none was requested since the last frame consumed it).
	var fade_in_seconds := 0.0
	var fade_out_seconds := 0.0
	var reset_count := 0
	var _scheduled := false

	func _init(clip_name: String, clip_duration: float) -> void:
		name = clip_name
		duration = clip_duration

	func get_clip_duration() -> float: return duration
	## Three: the action is active in the mixer (play() until stop()).
	func is_scheduled() -> bool: return _scheduled
	## Three: enabled, not paused, non-zero time scale and scheduled.
	func is_running() -> bool: return enabled and not paused and time_scale != 0.0 and _scheduled
	func reset() -> LocomotionAction:
		reset_count += 1
		paused = false
		enabled = true
		time = 0.0
		fade_in_seconds = 0.0
		fade_out_seconds = 0.0
		return self
	func set_effective_weight(value: float) -> LocomotionAction:
		weight = value
		return self
	func set_effective_time_scale(value: float) -> LocomotionAction:
		time_scale = value
		return self
	func get_effective_time_scale() -> float: return time_scale
	func fade_in(seconds: float) -> LocomotionAction:
		fade_in_seconds = seconds
		fade_out_seconds = 0.0
		return self
	func fade_out(seconds: float) -> LocomotionAction:
		fade_out_seconds = seconds
		fade_in_seconds = 0.0
		return self
	func play() -> LocomotionAction:
		_scheduled = true
		return self
	func stop() -> LocomotionAction:
		_scheduled = false
		return self

var _active := "Idle"
var _moving := false
var _running := false
var _previous_phase := 0.0

## `walk_floor_speed` is the floor speed of the walk cycle at time scale 1 for
## this actor (natural clip speed × render scale, same units as `speed`);
## running starts once walking would need more than RUN_GAIT_RATIO. Without
## it the legacy fixed thresholds apply.
func select(speed: float, yaw_delta: float, carrying: bool, walk_floor_speed: float = 3.15 / 2.4) -> String:
	_moving = (speed >= 0.07) if _moving else (speed > 0.12)
	var moving := _moving
	if not moving and absf(yaw_delta) > 55.0 * PI / 180.0: return "TurnLeft" if yaw_delta < 0.0 else "TurnRight"
	if not moving: return "CarryIdle" if carrying else "Idle"
	var floor_speed := maxf(1e-5, walk_floor_speed)
	_running = (speed >= RUN_GAIT_RATIO.stop * floor_speed) if _running else (speed > RUN_GAIT_RATIO.start * floor_speed)
	if _running: return "CarryRun" if carrying else "Run"
	return "CarryWalk" if carrying else "Walk"

## actions: Dictionary name → LocomotionAction (null entries allowed).
func transition(actions: Dictionary, requested: String, speed_scale: float = 1.0, fade_seconds: float = 0.2) -> void:
	var next: String = requested if actions.get(requested) != null else ("Idle" if actions.get("Idle") != null else requested)
	var next_action: LocomotionAction = actions.get(next)
	if next_action == null: return
	var target_scale := 0.0 if speed_scale == 0.0 else clampf(speed_scale, 0.55, 2.8)
	if next == _active and next_action.is_scheduled():
		# A rapid Idle → interaction → Idle cross-fade can leave Three's action
		# active in the mixer but disabled at weight zero. isScheduled() remains
		# true in that state, so merely changing its time scale preserves a
		# frozen bind pose. Recover it without restarting healthy actions.
		if target_scale > 0.0 and not next_action.is_running():
			next_action.reset().set_effective_weight(1.0).set_effective_time_scale(target_scale).fade_in(fade_seconds).play()
			return
		next_action.set_effective_time_scale(lerpf(next_action.get_effective_time_scale(), target_scale, 0.18))
		return

	var previous_action: LocomotionAction = actions.get(_active)
	var previous_duration := previous_action.get_clip_duration() if previous_action != null else 0.0
	var synchronized_gait := previous_action != null and _is_cyclic_gait(_active) and _is_cyclic_gait(next)
	var normalized_phase := fmod(previous_action.time / previous_duration, 1.0) if (synchronized_gait and previous_duration > 0.0) else 0.0

	next_action.reset()
	if synchronized_gait: next_action.time = normalized_phase * next_action.get_clip_duration()
	next_action.set_effective_weight(1.0).set_effective_time_scale(target_scale).fade_in(fade_seconds).play()
	if previous_action != null: previous_action.fade_out(fade_seconds)
	_active = next
	_previous_phase = normalized_phase if synchronized_gait else 0.0

## Returns "LeftFootDown" / "RightFootDown" events crossed since the last call.
func foot_events(action: LocomotionAction) -> Array:
	var duration := action.get_clip_duration() if action != null else 1.0
	if action == null or not action.is_running() or duration <= 0.0: return []
	var phase := fmod(action.time / duration, 1.0)
	var events := []
	if _crossed(_previous_phase, phase, GAIT_FOOT_CONTACT_PHASES.left): events.append("LeftFootDown")
	if _crossed(_previous_phase, phase, GAIT_FOOT_CONTACT_PHASES.right): events.append("RightFootDown")
	_previous_phase = phase
	return events

func current() -> String: return _active

static func _is_cyclic_gait(clip_name: String) -> bool:
	return CYCLIC_GAITS.has(clip_name)

static func _crossed(previous: float, current_phase: float, marker: float) -> bool:
	if current_phase >= previous: return previous < marker and current_phase >= marker
	return previous < marker or current_phase >= marker
