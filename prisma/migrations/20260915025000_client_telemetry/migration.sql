CREATE TABLE "ClientTelemetry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT,
    "route" TEXT,
    "deviceId" TEXT,
    "sessionId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientTelemetry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientTelemetry_userId_createdAt_idx" ON "ClientTelemetry"("userId", "createdAt");
CREATE INDEX "ClientTelemetry_kind_name_createdAt_idx" ON "ClientTelemetry"("kind", "name", "createdAt");
ALTER TABLE "ClientTelemetry" ADD CONSTRAINT "ClientTelemetry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
