class_name EmployeeStats
extends RefCounted
## Port of src/game/progression/EmployeeStats.ts.

## Training levels of a worker: 1 untrained, one more per each of the four
## bought steps (ROSTER_UPGRADE_STEPS in RosterUpgrades, which imports this).
const EMPLOYEE_MAX_LEVEL := 5

## Basket sizes per training level, authored by the owner: 3, 4, 6, 8, 10.
const EMPLOYEE_BASKET_BY_LEVEL := [3, 4, 6, 8, 10]

## Each training step adds a quarter of the untrained pace; four steps double it.
const EMPLOYEE_SPEED_STEP := 0.25
const EMPLOYEE_BASE_WALK_SPEED := 1.5

static func _training_level(level: Variant) -> int:
	return maxi(1, mini(EMPLOYEE_MAX_LEVEL, JS.floor(float(level)) if JS.is_finite_number(level) else 1))

## Multiplier a worker's training applies to pace, scanning and bagging:
## ×1 untrained, +25 % per step, ×2 at the fourth step.
static func employee_training_multiplier(level: Variant) -> float:
	return 1.0 + EMPLOYEE_SPEED_STEP * (_training_level(level) - 1)

## Units an employee carries per trip at a training level.
static func employee_carry_capacity(level: Variant) -> int:
	return EMPLOYEE_BASKET_BY_LEVEL[_training_level(level) - 1]

## Walking speed of an employee at a training level, in simulation units/s.
static func employee_walk_speed(level: Variant) -> float:
	return EMPLOYEE_BASE_WALK_SPEED * employee_training_multiplier(level)

## What a cashier's training changes at the till: `speed` divides the scan
## interval and `capacity` divides the bagging interval, both +25 % per step.
static func cashier_till_modifiers(level: Variant) -> Dictionary:
	var multiplier := employee_training_multiplier(level)
	return { "speed": multiplier, "capacity": multiplier }
