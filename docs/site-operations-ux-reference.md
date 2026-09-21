# Site Operations UX Reference

## What this document is

Lumens Site Operations is a native product on the Lumens stack. This file records the
operator-interface patterns we borrow **conceptually** from the SitePulse Operations
Dashboard, and the reasoning behind each one.

It is design provenance. It is not an integration plan.

## Source and access

Reference: **SitePulse Operations Dashboard - Native**, a Buzzy template.

Public detail page: https://www.buzzy.buzz/templates/sitepulse-operations-native/

Buzzy Builder MCP is not connected to this workspace, so the template artifacts were
never read. Everything below comes from the research already in this repository -
`docs/sitepulse-pilot.md`, `docs/sitepulse-integration-contract.md` and
`docs/sitepulse-builder-mcp-handoff.md` - and from general operations-console practice.

No proprietary source code, data model, layout file or implementation detail is copied
here. The patterns below are ideas about operator behaviour, not artifacts.

## Buzzy is a reference only

Buzzy hosts nothing. It runs no code, holds no data and gates no request in this
product. See `docs/site-operations-architecture.md`.

## Patterns we adopt

### 1. Location is the spine

An operator reasons **site -> equipment -> problem**. They do not reason about event
IDs or table rows.

So the navigation is Overview, Sites, Alerts, Sources, and the site detail screen is the
main working surface. An alert is always shown attached to its asset and its site, never
as a free-floating row.

### 2. A value without an age is incomplete

Every reading is rendered as three facts together: the value, how old it is, and whether
its source is healthy. A voltage of 11.7 V means nothing until you know it arrived four
minutes ago rather than four days ago.

The UI never shows a number on its own.

### 3. No data is not good news

A site with no telemetry is **unknown**, never **normal**. Absence of a reading and
absence of a problem look completely different.

This is the rule that decides the colour of a card. A missing or failed source removes
the healthy state instead of leaving it in place.

### 4. Five states, not two

Operators need to act differently on each of these, so the UI separates them:

| State | What it means | What the operator does |
| --- | --- | --- |
| `fresh` | recent accepted reading | read the value |
| `stale` | accepted reading, older than the policy allows | distrust the value, check the source |
| `missing` | a policy expects readings, none arrived in the window | chase the equipment or the link |
| `source_failed` | the integration itself reports failure | fix the integration, not the asset |
| `invalid` | a reading arrived and failed validation | inspect the payload, suspect the sensor |

`stale` and `missing` are different problems. `missing` and `source_failed` are different
problems. Collapsing them into one "no data" badge hides which system to go and fix.

### 5. An alert must explain itself

From an alert alone, an operator can answer: which site, which asset, which observation,
which provider, when, and why the threshold fired. The alert stores those links, so the
explanation survives after the reading scrolls out of the recent window.

### 6. A human decides before a truck moves

Detection is automatic. Dispatch is not.

The pilot creates alerts from readings without asking. It never creates a service task
on its own. An operator reviews the alert and presses the button, because a false alert
that costs an engineer a morning is expensive and a false alert that costs a badge in a
list is not.

### 7. Integration health is its own screen

Source health is tracked separately from readings and gets its own place in the
navigation. It answers "is the pipe working" independently of "what came down the pipe".
Without it, a dead integration is indistinguishable from quiet equipment.

### 8. Status names describe conditions

Avoid `good`, `bad` and `warning`. Prefer names tied to an actual condition:
`normal`, `attention`, `critical`, `unknown` for operational status, and the five signal
states above. A named condition tells the operator what is true; a colour word only tells
them how to feel.

### 9. Thresholds are configuration, not code

What counts as stale, and what counts as a low battery, is per asset and per metric. It
lives in a monitoring policy row an operator can read on screen. It is never a constant
compiled into a component.

### 10. The overview earns its space

The overview shows what changes the operator's next action: sites needing attention,
active alerts, failed and stale sources, open service tasks. It does not show decorative
totals.

## Patterns we deliberately reject

| Rejected | Why |
| --- | --- |
| A map as the primary navigation | One pilot site. A map costs a dependency and shows nothing a list does not. Revisit at fleet scale. |
| Weather and air-quality context feeds | They are not in the decision path for battery voltage, and they invite treating a third-party outage as an equipment fault. |
| CRM-shaped screens inside operations | Companies, contacts and opportunities already have a home. Duplicating them creates two answers to one question. |
| Autonomous task creation | See pattern 6. |
| Rich charting | A short reading history as a table answers the pilot's questions. Charts come once there is a fleet to compare. |
| A single "health" score per site | It averages away the one failing asset, which is the only thing the operator needed to see. |

## Where these rules are enforced

| Rule | Enforced in |
| --- | --- |
| Five states, derived server-side | `apps/api/src/site-ops/monitoring.ts` |
| No data is not normal | `deriveSignalState`, `siteStatusFrom` |
| Value plus age plus source | `signal-state-badge.tsx`, `asset-card.tsx` |
| Alert provenance | `SiteAlert` columns, immutable after insert |
| Human before dispatch | `siteOps.createTaskFromAlert` needs an operator capability |
| Thresholds as data | `SiteMonitoringPolicy` |
