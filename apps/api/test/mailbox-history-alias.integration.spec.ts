import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { CompanyDirectoryService } from "../src/companies/company-directory.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { EnrichmentLogService } from "../src/crm/enrichment-log.service";
import type { MailboxEmailIngestService } from "../src/email-ingest/mailbox-email-ingest.service";
import {
	type HistoricalEmailImportInput,
	historicalEmailImportInput,
} from "../src/mailbox/history-import.contracts";
import { HistoricalEmailImportService } from "../src/mailbox/history-import.service";
import { MailboxMatchService } from "../src/mailbox/mailbox-match.service";
import { ThreadWriterService } from "../src/mailbox/thread-writer.service";
import { withDiscardedCrmEvents } from "./agent-trigger.stub";

const suffix = process.env.TEST_RUN_ID ?? "history-alias-spec";
const mailbox = "danny@lumensny.com";
const crmUserEmail = `owner-${suffix}@lumenstechnology.com`;
const userId = `history-alias-user-${suffix}`;
const rootMessageId = `<history-alias-${suffix}@mail.test>`;
const rfcMessageId = `<history-alias-message-${suffix}@mail.test>`;
const providerMessageId = `history-alias-provider-${suffix}`;
const providerThreadId = `history-alias-thread-${suffix}`;
const recipientEmail = "dean.a.bruno@cummins.com";

const agent = {
	contactCreated: async () => true,
	companyCreated: async () => undefined,
	withCrmEvents: withDiscardedCrmEvents,
	companyRequested: async () => true,
} as unknown as AgentTriggerService;
const stamp = new ActivityStampService(db);
const directory = new CompanyDirectoryService(agent);
const log = new EnrichmentLogService(db, stamp);
const match = new MailboxMatchService(db, directory, agent, log);
const emailIngest = {
	handle: async () => false,
} as unknown as MailboxEmailIngestService;
const threads = new ThreadWriterService(db, match, stamp, emailIngest);
const history = new HistoricalEmailImportService(db, match, threads);

let cumminsCompanyId: string;
let cumminsContactId: string;
const originalBindings = process.env.CRM_HISTORICAL_MAILBOX_BINDINGS_JSON;

function message(overrides: Partial<HistoricalEmailImportInput> = {}) {
	return historicalEmailImportInput.parse({
		source: "gmail",
		mailbox,
		providerMessageId,
		providerThreadId,
		rfcMessageId,
		rootMessageId,
		subject: "Data Center Standby Power Projects",
		body: "Synthetic Cummins participant fixture",
		from: { email: mailbox, name: "Danny Ramroop" },
		recipients: [{ email: recipientEmail, name: "Dean Bruno", kind: "to" }],
		sentAt: "2026-09-27T16:14:26.000Z",
		...overrides,
	});
}

async function clean() {
	await db.emailThread.deleteMany({ where: { rootMessageId } });
	await db.contact.deleteMany({ where: { email: recipientEmail } });
	await db.company.deleteMany({
		where: { domain: { in: ["lumensny.com", "cummins.com"] } },
	});
	await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
	await clean();
	await db.user.create({
		data: { id: userId, name: "Alias Fixture Owner", email: crmUserEmail },
	});
	await db.company.create({
		data: { name: "Lumens NY Corp", domain: "lumensny.com" },
	});
	const cummins = await db.company.create({
		data: { name: "Cummins Inc.", domain: "cummins.com" },
		select: { id: true },
	});
	cumminsCompanyId = cummins.id;
	const contact = await db.contact.create({
		data: {
			firstName: "Dean",
			lastName: "Bruno",
			email: recipientEmail,
			companyId: cummins.id,
		},
		select: { id: true },
	});
	cumminsContactId = contact.id;
	process.env.CRM_HISTORICAL_MAILBOX_BINDINGS_JSON = JSON.stringify([
		{ userId, source: "gmail", mailbox },
	]);
});

afterAll(async () => {
	if (originalBindings === undefined) {
		delete process.env.CRM_HISTORICAL_MAILBOX_BINDINGS_JSON;
	} else {
		process.env.CRM_HISTORICAL_MAILBOX_BINDINGS_JSON = originalBindings;
	}
	await clean();
});

describe("historical mailbox alias matching", () => {
	it("matches Cummins while treating only the authorized Lumens alias as internal", async () => {
		const input = message();
		const imported = await history.import(input, userId, crmUserEmail);

		expect(imported.status).toBe("imported");
		expect(imported.companyId).toBe(cumminsCompanyId);
		expect(imported.contactId).toBe(cumminsContactId);

		const duplicate = await history.import(input, userId, crmUserEmail);
		expect(duplicate.status).toBe("duplicate");
		expect(await db.emailMessage.count({ where: { rfcMessageId } })).toBe(1);
	});

	it("rejects the same alias for another user or provider", async () => {
		const input = message({
			providerMessageId: `unauthorized-${suffix}`,
			providerThreadId: `unauthorized-thread-${suffix}`,
			rfcMessageId: `<unauthorized-${suffix}@mail.test>`,
			rootMessageId: `<unauthorized-root-${suffix}@mail.test>`,
		});

		await expect(
			history.import(input, "another-user", crmUserEmail),
		).rejects.toThrow("not authorized");
		await expect(
			history.import({ ...input, source: "outlook" }, userId, crmUserEmail),
		).rejects.toThrow("not authorized");
	});
});
