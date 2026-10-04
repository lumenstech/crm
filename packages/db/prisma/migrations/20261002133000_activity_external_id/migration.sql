ALTER TABLE "activity" ADD COLUMN "externalId" TEXT;
CREATE UNIQUE INDEX "activity_externalId_key" ON "activity"("externalId");
