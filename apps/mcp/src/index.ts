import { createServer } from "node:http";
import {
	localhostHostValidation,
	localhostOriginValidation,
	toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { CrmClient } from "./crm-client";
import { createCrmMcpServer } from "./server";

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

const port = Number(process.env.COMP_CRM_MCP_PORT ?? "3103");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error("COMP_CRM_MCP_PORT must be an integer between 1 and 65535.");
}

const apiUrl =
	process.env.COMP_CRM_API_URL?.trim() ?? "http://127.0.0.1:3101/rest";
const apiKey = required("COMP_CRM_API_KEY");

const client = new CrmClient(apiUrl, apiKey);
const handler = createMcpHandler(() => createCrmMcpServer(client));
const nodeHandler = toNodeHandler(handler, {
	onerror(error) {
		console.error(
			"Comp CRM MCP transport error:",
			error instanceof Error ? error.stack : String(error),
		);
	},
});

const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

const server = createServer((req, res) => {
	if (!validateHost(req, res) || !validateOrigin(req, res)) return;

	const requestUrl = new URL(
		req.url ?? "/",
		`http://${req.headers.host ?? "127.0.0.1"}`,
	);

	if (requestUrl.pathname === "/healthz") {
		res.statusCode = 200;
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				ok: true,
				service: "comp-crm-mcp",
				apiUrl,
			}),
		);
		return;
	}

	if (requestUrl.pathname !== "/mcp") {
		res.statusCode = 404;
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ error: "not_found" }));
		return;
	}

	void nodeHandler(req, res);
});

server.listen(port, "127.0.0.1", () => {
	console.log(
		JSON.stringify({
			message: "Comp CRM MCP listening",
			url: `http://127.0.0.1:${port}/mcp`,
			apiUrl,
		}),
	);
});

async function shutdown(signal: string) {
	console.log(JSON.stringify({ message: "Comp CRM MCP shutting down", signal }));
	server.close();
	await handler.close();
	process.exit(0);
}

process.on("SIGINT", () => {
	void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});
