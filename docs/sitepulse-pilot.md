# SitePulse Pilot: Lumens Site Operations

## Goal

Evaluate **SitePulse Operations Dashboard - Native** as the operator-facing site/asset operations console for Lumens, without creating a second system of record.

The Buzzy source template must remain protected. Build a separate target app tentatively named **Lumens Site Operations**.

## Confirmed current boundary

Existing work in draft PR #10 already defines the Comp CRM -> Lumens OS -> Gauzy operational boundary.

Authoritative records stay in the Lumens stack:

- Comp CRM: companies, people, opportunities, business units, source evidence, AgentTask
- Neon / Lumens OS: durable events and external identity mappings
- Gauzy: downstream operational/ERP execution
- Buzzy/SitePulse: operator-facing site/signal/alert/task view only unless a later decision explicitly changes ownership

Existing production Neon primitives:

- `lumens_os_event`
- `external_identity`
- `gauzy_promotion`

Existing feature-branch Lumens OS operational events:

- `project.sync`
- `task.sync`
- `task.assign`
- `task.schedule`

Existing MCP operations:

- `lumens_sync_project`
- `lumens_sync_task`
- `lumens_assign_task`
- `lumens_schedule_task`
- `lumens_get_operation`

## SitePulse keep / remove / replace / add map

### Keep from SitePulse

- site map / site list
- site status
- signal cards with source + unit + observed timestamp
- alert review workflow
- task assignment / completion UX
- integration/source health
- explicit fresh / stale / missing-source states

### Remove from first pilot

- generic demo organization records
- demo-only weather/air-quality decision logic
- broad multi-site rollout
- autonomous task creation from unvalidated external signals
- any duplicate customer/opportunity CRM functionality

### Replace

- SitePulse demo site IDs -> Lumens canonical site IDs
- generic signals -> EnergyBMS / BoilerCam / manually entered operational observations
- demo response tasks -> Lumens OS task commands / ServiceFixes execution path
- template integration status -> actual source health/freshness state

### Add later, only after pilot

- asset registry
- alarm policy/rule metadata
- operator acknowledgement
- evidence/photos/readings
- technician/service completion
- Gauzy/ServiceFixes work-order references
- site/asset history timeline

## Pilot scope

Exactly one site, one asset, one signal family, one alert path, and one response task.

Suggested first slice:

1. Site
2. Generator or battery asset
3. EnergyBMS voltage/state signal
4. Fresh / stale / source-failed evaluation
5. Human reviews alert
6. Human creates/assigns a service task
7. Task crosses Lumens OS boundary
8. Completion/evidence returns to the site timeline

Do not infer that missing telemetry means normal.

## Data ownership for pilot

Buzzy may cache/project data for display, but must not become authoritative for:

- customer/company identity
- opportunity identity
- business unit identity
- Lumens OS event identity
- Gauzy identity mappings
- final work-order/task state if that state is owned by Gauzy/ServiceFixes

Use `external_identity` for Buzzy mappings if persistent Buzzy record IDs must be associated with canonical records:

`(provider='buzzy', canonical_type, canonical_id, external_type) -> external_id`

## Required source fields

Every imported operational signal shown to an operator must expose or carry:

- canonical site ID
- canonical asset ID when applicable
- source/provider
- source record/event ID
- observed_at
- received_at
- unit
- value/state
- freshness state
- validation state
- provenance/evidence pointer where available

## Freshness states

At minimum:

- fresh
- stale
- missing/source-failed
- invalid/rejected

No-data must never silently render as healthy/normal.

## Builder MCP execution

Using Buzzy Builder MCP:

1. Inspect **SitePulse Operations Dashboard - Native** as a protected source.
2. Create a separate target app: **Lumens Site Operations**.
3. Do not mutate the source template.
4. Produce the keep/remove/replace/add diff before changing artifacts.
5. Implement the one-site pilot only.
6. Use representative synthetic data first.
7. Do not connect production write paths until review.
8. Verify role permissions and the four freshness cases.
9. Record target Buzzy app ID and artifact/version references in this document or the PR.

## Acceptance checks

- Fresh signal is visibly fresh and timestamped.
- Stale signal is not displayed as current.
- Source failure is distinct from a normal reading.
- Missing signal is distinct from healthy.
- Alert remains tied to the correct site and asset.
- Task remains tied to the originating alert/site.
- Replaying the same event does not duplicate the logical task.
- Only an authorized operator can issue a task mutation.
- Buzzy does not become a parallel CRM.
- No production Neon schema mutation is required for the first UI pilot.
- Existing draft PR #10 remains intact and is not bypassed.

## Decision gate after pilot

Proceed only if SitePulse materially reduces UI/runtime ownership while preserving Lumens OS boundaries and giving us a better site-centric operator experience than building the same interface directly in the CRM.
