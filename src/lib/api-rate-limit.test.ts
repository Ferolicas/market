import { describe, expect, it } from "vitest";
import { rateLimitExceeded } from "./api-rate-limit-response";

describe("rateLimitExceeded", () => {
  it("returns a machine-readable 429 with retry metadata", async () => {
    const response = rateLimitExceeded({
      allowed: false,
      limit: 30,
      remaining: 0,
      retryAfterSeconds: 17,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("ratelimit-limit")).toBe("30");
    expect(await response.json()).toEqual({ error: "RATE_LIMITED", retryAfterSeconds: 17 });
  });
});
