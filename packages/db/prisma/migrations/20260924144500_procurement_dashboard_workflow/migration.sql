-- Procurement operating dashboard workflow fields.
CREATE TYPE "ProcurementDemandType" AS ENUM ('PURCHASE', 'LEASE', 'CLOUD_CAPACITY');

ALTER TABLE "procurementCustomerRequest"
  ADD COLUMN "demandType" "ProcurementDemandType" NOT NULL DEFAULT 'PURCHASE',
  ADD COLUMN "nextAction" TEXT,
  ADD COLUMN "followUpAt" TIMESTAMP(3);

ALTER TABLE "procurementCustomerRequestItem"
  ALTER COLUMN "quantity" DROP NOT NULL,
  ALTER COLUMN "quantity" DROP DEFAULT;

CREATE INDEX "procurementCustomerRequest_businessUnitId_followUpAt_idx"
  ON "procurementCustomerRequest"("businessUnitId", "followUpAt");

CREATE INDEX "procurementCustomerRequest_businessUnitId_demandType_status_idx"
  ON "procurementCustomerRequest"("businessUnitId", "demandType", "status");
