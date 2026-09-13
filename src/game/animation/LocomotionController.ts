import { LoopRepeat, MathUtils, type AnimationAction } from "three";

export type LocomotionClip = "Idle" | "Walk" | "Run" | "TurnLeft" | "TurnRight" | "CarryIdle" | "CarryWalk" | "CarryRun";
export type FootstepEvent = "LeftFootDown" | "RightFootDown";

/** Calibrated from the support minima in the authored market walk cycle. */
export const GAIT_FOOT_CONTACT_PHASES = Object.freeze({ left: 0.125, right: 0.625 });

/**
 * Forward speed of each in-place locomotion clip at time scale 1, in model
 * units per second (bodies are 0.98 units tall). Measured offline on the
 * delivered cast as the median backward speed of the planted foot across the
 * cycle: Walk 0.31–0.39, Run 0.87–1.22, CarryWalk 0.20–0.28, CarryRun
 * 0.41–0.55, BasketWalk 0.44–0.57 depending on leg length. Multiply by the
 * actor's render scale to get the speed its feet cover on the floor; the
 * ratio body speed / that value is the time scale that keeps feet planted.
 */
export const CLIP_NATURAL_SPEED: Readonly<Record<string, number>> = Object.freeze({
  Walk: 0.35,
  Enter: 0.35,
  Exit: 0.35,
  TurnLeft: 0.35,
  TurnRight: 0.35,
  Run: 1.07,
  CarryWalk: 0.24,
  CarryRun: 0.46,
  BasketWalk: 0.52,
});

export const GAIT_TIME_SCALE_RANGE = Object.freeze({ min: 0.6, max: 2.8 });
/** Body speed over the natural walk speed above which a walk cycle would have
 * to spin so fast that the actor should run instead (and below which it may
 * walk again). */
export const RUN_GAIT_RATIO = Object.freeze({ start: 2.4, stop: 2.12 });

/** Time scale that keeps the feet planted for a body moving at `speed`
 * (same units as `naturalSpeed × rootScale`). Undefined for non-gait clips. */
export function gaitTimeScale(clip: string, speed: number, rootScale: number) {
  const natural = CLIP_NATURAL_SPEED[clip];
  if (natural === undefined) return undefined;
  const floorSpeed = natural * Math.max(1e-5, rootScale);
  return MathUtils.clamp(speed / floorSpeed, GAIT_TIME_SCALE_RANGE.min, GAIT_TIME_SCALE_RANGE.max);
}
const FULL_GROUNDING_SUPPORT: ReadonlySet<string> = new Set(["Walk", "CarryWalk", "Run", "CarryRun", "TurnLeft", "TurnRight"]);

/** Work clips share the avatar controller, so unknown/non-gait names deliberately get partial support. */
export function locomotionGroundingSupport(clip: string) {
  return FULL_GROUNDING_SUPPORT.has(clip) ? 1 : 0.25;
}

export class LocomotionController {
  private active = "Idle";
  private moving = false;
  private running = false;
  private previousPhase = 0;

  /** `walkFloorSpeed` is the floor speed of the walk cycle at time scale 1 for
   * this actor (natural clip speed × render scale, same units as `speed`);
   * running starts once walking would need more than RUN_GAIT_RATIO. Without
   * it the legacy fixed thresholds apply. */
  select(speed: number, yawDelta: number, carrying: boolean, walkFloorSpeed = 3.15 / RUN_GAIT_RATIO.start): LocomotionClip {
    this.moving = this.moving ? speed >= 0.07 : speed > 0.12;
    const moving = this.moving;
    if (!moving && Math.abs(yawDelta) > 55 * Math.PI / 180) return yawDelta < 0 ? "TurnLeft" : "TurnRight";
    if (!moving) return carrying ? "CarryIdle" : "Idle";
    const floor = Math.max(1e-5, walkFloorSpeed);
    this.running = this.running ? speed >= RUN_GAIT_RATIO.stop * floor : speed > RUN_GAIT_RATIO.start * floor;
    if (this.running) return carrying ? "CarryRun" : "Run";
    return carrying ? "CarryWalk" : "Walk";
  }

  transition(actions: Record<string, AnimationAction | null | undefined>, requested: string, speedScale = 1, fadeSeconds = 0.2) {
    const next = actions[requested] ? requested : actions.Idle ? "Idle" : requested;
    const nextAction = actions[next];
    if (!nextAction) return;
    const targetScale = speedScale === 0 ? 0 : MathUtils.clamp(speedScale, 0.55, 2.8);
    if (next === this.active && nextAction.isScheduled()) {
      nextAction.setEffectiveTimeScale(MathUtils.lerp(nextAction.getEffectiveTimeScale(), targetScale, 0.18));
      return;
    }

    const previousAction = actions[this.active];
    const previousDuration = previousAction?.getClip().duration ?? 0;
    const synchronizedGait = previousAction && isCyclicGait(this.active) && isCyclicGait(next);
    const normalizedPhase = synchronizedGait && previousDuration > 0
      ? (previousAction.time / previousDuration) % 1
      : 0;

    nextAction.reset();
    if (synchronizedGait) nextAction.time = normalizedPhase * nextAction.getClip().duration;
    nextAction
      .setLoop(LoopRepeat, Number.POSITIVE_INFINITY)
      .setEffectiveWeight(1)
      .setEffectiveTimeScale(targetScale)
      .fadeIn(fadeSeconds)
      .play();
    previousAction?.fadeOut(fadeSeconds);
    this.active = next;
    this.previousPhase = synchronizedGait ? normalizedPhase : 0;
  }

  footEvents(action: AnimationAction | null | undefined): FootstepEvent[] {
    const duration = action?.getClip().duration ?? 1;
    if (!action?.isRunning() || duration <= 0) return [];
    const phase = (action.time / duration) % 1;
    const events: FootstepEvent[] = [];
    if (crossed(this.previousPhase, phase, GAIT_FOOT_CONTACT_PHASES.left)) events.push("LeftFootDown");
    if (crossed(this.previousPhase, phase, GAIT_FOOT_CONTACT_PHASES.right)) events.push("RightFootDown");
    this.previousPhase = phase;
    return events;
  }

  current() { return this.active; }
}

const CYCLIC_GAITS = new Set(["Walk", "Run", "CarryWalk", "CarryRun"]);

function isCyclicGait(name: string) {
  return CYCLIC_GAITS.has(name);
}

function crossed(previous: number, current: number, marker: number) {
  return current >= previous ? previous < marker && current >= marker : previous < marker || current >= marker;
}
