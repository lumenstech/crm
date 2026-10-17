# Evaboot export preview

Evaboot is the selected LinkedIn acquisition provider for the US portfolio.
This adapter reads existing exports and prepares contact candidates for review.
It does not launch exports, spend credits, write CRM records, or send messages.

## Setup

1. Connect a Sales Navigator seat through Evaboot's extension.
2. Configure `EVABOOT_API_KEY` in the agent server environment or the root `.env`.
3. Run the quota command.
4. Preview a completed lead extraction with its extraction ID.

Keep API keys out of chat, source control, and browser code.
The key comes from Evaboot Dashboard → Integrations → API.
The integration is optional. An absent key returns `configured: false` without network requests.
This operator command does not advertise an automatic agent capability.

```sh
bun run --filter=agent evaboot quota
bun run --filter=agent evaboot plan --profiles 100 --max-credits 200
bun run --filter=agent evaboot preview ext-12345 --output /private/evaboot-preview.json
```

The output directory must exist. The command refuses to overwrite an existing file.
It creates the candidate file with owner-only read/write permissions on Unix.
Standard output contains counts and job state, not prospect data or credentials.
The preview defaults to 1,000 records. It reports `hasMore` and `nextStart` for larger exports.

```sh
bun run --filter=agent evaboot preview ext-12345 --start 1000 --max-records 1000 --output /private/evaboot-page-2.json
```

`plan` estimates a bounded profile batch with email finding.
It checks two credits per profile against the supplied cap and the provider balance.
It checks the largest valid account's remaining quota, not the sum across accounts.
This is a snapshot check. It reserves no credits and submits no job.
Concurrent jobs require a durable credit reservation ledger before paid launches.

## Provider contract

The adapter uses authenticated GET requests to a fixed Evaboot host.
Redirects fail. Responses have a size limit and a timeout.
Failures expose local error codes. Provider response bodies do not reach logs.
The caller receives `Retry-After` information. The adapter does not retry automatically.

| Operation | Contract |
| --- | --- |
| Quota | `GET /v1/quota/` returns `quota.credits` and per-account `salesnavs` limits. |
| Extraction creation | The detailed reference returns `extraction_id`, not the marketing page's `job_id` example. Creation is not implemented. |
| Extraction read | `GET /v1/extractions/{id}/?start=0&limit=100` |
| Pending | HTTP 202 and `ACCEPTED`, `SCHEDULED`, or `EXECUTING` |
| Successful | HTTP 200 and `EXECUTED`, with consistent pagination metadata |
| Incomplete | HTTP 200 also supports `PAUSED` and `FAILED`. These produce no candidate file. |
| Pagination | Advance by `returned_count`. Reject mismatched IDs, offsets, counts, and stalled cursors. |

The detailed API defines `matching` as leads matching search filters.
It does not mean that the email domain matches the employer.
Search-URL exports have no documented record-limit parameter.
Their final size and charge are unknown at submission.
This adapter therefore has no paid search-launch operation.

Sources checked September 16, 2026:

- [Extraction reference](https://docs.evaboot.com/api/linkedin-extraction)
- [Quota reference](https://docs.evaboot.com/api/account)
- [Response schemas](https://docs.evaboot.com/api/~schemas)
- [Troubleshooting](https://docs.evaboot.com/troubleshooting)

## Candidate handling

The boundary parser accepts explicit documented identity, employment, and email columns.
It drops unknown columns. New columns require an explicit reviewed mapping.
Names remain unsplit. The adapter creates no guessed public profile URLs.
`sourceRecordId` identifies an extraction row. It is not a global person identity.

The preview preserves raw email status. Only `safe` receives the provider-safe assessment.
That assessment does not prove employment, email ownership, freshness, or contactability.
Known personal domains and common shared mailboxes have their addresses removed from candidate output.
These lists are screening heuristics. They are not a complete work-email classifier.

Every candidate has `promotion: review_required`.
The retrieval timestamp is not an email verification timestamp.
The preview does not check the CRM suppression tables.
It does not assign products or business units automatically.

## Production work still required

1. Capture a live account response and confirm column mappings.
2. Resolve person identity, current employer, and business-email ownership.
3. Store verification evidence and freshness in a typed model.
4. Add explicit product and business-unit associations.
5. Preserve suppression in automated contact promotion.
6. Fix source-record upserts that replace business-unit associations.
7. Add durable task checkpoints and atomic credit reservations for paid operations.
8. Validate migrations on an isolated Neon branch before production use.

The existing manual contact-create path clears suppression through `allowAgain()`.
This adapter never calls that path.
The inspected `release` source-record key spans business units.
This adapter never writes source records.

## Tests

```sh
CRM_TELEMETRY_DISABLED=1 bun test apps/agent/test/evaboot.spec.ts
```

The tests use synthetic records and mocked HTTP responses.
They cover pagination, job states, malformed responses, credential isolation, candidate screening, and quota planning.
They do not call Evaboot or connect to Neon.
