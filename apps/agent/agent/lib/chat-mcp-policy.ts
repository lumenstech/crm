import type { AgentConnectionRequestStatus } from "@crm/validation/agent-connection-request";
import type { ApprovalStatus } from "eve/tools/approval";

type ConnectionStatus = {
	status: "CONNECTING" | "CONNECTED" | "ERROR" | "DISCONNECTED";
	lastErrorCode: string | null;
};

const REAUTH_ERROR_CODES = new Set([
	"authorization_server_changed",
	"invalid_client",
	"invalid_grant",
	"platform_removed",
	"refresh_token_missing",
]);

export function connectionRequestStatus(
	connection: ConnectionStatus | null,
): AgentConnectionRequestStatus {
	if (!connection || connection.status === "DISCONNECTED") {
		return "not_connected";
	}
	if (connection.status === "CONNECTED") return "connected";
	if (
		connection.status === "ERROR" &&
		connection.lastErrorCode &&
		REAUTH_ERROR_CODES.has(connection.lastErrorCode)
	) {
		return "needs_reauth";
	}
	return "error";
}

export function chatCallApprovalStatus(
	callKind: "read" | "change" | "risky",
	accessMode: "READ_ONLY" | "READ_WRITE",
	permissionMode: "manual" | "auto" | "bypass" | null,
): ApprovalStatus {
	const mode = permissionMode ?? "manual";
	if (accessMode === "READ_ONLY" && callKind !== "read") {
		return { type: "denied", reason: "The MCP connection is read-only." };
	}
	if (mode === "manual" && callKind !== "read") {
		return "user-approval";
	}
	if (mode === "auto" && callKind === "risky") {
		return "user-approval";
	}
	if (mode === "bypass" && callKind === "risky") {
		return { type: "approved", reason: "risky" };
	}
	return "approved";
}
