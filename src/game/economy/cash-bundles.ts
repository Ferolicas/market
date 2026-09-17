/** Physical money in the world: one bundle per ten euros of base money,
 * scaled by the country. 200 € in a drawer is twenty bundles stacked. */
export const CASH_BUNDLE_BASE_MINOR = 1_000;
/** Bundles drawn per drawer before the stack stops growing (performance). */
export const CASH_BUNDLE_RENDER_CAP = 240;

export function cashBundleMinor(moneyScale: number) {
  return Math.max(1, Math.round(CASH_BUNDLE_BASE_MINOR * (Number.isFinite(moneyScale) && moneyScale > 0 ? moneyScale : 1)));
}

/** Whole bundles in an amount; any money at all shows at least one. */
export function cashBundleCount(amountMinor: number, bundleMinor: number) {
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return 0;
  return Math.max(1, Math.floor(amountMinor / Math.max(1, bundleMinor)));
}
