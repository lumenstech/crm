import { describe, expect, it } from "bun:test";
import {
	GoogleSyncStatus,
	type MailboxSyncModel as MailboxSync,
} from "@crm/db";
import type { GmailMessage } from "../src/google/gmail.client";
import { GmailSyncService } from "../src/google/gmail-sync.service";
import type { IncomingMessage } from "../src/mailbox/thread-writer.service";

type StoreOptions = {
	mailbox: string;
	origin: "gmail";
	providerThreadId?: string;
};

function message(index: number): GmailMessage {
	return {
		id: `gmail-${index}`,
		threadId: `gmail-thread-${index}`,
		payload: {
			headers: [
				{ name: "Message-ID", value: `<gmail-${index}@mail.test>` },
				{ name: "From", value: `Buyer ${index} <buyer-${index}@mail.test>` },
				{ name: "To", value: "Rep <rep@example.test>" },
				{ name: "Date", value: "2026-10-10T12:00:00.000Z" },
			],
		},
	};
}

describe("GmailSyncService batching", () => {
	it("advances past a full batch and preserves Gmail thread identity", async () => {
		const messages = Array.from({ length: 121 }, (_, index) => message(index));
		const storedIds = new Set<string>();
		const stored: { parsed: IncomingMessage; options: StoreOptions }[] = [];
		const settled: { cursor?: string | null; status: GoogleSyncStatus }[] = [];

		const db = {
			emailMessage: {
				findMany: async () =>
					[...storedIds].map((gmailMessageId) => ({ gmailMessageId })),
			},
		} as unknown as ConstructorParameters<typeof GmailSyncService>[0];
		const gmail = {
			async profile() {
				return {
					outcome: "ok" as const,
					data: { emailAddress: "rep@example.test", historyId: "history-next" },
				};
			},
			async listHistory() {
				return {
					outcome: "ok" as const,
					data: {
						historyId: "history-next",
						history: [
							{
								messagesAdded: messages.map((entry) => ({
									message: { id: entry.id, threadId: entry.threadId },
								})),
							},
						],
					},
				};
			},
			async getMessage(_accessToken: string, id: string) {
				return {
					outcome: "ok" as const,
					data: messages.find((entry) => entry.id === id),
				};
			},
		} as unknown as ConstructorParameters<typeof GmailSyncService>[1];
		const tokens = {
			async accessTokenFor() {
				return { outcome: "ok" as const, accessToken: "token" };
			},
		} as unknown as ConstructorParameters<typeof GmailSyncService>[2];
		const state = {
			async markRunning() {},
			async settle(
				_id: string,
				update: { cursor?: string | null; status: GoogleSyncStatus },
			) {
				settled.push(update);
			},
		} as unknown as ConstructorParameters<typeof GmailSyncService>[3];
		const threads = {
			async context() {
				return {};
			},
			async store(
				_row: MailboxSync,
				options: StoreOptions,
				parsed: IncomingMessage,
			) {
				storedIds.add(parsed.gmailMessageId ?? "");
				stored.push({ parsed, options });
				return true;
			},
		} as unknown as ConstructorParameters<typeof GmailSyncService>[4];

		const service = new GmailSyncService(db, gmail, tokens, state, threads);
		const row = {
			id: "sync-1",
			userId: "user-1",
			source: "gmail",
			status: GoogleSyncStatus.IDLE,
			cursor: "history-start",
			autoCreate: false,
		} as unknown as MailboxSync;

		await service.sync(row);
		expect(stored).toHaveLength(120);
		expect(settled[0]?.cursor).toBe("history-start");
		expect(stored[0]?.options.providerThreadId).toBe("gmail-thread-0");

		await service.sync({ ...row, cursor: settled[0]?.cursor } as MailboxSync);
		expect(stored).toHaveLength(121);
		expect(settled[1]?.cursor).toBe("history-next");
		expect(stored[120]?.options.providerThreadId).toBe("gmail-thread-120");
	});
});