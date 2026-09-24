-- Seed the initial Comp CRM business units.
INSERT INTO "business_unit" (id, key, name, description, enabled, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, '516labs', '516 Labs', 'Concrete testing and laboratory services outreach.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'partwall', 'PartWall', 'Trade show booths, branded displays, walls, and fabrication.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'lumens-technology', 'Lumens Technology', 'MEP, electrical, controls, elevators, network, and systems integration.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'data-gear', 'Data-Gear', 'GPU servers, data center hardware, infrastructure, and related services.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  enabled = true,
  "updatedAt" = CURRENT_TIMESTAMP;

-- Scope provenance and canonical mappings to a business unit so the same
-- external lead can exist independently in more than one project.
DROP INDEX IF EXISTS "source_record_sourceSystem_sourceType_sourceId_key";
CREATE UNIQUE INDEX "source_record_businessUnitId_sourceSystem_sourceType_sourceId_key"
  ON "source_record"("businessUnitId", "sourceSystem", "sourceType", "sourceId");

ALTER TABLE "record_mapping" ADD COLUMN "businessUnitId" TEXT;

UPDATE "record_mapping" rm
SET "businessUnitId" = sr."businessUnitId"
FROM "source_record" sr
WHERE rm."businessUnitId" IS NULL
  AND rm."sourceSystem" = sr."sourceSystem"
  AND rm."sourceType" = sr."sourceType"
  AND rm."sourceId" = sr."sourceId";

DELETE FROM "record_mapping"
WHERE "businessUnitId" IS NULL;

ALTER TABLE "record_mapping" ALTER COLUMN "businessUnitId" SET NOT NULL;

DROP INDEX IF EXISTS "record_mapping_sourceSystem_sourceType_sourceId_canonicalTy_key";
CREATE UNIQUE INDEX "record_mapping_businessUnitId_sourceSystem_sourceType_sourceId_canonicalType_key"
  ON "record_mapping"("businessUnitId", "sourceSystem", "sourceType", "sourceId", "canonicalType");

CREATE INDEX "record_mapping_businessUnitId_canonicalType_idx"
  ON "record_mapping"("businessUnitId", "canonicalType");

ALTER TABLE "record_mapping"
  ADD CONSTRAINT "record_mapping_businessUnitId_fkey"
  FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
