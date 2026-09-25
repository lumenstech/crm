# COMP CRM live service map

The MCP server at `https://comp-crm-mcp.516labs.com/mcp` is the preferred execution channel.

The MCP service itself calls the authenticated COMP CRM REST service layer; it does not write directly to Neon.

Canonical tool mapping:

- `list_business_units` -> `GET /rest/business-units`
- `search_crm` -> `GET /rest/search?q=<query>`
- `list_record_business_units` -> `GET /rest/business-units/associations`
- `associate_record_with_business_unit` -> `POST /rest/business-units/associations`
- `ingest_leads` -> `POST /rest/ingest/signals/batch`
- `create_business_unit_opportunity` -> `POST /rest/business-units/opportunities`

Do not bypass the MCP/REST service layer. Do not embed credentials in plugin files.
