CREATE TABLE "SaveCommandBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 1,
    "fromRevision" INTEGER NOT NULL,
    "toRevision" INTEGER NOT NULL,
    "commandCount" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "commands" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaveCommandBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SaveCommandBatch_userId_slot_toRevision_idx" ON "SaveCommandBatch"("userId", "slot", "toRevision");
CREATE INDEX "SaveCommandBatch_createdAt_idx" ON "SaveCommandBatch"("createdAt");

ALTER TABLE "SaveCommandBatch" ADD CONSTRAINT "SaveCommandBatch_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
