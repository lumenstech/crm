CREATE TABLE "canonical_company" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "legalName" TEXT,
    "domain" TEXT,
    "website" TEXT,
    "companyId" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
    "mergedIntoId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "canonical_company_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "canonical_company_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "canonical_company_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "canonical_company"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "canonical_company_companyId_key" ON "canonical_company"("companyId");
CREATE INDEX "canonical_company_normalizedName_idx" ON "canonical_company"("normalizedName");
CREATE INDEX "canonical_company_domain_idx" ON "canonical_company"("domain");

CREATE TABLE "canonical_company_identifier" (
    "id" TEXT NOT NULL,
    "canonicalCompanyId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "identifierType" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "canonical_company_identifier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "canonical_company_identifier_company_fkey" FOREIGN KEY ("canonicalCompanyId") REFERENCES "canonical_company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "canonical_company_identifier_scope_key" ON "canonical_company_identifier"("sourceSystem", "identifierType", "normalizedValue");
CREATE INDEX "canonical_company_identifier_company_idx" ON "canonical_company_identifier"("canonicalCompanyId");

CREATE TABLE "canonical_person" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "normalizedName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "canonicalCompanyId" TEXT,
    "contactId" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
    "mergedIntoId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "canonical_person_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "canonical_person_company_fkey" FOREIGN KEY ("canonicalCompanyId") REFERENCES "canonical_company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "canonical_person_contact_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "canonical_person_mergedInto_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "canonical_person"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "canonical_person_contactId_key" ON "canonical_person"("contactId");
CREATE INDEX "canonical_person_normalizedName_idx" ON "canonical_person"("normalizedName");
CREATE INDEX "canonical_person_email_idx" ON "canonical_person"("email");

CREATE TABLE "canonical_person_identifier" (
    "id" TEXT NOT NULL,
    "canonicalPersonId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "identifierType" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "canonical_person_identifier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "canonical_person_identifier_person_fkey" FOREIGN KEY ("canonicalPersonId") REFERENCES "canonical_person"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "canonical_person_identifier_scope_key" ON "canonical_person_identifier"("sourceSystem", "identifierType", "normalizedValue");
CREATE INDEX "canonical_person_identifier_person_idx" ON "canonical_person_identifier"("canonicalPersonId");

CREATE TABLE "canonical_company_business_unit" (
    "canonicalCompanyId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "canonical_company_business_unit_pkey" PRIMARY KEY ("canonicalCompanyId", "businessUnitId"),
    CONSTRAINT "canonical_company_business_unit_company_fkey" FOREIGN KEY ("canonicalCompanyId") REFERENCES "canonical_company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "canonical_company_business_unit_unit_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "canonical_company_business_unit_unit_idx" ON "canonical_company_business_unit"("businessUnitId");

CREATE TABLE "canonical_person_business_unit" (
    "canonicalPersonId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "canonical_person_business_unit_pkey" PRIMARY KEY ("canonicalPersonId", "businessUnitId"),
    CONSTRAINT "canonical_person_business_unit_person_fkey" FOREIGN KEY ("canonicalPersonId") REFERENCES "canonical_person"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "canonical_person_business_unit_unit_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "canonical_person_business_unit_unit_idx" ON "canonical_person_business_unit"("businessUnitId");

CREATE TABLE "canonical_opportunity" (
    "id" TEXT NOT NULL,
    "canonicalCompanyId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "description" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "amount" DECIMAL(14,2),
    "currency" TEXT,
    "dealId" TEXT,
    "ownerId" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "canonical_opportunity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "canonical_opportunity_company_fkey" FOREIGN KEY ("canonicalCompanyId") REFERENCES "canonical_company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "canonical_opportunity_unit_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "canonical_opportunity_deal_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "canonical_opportunity_owner_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "canonical_opportunity_dealId_key" ON "canonical_opportunity"("dealId");
CREATE INDEX "canonical_opportunity_company_unit_idx" ON "canonical_opportunity"("canonicalCompanyId", "businessUnitId");
CREATE INDEX "canonical_opportunity_title_idx" ON "canonical_opportunity"("normalizedTitle");

CREATE TABLE "resolution_review" (
    "id" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proposedOperation" TEXT NOT NULL,
    "reviewerId" TEXT,
    "decision" TEXT,
    "decisionReason" TEXT,
    "decisionAt" TIMESTAMP(3),
    "failure" TEXT,
    "resultCanonicalId" TEXT,
    "resultVisibleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "resolution_review_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resolution_review_source_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "source_record"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "resolution_review_reviewer_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "resolution_review_open_source_key" ON "resolution_review"("sourceRecordId", "entityType", "reasonCode", "status");
CREATE INDEX "resolution_review_status_created_idx" ON "resolution_review"("status", "createdAt");

CREATE TABLE "resolution_candidate" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "canonicalType" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "matchReasons" JSONB NOT NULL DEFAULT '[]',
    "conflictingFields" JSONB NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resolution_candidate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resolution_candidate_review_fkey" FOREIGN KEY ("reviewId") REFERENCES "resolution_review"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "resolution_candidate_review_target_key" ON "resolution_candidate"("reviewId", "canonicalType", "canonicalId");

CREATE TABLE "promotion_audit" (
    "id" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "canonicalType" TEXT,
    "canonicalId" TEXT,
    "visibleId" TEXT,
    "error" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promotion_audit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promotion_audit_source_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "source_record"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promotion_audit_unit_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promotion_audit_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "promotion_audit_source_created_idx" ON "promotion_audit"("sourceRecordId", "createdAt");
