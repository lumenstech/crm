import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CrmClient } from "./crmClient";
import {
	associateRecordWithBusinessUnitInput,
	createBusinessUnitOpportunityInput,
	ingestLeadsInput,
	jsonObject,
	listRecordBusinessUnitsInput,
	searchCrmInput,
	type SignalPayloadValue,
} from "./schemas";

function result(value: SignalPayloadValue) {
	const text = JSON.stringify(value, null, 2);
	const objectValue = jsonObject.safeParse(value);
	return {
		content: [{ type: "text" as const, text }],
		structuredContent: objectValue.success ? objectValue.data : { value },
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
			description:
				"Search existing Comp CRM companies, contacts, and deals globally across business units. Results include source business-unit provenance and explicit reuse associations.",
			inputSchema: searchCrmInput.shape,
		},
		async (input) => result(await client.search(searchCrmInput.parse(input).q)),
	);

	server.registerTool(
		"associate_record_with_business_unit",
		{
			description:
				"Explicitly reuse an existing company or contact for another Comp CRM business unit without duplicating or reassigning the original record. Preserves source provenance.",
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
		"list_record_business_units",
		{
			description:
				"List explicit business-unit reuse associations for an existing company or contact.",
			inputSchema: listRecordBusinessUnitsInput.shape,
		},
		async (input) =>
			result(
				await client.listRecordBusinessUnits(
					listRecordBusinessUnitsInput.parse(input),
				),
			),
	);

	server.registerTool(
		"create_business_unit_opportunity",
		{
			description:
				"Create a business-unit-owned opportunity from an existing global company/contact relationship. The original company/contact provenance remains unchanged; the opportunity is explicitly owned by the target business unit.",
			inputSchema: createBusinessUnitOpportunityInput.shape,
		},
		async (input) =>
			result(
				await client.createBusinessUnitOpportunity(
					createBusinessUnitOpportunityInput.parse(input),
				),
			),
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
