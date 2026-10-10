import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, EmailDirection } from "@crm/db";
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

const suffix = process.env.TEST_RUN_ID ?? "history-import-spec";
const mailbox = `history-${suffix}@example.test`;
const userId = `history-user-${suffix}`;
const firstDomain = `history-a-${suffix}.test`;
const secondDomain = `history-b-${suffix}.test`;
const archivedDomain = `history-archived-${suffix}.test`;
const firstEmail = `buyer@${firstDomain}`;
const secondEmail = `buyer@${secondDomain}`;
const archivedEmail = `buyer@${archivedDomain}`;
const roots = [
	`<history-outbound-${suffix}@mail.test>`,
	`<history-inbound-${suffix}@mail.test>`,
	`<history-ambiguous-${suffix}@mail.test>`,
	`<history-archived-${suffix}@mail.test>`,
	`<history-provider-race-${suffix}@mail.test>`,
];

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

let firstCompanyId: string;
let firstContactId: string;

function message(overrides: Partial<HistoricalEmailImportInput> = {}) {
	return historicalEmailImportInput.parse({
		source: "gmail",
		mailbox,
		providerMessageId: `provider-${suffix}`,
		providerThreadId: `thread-${suffix}`,
		rfcMessageId: `<rfc-${suffix}@mail.test>`,
		rootMessageId: roots[0],
		subject: "History",
		body: "Historical body",
		from: { email: mailbox, name: "History User" },
		recipients: [{ email: firstEmail, name: "Buyer", kind: "to" }],
		sentAt: "2026-09-27T16:14:26.000Z",
		...overrides,
	});
}

async function clean() {
	await db.emailThread.deleteMany({ where: { rootMessageId: { in: roots } } });
	await db.contact.deleteMany({
		where: { email: { in: [firstEmail, secondEmail, archivedEmail] } },
	});
	await db.company.deleteMany({
		where: {
			domain: { in: [firstDomain, secondDomain, archivedDomain] },
		},
	});
	await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
	await clean();
	await db.user.create({
		data: { id: userId, name: "History User", email: mailbox },
	});
	const firstCompany = await db.company.create({
		data: { name: "History A", domain: firstDomain },
		select: { id: true },
	});
	firstCompanyId = firstCompany.id;
	const firstContact = await db.contact.create({
		data: {
			firstName: "Buyer",
			lastName: "A",
			email: firstEmail,
			companyId: firstCompany.id,
		},
		select: { id: true },
	});
	firstContactId = firstContact.id;
	const secondCompany = await db.company.create({
		data: { name: "History B", domain: secondDomain },
		select: { id: true },
	});
	await db.contact.create({
		data: {
			firstName: "Buyer",
			lastName: "B",
			email: secondEmail,
			companyId: secondCompany.id,
		},
	});
	const archivedCompany = await db.company.create({
		data: {
			name: "Archived Company",
			domain: archivedDomain,
			archivedAt: new Date("2026-01-01T00:00:00.000Z"),
		},
		select: { id: true },
	});
	await db.contact.create({
		data: {
			firstName: "Archived",
			lastName: "Buyer",
			email: archivedEmail,
			companyId: archivedCompany.id,
		},
	});
});

afterAll(clean);

describe("historical mailbox import", () => {
	it("stores an outbound message once with immutable identity and original date", async () => {
		const input = message();
		const imported = await history.import(input, userId, mailbox);

		expect(imported.status).toBe("imported");
		expect(imported.direction).toBe("outbound");
		expect(imported.companyId).toBe(firstCompanyId);
		expect(imported.contactId).toBe(firstContactId);
		expect(imported.originalSentAt).toBe("2026-09-27T16:14:26.000Z");
		expect(
			(
				await db.company.findUnique({
					where: { id: firstCompanyId },
					select: { lastActivityAt: true },
				})
			)?.lastActivityAt?.toISOString(),
		).toBe(input.sentAt);
		expect(
			(
				await db.contact.findUnique({
					where: { id: firstContactId },
					select: { lastActivityAt: true },
				})
			)?.lastActivityAt?.toISOString(),
		).toBe(input.sentAt);

		const stored = await db.emailMessage.findUnique({
			where: { rfcMessageId: input.rfcMessageId },
			select: {
				direction: true,
				sentAt: true,
				gmailMessageId: true,
				thread: {
					select: {
						provider: true,
						mailbox: true,
						providerThreadId: true,
						activity: { select: { id: true } },
					},
				},
			},
		});
		expect(stored?.direction).toBe(EmailDirection.OUTBOUND);
		expect(stored?.sentAt.toISOString()).toBe(input.sentAt);
		expect(stored?.gmailMessageId).toBe(input.providerMessageId);
		expect(stored?.thread.provider).toBe("gmail");
		expect(stored?.thread.mailbox).toBe(mailbox);
		expect(stored?.thread.providerThreadId).toBe(input.providerThreadId);
		expect(stored?.thread.activity).not.toBeNull();

		const duplicate = await history.import(input, userId, mailbox);
		expect(duplicate.status).toBe("duplicate");
		expect(
			await db.emailMessage.count({
				where: { rfcMessageId: input.rfcMessageId },
			}),
		).toBe(1);
	});

	it("allows distinct messages in the same provider thread", async () => {
		const input = message({
			providerMessageId: `provider-reply-${suffix}`,
			rfcMessageId: `<rfc-reply-${suffix}@mail.test>`,
			sentAt: "2026-09-27T17:14:26.000Z",
			body: "Historical reply body",
		});
		const imported = await history.import(input, userId, mailbox);

		expect(imported.status).toBe("imported");
		expect(imported.emailThreadId).toBeTruthy();
		expect(
			await db.emailMessage.count({
				where: { threadId: imported.emailThreadId ?? undefined },
			}),
		).toBe(2);
	});

	it("blocks a provider thread reused by a different canonical thread", async () => {
		const input = message({
			providerMessageId: `provider-cross-thread-${suffix}`,
			rfcMessageId: `<rfc-cross-thread-${suffix}@mail.test>`,
			rootMessageId: `<history-cross-thread-${suffix}@mail.test>`,
		});
		const result = await history.import(input, userId, mailbox);

		expect(result.status).toBe("conflict");
		expect(
			await db.emailMessage.count({
				where: { rfcMessageId: input.rfcMessageId },
			}),
		).toBe(0);
	});

	it("serializes concurrent reuse of one provider message ID", async () => {
		const first = message({
			providerMessageId: `provider-race-${suffix}`,
			providerThreadId: `thread-race-${suffix}`,
			rfcMessageId: `<rfc-race-a-${suffix}@mail.test>`,
			rootMessageId: roots[4],
		});
		const second = message({
			providerMessageId: first.providerMessageId,
			providerThreadId: first.providerThreadId,
			rfcMessageId: `<rfc-race-b-${suffix}@mail.test>`,
			rootMessageId: first.rootMessageId,
		});
		const results = await Promise.all([
			history.import(first, userId, mailbox),
			history.import(second, userId, mailbox),
		]);

		expect(results.map((result) => result.status).sort()).toEqual([
			"conflict",
			"imported",
		]);
		expect(
			await db.emailMessage.count({
				where: {
					rfcMessageId: {
						in: [first.rfcMessageId, second.rfcMessageId],
					},
				},
			}),
		).toBe(1);
		expect(
			await db.emailThread.count({
				where: { rootMessageId: first.rootMessageId },
			}),
		).toBe(1);
	});

	it("derives inbound direction from the authenticated mailbox", async () => {
		const input = message({
			providerMessageId: `provider-inbound-${suffix}`,
			providerThreadId: `thread-inbound-${suffix}`,
			rfcMessageId: `<rfc-inbound-${suffix}@mail.test>`,
			rootMessageId: roots[1],
			from: { email: firstEmail, name: "Buyer" },
			recipients: [{ email: mailbox, name: "History User", kind: "to" }],
			sentAt: "2026-09-28T16:14:26.000Z",
		});
		const imported = await history.import(input, userId, mailbox);

		expect(imported.status).toBe("imported");
		expect(imported.direction).toBe("inbound");
		const stored = await db.emailMessage.findUnique({
			where: { rfcMessageId: input.rfcMessageId },
			select: { direction: true, sentAt: true },
		});
		expect(stored?.direction).toBe(EmailDirection.INBOUND);
		expect(stored?.sentAt.toISOString()).toBe(input.sentAt);
	});

	it("returns ambiguous associations without writing a message", async () => {
		const input = message({
			providerMessageId: `provider-ambiguous-${suffix}`,
			providerThreadId: `thread-ambiguous-${suffix}`,
			rfcMessageId: `<rfc-ambiguous-${suffix}@mail.test>`,
			rootMessageId: roots[2],
			recipients: [
				{ email: firstEmail, name: "Buyer A", kind: "to" },
				{ email: secondEmail, name: "Buyer B", kind: "cc" },
			],
		});
		const result = await history.import(input, userId, mailbox);

		expect(result.status).toBe("ambiguous");
		expect(result.candidates).toHaveLength(2);
		expect(
			await db.emailMessage.count({
				where: { rfcMessageId: input.rfcMessageId },
			}),
		).toBe(0);
	});

	it("does not import through a contact on an archived company", async () => {
		const input = message({
			providerMessageId: `provider-archived-${suffix}`,
			providerThreadId: `thread-archived-${suffix}`,
			rfcMessageId: `<rfc-archived-${suffix}@mail.test>`,
			rootMessageId: roots[3],
			recipients: [
				{ email: archivedEmail, name: "Archived Buyer", kind: "to" },
			],
		});
		const result = await history.import(input, userId, mailbox);

		expect(result.status).toBe("unresolved");
		expect(
			await db.emailMessage.count({
				where: { rfcMessageId: input.rfcMessageId },
			}),
		).toBe(0);
	});
});
