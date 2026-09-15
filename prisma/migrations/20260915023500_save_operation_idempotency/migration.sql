CREATE TABLE "SaveOperation" (
    "operationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 1,
    "expectedRevision" INTEGER NOT NULL,
    "appliedRevision" INTEGER NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stateChecksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaveOperation_pkey" PRIMARY KEY ("operationId")
);

CREATE INDEX "SaveOperation_userId_createdAt_idx" ON "SaveOperation"("userId", "createdAt");
CREATE INDEX "SaveOperation_userId_slot_appliedRevision_idx" ON "SaveOperation"("userId", "slot", "appliedRevision");

ALTER TABLE "SaveOperation" ADD CONSTRAINT "SaveOperation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
