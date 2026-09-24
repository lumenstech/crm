# Buzzy Builder MCP Handoff - Lumens Site Operations

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

## Status - 2026-09-21

**Buzzy Builder MCP is not connected. Pilot steps 2 to 14 are blocked.**

Checks completed:

- The session MCP server list holds `Claude_Code_Remote`, `Claude_Docs`, `Gmail`,
  `Google_Drive`, `Microsoft_365`, `Neon`, `Resend` and `github`. It holds no Buzzy
  server.
- The MCP connector registry returns no Buzzy entry. The closest results are Zapier,
  Base44 and v0. None of them reach Buzzy.
- This repository declares no Buzzy MCP configuration. `.mcp.json` does not exist.
  `.claude/settings.json` declares no MCP server.
- The environment holds no Buzzy variable. `.env.example` declares no Buzzy variable.
- The repository references Buzzy only in the three `docs/sitepulse-*.md` files.

Effect: the agent cannot list Buzzy applications, cannot locate
**SitePulse Operations Dashboard - Native**, and cannot read its artifacts.

Therefore the source template stays untouched and no target app exists. The source
template ID, the target app ID, the editor URL and the artifact/version IDs stay
empty in the record table below.

To unblock: connect the Buzzy Builder MCP server to the session, authenticate it, then
re-run this brief from step 2.

The Lumens-side inspection below needed no Buzzy access. It is complete.

## Starting point

Use the Buzzy template:

**SitePulse Operations Dashboard - Native**

Public template detail:

https://www.buzzy.buzz/templates/sitepulse-operations-native/

Do not modify the source template. Create a separate target app named:

**Lumens Site Operations**

## Repository context

GitHub repository:

`lumenstech/crm`

Relevant draft implementation:

PR #10 - Lumens OS / Gauzy integration

Pilot specification:

`docs/sitepulse-pilot.md`

Integration contract:

`docs/sitepulse-integration-contract.md`

Do not change PR #10 while adapting the Buzzy application.

## Builder MCP instruction

Use this as the execution brief in Claude Code, Codex, Cursor, or another Builder MCP client:

```text
You are adapting an existing Buzzy application for Lumens.

SOURCE
- Inspect "SitePulse Operations Dashboard - Native" as a protected source.
- Do not mutate the source template.
- Create a separate target app named "Lumens Site Operations".

CONTEXT
- GitHub source of truth: lumenstech/crm
- Read docs/sitepulse-pilot.md.
- Read docs/sitepulse-integration-contract.md.
- The existing Lumens OS/Gauzy work is in draft PR #10 and must not be bypassed.
- Comp CRM and Neon remain authoritative for canonical identities and durable Lumens OS events.
- Gauzy/ServiceFixes remain downstream operational execution systems.
- Buzzy is the operator-facing site/signal/alert/task experience.

FIRST OUTPUT - DO NOT EDIT YET
Inspect the SitePulse source and report:
1. existing data entities/tables;
2. screens;
3. roles/permissions;
4. workflows/rules;
5. external integrations;
6. which artifacts contain each item;
7. a KEEP / REMOVE / REPLACE / ADD map against the Lumens pilot;
8. any capability mismatch that would require custom code or a Buzzy Function.

Wait only at artifact-review boundaries required by the Buzzy workflow. Do not broaden scope.

PILOT
Implement exactly:
- one site;
- one generator or battery asset;
- one signal family;
- four freshness conditions: fresh, stale, missing/source-failed, invalid/rejected;
- one alert review path;
- one explicit human action to create a service task;
- one task status/completion path.

DATA RULES
Every operational signal must expose:
- canonical site ID;
- canonical asset ID if applicable;
- provider/source;
- source event ID;
- observed_at;
- received_at;
- metric;
- unit;
- value/state;
- freshness;
- validation state;
- provenance/evidence pointer if available.

Never render missing or failed telemetry as normal/healthy.

READ INTEGRATION
Use a read-only REST projection from Lumens where practical.
Do not connect Buzzy directly to the production database.

WRITE INTEGRATION
Only explicit authenticated operator actions may leave Buzzy.
Send a narrow JSON command to the Lumens operational API through a Buzzy Function or Datatable Rule.
Every command must carry a stable commandId.
Do not create a parallel task/work-order authority in Buzzy.

IDENTITY
If target-app records need persistent Buzzy IDs, preserve canonical Lumens IDs and plan mapping through external_identity with provider=buzzy.

SECURITY
- No API keys in client-visible fields/widgets.
- Use Buzzy Constants / server-side Functions for secrets where required.
- UI visibility is not authorization; Lumens must re-authorize write operations.

SYNTHETIC FIRST
Use representative synthetic pilot data first.
Do not enable production write paths during initial adaptation.

TESTS
Demonstrate:
1. fresh signal;
2. stale signal;
3. missing signal;
4. source failure;
5. invalid/rejected signal;
6. task creation;
7. duplicate create-task command;
8. unauthorized mutation;
9. task completion;
10. site/asset/alert/task linkage after state changes.

ARTIFACT RECORD
When the target is created, write back:
- target Buzzy app ID;
- target editor URL;
- artifact/version identifiers;
- data entity names;
- role names;
- integration rules/functions created;
- unresolved blockers.

Do not add extra modules, dashboards, AI features, CRM functions, billing, customer management, or broad multi-site rollout during this pilot.
```

## Expected first Builder MCP result

Before any adaptation is accepted, the agent should provide a concrete source inspection containing:

| Area | Expected decision |
| --- | --- |
| Site/location entity | Keep structure, replace demo identity |
| Map/site list | Keep |
| Weather/AQ feeds | Remove from decision path; optional context only |
| Operational signal entity | Keep/reshape |
| Freshness | Add/strengthen explicit state |
| Alert entity | Keep/reshape |
| Task entity | Keep UI relation but not canonical authority |
| Demo records | Replace with synthetic Lumens pilot records |
| CRM-like data | Remove |
| Roles | Restrict and map to pilot operator permissions |
| External calls | Replace with Lumens read/command endpoints |
| Integration health | Keep and point at actual source status |

## Lumens-side boundary inspection

Source read: branch `feat/lumens-os-gauzy-integration` (PR #10). No file was changed.

### Canonical data model

`packages/db/prisma/schema.prisma` declares 76 models. It declares **no site, asset,
signal or alert model**. `TelemetryMilestone` and `TelemetryCounter` are product
analytics counters. They are not operational telemetry.

Consequence: every canonical ID in the pilot contract - `site_demo_001`,
`asset_generator_001`, `signal_demo_001`, `alert_demo_001` - has no canonical record
behind it today. `GET /ops/sites/:siteId/summary` has no data source. The pilot needs
a new site/asset/signal/alert model in Lumens before any read projection is real.

### Operational event boundary

`apps/api/src/lumens-os/operational-events.ts` defines the whole write boundary.

| Item | Value |
| --- | --- |
| Event types | `project.sync`, `task.sync`, `task.assign`, `task.schedule` |
| Canonical types in use | `opportunity`, `task` |
| Mutable types needing `commandId` | `task.assign`, `task.schedule` |
| Idempotency key | `eventType:canonicalType:canonicalId:commandId` |
| Uniqueness | `lumens_os_event.idempotency_key` is `@unique` |
| Side effect | one `AgentTask` row of kind `gauzy_operation` per new event |

There is no `alert` canonical type and no `alert.*` or `task.create` event type. The
pilot command `POST /ops/alerts/:alertId/create-task` maps to nothing that exists.
`task.sync` is the nearest event, and it requires an `opportunityId`, which a site
alert does not have.

### Idempotency

Lumens already enforces idempotency server-side. `emitOperationalEvent` builds the key,
reads `lumensOsEvent.findUnique` on it, and returns the existing event ID when found.
The unique index is the real guarantee. Buzzy therefore does not need to guarantee
idempotency. Buzzy needs only to send a stable `commandId`.

One defect applies to any new command path. The read and the create are two statements
inside the transaction, not an upsert. Two concurrent replays of one `commandId` race,
and the loser raises an unhandled Prisma `P2002` instead of returning the first event
ID. A single operator clicking twice is safe enough. A retrying Buzzy Function is not.

### Authorization

Two paths exist, and they are different.

1. `apps/api/src/mcp/mcp.gateway.ts` is the operator-identity path. It requires a
   Better Auth session. It then calls `workspaceRoleOf(userId)` and refuses every
   `lumens_*` tool except `lumens_get_operation` unless the role is `owner` or `admin`.
   This is real server-side authorization.
2. `apps/api/src/lumens-os/lumens-os.controller.ts` is the machine path. It is
   `@AllowAnonymous()` and compares an `Authorization` header against `CRON_SECRET`
   with a timing-safe compare. It carries no user identity and grants full internal
   privilege.

Buzzy must not receive `CRON_SECRET`. That secret is not operator-scoped.

Workspace roles are `owner`, `admin` and `member` (`packages/auth/src/organization.ts`).
There is no `operator` role and no `viewer` role. The pilot's two-role split has no
canonical counterpart. `member` is the only non-admin role, and `member` currently
cannot issue any Lumens OS command.

### Identity mapping

`external_identity` already carries the constraints the contract needs:

- `@@unique([provider, externalType, externalId])`
- `@@unique([canonicalType, canonicalId, provider, externalType])`

A `provider='buzzy'` mapping fits with no schema change.

### Transport rule

`docs/api.md` states: tRPC is the data surface, and REST is auth and health only. Nest
builds a REST bridge under `/rest` from every tRPC procedure at runtime. The plain REST
paths in `docs/sitepulse-integration-contract.md` conflict with that rule.

Correction for the requirements document: operator reads and commands are tRPC
procedures reached through the `/rest` bridge. Only machine-to-machine callbacks follow
the `internal/*` plus `CRON_SECRET` controller pattern.

## Capability gaps

The brief asks for one verdict per requirement: native, requires Buzzy Function,
requires Lumens API, or blocked.

The Buzzy half of every verdict is **UNKNOWN**. It needs the app, and the app is not
reachable. The Lumens half is inspected and stated.

| # | Requirement | Lumens side | Buzzy side | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Preserve canonical Lumens IDs | `external_identity` fits with no schema change | UNKNOWN - does Buzzy accept an external string as a record key? | requires Lumens API |
| 2 | One site with multiple assets | no site or asset model exists | UNKNOWN | requires Lumens API |
| 3 | Signal source timestamps | no signal model exists; `observed_at` and `received_at` must be new columns | UNKNOWN | requires Lumens API |
| 4 | Five states: fresh, stale, missing, source failed, invalid | no freshness or validation field exists; the server must compute freshness at read | UNKNOWN - can a screen render a null value as a named state rather than a blank cell? | requires Lumens API |
| 5 | Trace alert to signal to asset to site | no alert or signal model exists | UNKNOWN | requires Lumens API |
| 6 | Trace task to alert to asset to site | `lumens_os_event` has no `alert` canonical type and no `task.create` event type | UNKNOWN | requires Lumens API |
| 7 | Call an external REST endpoint | the `/rest` tRPC bridge already serves every procedure | UNKNOWN - Buzzy Function or Datatable Rule | requires Buzzy Function |
| 8 | Secure an API secret server-side | Better Auth session or a scoped `Apikey` row; never `CRON_SECRET` | UNKNOWN - can a Function read a Constant into a request header? | requires Buzzy Function |
| 9 | Generate and send an idempotent `commandId` | Lumens enforces it through `lumens_os_event.idempotency_key` | UNKNOWN - can a rule build a deterministic string from the alert ID? | requires Lumens API |
| 10 | Restrict write actions to authorized operators | `workspaceRoleOf` plus new `canCommandSiteTask` in `@crm/auth` | UNKNOWN - is a Buzzy role server-enforced or cosmetic? | requires Lumens API |
| 11 | Receive task-status updates | `lumens_get_operation` already reads event status; poll is enough for the pilot | UNKNOWN | requires Lumens API |
| 12 | Preserve external and canonical mappings | `external_identity` unique constraints already fit | UNKNOWN | native on the Lumens side |

Two stop conditions from the list below are already relevant, and both stay open until
the Buzzy app can be read:

- "permissions are only cosmetic/client-side" - unknown, and it decides whether the
  pilot can ever allow a write.
- "the SitePulse template cannot preserve canonical IDs" - unknown, and it decides
  whether `external_identity` is enough or a mapping table is needed.

## Target app record

Empty until Buzzy Builder MCP is connected.

| Field | Value |
| --- | --- |
| Source template ID | not read - MCP unavailable |
| Target app ID | not created |
| Target editor URL | not created |
| Creation timestamp | not created |
| Initial artifact/version ID | not created |
| Data entity names | not created |
| Role names | not created |
| Integration rules/functions | not created |
| Unresolved blockers | Buzzy Builder MCP is not connected |

## Stop conditions

Stop expansion and report the blocker if any of these are true:

- the SitePulse template cannot preserve canonical IDs;
- task actions cannot be made idempotent;
- permissions are only cosmetic/client-side;
- source freshness cannot be represented reliably;
- external REST integration requires exposing a production secret in client code;
- the target app cannot be separated cleanly from the source template;
- the adaptation would require Buzzy to become the system of record for CRM or operational identity.

## After successful pilot

Only after the pilot passes should the next design consider:

- multi-site rollup;
- asset registry;
- BoilerCam events;
- generator run state;
- pump/HVAC/elevator assets;
- technician evidence and photos;
- ServiceFixes work-order execution;
- Gauzy project/task status;
- escalation rules;
- mobile field workflow;
- customer-facing views.
