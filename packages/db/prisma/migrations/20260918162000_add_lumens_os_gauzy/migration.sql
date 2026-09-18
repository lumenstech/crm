-- Lumens OS / Gauzy integration tables
-- Generated from the approved Prisma schema and validated against the isolated Neon dev branch.

CREATE TABLE "lumens_os_event" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "business_unit_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leased_until" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lumens_os_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_identity" (
    "id" TEXT NOT NULL,
    "canonical_type" TEXT NOT NULL,
    "canonical_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "external_identity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gauzy_promotion" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "company_id" TEXT,
    "business_unit_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "gauzy_organization_id" TEXT,
    "gauzy_contact_id" TEXT,
    "gauzy_project_id" TEXT,
    "event_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "last_error" TEXT,
    "promoted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gauzy_promotion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lumens_os_event_idempotency_key_key" ON "lumens_os_event"("idempotency_key");
CREATE INDEX "lumens_os_event_dispatch_idx" ON "lumens_os_event"("status", "available_at", "created_at");
CREATE INDEX "lumens_os_event_aggregate_idx" ON "lumens_os_event"("aggregate_type", "aggregate_id");

CREATE UNIQUE INDEX "external_identity_provider_external_type_external_id_key" ON "external_identity"("provider", "external_type", "external_id");
CREATE UNIQUE INDEX "external_identity_canonical_type_canonical_id_provider_exte_key" ON "external_identity"("canonical_type", "canonical_id", "provider", "external_type");
CREATE INDEX "external_identity_canonical_idx" ON "external_identity"("canonical_type", "canonical_id");

CREATE UNIQUE INDEX "gauzy_promotion_opportunity_id_key" ON "gauzy_promotion"("opportunity_id");
CREATE INDEX "gauzy_promotion_status_idx" ON "gauzy_promotion"("status", "created_at");
