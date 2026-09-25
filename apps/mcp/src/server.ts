import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CrmClient } from "./crmClient";
import { ingestLeadsInput, searchCrmInput } from "./schemas";

function result(value: unknown) {
	const text = JSON.stringify(value, null, 2);
	return {
		content: [{ type: "text" as const, text }],
		structuredContent:
			value && typeof value === "object" && !Array.isArray(value)
				? (value as Record<string, unknown>)
				: { value },
	};
}

export function createCrmMcpServer(client: CrmClient): McpServer {
	const server = new McpServer({
		name: "comp-crm",
		version: "1.0.0",
	});

	server.registerTool(
		"list_business_units",
		{
			description:
				"List enabled Comp CRM business units. Use this before writing leads.",
			inputSchema: {},
		},
		async () => result(await client.businessUnits()),
	);

	server.registerTool(
		"search_crm",
		{
			description: "Search existing Comp CRM companies, contacts, and deals.",
			inputSchema: searchCrmInput.shape,
		},
		async (input) => result(await client.search(searchCrmInput.parse(input).q)),
	);

	server.registerTool(
		"ingest_leads",
		{
			description:
				"Batch-ingest researched leads into one explicit Comp CRM business unit. Never defaults the business unit.",
			inputSchema: ingestLeadsInput.shape,
		},
		async (input) =>
			result(await client.ingestLeads(ingestLeadsInput.parse(input))),
	);

	return server;
}
