import { radialInput, type InputVector } from "./InputManager";

export interface DragSample {
  input: InputVector;
  thumbX: number;
  thumbY: number;
}

export class DragJoystick {
  private activePointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private radius = 72;

  get pointerId() { return this.activePointerId; }
  get origin() { return { x: this.originX, y: this.originY }; }
  get visualRadius() { return this.radius; }

  begin(pointerId: number, x: number, y: number, viewportWidth: number, viewportHeight: number) {
    if (this.activePointerId !== null) return false;
    this.activePointerId = pointerId;
    this.originX = x;
    this.originY = y;
    this.radius = Math.min(96, Math.max(56, Math.min(viewportWidth, viewportHeight) * 0.1));
    return true;
  }

  move(pointerId: number, x: number, y: number): DragSample | null {
    if (pointerId !== this.activePointerId) return null;
    const deltaX = x - this.originX;
    const deltaY = y - this.originY;
    const length = Math.hypot(deltaX, deltaY);
    const thumbScale = length > this.radius ? this.radius / length : 1;
    return {
      input: radialInput(deltaX, deltaY, this.radius, Math.max(6, this.radius * 0.1)),
      thumbX: deltaX * thumbScale,
      thumbY: deltaY * thumbScale,
    };
  }

  end(pointerId?: number) {
    if (pointerId !== undefined && pointerId !== this.activePointerId) return false;
    this.activePointerId = null;
    return true;
  }
}
