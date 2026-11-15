import { describe, expect, test } from "bun:test";
import { chatCallApprovalStatus } from "../agent/lib/chat-mcp-policy";

describe("chat MCP approval", () => {
	test("asks before a change in manual mode", () => {
		expect(chatCallApprovalStatus("change", "READ_WRITE", "manual")).toBe(
			"user-approval",
		);
	});

	test("allows a read in manual mode", () => {
		expect(chatCallApprovalStatus("read", "READ_ONLY", "manual")).toBe(
			"approved",
		);
	});

	test("asks before a risky call in auto mode", () => {
		expect(chatCallApprovalStatus("risky", "READ_WRITE", "auto")).toBe(
			"user-approval",
		);
	});

	test("allows a risky call in bypass mode", () => {
		expect(chatCallApprovalStatus("risky", "READ_WRITE", "bypass")).toEqual({
			type: "approved",
			reason: "risky",
		});
	});

	test("treats a missing mode as manual", () => {
		expect(chatCallApprovalStatus("change", "READ_WRITE", null)).toBe(
			"user-approval",
		);
	});

	test("denies a write on a read-only connection", () => {
		expect(chatCallApprovalStatus("change", "READ_ONLY", "bypass")).toEqual({
			type: "denied",
			reason: "The MCP connection is read-only.",
		});
	});
});
