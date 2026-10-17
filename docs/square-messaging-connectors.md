# Square customer and messaging connectors

## Scope

Square and customer messaging are separate capabilities.

Square only imports customer and transaction data into CRM.

Messaging uses independent WhatsApp and SMS providers.

## Providers

- Square Customer and Orders APIs: customer ingestion and purchase history.
- Evolution API: WhatsApp transport.
- Android SMS Gateway: SMS transport and fallback.

The CRM owns customer identity, message history, routing state, and suppression state.

## Square flow

1. An owner connects a Square account.
2. CRM stores the Square connection credentials outside customer records.
3. A sync task imports every Square customer.
4. The sync normalizes email and phone values.
5. The sync matches an existing CRM contact before creating a contact.
6. CRM stores the Square customer ID in an external identity row.
7. A second sync imports orders and payments linked to each Square customer.
8. Square webhooks queue sync tasks for later changes.
9. Replayed pages and webhooks stay idempotent.

Square never selects a messaging channel and never sends a customer message.

## Messaging flow

1. An agent selects CRM customers from CRM data.
2. The agent creates message drafts from approved instructions.
3. The system checks the customer messaging identity.
4. The system uses Evolution API when the selected channel is WhatsApp.
5. The system uses Android SMS Gateway when the selected channel is SMS.
6. Provider webhooks write delivery events and inbound replies to one CRM conversation.
7. A failed WhatsApp delivery does not silently send SMS.
8. An automation must explicitly define SMS fallback before the fallback runs.
9. Suppressed contacts never enter a send task.

## Provider boundary

Messaging code uses a provider interface.

Required operations:

- health
- resolve recipient
- send text
- receive message
- receive delivery event

Provider-specific identifiers stay in external identity and message event records.

## Data model

### ExternalConnection

Stores one configured external system.

Required fields:

- id
- provider: square, evolution, android-sms-gateway
- label
- status
- encrypted credential reference
- configuration JSON
- lastHealthyAt
- lastSyncAt
- createdAt
- updatedAt

### ExternalIdentity

Maps a CRM contact to a provider identity.

Required fields:

- id
- contactId
- provider
- externalId
- address
- metadata JSON
- createdAt
- updatedAt

Unique key: provider plus externalId.

### CustomerTransaction

Stores normalized Square customer transaction facts.

Required fields:

- id
- contactId
- provider
- externalId
- type
- amount
- currency
- occurredAt
- metadata JSON

Unique key: provider plus externalId plus type.

### MessageThread

Stores one customer conversation.

Required fields:

- id
- contactId
- channel
- provider
- externalThreadId
- lastMessageAt
- createdAt
- updatedAt

### Message

Stores the normalized message.

Required fields:

- id
- threadId
- direction
- status
- body
- externalId
- sentAt
- receivedAt
- createdAt

### MessageEvent

Stores provider delivery events.

Required fields:

- id
- messageId
- provider
- externalEventId
- type
- payload JSON
- occurredAt

Provider event IDs are unique where the provider supplies them.

### ContactSuppression

Stores explicit channel restrictions.

Required fields:

- id
- contactId
- channel
- reason
- source
- createdAt

Unique key: contactId plus channel.

## CRM connection pages

Settings -> Connections shows three independent capabilities:

- Square
  - Brings in: customers and transaction history.
  - Sends: nothing.
- WhatsApp
  - Provider: Evolution API.
  - Brings in: replies and delivery events.
  - Sends: customer messages.
- SMS
  - Provider: Android SMS Gateway.
  - Brings in: replies and delivery events.
  - Sends: customer messages.

Connection pages configure capability only.

Automations remain in the agent builder.

## Agent actions

The agent action catalogue adds:

- square.customers.sync
- square.transactions.sync
- whatsapp.message.send
- sms.message.send

Each send action receives a resolved CRM contact ID and approved message body.

The provider adapter resolves the external destination.

## Required environment values

All values belong in the root `.env` and `.env.example`.

Square:

- SQUARE_ACCESS_TOKEN
- SQUARE_ENVIRONMENT
- SQUARE_WEBHOOK_SIGNATURE_KEY
- SQUARE_WEBHOOK_NOTIFICATION_URL

Evolution API:

- EVOLUTION_API_URL
- EVOLUTION_API_KEY
- EVOLUTION_INSTANCE
- EVOLUTION_WEBHOOK_SECRET

Android SMS Gateway:

- SMS_GATEWAY_URL
- SMS_GATEWAY_USERNAME
- SMS_GATEWAY_PASSWORD
- SMS_GATEWAY_WEBHOOK_SECRET

Missing provider configuration disables that capability.

## Security

- Parse every provider response and webhook with Zod at the process boundary.
- Verify every supported webhook signature before processing the event.
- Do not log customer message bodies, credentials, headers, or webhook bodies.
- Store provider credentials encrypted or in deployment secrets.
- Use idempotency keys for sends and imports.
- Do not place vendor clients in `apps/api`.
- Vendor clients and provider adapters live in `apps/agent`.
- The API queues durable AgentTask rows.

## Delivery order

1. Add provider-neutral database models and migrations.
2. Add Square customer import adapter and tests.
3. Add Square transaction import and tests.
4. Add Square webhook intake that queues durable tasks.
5. Add Evolution API adapter and tests.
6. Add Android SMS Gateway adapter and tests.
7. Add inbound messaging and delivery-event normalization.
8. Add connection pages.
9. Add agent actions and explicit fallback policy.
10. Run type checks, tests, migrations, and local smoke tests.
11. Open a pull request for review.

## Smoke tests

Square:

- Full customer import.
- Existing contact match by normalized email.
- Existing contact match by normalized phone.
- New contact creation.
- Pagination restart.
- Duplicate webhook replay.
- Transaction import.

WhatsApp:

- Provider health.
- Recipient resolution.
- Send one text.
- Receive one reply.
- Delivery event persistence.
- Restart persistence.

SMS:

- Gateway health.
- Send one text through the Android device.
- Receive one reply.
- Delivery event persistence.
- Restart persistence.

Routing:

- WhatsApp-only action never sends SMS.
- SMS-only action never sends WhatsApp.
- Explicit fallback uses SMS after the configured WhatsApp failure condition.
- Suppression blocks the send before provider execution.
