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

/** `n ** 1.65` and `n ** 1.55` for the integer tiers the economy prices, as
 * literals: `**` with a fractional exponent is `Math.pow`, which differs in
 * its last bits between engines, and these reach `Math.round` of a price. */
const POW_1_65 = [0, 1, 3.1383363915870026, 6.127030895836053, 9.849155306759329, 14.233132985628822, 19.228684032780198, 24.797720805443024, 30.909962525595052, 37.540507598529544, 44.6683592150963, 52.27546811440258, 60.346078862402024, 68.86626529872379, 77.823589632136, 87.20684554749104, 97.00586025666546];
const POW_1_55 = [0, 1, 2.928171391891251, 5.4895651648300365, 8.574187700290345, 12.117234333213268, 16.07438766957809, 20.412770931585943, 25.106691132696024, 30.135325698915423, 35.48133892335755, 41.129995500178424, 47.068562116228044, 53.28588658411802, 59.77209187109928, 66.51834748969007, 73.51669471981025];

export function powTier(base: number, exponent: 1.65 | 1.55) {
  const table = exponent === 1.65 ? POW_1_65 : POW_1_55;
  const index = Math.floor(base);
  if (index === base && index >= 0 && index < table.length) return table[index];
  return base ** exponent;
}
