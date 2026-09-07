export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimitExceeded(result: RateLimitResult) {
  return Response.json(
    { error: "RATE_LIMITED", retryAfterSeconds: result.retryAfterSeconds },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(result.retryAfterSeconds),
        "RateLimit-Limit": String(result.limit),
        "RateLimit-Remaining": String(result.remaining),
        "RateLimit-Reset": String(result.retryAfterSeconds),
      },
    },
  );
}
