CREATE TABLE "business_unit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_unit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "source_record" (
    "id" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "source_record_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "source_record_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "record_mapping" (
    "id" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "canonicalType" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "matchMethod" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "record_mapping_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "record_mapping_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "source_record"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "business_unit_key_key" ON "business_unit"("key");
CREATE INDEX "business_unit_enabled_key_idx" ON "business_unit"("enabled", "key");
CREATE UNIQUE INDEX "source_record_businessUnitId_sourceSystem_sourceType_sourceId_key"
    ON "source_record"("businessUnitId", "sourceSystem", "sourceType", "sourceId");
CREATE INDEX "source_record_businessUnitId_sourceType_idx"
    ON "source_record"("businessUnitId", "sourceType");
CREATE INDEX "source_record_sourceSystem_sourceType_sourceId_idx"
    ON "source_record"("sourceSystem", "sourceType", "sourceId");
CREATE UNIQUE INDEX "record_mapping_sourceRecordId_canonicalType_canonicalId_key"
    ON "record_mapping"("sourceRecordId", "canonicalType", "canonicalId");
CREATE INDEX "record_mapping_canonicalType_canonicalId_idx"
    ON "record_mapping"("canonicalType", "canonicalId");
