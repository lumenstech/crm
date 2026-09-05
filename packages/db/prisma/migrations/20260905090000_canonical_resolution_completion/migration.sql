CREATE TABLE "canonical_opportunity_identifier" (
    "id" TEXT NOT NULL,
    "canonicalOpportunityId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "identifierType" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "canonical_opportunity_identifier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "canonical_opportunity_identifier_opportunity_fkey" FOREIGN KEY ("canonicalOpportunityId") REFERENCES "canonical_opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "canonical_opportunity_identifier_scope_key" ON "canonical_opportunity_identifier"("sourceSystem", "identifierType", "normalizedValue");
CREATE INDEX "canonical_opportunity_identifier_opportunity_idx" ON "canonical_opportunity_identifier"("canonicalOpportunityId");
