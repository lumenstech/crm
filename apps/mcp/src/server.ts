import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CrmClient, type JsonValue, type SignalInput } from "./crm-client";

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number().finite(),
		z.boolean(),
		z.null(),
		z.array(jsonValue),
		z.record(z.string(), jsonValue),
	]),
);

const signalSchema = z.object({
	project: z
		.string()
		.trim()
		.min(1)
		.max(96)
		.describe("Enabled Comp CRM business-unit key, such as data-gear or partwall."),
	source: z
		.string()
		.trim()
		.min(1)
		.max(96)
		.default("chatgpt")
		.describe("Source system. Use chatgpt for records discovered in ChatGPT."),
	sourceType: z
		.string()
		.trim()
		.min(1)
		.max(160)
		.describe("Stable source category such as prospect, rfq, tender, supplier-quote, or research."),
	sourceId: z
		.string()
		.trim()
		.min(1)
		.max(320)
		.describe("Stable source-specific identifier used for deduplication."),
	sourceUrl: z.string().url().nullable().optional(),
	observedAt: z.string().datetime({ offset: true }).nullable().optional(),
	entity: z
		.string()
		.trim()
		.min(1)
		.max(320)
		.nullable()
		.optional()
		.describe("Company/entity name when known."),
	signalScore: z.number().min(0).max(100).nullable().optional(),
	tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
	payload: z.record(z.string(), jsonValue).default({}),
});

const qualificationComponents = z.object({
	icpMatch: z.number().min(0).max(25),
	commercialTrigger: z.number().min(0).max(20),
	projectRelevance: z.number().min(0).max(20),
	companyValue: z.number().min(0).max(10),
	location: z.number().min(0).max(10),
	decisionMaker: z.number().min(0).max(10),
	recency: z.number().min(0).max(5),
});

type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
};

function ok(result: unknown): ToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
		structuredContent: { result },
	};
}

function fail(error: unknown): ToolResult {
	const message = error instanceof Error ? error.message : String(error);
	return {
		content: [{ type: "text", text: message }],
		structuredContent: { error: message },
		isError: true,
	};
}

async function run(operation: () => Promise<unknown>): Promise<ToolResult> {
	try {
		return ok(await operation());
	} catch (error) {
		return fail(error);
	}
}

function rowsOf(value: unknown): Array<Record<string, unknown>> {
	if (!value || typeof value !== "object") return [];
	const rows = (value as { rows?: unknown }).rows;
	if (!Array.isArray(rows)) return [];
	return rows.filter(
		(row): row is Record<string, unknown> =>
			Boolean(row) && typeof row === "object" && !Array.isArray(row),
	);
}

async function createContactDeduped(
	client: CrmClient,
	input: {
		firstName: string;
		lastName?: string;
		email?: string;
		phone?: string;
		title?: string;
		companyId: string;
		ownerId?: string | null;
	},
) {
	const email = input.email?.trim().toLowerCase();
	if (email) {
		const search = await client.searchContacts(email, 25);
		const exact = rowsOf(search).find(
			(row) =>
				typeof row.email === "string" &&
				row.email.trim().toLowerCase() === email,
		);
		if (exact) {
			return {
				created: false,
				deduplicated: true,
				contact: exact,
			};
		}
	}

	const contact = await client.createContact(input);
	return { created: true, deduplicated: false, contact };
}

export function createCrmMcpServer(client: CrmClient): McpServer {
	const server = new McpServer(
		{ name: "comp-crm", version: "1.0.0" },
		{
			instructions: [
				"Use Comp CRM as the system of record for leads and opportunities.",
				"Always list business units before assigning an unfamiliar project key.",
				"Prefer ingest_signal or ingest_signals first so source provenance and deduplication are preserved.",
				"Before creating a visible company, review company candidates and resolve the signal to the correct company.",
				"Create contacts only after the company is resolved, and keep the contact linked to that company.",
				"Do not invent quantities, budgets, domains, emails, or deal amounts. Unknown values should remain absent or null.",
				"Do not create a Deal merely because a lead exists. Promote only when the signal is actually qualified.",
			].join(" "),
		},
	);

	server.registerTool(
		"list_business_units",
		{
			title: "List CRM business units",
			description:
				"List enabled Comp CRM business-unit keys and names. Call this before ingesting records when the correct project key is not already known.",
			inputSchema: z.object({}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async () => run(() => client.businessUnits()),
	);

	server.registerTool(
		"search_companies",
		{
			title: "Search CRM companies",
			description:
				"Search existing Comp CRM companies by company name or domain before creating or resolving a company.",
			inputSchema: z.object({
				q: z.string().trim().max(320).default(""),
			}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ q }) => run(() => client.searchCompanies(q)),
	);

	server.registerTool(
		"get_company",
		{
			title: "Get CRM company",
			description: "Get one Comp CRM company by its CRM id.",
			inputSchema: z.object({ id: z.string().trim().min(1) }),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ id }) => run(() => client.company(id)),
	);

	server.registerTool(
		"search_contacts",
		{
			title: "Search CRM contacts",
			description:
				"Search existing Comp CRM contacts by name, email, title, or related searchable fields. Use exact email matches for deduplication.",
			inputSchema: z.object({
				q: z.string().trim().max(320).default(""),
				limit: z.number().int().min(1).max(50).default(25),
			}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ q, limit }) => run(() => client.searchContacts(q, limit)),
	);

	server.registerTool(
		"get_contact",
		{
			title: "Get CRM contact",
			description: "Get one Comp CRM contact by its CRM id.",
			inputSchema: z.object({ id: z.string().trim().min(1) }),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ id }) => run(() => client.contact(id)),
	);

	server.registerTool(
		"ingest_signal",
		{
			title: "Ingest CRM signal",
			description:
				"Write one sourced lead, prospect, RFQ, tender, supplier signal, or research record into Comp CRM. The source/sourceType/sourceId tuple is deduplicated by the CRM.",
			inputSchema: signalSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async (input) => run(() => client.ingestSignal(input as SignalInput)),
	);

	server.registerTool(
		"ingest_signals",
		{
			title: "Ingest CRM signals in batch",
			description:
				"Ingest up to 50 sourced records. Returns per-record success/error results and does not invent or silently replace missing fields.",
			inputSchema: z.object({
				items: z.array(signalSchema).min(1).max(50),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ items }) =>
			run(async () => {
				const results: Array<Record<string, unknown>> = [];
				let accepted = 0;
				let deduplicated = 0;
				let failed = 0;

				for (const item of items) {
					try {
						const result = (await client.ingestSignal(
							item as SignalInput,
						)) as Record<string, unknown>;
						accepted += 1;
						if (result.deduplicated === true) deduplicated += 1;
						results.push({
							sourceId: item.sourceId,
							ok: true,
							...result,
						});
					} catch (error) {
						failed += 1;
						results.push({
							sourceId: item.sourceId,
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}

				return {
					requested: items.length,
					accepted,
					deduplicated,
					failed,
					results,
				};
			}),
	);

	server.registerTool(
		"list_signals",
		{
			title: "List CRM signals",
			description:
				"Read the Comp CRM signal inbox, optionally filtered by business unit, source, score, or mapping state.",
			inputSchema: z.object({
				project: z.string().trim().min(1).max(96).optional(),
				source: z.string().trim().min(1).max(96).optional(),
				minScore: z.number().min(0).max(100).optional(),
				status: z.enum(["all", "unresolved", "mapped"]).default("unresolved"),
				limit: z.number().int().min(1).max(200).default(50),
			}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async (input) => run(() => client.signals(input)),
	);

	server.registerTool(
		"company_candidates",
		{
			title: "Find company candidates",
			description:
				"Find existing Comp CRM company candidates for an ingested signal before resolving or creating a company.",
			inputSchema: z.object({
				sourceRecordId: z.string().trim().min(1),
			}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ sourceRecordId }) =>
			run(() => client.companyCandidates(sourceRecordId)),
	);

	server.registerTool(
		"resolve_signal_company",
		{
			title: "Resolve signal to company",
			description:
				"Map an ingested signal to an existing company or, after candidate review, create the company in the signal's business unit.",
			inputSchema: z.object({
				sourceRecordId: z.string().trim().min(1),
				companyId: z.string().trim().min(1).nullable().optional(),
				companyName: z.string().trim().min(1).max(320).nullable().optional(),
				domain: z.string().trim().max(320).nullable().optional(),
				createIfMissing: z.boolean().default(false),
				queueResearch: z.boolean().default(true),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async (input) => run(() => client.resolveCompany(input)),
	);

	server.registerTool(
		"create_contact",
		{
			title: "Create CRM contact",
			description:
				"Create a contact linked to a resolved CRM company. Exact email matches are returned as deduplicated instead of creating a duplicate.",
			inputSchema: z.object({
				firstName: z.string().trim().min(1).max(120),
				lastName: z.string().trim().max(120).optional(),
				email: z.string().email().optional(),
				phone: z.string().trim().max(100).optional(),
				title: z.string().trim().max(240).optional(),
				companyId: z
					.string()
					.trim()
					.min(1)
					.describe("CRM company id returned by resolve_signal_company."),
				ownerId: z.string().trim().min(1).nullable().optional(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async (input) => run(() => createContactDeduped(client, input)),
	);

	server.registerTool(
		"create_contacts",
		{
			title: "Create CRM contacts in batch",
			description:
				"Create up to 50 contacts linked to resolved CRM companies. Exact email matches are deduplicated.",
			inputSchema: z.object({
				items: z
					.array(
						z.object({
							firstName: z.string().trim().min(1).max(120),
							lastName: z.string().trim().max(120).optional(),
							email: z.string().email().optional(),
							phone: z.string().trim().max(100).optional(),
							title: z.string().trim().max(240).optional(),
							companyId: z.string().trim().min(1),
							ownerId: z.string().trim().min(1).nullable().optional(),
						}),
					)
					.min(1)
					.max(50),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ items }) =>
			run(async () => {
				const results: Array<Record<string, unknown>> = [];
				let created = 0;
				let deduplicated = 0;
				let failed = 0;

				for (const item of items) {
					try {
						const result = await createContactDeduped(client, item);
						if (result.created) created += 1;
						if (result.deduplicated) deduplicated += 1;
						results.push({
							email: item.email ?? null,
							ok: true,
							...result,
						});
					} catch (error) {
						failed += 1;
						results.push({
							email: item.email ?? null,
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}

				return {
					requested: items.length,
					created,
					deduplicated,
					failed,
					results,
				};
			}),
	);

	server.registerTool(
		"qualify_signal",
		{
			title: "Qualify CRM signal",
			description:
				"Score an ingested signal using the existing Comp CRM qualification model. This does not create a visible Deal.",
			inputSchema: z.object({
				sourceRecordId: z.string().trim().min(1),
				components: qualificationComponents.optional(),
				evidence: z
					.record(z.string(), z.string().max(2000))
					.default({}),
				notes: z.string().trim().max(4000).nullable().optional(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async (input) => run(() => client.qualifySignal(input)),
	);

	server.registerTool(
		"promote_signal",
		{
			title: "Promote CRM signal",
			description:
				"Promote a qualified signal into a canonical CRM opportunity. Visible Deal creation is off by default and should only be requested when actual commercial intent justifies it.",
			inputSchema: z.object({
				sourceRecordId: z.string().trim().min(1),
				createDeal: z.boolean().default(false),
				ownerId: z.string().trim().min(1).nullable().optional(),
				amountUsd: z.number().nonnegative().nullable().optional(),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async (input) => run(() => client.promoteSignal(input)),
	);

	return server;
}
