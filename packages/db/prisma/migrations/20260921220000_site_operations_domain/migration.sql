-- CreateTable
CREATE TABLE "site_ops_site" (
    "id" TEXT NOT NULL,
    "business_unit_id" TEXT NOT NULL,
    "company_id" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address_line" TEXT,
    "locality" TEXT,
    "region" TEXT,
    "country_code" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'normal',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_ops_site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_ops_asset" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "external_reference" TEXT,
    "asset_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "operational_status" TEXT NOT NULL DEFAULT 'normal',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_ops_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_ops_observation" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "numeric_value" DOUBLE PRECISION,
    "text_value" TEXT,
    "unit" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "validation" TEXT NOT NULL DEFAULT 'accepted',
    "rejection_code" TEXT,
    "evidence_ref" TEXT,
    "raw_payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_ops_observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_ops_monitoring_policy" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "unit" TEXT,
    "expected_interval_seconds" INTEGER NOT NULL,
    "stale_after_seconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "min_value" DOUBLE PRECISION,
    "max_value" DOUBLE PRECISION,
    "alert_severity" TEXT NOT NULL DEFAULT 'warning',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_ops_monitoring_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_ops_source_health" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "last_attempt_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_error" TEXT,
    "expected_interval_seconds" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_ops_source_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_ops_alert" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "observation_id" TEXT,
    "alert_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "state" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL,
    "provider" TEXT,
    "metric" TEXT,
    "observed_value" DOUBLE PRECISION,
    "threshold_kind" TEXT,
    "threshold_value" DOUBLE PRECISION,
    "occurrence_key" TEXT NOT NULL,
    "active_key" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" TEXT,
    "closed_at" TIMESTAMP(3),
    "lumens_os_event_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_ops_alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_ops_site_company_idx" ON "site_ops_site"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_ops_site_business_unit_id_code_key" ON "site_ops_site"("business_unit_id", "code");

-- CreateIndex
CREATE INDEX "site_ops_asset_site_type_idx" ON "site_ops_asset"("site_id", "asset_type");

-- CreateIndex
CREATE UNIQUE INDEX "site_ops_asset_site_id_code_key" ON "site_ops_asset"("site_id", "code");

-- CreateIndex
CREATE INDEX "site_ops_observation_asset_metric_idx" ON "site_ops_observation"("asset_id", "metric", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "site_ops_observation_site_time_idx" ON "site_ops_observation"("site_id", "observed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "site_ops_observation_provider_asset_id_source_event_id_key" ON "site_ops_observation"("provider", "asset_id", "source_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_ops_monitoring_policy_asset_id_metric_key" ON "site_ops_monitoring_policy"("asset_id", "metric");

-- CreateIndex
CREATE INDEX "site_ops_source_health_status_idx" ON "site_ops_source_health"("status");

-- CreateIndex
CREATE UNIQUE INDEX "site_ops_source_health_site_scope_key" ON "site_ops_source_health"("provider", "site_id") WHERE ("asset_id" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "site_ops_source_health_asset_scope_key" ON "site_ops_source_health"("provider", "site_id", "asset_id") WHERE ("asset_id" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "site_ops_alert_occurrence_key_key" ON "site_ops_alert"("occurrence_key");

-- CreateIndex
CREATE UNIQUE INDEX "site_ops_alert_active_key_key" ON "site_ops_alert"("active_key");

-- CreateIndex
CREATE INDEX "site_ops_alert_site_state_idx" ON "site_ops_alert"("site_id", "state", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "site_ops_alert_asset_state_idx" ON "site_ops_alert"("asset_id", "state");

-- AddForeignKey
ALTER TABLE "site_ops_site" ADD CONSTRAINT "site_ops_site_business_unit_id_fkey" FOREIGN KEY ("business_unit_id") REFERENCES "business_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_ops_site" ADD CONSTRAINT "site_ops_site_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "canonical_company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_ops_asset" ADD CONSTRAINT "site_ops_asset_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site_ops_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_ops_observation" ADD CONSTRAINT "site_ops_observation_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site_ops_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_ops_observation" ADD CONSTRAINT "site_ops_observation_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "site_ops_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_ops_monitoring_policy" ADD CONSTRAINT "site_ops_monitoring_policy_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "site_ops_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_ops_source_health" ADD CONSTRAINT "site_ops_source_health_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site_ops_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_ops_source_health" ADD CONSTRAINT "site_ops_source_health_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "site_ops_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_ops_alert" ADD CONSTRAINT "site_ops_alert_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site_ops_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_ops_alert" ADD CONSTRAINT "site_ops_alert_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "site_ops_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_ops_alert" ADD CONSTRAINT "site_ops_alert_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "site_ops_observation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

