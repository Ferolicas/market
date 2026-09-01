import { describe, expect, it } from "vitest";
import { marketPerformanceProbeEnabled, marketQaFreezeEnabled, marketQaQueryEnabled } from "./QaAccess";

describe("browser QA access", () => {
  it("ignores every public URL flag when the build gate is disabled", () => {
    expect(marketQaQueryEnabled("?debug=1", false)).toBe(false);
    expect(marketPerformanceProbeEnabled("?perf=1", false)).toBe(false);
    expect(marketQaFreezeEnabled("?perf-freeze=1&debug=1", "1", false)).toBe(false);
  });

  it("allows explicit QA builds to inspect and freeze deterministic sessions", () => {
    expect(marketQaQueryEnabled("?debug=1", true)).toBe(true);
    expect(marketPerformanceProbeEnabled("?perf=1", true)).toBe(true);
    expect(marketQaFreezeEnabled("?debug=1", "1", true)).toBe(true);
    expect(marketQaFreezeEnabled("?debug=1", null, true)).toBe(false);
    expect(marketQaFreezeEnabled("?perf-freeze=1", null, true)).toBe(true);
  });
});
