# Lumens Site Operations Architecture

## Product

**Lumens Site Operations** is a native operational dashboard for physical sites and
equipment. It runs entirely on the existing Lumens stack: Neon, the Nest API, tRPC, the
Next.js app, and the Lumens OS event boundary.

## Runtime shape

```text
EnergyBMS / BoilerCam / equipment integrations
                    |
                    v
             Lumens ingestion
                    |
                    v
              Neon / Lumens OS
                    |
        +-----------+-----------+
        |                       |
        v                       v
Cloudflare Workers/API    Lumens Site Operations
                                Web UI
        |                       |
        +-----------+-----------+
                    |
                    v
          Lumens OS event boundary
                    |
          +---------+---------+
          |                   |
          v                   v
        Gauzy             ServiceFixes
```

## Buzzy is not in this picture

Buzzy and the SitePulse template are a **design reference only**. See
`docs/site-operations-ux-reference.md`.

There is no Buzzy production runtime, no Buzzy-hosted database, no Buzzy-hosted
application, no Buzzy Function, no Buzzy API dependency, no Buzzy deployment
subscription, and no production dependency on Buzzy availability. Nothing in the product
degrades if Buzzy disappears, because nothing in the product calls it.

`docs/sitepulse-pilot.md`, `docs/sitepulse-integration-contract.md`,
`docs/sitepulse-builder-mcp-handoff.md` and `docs/sitepulse-lumens-api-requirements.md`
describe the superseded Buzzy-hosted plan. They are kept as research history and marked
superseded at the top of each file.

## Ownership

Every concept has exactly one authority. A second writer is how two systems come to
disagree about the same fact.

| Domain concept | Authority | Table |
| --- | --- | --- |
| Company / customer | existing CRM canonical model | `canonical_company` |
| Site | Lumens Site Operations | `site_ops_site` |
| Asset / equipment | Lumens Site Operations | `site_ops_asset` |
| Raw equipment telemetry | the originating equipment service | not stored here |
| Normalized operational observation | Lumens Site Operations | `site_ops_observation` |
| Monitoring expectation | Lumens Site Operations | `site_ops_monitoring_policy` |
| Source health | Lumens Site Operations | `site_ops_source_health` |
| Alert | Lumens Site Operations | `site_ops_alert` |
| Alert acknowledgement | Lumens Site Operations | `site_ops_alert` columns |
| Operational command / event | Lumens OS | `lumens_os_event` |
| Service task | Lumens OS, executed by Gauzy / ServiceFixes | `lumens_os_event` + `AgentTask` |
| Commercial opportunity | existing CRM | `canonical_opportunity` |
| External identity mapping | existing layer | `external_identity` |

Two consequences follow.

**Site Operations never writes a CRM record.** A site may reference a
`canonical_company`, and that is the whole relationship. Site Operations does not create
companies, does not touch opportunity stage, and does not enrich anything.

**Site Operations never executes a service task.** It emits a Lumens OS event and stops.
Gauzy and ServiceFixes own execution, exactly as in PR #10.

### The CRM must not become a telemetry database

The volume risk is real, and it is contained by three rules:

1. Observations live in their own table, `site_ops_observation`, with their own indexes
   and their own retention story. They are never mixed into `source_record`. They dedupe
   on `(provider, assetId, sourceEventId)`, not on `(provider, sourceEventId)`: a
   provider's event number is only unique per device unless its contract says otherwise,
   and two generators may legally emit the same local sequence number.
2. Nothing in the CRM reads `site_ops_observation`. No scanner, no inbox, no agent task.
3. Site Operations is a leaf. CRM tables have no foreign key pointing into it, so the
   operational domain can later move to its own database or its own Neon project without
   a CRM migration.

## SourceRecord audit

The brief asked whether operational telemetry can reuse `SourceRecord`. It was audited
on branch `feat/lumens-os-gauzy-integration`. Every consumer lives in
`apps/api/src/ingest`.

| # | Question | Answer |
| --- | --- | --- |
| 1 | Does inserting a SourceRecord trigger commercial scoring? | **No.** `IngestService.signal` is a bare upsert. `SignalQualificationService.qualify` is a separate procedure taking an explicit `sourceRecordId`. |
| 2 | Does it trigger company / person / opportunity matching? | **No** at insert. `companyCandidates` and `resolveCompany` are explicit calls. |
| 3 | Does it create AgentTasks? | **No.** `apps/api/src/ingest` contains no AgentTask write. |
| 4 | Does it feed outreach or research? | **Not automatically.** `promote` is explicit and creates a Deal through `DealsService`. |
| 5 | Do scanners assume every SourceRecord is commercial intelligence? | **Yes.** `IngestService.inbox` selects from `source_record` with **no `sourceType` filter**, joins `business_unit`, derives `signal_score` from the payload, tests `record_mapping` for `canonicalType='company'`, and orders by score. The Intelligence Inbox renders every row it returns. |
| 6 | Can operational records be partitioned by `sourceType`? | **Only by changing commercial code.** `inbox` filters on `project` and `minScore` and nothing else. Adding an operational carve-out means editing the commercial query and every caller, which couples two domains that should not know about each other. |
| 7 | Would telemetry volume make it unsuitable? | **Yes.** `payload` is an unbounded `Json`. `inbox` sorts on a jsonb expression with no supporting index, so it scans. The indexes are `(sourceSystem, sourceType, sourceId)` and `(businessUnitId, sourceType)`; neither serves "latest reading for this asset and metric", which is the only read Site Operations makes. |

### Decision

**Do not use `SourceRecord` for operational telemetry.** Site Operations gets
`site_ops_observation`, a dedicated table with `(provider, sourceEventId)` uniqueness and
a `(assetId, metric, observedAt DESC)` index.

`SourceRecord` remains available for **low-volume evidence and provenance**, for example
a document or an inspection report attached to an alert. That path is not built in the
pilot. If it is built later, it must carry a `sourceType` that the commercial inbox
excludes, and excluding it is a change to `IngestService.inbox` that must be made
deliberately.

## Observation state versus monitoring state

This is the most important rule in the domain, and getting it wrong is what makes an
outage look healthy.

### Do not manufacture telemetry

There is no observation row with `value = null, freshness = "missing"`. A row in
`site_ops_observation` means **a reading was received**. Nothing else may create one.

Writing a fake row to represent absence has three costs: it corrupts the history an
operator reads, it makes "how many readings did we get" unanswerable, and it makes the
absence itself look like evidence.

### Two different facts

| Fact | Table | Meaning |
| --- | --- | --- |
| Observation | `site_ops_observation` | what was actually received |
| Monitoring expectation | `site_ops_monitoring_policy` | what should have been received |
| Source health | `site_ops_source_health` | whether the integration is working |

`missing` is the absence of the first where the second says there should be one. It is a
computed conclusion, not a stored row.

### How the five states are derived

`deriveSignalState` in `apps/api/src/site-ops/monitoring.ts` is the only place this
happens. It runs at read time, in this order:

```text
policy disabled or absent          -> not_configured
source health status = failed      -> source_failed
latest observation invalid/rejected -> invalid
no accepted observation at all      -> missing
now - observedAt > staleAfterSeconds -> stale
otherwise                           -> fresh
```

Order matters. A failed source outranks a stale reading, because the operator must fix
the integration before the reading age means anything. `not_configured` is separate from
`missing`: "we never asked for this metric" is not the same problem as "we asked and
nothing came".

### Why the server derives it

The client never computes freshness from a timestamp. Freshness depends on the policy,
and the policy changes. A client that derives it drifts from the server the moment an
operator edits a threshold, and then two screens disagree about whether a site is in
trouble.

## Alert lifecycle

### Only proof moves an alert

`evaluateThresholds` returns `null` when a reading cannot prove anything, and an array
of per-direction verdicts when it can. Only a **fresh, accepted, numeric** reading
proves anything.

| Signal state | What happens to threshold alerts |
| --- | --- |
| `fresh` + breach | open a new alert, unless one is already active |
| `fresh` + inside the band | close the active alert for that direction |
| `stale` | nothing changes |
| `missing` | nothing changes |
| `source_failed` | nothing changes |
| `invalid` | nothing changes |
| `not_configured` | nothing changes |

Losing telemetry is not recovery. A low-voltage alert whose sensor then goes offline
stays open, and the site separately reports `source_failed` so the operator can see both
facts. Treating "no reading" as "condition cleared" is how a dead sensor silently closes
a live fault.

Each direction is judged separately, so a fresh reading that swings from above the
maximum to below the minimum closes the `max` alert - that condition is provably over -
and opens a `min` alert. Contradictory alerts cannot both stay open.

### One active alert, many historical ones

Two keys carry the rules:

| Column | Meaning | Uniqueness |
| --- | --- | --- |
| `activeKey` | `threshold:<assetId>:<metric>:<kind>` while the alert is open or acknowledged, `NULL` once closed | unique, so one live alert per condition |
| `occurrenceKey` | `threshold:<assetId>:<metric>:<kind>:<observationId>` | unique, so one alert per breach episode |

Because `activeKey` is nullable and Postgres treats NULLs as distinct, a single unique
index gives both rules at once: exactly one active alert per condition, and any number
of closed ones behind it.

**A closed alert is never reopened.** A later breach of the same condition is a new row.
The earlier row keeps its `observationId`, `observedValue`, `thresholdValue`, `reason`,
`openedAt`, `acknowledgedAt` and `acknowledgedBy` exactly as they were, so a six-month-old
incident still explains itself even after the policy is retuned. A new occurrence starts
with empty acknowledgement fields and empty metadata, so one incident's review note can
never appear on another.

Only the review columns of a live alert change: `state`, `acknowledgedAt`,
`acknowledgedBy`, `closedAt`, `activeKey`, `lumensOsEventId`.

## Command boundary

An operator action leaves Site Operations as a Lumens OS event and nothing else.

```text
alert opens automatically
  -> operator reviews it
  -> operator acknowledges                 (siteOps.acknowledgeAlert)
  -> operator requests a service task      (siteOps.createTaskFromAlert)
  -> capability checked server-side
  -> alert must already be acknowledged    (open and closed are both rejected)
  -> resolve site, asset, business unit    (from the alert, never from the client)
  -> emitOperationalEvent task.create      (idempotent on commandId)
  -> lumens_os_event row, durable and pending
```

**Acknowledgement is a gate, not a formality.** `createTaskFromAlert` rejects an alert
that is `open` and one that is `closed`. Only `acknowledged` proceeds. A hidden button is
not authorization, so the rule lives in the service.

### Nothing executes a site service task yet

`task.create` has no Gauzy or ServiceFixes executor. The event is written durably and
deduplicated, and **no `gauzy_operation` AgentTask is queued for it**, because nothing
downstream can run it. `GauzyOperationService` refuses the type outright rather than
falling through to a wrong handler.

The UI says what is true: a task is **requested**, and its Lumens OS event is pending.
It never says dispatched, assigned or created downstream, because no technician has been
sent. Faking downstream success is worse than showing a queue.

The client sends `alertId`, `commandId`, `title` and `description`. It does not choose
the business unit, the canonical IDs, the alert parent or the destination. Those are
resolved server-side from the alert, because a client that can name its own business
unit can write into any business unit.

## Identity

Canonical IDs are Lumens IDs. There is no second namespace.

`external_identity` stays available for mapping a downstream system's ID onto a Lumens
canonical ID, for example a ServiceFixes work-order reference. `provider='buzzy'` is not
used and is not needed, because Buzzy holds no records.

## Equipment categories

`SITE_ASSET_TYPES` in `packages/validation/src/site-operations.ts` is designed to grow
to: generators, batteries and UPS, electrical panels, pumps, HVAC, boilers, water
heaters, elevators and lifts, sensors, network equipment, and GPU or server
infrastructure.

The pilot implements `generator` and `battery` only. The rest are declared in the type so
the domain shape is settled, and each one arrives with its own metrics and policies when
it is actually needed. Adding a category is a value in a list plus its monitoring
policies. It is not a schema change.

## Out of scope for the pilot

Multi-site rollout, BoilerCam, EnergyBMS production credentials, Gauzy production
writes, ServiceFixes production writes, elevators, HVAC, pumps, customer portal,
billing, AI diagnosis, autonomous dispatch, technician mobile, equipment financing,
predictive maintenance, multi-tenant customer access, maps, push notifications, SMS and
WhatsApp.

The domain is shaped so each of these is additive.
