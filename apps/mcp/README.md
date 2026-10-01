# Comp CRM MCP

Remote MCP facade for Comp CRM.

## Tools

- `list_business_units`
- `search_crm`
- `list_record_business_units`
- `associate_record_with_business_unit`
- `ingest_leads`
- `create_business_unit_opportunity`

The required workflow is global search first, reuse and associate existing records, ingest only genuinely new records, then create qualified opportunities after association.

No direct database access is used by the MCP process. The MCP service calls the existing Comp CRM REST API with a dedicated Better Auth API key.

## Runtime

Production is a long-running Bun process bound to loopback:

```text
HOST=127.0.0.1
PORT=3103
COMP_CRM_BASE_URL=http://127.0.0.1:3101
COMP_CRM_API_KEY=crm_...
COMP_CRM_AUTH_BASE_URL=http://127.0.0.1:3101/api/auth
COMP_CRM_AUTH_PUBLIC_URL=https://comp-crm-api.516labs.com/api/auth
COMP_CRM_MCP_PUBLIC_URL=https://comp-crm-mcp.516labs.com/mcp
MCP_CALLER_TOKENS=<optional backward-compatible caller token>
```

`MCP_CALLER_TOKENS` may be a single bare token or a JSON object whose keys are accepted tokens.
OAuth access tokens are validated through Better Auth at `COMP_CRM_AUTH_BASE_URL`; the public URL is used only in protected-resource metadata.

Endpoints:

- `GET /health`
- `GET /ready`
- `POST /mcp`

The MCP endpoint requires `Authorization: Bearer ...`.

## Validation

```sh
bun run check-types
bun run lint
bun test
bun run build
```

Do not give this process `DATABASE_URL`.

Deployment references are under `deploy/`.
