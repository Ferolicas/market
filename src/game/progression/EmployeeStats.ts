/** Training levels of a worker: 1 untrained, one more per each of the four
 * bought steps (ROSTER_UPGRADE_STEPS in RosterUpgrades, which imports this). */
export const EMPLOYEE_MAX_LEVEL = 5;

/** Basket sizes per training level, authored by the owner: 3, 4, 6, 8, 10. */
export const EMPLOYEE_BASKET_BY_LEVEL: readonly number[] = [3, 4, 6, 8, 10];

/** Each training step adds a quarter of the untrained pace; four steps double it. */
export const EMPLOYEE_SPEED_STEP = 0.25;
export const EMPLOYEE_BASE_WALK_SPEED = 1.5;

function trainingLevel(level: number) {
  return Math.max(1, Math.min(EMPLOYEE_MAX_LEVEL, Number.isFinite(level) ? Math.floor(level) : 1));
}

/** Multiplier a worker's training applies to pace, scanning and bagging:
 * ×1 untrained, +25 % per step, ×2 at the fourth step. */
export function employeeTrainingMultiplier(level: number) {
  return 1 + EMPLOYEE_SPEED_STEP * (trainingLevel(level) - 1);
}

/** Units an employee carries per trip at a training level. */
export function employeeCarryCapacity(level: number) {
  return EMPLOYEE_BASKET_BY_LEVEL[trainingLevel(level) - 1];
}

/** Walking speed of an employee at a training level, in simulation units/s. */
export function employeeWalkSpeed(level: number) {
  return EMPLOYEE_BASE_WALK_SPEED * employeeTrainingMultiplier(level);
}

/**
 * What a cashier's training changes at the till: `speed` divides the scan
 * interval and `capacity` divides the bagging interval, both +25 % per step.
 */
export function cashierTillModifiers(level: number) {
  const multiplier = employeeTrainingMultiplier(level);
  return { speed: multiplier, capacity: multiplier };
}
