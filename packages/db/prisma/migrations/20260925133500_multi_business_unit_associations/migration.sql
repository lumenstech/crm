-- Additive cross-business-unit associations for existing CRM records.
-- Legacy Company.businessUnitId and Deal.businessUnitId remain in place for compatibility.

CREATE TABLE "company_business_unit" (
  "companyId" TEXT NOT NULL,
  "businessUnitId" TEXT NOT NULL,
  "useCase" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_business_unit_pkey" PRIMARY KEY ("companyId", "businessUnitId")
);

CREATE INDEX "company_business_unit_businessUnitId_companyId_idx"
  ON "company_business_unit"("businessUnitId", "companyId");

ALTER TABLE "company_business_unit"
  ADD CONSTRAINT "company_business_unit_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_business_unit"
  ADD CONSTRAINT "company_business_unit_businessUnitId_fkey"
  FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "contact_business_unit" (
  "contactId" TEXT NOT NULL,
  "businessUnitId" TEXT NOT NULL,
  "useCase" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_business_unit_pkey" PRIMARY KEY ("contactId", "businessUnitId")
);

CREATE INDEX "contact_business_unit_businessUnitId_contactId_idx"
  ON "contact_business_unit"("businessUnitId", "contactId");

ALTER TABLE "contact_business_unit"
  ADD CONSTRAINT "contact_business_unit_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_business_unit"
  ADD CONSTRAINT "contact_business_unit_businessUnitId_fkey"
  FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve every existing primary assignment as an explicit association.
INSERT INTO "company_business_unit" ("companyId", "businessUnitId", "createdAt")
SELECT id, "businessUnitId", CURRENT_TIMESTAMP
FROM "company"
WHERE "businessUnitId" IS NOT NULL
ON CONFLICT ("companyId", "businessUnitId") DO NOTHING;

-- Contacts inherit their company's existing business-unit assignment.
INSERT INTO "contact_business_unit" ("contactId", "businessUnitId", "createdAt")
SELECT c.id, co."businessUnitId", CURRENT_TIMESTAMP
FROM "contact" c
JOIN "company" co ON co.id = c."companyId"
WHERE co."businessUnitId" IS NOT NULL
ON CONFLICT ("contactId", "businessUnitId") DO NOTHING;
