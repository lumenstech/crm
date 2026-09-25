import { describe, expect, test } from "bun:test";
import { MailboxEmailIngestService } from "../src/email-ingest/mailbox-email-ingest.service";

function service(overrides?: { address?: string; senders?: string }) {
	const calls: unknown[] = [];
	const config = {
		get(name: string) {
			if (name === "CRM_EMAIL_INGEST_ADDRESS")
				return overrides?.address ?? "leads@516labs.com";
			if (name === "CRM_EMAIL_INGEST_ALLOWED_SENDERS")
				return overrides?.senders ?? "trusted@example.com";
			return undefined;
		},
	};
	const ingest = {
		async process(batch: unknown) {
			calls.push(batch);
			return {
				batchId: "batch-1",
				businessUnit: "data-gear",
				submitted: 1,
				existing: 0,
				created: 1,
				checked: 0,
				failed: 0,
			};
		},
	};
	return {
		calls,
		gateway: new MailboxEmailIngestService(config as never, ingest as never),
	};
}

const baseMessage = {
	rfcMessageId: "msg-1@example.com",
	rootId: "msg-1@example.com",
	subject: "CRM ingest",
	from: { email: "trusted@example.com", name: null },
	recipients: [{ email: "leads@516labs.com", name: null, kind: "to" as const }],
	body: `COMP-CRM-INGEST-V1
{
  "batchId": "batch-1",
  "businessUnit": "data-gear",
  "mode": "INGEST",
  "leads": [{ "company": "Example AI" }]
}`,
	sentAt: new Date("2026-09-25T19:00:00Z"),
};

describe("mailbox CRM lead ingestion", () => {
	test("consumes a valid structured email to the leads address", async () => {
		const { gateway, calls } = service();
		expect(await gateway.handle(baseMessage)).toBe(true);
		expect(calls).toHaveLength(1);
	});

	test("ignores ordinary mailbox messages", async () => {
		const { gateway, calls } = service();
		expect(
			await gateway.handle({
				...baseMessage,
				recipients: [{ email: "sales@516labs.com", name: null, kind: "to" as const }],
			}),
		).toBe(false);
		expect(calls).toHaveLength(0);
	});

	test("consumes but rejects messages from non-allowlisted senders", async () => {
		const { gateway, calls } = service();
		expect(
			await gateway.handle({
				...baseMessage,
				from: { email: "attacker@example.net", name: null },
			}),
		).toBe(true);
		expect(calls).toHaveLength(0);
	});
});
