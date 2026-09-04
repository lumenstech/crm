CREATE TABLE "crmIngestEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crmIngestEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crmIngestEvent_eventId_key" ON "crmIngestEvent"("eventId");
CREATE INDEX "crmIngestEvent_project_receivedAt_idx" ON "crmIngestEvent"("project", "receivedAt");
CREATE INDEX "crmIngestEvent_source_sourceType_idx" ON "crmIngestEvent"("source", "sourceType");

CREATE TABLE "crmSignal" (
    "id" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "score" INTEGER NOT NULL DEFAULT 50,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "companyId" TEXT,
    "contactId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crmSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crmSignal_project_score_idx" ON "crmSignal"("project", "score");
CREATE INDEX "crmSignal_companyId_observedAt_idx" ON "crmSignal"("companyId", "observedAt");
CREATE INDEX "crmSignal_contactId_observedAt_idx" ON "crmSignal"("contactId", "observedAt");
CREATE INDEX "crmSignal_source_sourceType_idx" ON "crmSignal"("source", "sourceType");

ALTER TABLE "crmSignal" ADD CONSTRAINT "crmSignal_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crmSignal" ADD CONSTRAINT "crmSignal_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
