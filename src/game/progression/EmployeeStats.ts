import { stationTierModifiers } from "./levels";

/** Units an employee carries per trip at a training level (1 to 5). */
export function employeeCarryCapacity(level: number) {
  return Math.min(8, 2 + Math.max(1, Math.floor(level)));
}

/** Walking speed of an employee at a training level, in simulation units/s. */
export function employeeWalkSpeed(level: number) {
  return Math.min(2.15, 1.42 + Math.max(1, Math.floor(level)) * 0.08);
}

/**
 * What a cashier's training changes at the till: `speed` divides the scan
 * interval and `capacity` divides the bagging interval, the same table the
 * team card prints, so every bought step shortens each customer's checkout.
 */
export function cashierTillModifiers(level: number) {
  return stationTierModifiers(level);
}
