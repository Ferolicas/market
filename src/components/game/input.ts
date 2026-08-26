export const mobileInput = { x: 0, y: 0 };

export function setMobileInput(x: number, y: number) {
  mobileInput.x = Math.max(-1, Math.min(1, x));
  mobileInput.y = Math.max(-1, Math.min(1, y));
}
