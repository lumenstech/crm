import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpAuthClient } from "better-auth/plugins/mcp/client";
import { isAuthorized, parseCallerTokens } from "./auth";
import { CrmClient } from "./crmClient";
import { safeError } from "./redact";
import { createCrmMcpServer } from "./server";

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

function optional(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value || undefined;
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

function publicResourceUrl(): string {
	const configured = optional("COMP_CRM_MCP_PUBLIC_URL");
	if (!configured) return "https://comp-crm-mcp.516labs.com/mcp";
	const url = new URL(configured);
	if (url.protocol !== "https:") {
		throw new Error("COMP_CRM_MCP_PUBLIC_URL must use HTTPS.");
	}
	return url.toString();
}

const resourceUrl = publicResourceUrl();
const resourceMetadataUrl = new URL(
	"/.well-known/oauth-protected-resource",
	resourceUrl,
).toString();
const authPublicUrl = optional("COMP_CRM_AUTH_PUBLIC_URL");
const authBaseUrl = optional("COMP_CRM_AUTH_BASE_URL");
const oauthClient = authBaseUrl
	? createMcpAuthClient({ authURL: authBaseUrl, resource: resourceUrl })
	: null;
const oauthDiscovery = oauthClient?.discoveryHandler();

function unauthorized(res: ServerResponse): void {
	const wwwAuthenticate = `Bearer resource_metadata="${resourceMetadataUrl}"`;
	res.setHeader("www-authenticate", wwwAuthenticate);
	res.setHeader("access-control-expose-headers", "WWW-Authenticate");
	json(res, 401, {
		jsonrpc: "2.0",
		error: {
			code: -32000,
			message: "Unauthorized: Authentication required.",
			"www-authenticate": wwwAuthenticate,
		},
		id: null,
	});
}

function protectedResourceMetadata() {
	return {
		resource: resourceUrl,
		authorization_servers: authPublicUrl ? [authPublicUrl] : [],
		bearer_methods_supported: ["header"],
		scopes_supported: ["openid", "profile", "email", "offline_access"],
	};
}

async function writeWebResponse(
	res: ServerResponse,
	response: Response,
): Promise<void> {
	res.statusCode = response.status;
	response.headers.forEach((value, key) => {
		res.setHeader(key, value);
	});
	res.end(Buffer.from(await response.arrayBuffer()));
}

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(process.env.PORT ?? "3103");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error("PORT must be an integer between 1 and 65535.");
}

const crmBaseUrl = required("COMP_CRM_BASE_URL");
const crmApiKey = required("COMP_CRM_API_KEY");
const rawCallerTokens = optional("MCP_CALLER_TOKENS");
const callerTokens = rawCallerTokens ? parseCallerTokens(rawCallerTokens) : [];
if (callerTokens.length === 0 && !oauthClient) {
	throw new Error(
		"Configure COMP_CRM_AUTH_BASE_URL or MCP_CALLER_TOKENS for MCP authentication.",
	);
}

const client = new CrmClient(crmBaseUrl, crmApiKey);
const secrets = [crmApiKey, rawCallerTokens ?? "", ...callerTokens];

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);

	try {
		if (req.method === "GET" && url.pathname === "/health") {
			json(res, 200, { ok: true, service: "comp-crm-mcp" });
			return;
		}

		if (
			req.method === "GET" &&
			url.pathname === "/.well-known/oauth-authorization-server"
		) {
			if (!oauthDiscovery) {
				json(res, 404, { error: "oauth_not_configured" });
				return;
			}
			await writeWebResponse(
				res,
				await oauthDiscovery(
					new Request(url, {
						method: "GET",
						headers: req.headers as HeadersInit,
					}),
				),
			);
			return;
		}

		if (
			req.method === "GET" &&
			(url.pathname === "/.well-known/oauth-protected-resource" ||
				url.pathname === "/.well-known/oauth-protected-resource/mcp")
		) {
			res.setHeader("access-control-allow-origin", "*");
			json(res, 200, protectedResourceMetadata());
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

		const authorization = headerValue(req.headers.authorization);
		const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
		const oauthAuthorized =
			token && oauthClient ? await oauthClient.verifyToken(token) : null;
		const staticAuthorized = isAuthorized(authorization, callerTokens);
		if (!oauthAuthorized && !staticAuthorized) {
			unauthorized(res);
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
