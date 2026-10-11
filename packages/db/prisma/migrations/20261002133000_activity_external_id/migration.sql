SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "activity_externalId_key" ON "activity"("externalId");
