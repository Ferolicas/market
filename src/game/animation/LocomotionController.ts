import type { AnimationAction } from "three";

export type LocomotionClip = "Idle" | "Walk" | "Run" | "TurnLeft" | "TurnRight" | "CarryIdle" | "CarryWalk";
export type FootstepEvent = "LeftFootDown" | "RightFootDown";

export class LocomotionController {
  private active = "Idle";
  private moving = false;
  private previousPhase = 0;

  select(speed: number, yawDelta: number, carrying: boolean): LocomotionClip {
    this.moving = this.moving ? speed >= 0.07 : speed > 0.12;
    const moving = this.moving;
    if (!moving && Math.abs(yawDelta) > 55 * Math.PI / 180) return yawDelta < 0 ? "TurnLeft" : "TurnRight";
    if (!moving) return carrying ? "CarryIdle" : "Idle";
    if (speed >= 3.15) return "Run";
    return carrying ? "CarryWalk" : "Walk";
  }

  transition(actions: Record<string, AnimationAction | null | undefined>, next: string, speedScale = 1, fadeSeconds = 0.16) {
    if (next === this.active && actions[next]?.isRunning()) {
      actions[next]?.setEffectiveTimeScale(speedScale);
      return;
    }
    actions[this.active]?.fadeOut(fadeSeconds);
    actions[next]?.reset().setEffectiveTimeScale(speedScale).fadeIn(fadeSeconds).play();
    this.active = next;
    this.previousPhase = 0;
  }

  footEvents(action: AnimationAction | null | undefined): FootstepEvent[] {
    const duration = action?.getClip().duration ?? 1;
    if (!action?.isRunning() || duration <= 0) return [];
    const phase = (action.time / duration) % 1;
    const events: FootstepEvent[] = [];
    if (crossed(this.previousPhase, phase, 0.03)) events.push("LeftFootDown");
    if (crossed(this.previousPhase, phase, 0.53)) events.push("RightFootDown");
    this.previousPhase = phase;
    return events;
  }

  current() { return this.active; }
}

function crossed(previous: number, current: number, marker: number) {
  return current >= previous ? previous < marker && current >= marker : previous < marker || current >= marker;
}
