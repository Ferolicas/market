import type { InputVector } from "../input/InputManager";

export interface Vector2 { x: number; y: number; }

export interface PlayerMotionConfig {
  walkSpeed: number;
  acceleration: number;
  braking: number;
  turnTime: number;
  maxTurnRate: number;
}

export const DEFAULT_PLAYER_MOTION: PlayerMotionConfig = {
  walkSpeed: 2.2,
  acceleration: 12,
  braking: 16,
  turnTime: 0.13,
  maxTurnRate: Math.PI * 3,
};

/** Keep the calibrated starting pace; each of four upgrades adds 25% of it. */
export const PLAYER_MAX_SPEED_MULTIPLIER = 2.7;
export const PLAYER_TIER_ONE_SPEED_MULTIPLIER = PLAYER_MAX_SPEED_MULTIPLIER * 0.6;
// Campaign T1 was 70% of 5.94. Requested: 2.5 times that speed,
// now representing 75% of the new maximum, with the requested 20% reduction.
// Both modes use the same four-step training curve.
export const CAMPAIGN_MAX_SPEED_MULTIPLIER = PLAYER_MAX_SPEED_MULTIPLIER * 0.7 * 2.5 * 0.8 / 0.75;

export function playerSpeedProgressForTier(tier: number, campaign = false) {
  const safeTier = Math.max(1, Math.min(5, Math.floor(Number.isFinite(tier) ? tier : 1)));
  return (campaign ? 0.75 : 0.6) * (1 + (safeTier - 1) * 0.25);
}

export function playerMotionForTier(tier: number, campaign = false): PlayerMotionConfig {
  const tierMultiplier = playerSpeedProgressForTier(tier, campaign);
  const maximumMultiplier = campaign ? CAMPAIGN_MAX_SPEED_MULTIPLIER : PLAYER_MAX_SPEED_MULTIPLIER;
  return {
    ...DEFAULT_PLAYER_MOTION,
    walkSpeed: DEFAULT_PLAYER_MOTION.walkSpeed * maximumMultiplier * tierMultiplier,
    acceleration: DEFAULT_PLAYER_MOTION.acceleration * maximumMultiplier,
    braking: DEFAULT_PLAYER_MOTION.braking * maximumMultiplier,
  };
}

export function cameraRelativeMovement(input: InputVector, cameraForward: Vector2): Vector2 {
  const forwardLength = Math.hypot(cameraForward.x, cameraForward.y) || 1;
  const forward = { x: cameraForward.x / forwardLength, y: cameraForward.y / forwardLength };
  // In the XZ plane, camera-right is the counter-clockwise perpendicular to
  // camera-forward. The previous clockwise perpendicular mirrored every
  // horizontal input source (keyboard, pointer and gamepad).
  const right = { x: -forward.y, y: forward.x };
  const x = (right.x * input.x + forward.x * -input.y) * input.magnitude;
  const y = (right.y * input.x + forward.y * -input.y) * input.magnitude;
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

export function moveVelocity(current: Vector2, intention: Vector2, delta: number, config = DEFAULT_PLAYER_MOTION): Vector2 {
  const intendedMagnitude = Math.min(1, Math.hypot(intention.x, intention.y));
  const target = { x: intention.x * config.walkSpeed, y: intention.y * config.walkSpeed };
  const response = intendedMagnitude > 0.001 ? config.acceleration : config.braking;
  const maxChange = response * Math.max(0, delta);
  const difference = { x: target.x - current.x, y: target.y - current.y };
  const distance = Math.hypot(difference.x, difference.y);
  if (distance <= maxChange || distance === 0) return target;
  return { x: current.x + difference.x / distance * maxChange, y: current.y + difference.y / distance * maxChange };
}

export function smoothYaw(current: number, target: number, angularVelocity: number, delta: number, config = DEFAULT_PLAYER_MOTION) {
  const fullTurn = Math.PI * 2;
  const difference = ((target - current + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
  const omega = 2 / Math.max(0.001, config.turnTime);
  const x = omega * Math.max(0, delta);
  const exponential = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = Math.max(-config.maxTurnRate * config.turnTime, Math.min(config.maxTurnRate * config.turnTime, difference));
  const temporary = (angularVelocity + omega * change) * delta;
  const nextVelocity = (angularVelocity - omega * temporary) * exponential;
  const next = target - (change + temporary) * exponential;
  return { yaw: next, angularVelocity: nextVelocity };
}
