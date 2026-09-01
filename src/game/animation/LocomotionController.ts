import { LoopRepeat, MathUtils, type AnimationAction } from "three";

export type LocomotionClip = "Idle" | "Walk" | "Run" | "TurnLeft" | "TurnRight" | "CarryIdle" | "CarryWalk" | "CarryRun";
export type FootstepEvent = "LeftFootDown" | "RightFootDown";

/** Calibrated from the support minima in the authored market walk cycle. */
export const GAIT_FOOT_CONTACT_PHASES = Object.freeze({ left: 0.125, right: 0.625 });
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

  select(speed: number, yawDelta: number, carrying: boolean): LocomotionClip {
    this.moving = this.moving ? speed >= 0.07 : speed > 0.12;
    const moving = this.moving;
    if (!moving && Math.abs(yawDelta) > 55 * Math.PI / 180) return yawDelta < 0 ? "TurnLeft" : "TurnRight";
    if (!moving) return carrying ? "CarryIdle" : "Idle";
    this.running = this.running ? speed >= 2.78 : speed > 3.15;
    if (this.running) return carrying ? "CarryRun" : "Run";
    return carrying ? "CarryWalk" : "Walk";
  }

  transition(actions: Record<string, AnimationAction | null | undefined>, requested: string, speedScale = 1, fadeSeconds = 0.2) {
    const next = actions[requested] ? requested : actions.Idle ? "Idle" : requested;
    const nextAction = actions[next];
    if (!nextAction) return;
    const targetScale = MathUtils.clamp(speedScale, 0.55, 2.8);
    if (next === this.active && nextAction.isRunning()) {
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
