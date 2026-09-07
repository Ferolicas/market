CREATE TABLE "api_rate_limit_bucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_rate_limit_bucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "api_rate_limit_bucket_expiresAt_idx"
ON "api_rate_limit_bucket"("expiresAt");
