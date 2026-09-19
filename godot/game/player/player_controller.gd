class_name PlayerController
extends RefCounted
## Port of src/game/player/PlayerController.ts (pure motion rules).
## TS `Vector2 {x, y}` → Godot Vector2 (y is the XZ-plane z). InputVector and
## PlayerMotionConfig stay Dictionaries: { x, y, magnitude } and
## { walkSpeed, acceleration, braking, turnTime, maxTurnRate }.

const DEFAULT_PLAYER_MOTION = {
	"walkSpeed": 2.2,
	"acceleration": 12,
	"braking": 16,
	"turnTime": 0.13,
	"maxTurnRate": PI * 3,
}

## Keep the calibrated starting pace; each of four upgrades adds 25% of it.
const PLAYER_MAX_SPEED_MULTIPLIER = 2.7
const PLAYER_TIER_ONE_SPEED_MULTIPLIER = PLAYER_MAX_SPEED_MULTIPLIER * 0.6
## Campaign T1 was 70% of 5.94. Requested: 2.5 times that speed,
## now representing 75% of the new maximum, with the requested 20% reduction.
## Both modes use the same four-step training curve.
const CAMPAIGN_MAX_SPEED_MULTIPLIER = PLAYER_MAX_SPEED_MULTIPLIER * 0.7 * 2.5 * 0.8 / 0.75

static func player_speed_progress_for_tier(tier: Variant, campaign: bool = false) -> float:
	var safe_tier := maxi(1, mini(5, JS.floor(float(tier) if JS.is_finite_number(tier) else 1.0)))
	return (0.75 if campaign else 0.6) * (1 + (safe_tier - 1) * 0.25)

static func player_motion_for_tier(tier: Variant, campaign: bool = false) -> Dictionary:
	var tier_multiplier := player_speed_progress_for_tier(tier, campaign)
	var maximum_multiplier: float = CAMPAIGN_MAX_SPEED_MULTIPLIER if campaign else PLAYER_MAX_SPEED_MULTIPLIER
	return JS.spread(DEFAULT_PLAYER_MOTION, {
		"walkSpeed": DEFAULT_PLAYER_MOTION.walkSpeed * maximum_multiplier * tier_multiplier,
		"acceleration": DEFAULT_PLAYER_MOTION.acceleration * maximum_multiplier,
		"braking": DEFAULT_PLAYER_MOTION.braking * maximum_multiplier,
	})

static func camera_relative_movement(input: Dictionary, camera_forward: Vector2) -> Vector2:
	var forward_length := JS.hypot(camera_forward.x, camera_forward.y)
	if forward_length == 0.0: forward_length = 1.0
	var forward := Vector2(camera_forward.x / forward_length, camera_forward.y / forward_length)
	# In the XZ plane, camera-right is the counter-clockwise perpendicular to
	# camera-forward. The previous clockwise perpendicular mirrored every
	# horizontal input source (keyboard, pointer and gamepad).
	var right := Vector2(-forward.y, forward.x)
	var x: float = (right.x * input.x + forward.x * -input.y) * input.magnitude
	var y: float = (right.y * input.x + forward.y * -input.y) * input.magnitude
	var length := JS.hypot(x, y)
	return Vector2(x / length, y / length) if length > 1 else Vector2(x, y)

static func move_velocity(current: Vector2, intention: Vector2, delta: float, config: Dictionary = DEFAULT_PLAYER_MOTION) -> Vector2:
	var intended_magnitude := minf(1.0, JS.hypot(intention.x, intention.y))
	var target := Vector2(intention.x * config.walkSpeed, intention.y * config.walkSpeed)
	var response: float = config.acceleration if intended_magnitude > 0.001 else config.braking
	var max_change := response * maxf(0.0, delta)
	var difference := Vector2(target.x - current.x, target.y - current.y)
	var distance := JS.hypot(difference.x, difference.y)
	if distance <= max_change or distance == 0: return target
	return Vector2(current.x + difference.x / distance * max_change, current.y + difference.y / distance * max_change)

## Returns { yaw, angularVelocity }.
static func smooth_yaw(current: float, target: float, angular_velocity: float, delta: float, config: Dictionary = DEFAULT_PLAYER_MOTION) -> Dictionary:
	var full_turn := PI * 2
	var difference := fmod(fmod(target - current + PI, full_turn) + full_turn, full_turn) - PI
	var omega := 2 / maxf(0.001, config.turnTime)
	var x := omega * maxf(0.0, delta)
	var exponential := 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
	var change := maxf(-config.maxTurnRate * config.turnTime, minf(config.maxTurnRate * config.turnTime, difference))
	var temporary := (angular_velocity + omega * change) * delta
	var next_velocity := (angular_velocity - omega * temporary) * exponential
	var next := target - (change + temporary) * exponential
	return { "yaw": next, "angularVelocity": next_velocity }
