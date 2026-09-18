import { workspaceRoleOf } from "@crm/auth";
import { db } from "@crm/db";
import type { AnyRouter } from "@trpc/server";
import type { Request, Response } from "express";
import { z } from "zod";
import { companyIdInput } from "../companies/companies.contracts";
import { contactIdInput } from "../contacts/contacts.contracts";
import { dealIdInput } from "../deals/deals.contracts";
import type { AppRouter } from "../generated/server";
import {
	ingestSignalInput,
	signalInboxInput,
} from "../ingest/ingest.contracts";
import { emitOperationalEvent } from "../lumens-os/operational-events";
import { createBaseTrpcContext } from "../trpc/trpc.context";
import { MCP } from "./mcp.config";
import { mcpRequest, mcpToolCallParams } from "./mcp.contracts";

const searchInput = z.object({ q: z.string().trim().max(320).default("") });
const confirmedIngestInput = ingestSignalInput.extend({
	confirm: z.literal(true),
});
const confirmedResearchInput = companyIdInput.extend({
	confirm: z.literal(true),
});
const lumensProjectInput = z.object({
	businessUnitId: z.string().min(1),
	opportunityId: z.string().min(1),
	companyId: z.string().min(1),
	name: z.string().min(1),
	confirm: z.literal(true),
});
const lumensTaskInput = z.object({
	businessUnitId: z.string().min(1),
	taskId: z.string().min(1),
	opportunityId: z.string().min(1),
	title: z.string().min(1),
	description: z.string().nullable().optional(),
	confirm: z.literal(true),
});
const lumensAssignmentInput = z.object({
	businessUnitId: z.string().min(1),
	taskId: z.string().min(1),
	personId: z.string().min(1),
	commandId: z.string().min(1),
	confirm: z.literal(true),
});
const lumensScheduleInput = z.object({
	businessUnitId: z.string().min(1),
	taskId: z.string().min(1),
	startAt: z.string().datetime(),
	endAt: z.string().datetime().nullable().optional(),
	commandId: z.string().min(1),
	confirm: z.literal(true),
});
const lumensOperationInput = z.object({ eventId: z.string().min(1) });

const tools = [
	{
		name: "crm_search",
		description: "Search CRM companies, contacts, and deals.",
		inputSchema: {
			type: "object",
			properties: { q: { type: "string", maxLength: 320 } },
			required: ["q"],
			additionalProperties: false,
		},
	},
	{
		name: "crm_get_company",
		description: "Read one CRM company by id.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
	},
	{
		name: "crm_get_contact",
		description: "Read one CRM contact by id.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
	},
	{
		name: "crm_get_deal",
		description: "Read one CRM deal by id.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
			additionalProperties: false,
		},
	},
	{
		name: "crm_list_signals",
		description: "List staged CRM ingestion signals without promoting them.",
		inputSchema: {
			type: "object",
			properties: {
				project: { type: "string" },
				minScore: { type: "number", minimum: 0, maximum: 100 },
				status: { type: "string", enum: ["all", "unresolved", "mapped"] },
				limit: { type: "integer", minimum: 1, maximum: 200 },
			},
			additionalProperties: false,
		},
	},
	{
		name: "crm_ingest_signal",
		description:
			"Stage one external CRM signal. This does not promote or match records.",
		inputSchema: {
			type: "object",
			properties: {
				project: { type: "string" },
				source: { type: "string" },
				sourceType: { type: "string" },
				sourceId: { type: "string" },
				sourceUrl: { type: ["string", "null"], format: "uri" },
				observedAt: { type: ["string", "null"], format: "date-time" },
				entity: { type: ["string", "null"] },
				signalScore: { type: ["number", "null"], minimum: 0, maximum: 100 },
				tags: { type: "array", items: { type: "string" }, maxItems: 50 },
				payload: { type: "object" },
				confirm: { const: true },
			},
			required: ["project", "source", "sourceType", "sourceId", "confirm"],
			additionalProperties: false,
		},
	},
	{
		name: "crm_queue_company_research",
		description: "Queue durable agent research for one existing CRM company.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" }, confirm: { const: true } },
			required: ["id", "confirm"],
			additionalProperties: false,
		},
	},
	{
		name: "lumens_sync_project",
		description: "Queue an idempotent canonical opportunity-to-Gauzy project synchronization.",
		inputSchema: { type: "object", properties: { businessUnitId: { type: "string" }, opportunityId: { type: "string" }, companyId: { type: "string" }, name: { type: "string" }, confirm: { const: true } }, required: ["businessUnitId", "opportunityId", "companyId", "name", "confirm"], additionalProperties: false },
	},
	{
		name: "lumens_sync_task",
		description: "Queue an idempotent canonical task-to-Gauzy task synchronization.",
		inputSchema: { type: "object", properties: { businessUnitId: { type: "string" }, taskId: { type: "string" }, opportunityId: { type: "string" }, title: { type: "string" }, description: { type: ["string", "null"] }, confirm: { const: true } }, required: ["businessUnitId", "taskId", "opportunityId", "title", "confirm"], additionalProperties: false },
	},
	{
		name: "lumens_assign_task",
		description: "Queue a versioned canonical task assignment command.",
		inputSchema: { type: "object", properties: { businessUnitId: { type: "string" }, taskId: { type: "string" }, personId: { type: "string" }, commandId: { type: "string" }, confirm: { const: true } }, required: ["businessUnitId", "taskId", "personId", "commandId", "confirm"], additionalProperties: false },
	},
	{
		name: "lumens_schedule_task",
		description: "Queue a versioned canonical task scheduling command.",
		inputSchema: { type: "object", properties: { businessUnitId: { type: "string" }, taskId: { type: "string" }, startAt: { type: "string", format: "date-time" }, endAt: { type: ["string", "null"], format: "date-time" }, commandId: { type: "string" }, confirm: { const: true } }, required: ["businessUnitId", "taskId", "startAt", "commandId", "confirm"], additionalProperties: false },
	},
	{
		name: "lumens_get_operation",
		description: "Read durable Lumens OS operation status by event id.",
		inputSchema: { type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"], additionalProperties: false },
	}
] as const;

type Caller = ReturnType<AppRouter["createCaller"]>;
type JsonValue =
	| undefined
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

function jsonRpcError(
	id: string | number | null,
	code: number,
	message: string,
) {
	return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function result<Value extends object>(id: string | number, value: Value) {
	return {
		jsonrpc: "2.0" as const,
		id,
		result: {
			...value,
			_meta: {
				"io.modelcontextprotocol/serverInfo": MCP.server,
			},
		},
	};
}

function toolResult(id: string | number, value: JsonValue, isError = false) {
	return result(id, {
		content: [{ type: "text", text: JSON.stringify(value) }],
		structuredContent: value,
		isError,
	});
}

async function callTool(
	caller: Caller,
	name: string,
	args: JsonValue | undefined,
	userId: string,
) {
	if (name.startsWith("lumens_") && name !== "lumens_get_operation") {
		const role = await workspaceRoleOf(userId);
		if (role !== "owner" && role !== "admin") throw new Error("Lumens OS mutations require workspace owner or admin.");
	}
	switch (name) {
		case "crm_search": {
			const input = searchInput.parse(args ?? {});
			return caller.search.quick(input);
		}
		case "crm_get_company":
			return caller.companies.byId(companyIdInput.parse(args));
		case "crm_get_contact":
			return caller.contacts.byId(contactIdInput.parse(args));
		case "crm_get_deal":
			return caller.deals.byId(dealIdInput.parse(args));
		case "crm_list_signals":
			return caller.ingest.inbox(signalInboxInput.parse(args ?? {}));
		case "crm_ingest_signal": {
			const input = confirmedIngestInput.parse(args);
			const { confirm: _, ...signal } = input;
			return caller.ingest.signal(signal);
		}
		case "crm_queue_company_research": {
			const input = confirmedResearchInput.parse(args);
			return caller.companies.research({ id: input.id });
		}
		case "lumens_sync_project": {
			const input = lumensProjectInput.parse(args);
			return db.$transaction((tx) => emitOperationalEvent(tx, {
				version: 1, eventType: "project.sync", canonicalType: "opportunity",
				canonicalId: input.opportunityId, businessUnitId: input.businessUnitId,
				data: { companyId: input.companyId, name: input.name },
			}));
		}
		case "lumens_sync_task": {
			const input = lumensTaskInput.parse(args);
			return db.$transaction((tx) => emitOperationalEvent(tx, {
				version: 1, eventType: "task.sync", canonicalType: "task",
				canonicalId: input.taskId, businessUnitId: input.businessUnitId,
				data: { opportunityId: input.opportunityId, title: input.title, description: input.description ?? null },
			}));
		}
		case "lumens_assign_task": {
			const input = lumensAssignmentInput.parse(args);
			return db.$transaction((tx) => emitOperationalEvent(tx, {
				version: 1, eventType: "task.assign", canonicalType: "task",
				canonicalId: input.taskId, businessUnitId: input.businessUnitId, commandId: input.commandId,
				data: { taskId: input.taskId, personId: input.personId },
			}));
		}
		case "lumens_schedule_task": {
			const input = lumensScheduleInput.parse(args);
			return db.$transaction((tx) => emitOperationalEvent(tx, {
				version: 1, eventType: "task.schedule", canonicalType: "task",
				canonicalId: input.taskId, businessUnitId: input.businessUnitId, commandId: input.commandId,
				data: { taskId: input.taskId, startAt: input.startAt, endAt: input.endAt ?? null },
			}));
		}
		case "lumens_get_operation": {
			const { eventId } = lumensOperationInput.parse(args);
			return db.lumensOsEvent.findUnique({
				where: { id: eventId },
				select: { id: true, eventType: true, aggregateType: true, aggregateId: true, businessUnitId: true, status: true, attempts: true, lastError: true, availableAt: true, leasedUntil: true, processedAt: true, createdAt: true, updatedAt: true },
			});
		}
		default:
			throw new Error(`Unknown MCP tool: ${name}.`);
	}
}

function headerValue(req: Request, name: string): string | undefined {
	const value = req.header(name);
	return value?.trim() || undefined;
}

function validateHeaders(
	req: Request,
	method: string,
	name?: string,
): string | null {
	if (headerValue(req, "MCP-Protocol-Version") !== MCP.protocolVersion) {
		return "MCP-Protocol-Version does not match the supported protocol.";
	}
	if (headerValue(req, "Mcp-Method") !== method) {
		return "Mcp-Method does not match the JSON-RPC method.";
	}
	if (name && headerValue(req, "Mcp-Name") !== name) {
		return "Mcp-Name does not match the JSON-RPC request.";
	}
	if (!name && headerValue(req, "Mcp-Name")) {
		return "Mcp-Name is not valid for this method.";
	}
	return null;
}

export function createMcpGateway(router: AnyRouter) {
	return async (req: Request, res: Response): Promise<void> => {
		const parsed = mcpRequest.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json(jsonRpcError(null, -32600, "Invalid Request"));
			return;
		}

		const request = parsed.data;
		const toolParams =
			request.method === "tools/call"
				? mcpToolCallParams.safeParse(request.params)
				: null;
		const name = toolParams?.success ? toolParams.data.name : undefined;
		const headerError = validateHeaders(req, request.method, name);
		if (headerError) {
			res.status(400).json(jsonRpcError(request.id, -32020, headerError));
			return;
		}

		const context = await createBaseTrpcContext(req);
		if (!context.session?.user) {
			res.status(401).json(jsonRpcError(request.id, -32001, "Unauthorized"));
			return;
		}

		const caller = router.createCaller(context) as Caller;
		try {
			if (request.method === "server/discover") {
				res.json(
					result(request.id, {
						supportedVersions: [MCP.protocolVersion],
						capabilities: { tools: { listChanged: false } },
						instructions:
							"Use CRM tools for authenticated intelligence workflows and Lumens OS tools for confirmed, durable operational commands. Lumens OS mutations are queued and auditable; they do not bypass orchestration.",
						ttlMs: MCP.toolListTtlMs,
						cacheScope: "private",
					}),
				);
				return;
			}

			if (request.method === "tools/list") {
				res.json(
					result(request.id, {
						tools,
						ttlMs: MCP.toolListTtlMs,
						cacheScope: "private",
					}),
				);
				return;
			}

			if (request.method === "tools/call") {
				if (!toolParams?.success) {
					res
						.status(400)
						.json(jsonRpcError(request.id, -32602, "Invalid tool parameters."));
					return;
				}
				try {
					const value = await callTool(
						caller,
						toolParams.data.name,
						toolParams.data.arguments,
						context.session.user.id,
					);
					res.json(
						toolResult(
							request.id,
							JSON.parse(JSON.stringify(value)) as JsonValue,
						),
					);
				} catch (error) {
					if (error instanceof z.ZodError) {
						res
							.status(400)
							.json(
								jsonRpcError(request.id, -32602, "Invalid tool arguments."),
							);
						return;
					}
					const message =
						error instanceof Error ? error.message : "CRM tool call failed.";
					res.json(toolResult(request.id, { message }, true));
				}
				return;
			}

			res
				.status(404)
				.json(jsonRpcError(request.id, -32601, "Method not found"));
		} catch {
			res.status(500).json(jsonRpcError(request.id, -32603, "Internal error"));
		}
	};
}
