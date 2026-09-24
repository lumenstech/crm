# Comp CRM MCP

Private MCP bridge for ChatGPT, Codex, Claude Code, and other MCP clients.

## Security model

The server binds only to `127.0.0.1` and is not intended to be exposed through
the public Cloudflare hostname. ChatGPT should reach it through OpenAI Secure MCP
Tunnel. CRM writes continue to go through the existing authenticated Comp CRM
REST bridge.

Default endpoints:

- MCP: `http://127.0.0.1:3103/mcp`
- Health: `http://127.0.0.1:3103/healthz`
- CRM REST bridge: `http://127.0.0.1:3101/rest`

## Required environment

```text
COMP_CRM_API_KEY=<dedicated Better Auth API key>
COMP_CRM_API_URL=http://127.0.0.1:3101/rest
COMP_CRM_MCP_PORT=3103
```

Generate a dedicated one-year API key for an existing CRM user:

```bash
bun --filter=api mcp:key:create user@example.com
```

The command prints the key once. Store it in the production environment and do
not commit it.

## Tools

- `list_business_units`
- `search_companies`
- `get_company`
- `search_contacts`
- `get_contact`
- `ingest_signal`
- `ingest_signals`
- `list_signals`
- `company_candidates`
- `resolve_signal_company`
- `create_contact`
- `create_contacts`
- `qualify_signal`
- `promote_signal`

The intended lead workflow is:

1. list business units
2. ingest sourced signal(s)
3. review company candidates
4. resolve to an existing company or create after verification
5. create linked contact(s), with exact-email deduplication
6. qualify
7. promote only when the evidence supports an opportunity

## ChatGPT

For ChatGPT Business/Enterprise developer mode, use OpenAI Secure MCP Tunnel so
the MCP service remains private. Configure the tunnel client on the same host:

```text
MCP server URL: http://127.0.0.1:3103/mcp
```

Then create a developer-mode app in ChatGPT using the tunnel connection and scan
the MCP tools.
