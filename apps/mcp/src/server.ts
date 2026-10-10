import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CrmClient } from "./crmClient";
import {
	associateRecordWithBusinessUnitInput,
	createBusinessUnitOpportunityInput,
	finalizeOutreachInput,
	historicalEmailImportInput,
	ingestLeadsInput,
	jsonObject,
	listCompanyOutreachHistoryInput,
	listRecordBusinessUnitsInput,
	listRecordInteractionsInput,
	preflightOutreachInput,
	recordInteractionInput,
	reserveOutreachInput,
	type SignalPayloadValue,
	searchCrmInput,
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
		"record_interaction",
		{
			description:
				"Record a CRM interaction after the company/contact/deal is resolved. Use channel=whatsapp for WhatsApp messages. Never creates a parallel contact record.",
			inputSchema: recordInteractionInput.shape,
		},
		async (input) =>
			result(
				await client.recordInteraction(recordInteractionInput.parse(input)),
			),
	);

	server.registerTool(
		"list_record_interactions",
		{
			description:
				"List CRM timeline interactions for a resolved company, contact, or deal. Can filter to WhatsApp or another recorded channel.",
			inputSchema: listRecordInteractionsInput.shape,
		},
		async (input) =>
			result(
				await client.listRecordInteractions(
					listRecordInteractionsInput.parse(input),
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

	server.registerTool(
		"preflight_outreach",
		{
			description:
				"Resolve one canonical CRM company and determine whether outreach is allowed. This operation never sends email.",
			inputSchema: preflightOutreachInput.shape,
		},
		async (input) =>
			result(
				await client.preflightOutreach(preflightOutreachInput.parse(input)),
			),
	);

	server.registerTool(
		"reserve_outreach",
		{
			description:
				"Create an atomic CRM-backed outreach reservation before any sender is called.",
			inputSchema: reserveOutreachInput.shape,
		},
		async (input) =>
			result(await client.reserveOutreach(reserveOutreachInput.parse(input))),
	);

	server.registerTool(
		"finalize_outreach",
		{
			description:
				"Record an idempotent provider status for an existing outreach reservation.",
			inputSchema: finalizeOutreachInput.shape,
		},
		async (input) =>
			result(await client.finalizeOutreach(finalizeOutreachInput.parse(input))),
	);

	server.registerTool(
		"import_historical_email",
		{
			description:
				"Import one verified historical Gmail or Outlook message into canonical CRM mailbox history. Requires exact provider, message, thread, and RFC IDs plus a mailbox matching the authenticated CRM user. Never creates contacts or outreach ledger rows; unresolved and conflicting matches return for review.",
			inputSchema: historicalEmailImportInput.shape,
		},
		async (input) =>
			result(
				await client.importHistoricalEmail(
					historicalEmailImportInput.parse(input),
				),
			),
	);

	server.registerTool(
		"list_company_outreach_history",
		{
			description:
				"List durable outreach history for one canonical CRM company.",
			inputSchema: listCompanyOutreachHistoryInput.shape,
		},
		async (input) =>
			result(
				await client.listCompanyOutreachHistory(
					listCompanyOutreachHistoryInput.parse(input),
				),
			),
	);

	return server;
}
