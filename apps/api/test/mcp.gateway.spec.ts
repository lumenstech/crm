import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { auth } from "@crm/auth";
import { db } from "@crm/db";
import { createAuthMiddleware } from "better-auth/api";
import { applySetCookies } from "better-auth/cookies";
import express from "express";
import request from "supertest";
import { IngestService } from "../src/ingest/ingest.service";
import { createMcpGateway } from "../src/mcp/mcp.gateway";

const suffix = `mcp-${Date.now()}`;
const userId = `${suffix}-user`;
const unitId = `${suffix}-unit`;
const sourceId = `${suffix}-signal`;
let app: ReturnType<typeof express>;
let apiKey: string;

async function sessionCookie(): Promise<string> {
	const context = await auth.$context;
	const token = `${suffix}-token`;
	await db.session.create({
		data: {
			id: `${suffix}-session`,
			token,
			userId,
			expiresAt: new Date(Date.now() + 86_400_000),
		},
	});
	const serialize = createAuthMiddleware(async (ctx) =>
		ctx.setSignedCookie(
			context.authCookies.sessionToken.name,
			token,
			context.secret,
			context.authCookies.sessionToken.attributes,
		),
	);
	const headers = new Headers();
	applySetCookies(headers, [await serialize({ headers: new Headers() })]);
	return headers.get("cookie") ?? "";
}

type RpcBody = {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: Record<string, JsonValue>;
};
type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

const base = {
	jsonrpc: "2.0",
	id: 1,
} as const;

describe("MCP gateway", () => {
	beforeAll(async () => {
		await db.user.create({
			data: { id: userId, name: "MCP Test", email: `${suffix}@example.test` },
		});
		await db.businessUnit.create({
			data: { id: unitId, key: suffix, name: "MCP Test Unit" },
		});
		const cookie = await sessionCookie();
		const created = await auth.api.createApiKey({
			headers: new Headers({ cookie }),
			body: { name: `${suffix}-key`, expiresIn: null },
		});
		apiKey = created.key;
		const ingest = new IngestService(db);
		const router = {
			createCaller: () => ({
				search: {
					quick: async () => ({ companies: [], contacts: [], deals: [] }),
				},
				companies: {
					byId: async () => null,
					research: async () => ({ queued: true }),
				},
				contacts: { byId: async () => null },
				deals: { byId: async () => null },
				ingest: {
					signal: (input: Parameters<IngestService["signal"]>[0]) =>
						ingest.signal(input),
					inbox: (input: Parameters<IngestService["inbox"]>[0]) =>
						ingest.inbox(input),
				},
			}),
		};
		app = express();
		app.use(express.json());
		app.post("/mcp", createMcpGateway(router as never));
	});

	afterAll(async () => {
		await db.recordMapping.deleteMany({
			where: { sourceRecord: { businessUnitId: unitId } },
		});
		await db.sourceRecord.deleteMany({ where: { businessUnitId: unitId } });
		await db.businessUnit.delete({ where: { id: unitId } });
		await db.apikey.deleteMany({ where: { referenceId: userId } });
		await db.session.deleteMany({ where: { userId } });
		await db.user.delete({ where: { id: userId } });
	});

	function call(body: RpcBody) {
		return request(app)
			.post("/mcp")
			.set("MCP-Protocol-Version", "2026-07-28")
			.set("Mcp-Method", String((body as { method?: string }).method ?? ""))
			.set("x-api-key", apiKey)
			.send(body);
	}

	it("rejects missing and invalid credentials", async () => {
		const body = { ...base, method: "tools/list", params: {} };
		expect(
			(
				await request(app)
					.post("/mcp")
					.set("MCP-Protocol-Version", "2026-07-28")
					.set("Mcp-Method", "tools/list")
					.send(body)
			).status,
		).toBe(401);
		expect(
			(
				await request(app)
					.post("/mcp")
					.set("MCP-Protocol-Version", "2026-07-28")
					.set("Mcp-Method", "tools/list")
					.set("x-api-key", "crm_invalid")
					.send(body)
			).status,
		).toBe(401);
	});

	it("allows an authenticated request and exposes only the fixed tools", async () => {
		const response = await call({
			...base,
			method: "tools/list",
			params: {},
		}).expect(200);
		const names = response.body.result.tools.map(
			(tool: { name: string }) => tool.name,
		);
		expect(names).toEqual([
			"crm_search",
			"crm_get_company",
			"crm_get_contact",
			"crm_get_deal",
			"crm_list_signals",
			"crm_ingest_signal",
			"crm_queue_company_research",
		]);
	});

	it("rejects header mismatches, unknown tools, and missing confirmation", async () => {
		const mismatch = await call({
			...base,
			method: "tools/list",
			params: {},
		}).set("Mcp-Method", "server/discover");
		expect(mismatch.status).toBe(400);
		const unknown = await call({
			...base,
			method: "tools/call",
			params: { name: "crm_delete_everything", arguments: {} },
		}).set("Mcp-Name", "crm_delete_everything");
		expect(unknown.status).toBe(200);
		expect(unknown.body.result.isError).toBe(true);
		const unconfirmed = await call({
			...base,
			method: "tools/call",
			params: {
				name: "crm_ingest_signal",
				arguments: {
					project: suffix,
					source: "test",
					sourceType: "signal",
					sourceId,
				},
			},
		}).set("Mcp-Name", "crm_ingest_signal");
		expect(unconfirmed.status).toBe(400);
		expect(
			await db.sourceRecord.count({ where: { businessUnitId: unitId } }),
		).toBe(0);
		const unconfirmedResearch = await call({
			...base,
			method: "tools/call",
			params: {
				name: "crm_queue_company_research",
				arguments: { id: "company" },
			},
		}).set("Mcp-Name", "crm_queue_company_research");
		expect(unconfirmedResearch.status).toBe(400);
	});

	it("accepts confirmed ingestion through the authenticated gateway", async () => {
		const response = await call({
			...base,
			method: "tools/call",
			params: {
				name: "crm_ingest_signal",
				arguments: {
					project: suffix,
					source: "test",
					sourceType: "signal",
					sourceId,
					confirm: true,
					payload: { company: "MCP Co" },
				},
			},
		})
			.set("Mcp-Name", "crm_ingest_signal")
			.expect(200);
		expect(response.body.result.isError).toBe(false);
		expect(
			await db.sourceRecord.count({
				where: { businessUnitId: unitId, sourceId },
			}),
		).toBe(1);
	});
});
