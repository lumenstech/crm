# SitePulse Integration Contract

## Purpose

This contract defines the first integration between **Lumens Site Operations** (a Buzzy/SitePulse-derived operator UI) and the existing Lumens operations stack.

It is deliberately narrow. Buzzy is a presentation/workflow surface. It is not a replacement for Comp CRM, Lumens OS, Neon, Gauzy, ServiceFixes, EnergyBMS, or BoilerCam.

## Direction of authority

```text
EnergyBMS / BoilerCam / manual observations
                  |
                  v
        Lumens operational API
                  |
            read projections
                  |
                  v
      Buzzy / Lumens Site Operations
                  |
      explicit human operator action
                  |
                  v
        Lumens operational API
                  |
                  v
       lumens_os_event / AgentTask
                  |
                  v
       Gauzy / ServiceFixes execution
```

## Buzzy integration primitives

Buzzy supports the mechanisms needed for this architecture:

- REST/URL data import for external records.
- Datatable Rules that can send JSON to an external REST endpoint.
- Buzzy Functions for secure server-side calls, webhooks, and integration logic.
- Buzzy REST API for external systems that need to update Buzzy records.
- Buzzy MCP exposure for controlled assistant access.

For the pilot, prefer **read projections + explicit operator commands**. Do not implement broad bidirectional replication.

## Read model

The first read surface should return one or more sites with nested asset and latest-signal summaries.

Conceptual endpoint:

`GET /ops/sites/:siteId/summary`

Example response:

```json
{
  "site": {
    "id": "site_demo_001",
    "name": "Pilot Site",
    "timezone": "America/Guyana",
    "status": "attention"
  },
  "assets": [
    {
      "id": "asset_generator_001",
      "type": "generator",
      "name": "Generator 1",
      "operationalStatus": "attention"
    }
  ],
  "signals": [
    {
      "id": "signal_demo_001",
      "siteId": "site_demo_001",
      "assetId": "asset_generator_001",
      "provider": "energybms",
      "sourceEventId": "energybms_demo_001",
      "metric": "battery_voltage",
      "value": 11.7,
      "unit": "V",
      "observedAt": "2026-09-21T00:00:00Z",
      "receivedAt": "2026-09-21T00:00:10Z",
      "freshness": "fresh",
      "validation": "accepted"
    }
  ],
  "alerts": [
    {
      "id": "alert_demo_001",
      "siteId": "site_demo_001",
      "assetId": "asset_generator_001",
      "signalId": "signal_demo_001",
      "state": "open",
      "severity": "warning",
      "reason": "Battery voltage below configured threshold",
      "createdAt": "2026-09-21T00:00:11Z"
    }
  ]
}
```

## Signal state

Every signal projection must explicitly carry both freshness and validation.

### Freshness

Allowed pilot values:

- `fresh`
- `stale`
- `missing`
- `source_failed`

### Validation

Allowed pilot values:

- `accepted`
- `invalid`
- `rejected`
- `unknown`

Buzzy must never convert missing, failed, invalid, or rejected input into a visually healthy/normal state.

## Operator command model

Buzzy may initiate a command only from an explicit authenticated operator action.

Pilot command:

`POST /ops/alerts/:alertId/create-task`

Example:

```json
{
  "commandId": "sitepulse:alert_demo_001:create-task:v1",
  "siteId": "site_demo_001",
  "assetId": "asset_generator_001",
  "title": "Inspect generator battery",
  "description": "Battery voltage signal requires field review.",
  "businessUnitId": "<canonical-business-unit-id>",
  "origin": {
    "provider": "buzzy",
    "surface": "lumens-site-operations",
    "alertId": "alert_demo_001"
  }
}
```

Expected behavior:

1. Validate authenticated role.
2. Resolve canonical site/asset/alert identity.
3. Reject unknown, stale, malformed, or unauthorized command inputs.
4. Enforce idempotency on `commandId`.
5. Emit the appropriate Lumens OS operational event.
6. Create or reuse the downstream operational task.
7. Return the durable Lumens OS event ID and current status.

Example response:

```json
{
  "accepted": true,
  "eventId": "<lumens-os-event-id>",
  "status": "pending"
}
```

## Identity mapping

If the Buzzy target app creates persistent IDs for projected canonical objects, map them using the existing external identity layer:

```text
provider = buzzy
canonical_type = site | asset | alert | task
canonical_id = <Lumens canonical ID>
external_type = <Buzzy datatable/object type>
external_id = <Buzzy record ID>
```

Do not create a second independent identity namespace and later attempt fuzzy reconciliation.

## Idempotency

All write-capable commands must contain a stable command ID.

For example:

`sitepulse:<alert-id>:create-task:v1`

Replaying the same command must return or resolve to the same logical action and must not create duplicate work.

## Authentication and secrets

- No production Lumens credential belongs in a Buzzy client-side field or code widget.
- If Buzzy must hold an integration secret, store it in Buzzy Constants and use a server-side Buzzy Function or an equivalent secure server-side path.
- Operator write endpoints must authorize the user/action on the Lumens side as well.
- Read-only data import credentials should have read-only scope wherever possible.

## Pilot write restrictions

The first pilot must not allow Buzzy to:

- create or edit CRM companies, contacts, or opportunities;
- alter opportunity stage;
- create arbitrary Gauzy organizations/customers/projects;
- modify `external_identity` directly;
- write telemetry;
- suppress or mark alerts healthy merely because a source is unavailable;
- bypass Lumens OS event/AgentTask orchestration.

## Buzzy implementation preference

For first implementation:

### Reads

Prefer Buzzy REST/URL data import or a Buzzy Function that calls a read-only Lumens endpoint.

### Writes

Prefer a Datatable Rule or Buzzy Function that sends a small validated JSON command to the Lumens operational API.

Do not expose the production database directly to Buzzy.

## Required pilot scenarios

Test all of these with representative synthetic records:

1. Fresh accepted signal.
2. Stale accepted signal.
3. No signal received.
4. Source explicitly failed.
5. Invalid signal payload.
6. Duplicate signal event.
7. Operator creates a task once.
8. Same create-task command is replayed.
9. Unauthorized user attempts task creation.
10. Task status changes after downstream processing.

## Exit criteria

The pilot passes only if:

- source age is visible;
- missing data is distinguishable from a good reading;
- alert provenance is inspectable;
- task origin remains traceable to site + asset + alert;
- duplicate commands do not duplicate work;
- write permission is enforced server-side;
- Buzzy remains replaceable as a UI/runtime without changing the canonical Lumens data model.
