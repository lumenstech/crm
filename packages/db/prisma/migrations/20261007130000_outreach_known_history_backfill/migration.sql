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
  'known-dg-' || c."id" || '-' || facts."eventDate",
  c."id",
  NULL,
  bu."id",
  'NEW_OUTREACH',
  'HISTORIC_BACKFILL',
  'Operator-provided historical Data-Gear outreach evidence',
  'Danny Ramroop <sales@data-gear.com>',
  facts."recipientEmail",
  '(historic outreach evidence)',
  'SENT',
  'operator-provided-history',
  NULL,
  'known-dg:' || c."id" || ':' || facts."eventDate",
  'known-dg:' || c."id" || ':' || facts."eventDate",
  jsonb_build_object(
    'source', 'operator-provided-known-history',
    'eventDate', facts."eventDate",
    'knownRoute', facts."knownRoute"
  ),
  facts."eventDate"::timestamp,
  facts."eventDate"::timestamp,
  facts."eventDate"::timestamp,
  facts."eventDate"::timestamp
FROM "company" c
JOIN "business_unit" bu ON bu."key" = 'data-gear'
JOIN (
  VALUES
    ('lambda.ai', 'lambda', '2026-09-23', 'sales@lambda.ai', true),
    ('lambda.ai', 'lambda', '2026-09-26', 'sales@lambda.ai', true),
    ('lambda.ai', 'lambda', '2026-10-07', 'sales@lambda.ai', true),
    ('nscale.com', 'nscale', '2026-09-23', '', false),
    ('nscale.com', 'nscale', '2026-09-26', '', false),
    ('nscale.com', 'nscale', '2026-10-07', '', false),
    ('wv.gov', 'west virginia office of technology', '2026-09-15', '', false),
    ('wv.gov', 'west virginia office of technology', '2026-10-07', '', false),
    ('greenkogroup.com', 'greenko', '2026-10-07', 'info@greenkogroup.com', true),
    ('greenkogroup.com', 'greenko / am intelligence', '2026-10-07', 'info@greenkogroup.com', true),
    ('greenkogroup.com', 'am intelligence', '2026-10-07', 'info@greenkogroup.com', true)
) AS facts("domain", "name", "eventDate", "recipientEmail", "knownRoute")
  ON lower(c."domain") = facts."domain" AND lower(c."name") = facts."name"
WHERE c."archivedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "outreach_ledger" existing
    WHERE existing."companyId" = c."id"
      AND existing."businessUnitId" = bu."id"
      AND existing."metadata"->>'eventDate' = facts."eventDate"
      AND existing."metadata"->>'source' = 'operator-provided-known-history'
  )
ON CONFLICT DO NOTHING;
