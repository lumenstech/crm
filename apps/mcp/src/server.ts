import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CrmClient } from "./crmClient";
import {
	associateRecordWithBusinessUnitInput,
	createBusinessUnitOpportunityInput,
	ingestLeadsInput,
	listRecordBusinessUnitsInput,
	searchCrmInput,
} from "./schemas";

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
		version: "1.1.0",
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
			description:
				"Search Comp CRM globally across existing companies, contacts, and deals before any ingest or association.",
			inputSchema: searchCrmInput.shape,
		},
		async (input) => result(await client.search(searchCrmInput.parse(input).q)),
	);

	server.registerTool(
		"list_record_business_units",
		{
			description:
				"List all business-unit associations for an existing company or contact.",
			inputSchema: listRecordBusinessUnitsInput.shape,
		},
		async (input) =>
			result(
				await client.recordBusinessUnits(
					listRecordBusinessUnitsInput.parse(input),
				),
			),
	);

	server.registerTool(
		"associate_record_with_business_unit",
		{
			description:
				"Associate an existing company or contact with an additional business unit without duplicating or reassigning the record.",
			inputSchema: associateRecordWithBusinessUnitInput.shape,
		},
		async (input) =>
			result(
				await client.associateRecord(
					associateRecordWithBusinessUnitInput.parse(input),
				),
			),
	);

	server.registerTool(
		"ingest_leads",
		{
			description:
				"Batch-ingest researched leads into one explicit Comp CRM business unit after global search shows no suitable existing record.",
			inputSchema: ingestLeadsInput.shape,
		},
		async (input) =>
			result(await client.ingestLeads(ingestLeadsInput.parse(input))),
	);

	server.registerTool(
		"create_business_unit_opportunity",
		{
			description:
				"Create a qualified business-unit opportunity for an already associated company. Reuses an equivalent open opportunity when present.",
			inputSchema: createBusinessUnitOpportunityInput.shape,
		},
		async (input) =>
			result(
				await client.createBusinessUnitOpportunity(
					createBusinessUnitOpportunityInput.parse(input),
				),
			),
	);

	return server;
}
