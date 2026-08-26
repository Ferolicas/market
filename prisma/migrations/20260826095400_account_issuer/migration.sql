-- Better Auth 1.7 scopes every account identity by issuer.
ALTER TABLE "account" ADD COLUMN "issuer" TEXT;
UPDATE "account" SET "issuer" = 'local:credential' WHERE "issuer" IS NULL;
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;
CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "account"("issuer", "accountId");
