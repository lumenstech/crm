# Lumens API Requirements - Site Operations

> **SUPERSEDED — 2026-09-21.** This document describes a plan in which Buzzy hosts the
> operations dashboard as a production runtime. **That plan is cancelled.** Buzzy and
> the SitePulse template are now a **design reference only**: no Buzzy production
> runtime, no Buzzy-hosted database or application, no Buzzy Functions, no Buzzy API
> dependency, no deployment subscription, and no production dependency on Buzzy
> availability.
>
> The native implementation is draft PR #12. Read instead:
> - `docs/site-operations-architecture.md` — ownership, the native runtime, the
>   SourceRecord decision, and the observation-versus-monitoring-state rule.
> - `docs/site-operations-ux-reference.md` — the SitePulse UX patterns we borrowed.
>
> Specifically, **every statement below is void** where it implies that Buzzy hosts
> the dashboard, projects operational data in production, calls Lumens production
> APIs from a Buzzy Function, needs an `external_identity` row with `provider='buzzy'`,
> or that Buzzy permissions or availability matter to production authorization or
> task status.
>
> This file is kept as research history: the freshness, provenance, idempotency and
> authorization requirements it set out are still the requirements, and they are now
> met natively.

## Status

**Provisional. Not validated by a Buzzy implementation.**

`docs/sitepulse-pilot.md` step 15 asks for this document after the Buzzy pilot shows
what Buzzy actually needs. The Buzzy Builder MCP server is not connected, so that pilot
has not run. See the status block in `docs/sitepulse-builder-mcp-handoff.md`.

Every endpoint below is derived from two sources that do exist:

1. `docs/sitepulse-integration-contract.md`, the agreed read/write contract.
2. The code on branch `feat/lumens-os-gauzy-integration` (PR #10), read on 2026-09-21.

Re-confirm this list against the real Buzzy app before any of it is built. Buzzy may
need fewer endpoints, different field shapes, or a different call style. Delete what the
pilot does not use.

Nothing here is implemented. No production API code was written.

## Prerequisite: the canonical model does not exist

`packages/db/prisma/schema.prisma` has no site, asset, signal or alert model. None of
the reads below have a data source today.

The pilot therefore needs new canonical tables before any endpoint is real:

| Table | Purpose | Canonical ID |
| --- | --- | --- |
| `site` | one operational site | `siteId` |
| `asset` | one generator or battery, owned by a site | `assetId` |
| `signal` | one observation, owned by an asset | `signalId` |
| `alert` | one operator-reviewable condition, owned by a signal | `alertId` |
| `source_health` | last known state per provider per site | provider + site |

These are new Lumens tables, not Buzzy tables. Buzzy projects them and never owns them.

`external_identity` needs no change. `provider='buzzy'` with
`canonical_type` in `site | asset | alert | task` already fits its unique constraints.

## Transport

`docs/api.md` rules the shape: tRPC is the data surface, REST is auth and health only,
and Nest builds a `/rest` bridge from every tRPC procedure at runtime.

So:

- Operator reads and operator commands are tRPC procedures in a `site-ops` router, with
  `@UseMiddlewares(AuthMiddleware)`. Buzzy calls them over the generated `/rest` bridge.
- Machine-to-machine callbacks follow the existing `internal/*` controller pattern with
  a `CRON_SECRET` bearer.

The plain paths in `docs/sitepulse-integration-contract.md` (`GET /ops/sites/:siteId/summary`)
do not match the house rule. The paths below replace them.

## Authentication

| Caller | Mechanism |
| --- | --- |
| Buzzy operator action | Better Auth session, or a scoped `Apikey` row resolved to a user |
| Buzzy read projection | the same identity, read scope only |
| Lumens internal cron | `Authorization: Bearer <CRON_SECRET>` |

**Buzzy never receives `CRON_SECRET`.** That secret is not operator-scoped. It reaches
`LumensOsController`, which is `@AllowAnonymous()` and grants full internal privilege.

Any secret Buzzy does hold lives in Buzzy Constants and is read only by a server-side
Buzzy Function. It never reaches a client-visible field or widget.

## Authorization

Workspace roles today are `owner`, `admin` and `member`. There is no `operator` role and
no `viewer` role.

The pilot needs a third capability, not a fourth role. Add to `packages/auth`:

```
canReviewSiteAlert(role)   -> owner | admin | member
canCommandSiteTask(role)   -> owner | admin
```

`@crm/auth` is the single source, the service enforces it, and the UI uses the same
helper to disable the control. That is the existing rule in `docs/api.md`: the button
and the 403 cannot disagree.

Hiding a Buzzy button is not authorization. Every command below re-checks the role in
the Lumens service.

## Reads

### 1. Site summary

| Field | Value |
| --- | --- |
| Procedure | `siteOps.siteSummary` |
| Method / path | `GET /rest/site-ops/site-summary` |
| Request | `{ siteId: string }` |
| Auth | session or scoped API key |
| Authorization | `canReviewSiteAlert` |
| Idempotency | not applicable, read |
| Canonical IDs | returns `siteId`, `assetId`, `signalId`, `alertId` verbatim |

Response is the shape already agreed in the integration contract: `site`, `assets`,
`signals`, `alerts`.

Failure states:

- `404` unknown `siteId`.
- `403` role fails `canReviewSiteAlert`.
- `200` with `site.status = "unknown"` when every source for the site failed. The
  endpoint must never return `"normal"` because it has no data.

### 2. Asset status

| Field | Value |
| --- | --- |
| Procedure | `siteOps.assetStatus` |
| Method / path | `GET /rest/site-ops/asset-status` |
| Request | `{ assetId: string }` |
| Auth | session or scoped API key |
| Authorization | `canReviewSiteAlert` |
| Canonical IDs | `assetId`, parent `siteId` |

Failure states: `404` unknown asset, `403` role, `200` with `operationalStatus = "unknown"`
when no signal is fresh.

### 3. Latest signals

| Field | Value |
| --- | --- |
| Procedure | `siteOps.latestSignals` |
| Method / path | `GET /rest/site-ops/latest-signals` |
| Request | `{ siteId: string, assetId?: string, metric?: string, limit?: number }` |
| Auth | session or scoped API key |
| Authorization | `canReviewSiteAlert` |

Each row carries every field the pilot requires: `signalId`, `siteId`, `assetId`,
`provider`, `sourceEventId`, `metric`, `value`, `unit`, `observedAt`, `receivedAt`,
`freshness`, `validation`, `evidenceRef`.

**Lumens computes `freshness`, not Buzzy.** The server compares `observedAt` against the
metric's configured threshold at read time and returns `fresh | stale | missing | source_failed`.
Buzzy renders the value it is given. A client that derives freshness from a timestamp
drifts from the server the moment a threshold changes.

`validation` is `accepted | invalid | rejected | unknown`, stored at ingest, never
recomputed at read.

Failure states:

- An expected metric with no row returns an entry with `freshness = "missing"` and a
  null `value`. It must not be omitted, because an omitted row renders as nothing and
  nothing renders as fine.
- A provider whose last poll failed returns `freshness = "source_failed"`.
- A row that failed parsing returns `validation = "invalid"` with the raw payload behind
  `evidenceRef` and a null `value`.

### 4. Alerts

| Field | Value |
| --- | --- |
| Procedure | `siteOps.alerts` |
| Method / path | `GET /rest/site-ops/alerts` |
| Request | `{ siteId: string, state?: "open" \| "acknowledged" \| "closed" }` |
| Auth | session or scoped API key |
| Authorization | `canReviewSiteAlert` |

Each alert carries `alertId`, `siteId`, `assetId`, `signalId`, `provider`, `reason`,
`severity`, `state`, `createdAt`, `acknowledgedAt`, `acknowledgedBy`.

`signalId` is required, not optional. It is the whole provenance chain:
alert -> signal -> asset -> site.

Failure states: `404` unknown site, `403` role.

### 5. Source health

| Field | Value |
| --- | --- |
| Procedure | `siteOps.sourceHealth` |
| Method / path | `GET /rest/site-ops/source-health` |
| Request | `{ siteId: string }` |
| Auth | session or scoped API key |
| Authorization | `canReviewSiteAlert` |

Returns one row per provider: `provider`, `state` (`ok | degraded | failed`),
`lastSuccessAt`, `lastAttemptAt`, `lastError`, `expectedIntervalSeconds`.

This is the endpoint that stops a telemetry outage looking healthy. A provider with no
successful poll inside `expectedIntervalSeconds` is `failed`, and the site summary
reports `unknown` rather than `normal`.

Failure states: the endpoint itself never fails soft. If the health table cannot be read
it returns `500`. Buzzy renders an unreachable health endpoint as unknown, never as ok.

### 6. Downstream task status

| Field | Value |
| --- | --- |
| Procedure | `siteOps.taskStatus` |
| Method / path | `GET /rest/site-ops/task-status` |
| Request | `{ eventId: string }` or `{ commandId: string }` |
| Auth | session or scoped API key |
| Authorization | `canReviewSiteAlert` |

This wraps the existing `lumens_get_operation` read of `lumens_os_event`. It returns
`eventId`, `status`, `attempts`, `lastError`, `processedAt`, plus the resolved downstream
task reference once Gauzy or ServiceFixes returns one.

Lookup by `commandId` is new. `lumens_os_event` stores `idempotency_key`, not
`command_id`, so a `commandId` lookup must reconstruct the key as
`eventType:canonicalType:canonicalId:commandId`. Storing `commandId` as its own indexed
column is the cleaner fix.

Failure states: `404` unknown event, `403` role.

## Commands

### 7. Create service task from alert

| Field | Value |
| --- | --- |
| Procedure | `siteOps.createTaskFromAlert` |
| Method / path | `POST /rest/site-ops/create-task-from-alert` |
| Auth | Better Auth session, or scoped API key bound to a real user |
| Authorization | `canCommandSiteTask`, re-checked in the service |
| Idempotency | `commandId`, enforced by `lumens_os_event.idempotency_key` |

Request:

```json
{
  "commandId": "sitepulse:<alert-id>:create-task:v1",
  "siteId": "<canonical-site-id>",
  "assetId": "<canonical-asset-id>",
  "alertId": "<alert-id>",
  "title": "Inspect generator battery",
  "description": "Battery voltage alert requires field review.",
  "businessUnitId": "<canonical-business-unit-id>",
  "origin": { "provider": "buzzy", "surface": "lumens-site-operations" }
}
```

Response:

```json
{ "accepted": true, "eventId": "<lumens-os-event-id>", "status": "pending", "created": false }
```

`created` tells Buzzy whether this call made the event or matched an existing one. A
replay returns `created: false` with the same `eventId`. Buzzy shows one task either way.

Required Lumens work, in order:

1. Add an `alert` canonical type and a `task.create` operational event type.
   `OPERATIONAL_EVENT_TYPES` has four members today and none of them fit. `task.sync`
   requires an `opportunityId`, which a site alert does not have.
2. Add `task.create` to the mutable set, so `emitOperationalEvent` requires `commandId`.
3. Replace the `findUnique` then `create` pair in `emitOperationalEvent` with an upsert
   or a `P2002` catch. Two concurrent replays of one `commandId` currently race, and the
   loser raises an unhandled Prisma error instead of returning the first `eventId`.
4. Resolve `businessUnitId` from the site server-side. Do not let Buzzy choose it.

Failure states:

- `400` malformed body, or `commandId` that does not match `sitepulse:<alertId>:create-task:v1`.
- `403` role fails `canCommandSiteTask`.
- `404` unknown `alertId`, `siteId` or `assetId`.
- `409` the `alertId` does not belong to the `assetId`, or the asset does not belong to
  the site. Mismatched identity is a rejection, never a silent re-parent.
- `422` the alert is already closed.
- `200` with `created: false` on replay. This is a success, not an error.

### 8. Acknowledge alert

| Field | Value |
| --- | --- |
| Procedure | `siteOps.acknowledgeAlert` |
| Method / path | `POST /rest/site-ops/acknowledge-alert` |
| Request | `{ commandId: string, alertId: string, note?: string }` |
| Auth | Better Auth session, or scoped API key bound to a real user |
| Authorization | `canReviewSiteAlert` |
| Idempotency | `commandId` as `sitepulse:<alert-id>:acknowledge:v1` |

Acknowledgement is a Lumens state change, not a Buzzy one. Buzzy must not hold the
acknowledged flag, because a second surface would then disagree about whether a human
has seen the alert.

Response returns the alert with `state`, `acknowledgedAt` and `acknowledgedBy`.

Failure states: `403` role, `404` unknown alert, `200` unchanged on replay.

## Task status returning to Buzzy

Requirement 11 of the pilot brief is that Buzzy receives task-status updates. Two
options exist.

| Option | Mechanism | Verdict |
| --- | --- | --- |
| Poll | Buzzy calls `siteOps.taskStatus` on an interval | **Use this for the pilot.** No new Lumens surface, no Buzzy credential held by Lumens. |
| Push | Lumens calls the Buzzy REST API when `lumens_os_event.status` changes | Defer. It needs a Buzzy API key stored in Lumens and a new outbound adapter. |

If push is later chosen, it belongs in `apps/agent`, not in the API. `docs/api.md` is
explicit: the API writes an `AgentTask` row and the agent owns the vendor client.

## Not requested and not designed

These stay out until the pilot passes: multi-site rollout, BoilerCam, ServiceFixes
production writes, Gauzy production writes, customer portal, billing, CRM or opportunity
surfaces, AI assistance, autonomous task creation, technician mobile flow, photo upload,
extra equipment types, production secrets.

## Open questions for the Buzzy pilot

1. Can a Buzzy Function set a request header from a Constant, so the operator identity
   reaches Lumens without a client-visible key?
2. Does Buzzy preserve an externally supplied string ID as a record key, or does it
   force its own?
3. Can a Buzzy screen render five distinct signal states, or does it collapse a null
   value into a blank cell?
4. Does a Buzzy role restrict an action server-side, or only hide the control?
5. Can a Datatable Rule read a `409` or `422` response body and show the reason?

Answer these from the real app. Do not assume them.
