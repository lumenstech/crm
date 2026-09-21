# Buzzy Builder MCP Handoff - Lumens Site Operations

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
