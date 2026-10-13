import { describe, expect, it } from "bun:test";
import {
	GoogleSyncStatus,
	type MailboxSyncModel as MailboxSync,
} from "@crm/db";
import { PURELYMAIL_OWNER_USER_ID } from "@crm/db/purelymail";
import type { ImapFlow } from "imapflow";
import type { ActivePurelymailCredential } from "../src/mailbox/purelymail-credential.service";
import { PURELYMAIL_IMAP } from "../src/mailbox/purelymail-imap.config";
import { PurelymailImapService } from "../src/mailbox/purelymail-imap.service";
import type { SyncStateService } from "../src/mailbox/sync-state.service";
import type { ThreadWriterService } from "../src/mailbox/thread-writer.service";

const UPDATED_AT = new Date("2026-10-13T00:00:00.000Z");

type DispositionInput = {
	create?: { status?: string; uid?: number; uidValidity?: string };
	update?: { status?: string; uid?: number; uidValidity?: string };
};

function message(uid: number, oversized = false, missingSource = false) {
	const source = Buffer.from(
		[
			`From: Sender ${uid} <sender-${uid}@example.test>`,
			"To: customer@example.test",
			`Message-ID: <purelymail-${uid}@example.test>`,
			"Date: Tue, 13 Oct 2026 00:00:00 +0000",
			`Subject: Message ${uid}`,
			"",
			"Body",
		].join("\r\n"),
	);
	return {
		uid,
		internalDate: new Date("2026-10-13T00:00:00.000Z"),
		size: oversized ? PURELYMAIL_IMAP.maxMessageBytes + 1 : source.length,
		source: missingSource
			? undefined
			: oversized
				? Buffer.concat([source, Buffer.alloc(PURELYMAIL_IMAP.maxMessageBytes)])
				: source,
	};
}

class FakeImap {
	mailbox = { uidValidity: 7, readOnly: true };
	usable = true;
	readonly fetched: number[][] = [];
	oversizedFirst = true;
	omitSourceOnFirstFetch = false;

	onFetch: (uids: number[]) => void;

	constructor(onFetch: (uids: number[]) => void) {
		this.onFetch = onFetch;
	}

	async connect(): Promise<void> {}

	async getMailboxLock(_folder: string, options: { readOnly?: boolean }) {
		if (!options.readOnly) throw new Error("test expected a read-only lock");
		return { release() {} };
	}

	async search(): Promise<number[]> {
		return Array.from({ length: 100 }, (_, index) => index + 1);
	}

	async fetchAll(uids: number[]): Promise<ReturnType<typeof message>[]> {
		this.fetched.push(uids);
		const omitSource = this.omitSourceOnFirstFetch;
		this.onFetch(uids);
		return uids.map((uid) =>
			message(uid, this.oversizedFirst && uid === 1, omitSource && uid === 1),
		);
	}

	async logout(): Promise<void> {}

	close(): void {}
}

function buildHarness(options?: {
	current?: () => boolean;
	oversizedFirst?: boolean;
}) {
	const row = {
		id: "sync-1",
		userId: PURELYMAIL_OWNER_USER_ID,
		source: "purelymail",
		status: GoogleSyncStatus.IDLE,
		cursor: null,
		lastSyncedAt: null,
		lastError: null,
		retryAfter: null,
		autoCreate: false,
		createdAt: UPDATED_AT,
		updatedAt: UPDATED_AT,
	} as MailboxSync;
	const credential: ActivePurelymailCredential = {
		userId: PURELYMAIL_OWNER_USER_ID,
		password: "fixture-password",
		folder: "Sent",
		updatedAt: UPDATED_AT,
	};
	const dispositions: DispositionInput[] = [];
	const writes: number[] = [];
	const fakeClient = new FakeImap(() => undefined);
	fakeClient.oversizedFirst = options?.oversizedFirst ?? true;
	const current = options?.current ?? (() => true);
	const db = {
		mailboxSyncDisposition: {
			upsert: async (input: DispositionInput) => {
				dispositions.push(input);
				return { id: `disposition-${dispositions.length}` };
			},
		},
	};
	const state = {
		get: async () => row,
		ensureUnchanged: async () => row,
		claim: async () => {
			row.status = GoogleSyncStatus.RUNNING;
			return true;
		},
		settle: async (
			_id: string,
			update: { cursor?: string | null; status: GoogleSyncStatus },
		) => {
			row.cursor = update.cursor ?? null;
			row.status = update.status;
			row.retryAfter = null;
		},
		markFailed: async () => {
			row.status = GoogleSyncStatus.FAILED;
		},
		cancel: async () => {
			row.status = GoogleSyncStatus.IDLE;
			row.retryAfter = null;
		},
	} as unknown as SyncStateService;
	const writer = {
		context: async () => ({
			ourAddresses: new Set<string>(),
			ourDomains: new Set<string>(),
			suppressedDomains: new Set<string>(),
			suppressedEmails: new Set<string>(),
		}),
		storeDetailed: async () => {
			writes.push(writes.length + 1);
			return {
				status: "stored" as const,
				activityId: `activity-${writes.length}`,
				companyId: null,
				contactId: null,
			};
		},
	} as unknown as ThreadWriterService;
	const credentials = {
		active: async () => credential,
		isCurrent: async () => current(),
	};
	const service = new (class extends PurelymailImapService {
		protected override createClient(): ImapFlow {
			return fakeClient as unknown as ImapFlow;
		}
	})(
		db as never,
		state,
		writer,
		{
			list: async () => [{ id: "unit-1", key: "data-gear", name: "Data Gear" }],
		} as never,
		credentials as never,
	);

	return { service, row, fakeClient, dispositions, writes };
}

describe("Purelymail IMAP service progress fencing", () => {
	it("records an oversized UID and advances through the next 50-message page", async () => {
		const harness = buildHarness();

		const first = await harness.service.poll();
		const firstCursor = harness.row.cursor;
		const second = await harness.service.poll();

		expect(first.failed).toBe(0);
		expect(first.skipped).toBe(1);
		expect(firstCursor).toContain('"uid":50');
		expect(second.processed).toBe(50);
		expect(harness.row.cursor).toContain('"uid":100');
		expect(harness.fakeClient.fetched).toEqual([
			Array.from({ length: 50 }, (_, index) => index + 1),
			Array.from({ length: 50 }, (_, index) => index + 51),
		]);
		expect(harness.writes).toHaveLength(99);
		expect(harness.dispositions).toHaveLength(1);
		expect(harness.dispositions[0]).toMatchObject({
			create: { status: "SKIPPED", uid: 1, uidValidity: "7" },
		});
	});

	it("stops before importing when the credential is paused during fetch", async () => {
		let current = true;
		const harness = buildHarness({ current: () => current });
		harness.fakeClient.onFetch = () => {
			current = false;
		};

		const result = await harness.service.poll();

		expect(result.status).toBe("disabled");
		expect(harness.writes).toHaveLength(0);
		expect(harness.row.status).toBe(GoogleSyncStatus.IDLE);
		expect(harness.row.cursor).toBeNull();
	});

	it("retries a missing message body instead of recording a permanent skip", async () => {
		const harness = buildHarness({ oversizedFirst: false });
		harness.fakeClient.omitSourceOnFirstFetch = true;
		harness.fakeClient.onFetch = () => {
			harness.fakeClient.omitSourceOnFirstFetch = false;
		};

		const first = await harness.service.poll();
		const second = await harness.service.poll();

		expect(first.failed).toBe(1);
		expect(first.skipped).toBe(0);
		expect(harness.row.cursor).toContain('"uid":50');
		expect(second.failed).toBe(0);
		expect(second.processed).toBe(50);
		expect(harness.dispositions).toHaveLength(0);
	});
});
