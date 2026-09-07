import { describe, expect, it } from "vitest";
import { runtimeConfig } from "./runtime-config";

describe("runtime config", () => {
  it("contains only versioned non-sensitive flags and measured cadence", () => {
    expect(runtimeConfig.schemaVersion).toBe(1);
    expect(runtimeConfig.tuning.remoteSaveIntervalSeconds).toBe(1800);
    expect(Object.values(runtimeConfig.flags).every((value) => typeof value === "boolean")).toBe(true);
    expect(JSON.stringify(runtimeConfig)).not.toMatch(/secret|password|token|credential|databaseUrl/i);
  });
});

