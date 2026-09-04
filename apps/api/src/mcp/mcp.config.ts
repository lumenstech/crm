export const MCP = {
	path: "/mcp",
	protocolVersion: "2026-07-28",
	server: {
		name: "lumens-comp-crm",
		version: "1.0.0",
	},
	bodyMaxBytes: 64 * 1024,
	toolListTtlMs: 60_000,
	rateLimit: {
		windowMs: 60_000,
		maxToolCalls: 60,
	},
} as const;
