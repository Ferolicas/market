import { describe, expect, it } from "vitest";
import { CASH_BUNDLE_BASE_MINOR, cashBundleCount, cashBundleMinor } from "./cash-bundles";

describe("cash bundles", () => {
  it("shows one bundle per ten euros: 200 € is twenty bundles", () => {
    expect(cashBundleMinor(1)).toBe(CASH_BUNDLE_BASE_MINOR);
    expect(cashBundleCount(20_000, cashBundleMinor(1))).toBe(20);
    expect(cashBundleCount(1_999, cashBundleMinor(1))).toBe(1);
    expect(cashBundleCount(371, cashBundleMinor(1))).toBe(1);
    expect(cashBundleCount(0, cashBundleMinor(1))).toBe(0);
  });
  it("scales the bundle with the country's money", () => {
    expect(cashBundleMinor(4)).toBe(4_000);
    expect(cashBundleCount(80_000, cashBundleMinor(4))).toBe(20);
    expect(cashBundleMinor(Number.NaN)).toBe(CASH_BUNDLE_BASE_MINOR);
  });
});
