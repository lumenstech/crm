# Lumens OS / Gauzy integration

This branch implements the operational boundary between Comp CRM and Gauzy.

## Ownership boundaries

- Comp CRM remains the system of record for intelligence, prospects, canonical companies, people, opportunities, business units, source evidence, and AgentTask.
- Gauzy is the downstream operations/ERP system. Prospects are never bulk-synchronized to Gauzy.
- Square is customer ingestion only and remains outside this integration.
- SequenceNow owns customer communications (WhatsApp/SMS) and remains outside this integration.
- Gauzy is accessed only through a REST adapter. Comp CRM must not import Gauzy internals.

## First promotion flow

```text
canonical opportunity -> WON
  -> opportunity.won
  -> lumens_os_event
  -> AgentTask (gauzy_promotion)
  -> GauzyAdapter
  -> organization/customer/contact/project
  -> external_identity mappings
  -> gauzy_promotion result
```

## opportunity.won v1

The event payload is ID-oriented so canonical records remain authoritative:

```ts
type OpportunityWonV1 = {
  eventType: "opportunity.won";
  version: 1;
  opportunityId: string;
  companyId: string;
  contactIds: string[];
  businessUnitId: string;
  provenanceIds: string[];
};
```

Emission must occur only on a transition into the configured WON stage. Re-saving an already-won opportunity must not enqueue another promotion.

## Idempotency

`external_identity` is the universal mapping layer. A promotion must resolve mappings before every Gauzy create. The same event may be processed repeatedly without creating duplicate Gauzy customers, contacts, or projects. Partial failures must be resumable.

Recommended identity tuple:

```text
(provider, canonical_type, canonical_id, external_type) -> external_id
```

For Gauzy the expected mappings are:

- canonical company -> Gauzy customer
- canonical person -> Gauzy contact
- canonical opportunity -> Gauzy project

## Durable processing

AgentTask remains the retry backbone. A new `gauzy_promotion` task references the Lumens OS event ID. Transient failures remain retryable; validation/permanent failures are persisted with the error/evidence. Successful tasks record the promotion result.

## Database reconciliation

Production Neon already contains:

- `lumens_os_event`
- `external_identity`
- `gauzy_promotion`

Before adding Prisma models/migrations, introspect those exact production definitions and reproduce them in the repository schema. Do **not** run a generated migration against production merely to make Prisma match. Development/testing must use a Neon development branch.

The existing canonical models are `CanonicalCompany`, `CanonicalPerson`, `CanonicalOpportunity`, `SourceRecord`, `BusinessUnit`, and `AgentTask`.

## GauzyAdapter contract

The adapter should expose operations at the Comp boundary, not Gauzy internals:

```ts
interface GauzyAdapter {
  findOrCreateOrganization(input: OrganizationInput): Promise<ExternalEntity>;
  findOrCreateCustomer(input: CustomerInput): Promise<ExternalEntity>;
  findOrCreateContact(input: ContactInput): Promise<ExternalEntity>;
  findOrCreateProject(input: ProjectInput): Promise<ExternalEntity>;
}
```

Credentials, endpoint paths, Gauzy DTOs, authentication, retries, and response normalization belong inside the adapter.

## Required tests

1. Transition an opportunity into WON and create exactly one event.
2. Re-save the won opportunity and create no second logical promotion.
3. Promote a company/contact/opportunity and persist all external identities.
4. Replay the event and verify zero duplicate Gauzy entities.
5. Fail after customer creation, retry, reuse the customer mapping, and finish contacts/project.
6. Simulate transient Gauzy failure and verify AgentTask remains retryable.
7. Simulate permanent validation failure and verify the failure is persisted.
8. Verify no Square or SequenceNow behavior is invoked by Gauzy promotion.

## Deployment

No production deployment or production migration from this feature branch. After tests and review: open PR to `release`, approve/merge, monitor the existing Cloudflare GitHub/Workers Build, then verify production in a fresh browser. Never use remote Wrangler OAuth/device-code login.
