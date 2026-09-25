---
name: crm-ingest-flow
description: Use when working with COMP CRM records, lead ingestion, dedupe, business-unit association, transaction history, or opportunity creation.
---

# COMP CRM Ingest Flow

Use the `comp_crm` MCP server for every live COMP CRM read or write.

## Required order

1. `list_business_units` when the target business-unit key has not already been verified.
2. `search_crm` globally for every candidate.
3. If an existing company/contact matches, call `list_record_business_units`.
4. If the target business unit is missing, call `associate_record_with_business_unit`.
5. Only when no suitable global match exists, call `ingest_leads`.
6. Only after the relationship is correct and the record is qualified, call `create_business_unit_opportunity`.

Never write directly to Neon. Never maintain a spreadsheet, local database, or shadow CRM instead of completing the real CRM operation. Never duplicate or reassign a record merely because another business unit also needs it.

## Live MCP operations

The `comp_crm` MCP server exposes exactly these canonical operations:

- `list_business_units`
- `search_crm`
- `list_record_business_units`
- `associate_record_with_business_unit`
- `ingest_leads`
- `create_business_unit_opportunity`

Treat `data-gear` as the canonical Data-Gear business-unit key.

## Authentication

Authentication is supplied by the MCP connection environment through `COMP_CRM_MCP_CALLER_TOKEN`. Never ask the user to paste that token, the internal `crm_...` API key, a database URL, or Neon credentials into chat. Never embed secrets in plugin files.

If the MCP connection is unavailable or unauthenticated, report the exact connection error. Do not claim a read or write occurred and do not fall back to direct database access.

## Existing record flow

Search using strongest identifiers first: domain, company name, email, phone, and contact name.

For a match:
- inspect current business-unit associations;
- associate the record to the requested unit only if missing;
- preserve original provenance;
- do not duplicate.

## New record flow

For a genuine net-new lead:
- prepare a clean source payload;
- ingest it into the explicit target business unit;
- record what was created, skipped, or rejected;
- create an opportunity only when qualified.

## Completed transactions vs opportunities

Keep verified completed transactions separate from quotes, proposals, and active opportunities. For completed Data-Gear history, preserve evidence notes under `data-gear`. Quotes and proposals belong in opportunities, not completed transaction history.

## Batch result

Report only service-confirmed results:
- target business unit;
- searched count;
- existing records reused;
- associations added;
- new records ingested;
- opportunities created;
- skipped/ambiguous records and why.
