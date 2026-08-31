export interface InputVector {
  x: number;
  y: number;
  magnitude: number;
}

const ZERO_INPUT: InputVector = Object.freeze({ x: 0, y: 0, magnitude: 0 });

export function radialInput(deltaX: number, deltaY: number, radius: number, deadzone: number): InputVector {
  const safeRadius = Math.max(1, radius);
  const safeDeadzone = Math.min(safeRadius - Number.EPSILON, Math.max(0, deadzone));
  const length = Math.hypot(deltaX, deltaY);
  if (length <= safeDeadzone) return ZERO_INPUT;
  const magnitude = Math.min(1, (length - safeDeadzone) / (safeRadius - safeDeadzone));
  return { x: deltaX / length, y: deltaY / length, magnitude };
}

export function normalizedInput(x: number, y: number, deadzone = 0): InputVector {
  const length = Math.hypot(x, y);
  if (length <= deadzone) return ZERO_INPUT;
  const magnitude = Math.min(1, (length - deadzone) / Math.max(Number.EPSILON, 1 - deadzone));
  return { x: x / length, y: y / length, magnitude };
}

export function strongestInput(inputs: readonly InputVector[]): InputVector {
  return inputs.reduce<InputVector>((strongest, candidate) => candidate.magnitude > strongest.magnitude ? candidate : strongest, ZERO_INPUT);
}

export class InputManager {
  private pointer: InputVector = ZERO_INPUT;
  private keyboard: InputVector = ZERO_INPUT;
  private gamepad: InputVector = ZERO_INPUT;

  setPointer(input: InputVector) { this.pointer = input; }
  setKeyboard(x: number, y: number) { this.keyboard = normalizedInput(x, y); }
  setGamepad(x: number, y: number) { this.gamepad = normalizedInput(x, y, 0.15); }
  clearPointer() { this.pointer = ZERO_INPUT; }
  clearKeyboard() { this.keyboard = ZERO_INPUT; }
  clearGamepad() { this.gamepad = ZERO_INPUT; }
  clearAll() { this.pointer = this.keyboard = this.gamepad = ZERO_INPUT; }
  sample() { return strongestInput([this.pointer, this.keyboard, this.gamepad]); }
}

export const inputManager = new InputManager();
