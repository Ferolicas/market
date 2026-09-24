/**
 * The engine must give the same bits on every JavaScript engine: the client
 * plays on Safari (JavaScriptCore) and the server replays on Node (V8).
 * IEEE 754 add, multiply, divide and sqrt are correctly rounded everywhere;
 * `Math.hypot`, `Math.pow`/`**`, `Math.exp` and the trigonometric functions
 * are not, and differ in their last bits between engines. Anything that feeds
 * the authoritative state goes through these instead.
 */
export function distance2d(dx: number, dz: number) {
  return Math.sqrt(dx * dx + dz * dz);
}

/** `base ** exponent` for a non-negative integer exponent by repeated
 * multiplication: identical on every engine, unlike `**`. */
export function powInt(base: number, exponent: number) {
  let result = 1;
  const steps = Math.max(0, Math.floor(Number.isFinite(exponent) ? exponent : 0));
  for (let index = 0; index < steps; index += 1) result *= base;
  return result;
}
