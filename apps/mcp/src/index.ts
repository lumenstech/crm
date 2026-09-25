import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isAuthorized, parseCallerTokens } from "./auth";
import { CrmClient } from "./crmClient";
import { safeError } from "./redact";
import { createCrmMcpServer } from "./server";

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

function headerValue(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.length;
		if (total > 1_048_576) throw new Error("MCP request body exceeds 1 MiB.");
		chunks.push(buffer);
	}
	if (chunks.length === 0) return null;
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(body));
}

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(process.env.PORT ?? "3103");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error("PORT must be an integer between 1 and 65535.");
}

const crmBaseUrl = required("COMP_CRM_BASE_URL");
const crmApiKey = required("COMP_CRM_API_KEY");
const rawCallerTokens = required("MCP_CALLER_TOKENS");
const callerTokens = parseCallerTokens(rawCallerTokens);
if (callerTokens.length === 0)
	throw new Error("MCP_CALLER_TOKENS contains no usable token.");

const client = new CrmClient(crmBaseUrl, crmApiKey);
const secrets = [crmApiKey, rawCallerTokens, ...callerTokens];

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);

	try {
		if (req.method === "GET" && url.pathname === "/health") {
			json(res, 200, { ok: true, service: "comp-crm-mcp" });
			return;
		}

		if (req.method === "GET" && url.pathname === "/ready") {
			try {
				await client.businessUnits();
				json(res, 200, { ok: true, service: "comp-crm-mcp", crm: "ready" });
			} catch {
				json(res, 503, {
					ok: false,
					service: "comp-crm-mcp",
					crm: "unavailable",
				});
			}
			return;
		}

		if (url.pathname !== "/mcp") {
			json(res, 404, { error: "not_found" });
			return;
		}

		if (req.method !== "POST") {
			json(res, 405, {
				jsonrpc: "2.0",
				error: { code: -32000, message: "Method not allowed." },
				id: null,
			});
			return;
		}

		if (!isAuthorized(headerValue(req.headers.authorization), callerTokens)) {
			res.setHeader("www-authenticate", "Bearer");
			json(res, 401, { error: "unauthorized" });
			return;
		}

		const body = await readJson(req);
		const mcp = createCrmMcpServer(client);
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});

		res.on("close", () => {
			void transport.close();
			void mcp.close();
		});

		await mcp.connect(transport);
		await transport.handleRequest(req, res, body);
	} catch (error) {
		console.error("Comp CRM MCP request failed:", safeError(error, secrets));
		if (!res.headersSent) {
			json(res, 500, {
				jsonrpc: "2.0",
				error: { code: -32603, message: "Internal server error." },
				id: null,
			});
		}
	}
});

server.listen(port, host, () => {
	console.log(
		JSON.stringify({
			message: "Comp CRM MCP listening",
			host,
			port,
			crmBaseUrl,
		}),
	);
});

function shutdown(signal: string): void {
	console.log(
		JSON.stringify({ message: "Comp CRM MCP shutting down", signal }),
	);
	server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
