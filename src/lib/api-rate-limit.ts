import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { RateLimitResult } from "@/lib/api-rate-limit-response";
export { rateLimitExceeded } from "@/lib/api-rate-limit-response";

type RateLimitOptions = {
  scope: string;
  subject: string;
  limit: number;
  windowSeconds: number;
};

type BucketRow = {
  count: number;
  expiresAt: Date;
};

/**
 * PostgreSQL is already shared by every API instance, so this guard works
 * across processes without adding another availability dependency. The row is
 * updated atomically and reused when its fixed window expires.
 */
export async function consumeApiRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const key = createHash("sha256")
    .update(`${options.scope}\0${options.subject}`)
    .digest("hex");
  const expiresAt = new Date(Date.now() + options.windowSeconds * 1_000);
  const rows = await db.$queryRaw<BucketRow[]>(Prisma.sql`
    INSERT INTO "api_rate_limit_bucket" ("key", "count", "expiresAt", "updatedAt")
    VALUES (${key}, 1, ${expiresAt}, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "api_rate_limit_bucket"."expiresAt" <= CURRENT_TIMESTAMP THEN 1
        ELSE "api_rate_limit_bucket"."count" + 1
      END,
      "expiresAt" = CASE
        WHEN "api_rate_limit_bucket"."expiresAt" <= CURRENT_TIMESTAMP THEN EXCLUDED."expiresAt"
        ELSE "api_rate_limit_bucket"."expiresAt"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "count", "expiresAt"
  `);
  const bucket = rows[0];
  const count = bucket?.count ?? options.limit + 1;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(((bucket?.expiresAt.getTime() ?? expiresAt.getTime()) - Date.now()) / 1_000),
  );
  return {
    allowed: count <= options.limit,
    limit: options.limit,
    remaining: Math.max(0, options.limit - count),
    retryAfterSeconds,
  };
}
