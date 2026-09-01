/**
 * Browser QA hooks are compiled out of normal production behaviour. A local
 * production build may opt in explicitly, but the public deployment never
 * grants simulation controls merely because a URL contains `?debug`.
 */
export const MARKET_QA_BUILD_ENABLED = process.env.NODE_ENV !== "production"
  || process.env.NEXT_PUBLIC_MARKET_QA_ENABLED === "1";

export function marketQaQueryEnabled(search: string, enabled = MARKET_QA_BUILD_ENABLED) {
  return enabled && new URLSearchParams(search).has("debug");
}

export function marketPerformanceProbeEnabled(search: string, enabled = MARKET_QA_BUILD_ENABLED) {
  return enabled && new URLSearchParams(search).has("perf");
}

export function marketQaFreezeEnabled(search: string, freezeToken: string | null, enabled = MARKET_QA_BUILD_ENABLED) {
  if (!enabled) return false;
  const params = new URLSearchParams(search);
  return params.has("perf-freeze") || (params.has("debug") && freezeToken === "1");
}
