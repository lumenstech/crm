import { db } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";
import { z } from "zod";
import { permissionModeOf } from "./approval";
import { chatCallApprovalStatus } from "./chat-mcp-policy";
import { attribute, purposeOf } from "./session-purpose";

const toolCallKind = z.enum(["read", "change", "risky"]);

type ChatMcpConnection = {
	id: string;
	platformSlug: string;
	status: "CONNECTING" | "CONNECTED" | "ERROR" | "DISCONNECTED";
	accessMode: "READ_ONLY" | "READ_WRITE";
	lastErrorCode: string | null;
	toolSnapshots: readonly {
		name: string;
		callKind: "read" | "change" | "risky";
	}[];
};

export async function loadChatMcpConnections(): Promise<ChatMcpConnection[]> {
	const connections = await db.mcpConnection.findMany({
		where: { organizationId: WORKSPACE_ID },
		select: {
			id: true,
			platformSlug: true,
			status: true,
			accessMode: true,
			lastErrorCode: true,
			toolSnapshots: {
				where: { reviewState: "REVIEWED" },
				select: { name: true, callKind: true },
			},
		},
	});
	return connections.map((connection) => ({
		...connection,
		toolSnapshots: connection.toolSnapshots.map((tool) => ({
			...tool,
			callKind: toolCallKind.parse(tool.callKind),
		})),
	}));
}

export async function authorizeChatMcpTool(
	platformSlug: string,
	connection: ChatMcpConnection | null,
	userId: string,
	context: ApprovalContext,
): Promise<ApprovalStatus> {
	if (
		purposeOf(context) !== "builder" ||
		attribute(context, "commandType") !== "CHAT" ||
		attribute(context, "userId") !== userId ||
		context.session.auth.current?.principalId !== userId
	) {
		return {
			type: "denied",
			reason: "Only the signed-in chat owner can use connected tools.",
		};
	}
	if (connection?.status !== "CONNECTED") {
		return { type: "denied", reason: "The MCP platform is disconnected." };
	}
	const toolName = bareToolName(platformSlug, context.toolName);
	if (!toolName) {
		return { type: "denied", reason: "The MCP tool name is invalid." };
	}
	const current = await db.mcpConnection.findUnique({
		where: { id: connection.id },
		select: {
			status: true,
			accessMode: true,
			toolSnapshots: {
				where: { name: toolName, reviewState: "REVIEWED" },
				select: { callKind: true },
				take: 1,
			},
		},
	});
	if (current?.status !== "CONNECTED") {
		return { type: "denied", reason: "The MCP platform is disconnected." };
	}
	const tool = current.toolSnapshots[0];
	if (!tool) {
		return { type: "denied", reason: "This MCP tool is not reviewed." };
	}
	return chatCallApprovalStatus(
		toolCallKind.parse(tool.callKind),
		current.accessMode,
		permissionModeOf(context),
	);
}

export function bareToolName(
	platformSlug: string,
	qualifiedName: string,
): string | null {
	const prefix = `${platformSlug}__`;
	return qualifiedName.startsWith(prefix)
		? qualifiedName.slice(prefix.length)
		: null;
}
