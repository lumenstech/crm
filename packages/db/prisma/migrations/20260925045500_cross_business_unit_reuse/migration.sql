-- CreateTable
CREATE TABLE "business_unit_record_association" (
    "id" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "sourceBusinessUnitId" TEXT,
    "targetBusinessUnitId" TEXT NOT NULL,
    "useCase" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_unit_record_association_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_unit_record_association_recordType_recordId_targetBusinessUnitId_key"
ON "business_unit_record_association"("recordType", "recordId", "targetBusinessUnitId");

-- CreateIndex
CREATE INDEX "business_unit_record_association_recordType_recordId_idx"
ON "business_unit_record_association"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "business_unit_record_association_targetBusinessUnitId_recordType_idx"
ON "business_unit_record_association"("targetBusinessUnitId", "recordType");

-- AddForeignKey
ALTER TABLE "business_unit_record_association"
ADD CONSTRAINT "business_unit_record_association_sourceBusinessUnitId_fkey"
FOREIGN KEY ("sourceBusinessUnitId") REFERENCES "business_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_unit_record_association"
ADD CONSTRAINT "business_unit_record_association_targetBusinessUnitId_fkey"
FOREIGN KEY ("targetBusinessUnitId") REFERENCES "business_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ensure EnergyBMS is available as a first-class business unit for cross-unit reuse.
INSERT INTO "business_unit" (
    "id", "key", "name", "description", "enabled", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    'energybms',
    'EnergyBMS',
    'EnergyBMS building energy management, controls, metering, optimization, and LL97-related opportunities.',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "business_unit" WHERE "key" = 'energybms'
);
