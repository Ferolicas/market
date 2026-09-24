ALTER TABLE "SaveCommandBatch" ADD COLUMN "baseNormalized" BOOLEAN;
ALTER TABLE "SaveCommandBatch" ADD COLUMN "baseState" JSONB;
ALTER TABLE "SaveCommandBatch" ADD COLUMN "submittedState" JSONB;
