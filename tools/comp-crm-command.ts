import { readFile } from "node:fs/promises";
import { CrmClient } from "../apps/mcp/src/crmClient";

type Operation =
	| "list_business_units"
	| "search_crm"
	| "list_record_business_units"
	| "associate_record_with_business_unit"
	| "ingest_leads"
	| "create_business_unit_opportunity";

type Command = {
	operation: Operation;
	input?: Record<string, unknown>;
};

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

const commandPath = process.argv[2]?.trim();
if (!commandPath) {
	throw new Error("Usage: bun tools/comp-crm-command.ts <command.json>");
}

const raw = await readFile(commandPath, "utf8");
const command = JSON.parse(raw) as Command;
const input = command.input ?? {};

const client = new CrmClient(
	process.env.COMP_CRM_BASE_URL?.trim() || "http://127.0.0.1:3101",
	required("COMP_CRM_API_KEY"),
);

let result: unknown;

switch (command.operation) {
	case "list_business_units":
		result = await client.businessUnits();
		break;
	case "search_crm": {
		const q = typeof input.q === "string" ? input.q.trim() : "";
		if (!q) throw new Error("search_crm requires input.q");
		result = await client.search(q);
		break;
	}
	case "list_record_business_units":
		result = await client.listRecordBusinessUnits(
			input as Parameters<CrmClient["listRecordBusinessUnits"]>[0],
		);
		break;
	case "associate_record_with_business_unit":
		result = await client.associateRecord(
			input as Parameters<CrmClient["associateRecord"]>[0],
		);
		break;
	case "ingest_leads":
		result = await client.ingestLeads(
			input as Parameters<CrmClient["ingestLeads"]>[0],
		);
		break;
	case "create_business_unit_opportunity":
		result = await client.createBusinessUnitOpportunity(
			input as Parameters<CrmClient["createBusinessUnitOpportunity"]>[0],
		);
		break;
	default:
		throw new Error(`Unsupported operation: ${String(command.operation)}`);
}

process.stdout.write(
	JSON.stringify(
		{
			ok: true,
			operation: command.operation,
			result,
		},
		null,
		2,
	) + "\n",
);
