ALTER TABLE "LedgerEntry"
ADD COLUMN "eventId" TEXT,
ADD COLUMN "sessionId" TEXT,
ADD COLUMN "sequence" INTEGER,
ADD COLUMN "type" TEXT,
ADD COLUMN "payload" JSONB,
ADD COLUMN "idempotencyKey" TEXT;

CREATE INDEX "LedgerEntry_userId_eventId_idx" ON "LedgerEntry"("userId", "eventId");
CREATE UNIQUE INDEX "LedgerEntry_userId_idempotencyKey_key" ON "LedgerEntry"("userId", "idempotencyKey");
