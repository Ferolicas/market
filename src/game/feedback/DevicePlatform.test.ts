import { describe, expect, it } from "vitest";
import { isAppleTouchDevice } from "./DevicePlatform";

describe("dispositivos Apple táctiles", () => {
  it("reconoce iPhone, iPad y el iPad que se presenta como Mac", () => {
    expect(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
  });
  it("deja fuera Android, escritorio y Mac sin pantalla táctil", () => {
    expect(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)", platform: "Linux armv8l", maxTouchPoints: 5 })).toBe(false);
    expect(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isAppleTouchDevice({ userAgent: "", platform: "", maxTouchPoints: 0 })).toBe(false);
  });
});
