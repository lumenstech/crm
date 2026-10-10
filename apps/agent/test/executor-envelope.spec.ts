import { describe, expect, it } from "bun:test";
import {
	executorPayloadHash,
	parseExecutorEnvelope,
} from "../agent/lib/resend-executor";

const payload = {
	version: "COMP-CRM-EXECUTOR-V1",
	jobId: "partwall-20261006-001",
	operation: "partwall-canonical-comparison",
	taskRef: "partwall-production-leads-001",
	expiresAt: "2026-10-07T12:00:00.000Z",
};

describe("executor control envelope", () => {
	it("accepts the exact versioned payload hash", () => {
		const result = parseExecutorEnvelope(
			`COMP-CRM-EXECUTOR-V1\n${JSON.stringify({
				...payload,
				payloadHash: executorPayloadHash(payload),
			})}`,
		);

		expect(result).toMatchObject(payload);
	});

	it("rejects an altered payload hash", () => {
		const result = parseExecutorEnvelope(
			`COMP-CRM-EXECUTOR-V1\n${JSON.stringify({
				...payload,
				payloadHash: `sha256:${"0".repeat(64)}`,
			})}`,
		);

		expect(result).toBeNull();
	});

	it("rejects unknown envelope fields", () => {
		const result = parseExecutorEnvelope(
			`COMP-CRM-EXECUTOR-V1\n${JSON.stringify({
				...payload,
				payloadHash: executorPayloadHash(payload),
				callbackUrl: "https://example.test",
			})}`,
		);

		expect(result).toBeNull();
	});
});
