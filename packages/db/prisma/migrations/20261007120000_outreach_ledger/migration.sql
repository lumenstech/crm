CREATE TYPE "OutreachMode" AS ENUM ('NEW_OUTREACH', 'FOLLOW_UP', 'RETRY_BOUNCED_ROUTE');

CREATE TYPE "OutreachStatus" AS ENUM ('RESERVED', 'QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'CANCELED');

CREATE TABLE "outreach_ledger" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "businessUnitId" TEXT NOT NULL,
    "outreachMode" "OutreachMode" NOT NULL,
    "campaignType" TEXT,
    "purpose" TEXT,
    "senderIdentity" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "OutreachStatus" NOT NULL DEFAULT 'RESERVED',
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "reservationKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "notes" TEXT,
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outreach_ledger_reservationKey_key" ON "outreach_ledger"("reservationKey");
CREATE UNIQUE INDEX "outreach_ledger_idempotencyKey_key" ON "outreach_ledger"("idempotencyKey");
CREATE UNIQUE INDEX "outreach_ledger_providerMessageId_key" ON "outreach_ledger"("providerMessageId") WHERE "providerMessageId" IS NOT NULL;
CREATE UNIQUE INDEX "outreach_ledger_active_new_outreach_key"
  ON "outreach_ledger"("businessUnitId", "companyId")
  WHERE "outreachMode" = 'NEW_OUTREACH' AND "status" IN ('RESERVED', 'QUEUED');
CREATE INDEX "outreach_ledger_companyId_businessUnitId_outreachMode_idx"
  ON "outreach_ledger"("companyId", "businessUnitId", "outreachMode");
CREATE INDEX "outreach_ledger_companyId_businessUnitId_status_idx"
  ON "outreach_ledger"("companyId", "businessUnitId", "status");
CREATE INDEX "outreach_ledger_businessUnitId_createdAt_idx"
  ON "outreach_ledger"("businessUnitId", "createdAt");
CREATE INDEX "outreach_ledger_recipientEmail_idx"
  ON "outreach_ledger"("recipientEmail");

ALTER TABLE "outreach_ledger" ADD CONSTRAINT "outreach_ledger_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outreach_ledger" ADD CONSTRAINT "outreach_ledger_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "outreach_ledger" ADD CONSTRAINT "outreach_ledger_businessUnitId_fkey"
  FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "outreach_ledger" (
  "id",
  "companyId",
  "contactId",
  "businessUnitId",
  "outreachMode",
  "campaignType",
  "purpose",
  "senderIdentity",
  "recipientEmail",
  "subject",
  "status",
  "provider",
  "providerMessageId",
  "reservationKey",
  "idempotencyKey",
  "metadata",
  "createdAt",
  "reservedAt",
  "sentAt",
  "updatedAt"
)
SELECT
  'historic-email-' || em."id",
  et."companyId",
  et."contactId",
  COALESCE(c."businessUnitId", association."targetBusinessUnitId"),
  'NEW_OUTREACH',
  'HISTORIC_BACKFILL',
  'Historic outbound email evidence',
  em."fromEmail",
  recipient."email",
  COALESCE(em."subject", '(historic outbound email)'),
  'SENT',
  'crm-email-history',
  em."rfcMessageId",
  'historic-email:' || em."id",
  'historic-email:' || em."id",
  jsonb_build_object(
    'source', 'emailMessage',
    'emailMessageId', em."id",
    'rfcMessageId', em."rfcMessageId",
    'backfill', '20261007120000_outreach_ledger'
  ),
  em."sentAt",
  em."sentAt",
  em."sentAt",
  em."sentAt"
FROM "emailMessage" em
JOIN "emailThread" et ON et."id" = em."threadId"
JOIN "company" c ON c."id" = et."companyId"
LEFT JOIN LATERAL (
  SELECT assoc."targetBusinessUnitId"
  FROM "business_unit_record_association" assoc
  WHERE assoc."recordType" = 'company' AND assoc."recordId" = c."id"
  ORDER BY assoc."createdAt" ASC
  LIMIT 1
) association ON TRUE
JOIN LATERAL (
  SELECT recipient_value->>'email' AS "email"
  FROM jsonb_array_elements(em."recipients") recipient_value
  WHERE recipient_value->>'email' IS NOT NULL
  ORDER BY recipient_value->>'email'
  LIMIT 1
) recipient ON TRUE
WHERE em."direction" = 'OUTBOUND'
  AND COALESCE(c."businessUnitId", association."targetBusinessUnitId") IS NOT NULL
ON CONFLICT DO NOTHING;
