import { z } from "zod";

export const mcpRequestId = z.union([z.string(), z.number()]);

export const mcpRequest = z.object({
	jsonrpc: z.literal("2.0"),
	id: mcpRequestId,
	method: z.string().trim().min(1).max(160),
	params: z.json().optional(),
});

export const mcpToolCallParams = z.object({
	name: z.string().trim().min(1).max(160),
	arguments: z.json().optional(),
});

export const mcpToolListParams = z.object({}).optional();

export type McpRequest = z.infer<typeof mcpRequest>;
export type McpToolCallParams = z.infer<typeof mcpToolCallParams>;
