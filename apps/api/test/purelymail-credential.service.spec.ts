import { describe, expect, it } from "bun:test";
import { GoogleSyncStatus } from "@crm/db";
import { PURELYMAIL_OWNER_USER_ID } from "@crm/db/purelymail";
import { encryptPurelymailPassword } from "../src/mailbox/purelymail-credential.crypto";
import { PurelymailCredentialService } from "../src/mailbox/purelymail-credential.service";

const key = Buffer.alloc(32, 9);
const encodedKey = `v1:${key.toString("base64url")}`;

type SyncUpdate = {
	where?: { status?: { not?: GoogleSyncStatus } };
	data?: {
		retryAfter?: Date | null;
		status?: GoogleSyncStatus;
		lastError?: string | null;
	};
};

type CredentialRecord = {
	userId: string;
	encryptedPassword: string;
	nonce: string;
	authTag: string;
	keyVersion: number;
	folder: string;
	enabled: boolean;
	updatedAt: Date;
};

type CredentialUpdate = {
	where: { userId: string; updatedAt?: Date };
	data: { enabled?: boolean };
};

type CredentialUpsert = {
	update: Omit<CredentialRecord, "userId" | "updatedAt">;
};

function createHarness(skippedCount = 0) {
	const encrypted = encryptPurelymailPassword("fixture-password", key);
	const syncUpdates: SyncUpdate[] = [];
	const credential = {
		userId: PURELYMAIL_OWNER_USER_ID,
		encryptedPassword: encrypted.ciphertext,
		nonce: encrypted.nonce,
		authTag: encrypted.authTag,
		keyVersion: encrypted.keyVersion,
		folder: "Sent",
		enabled: true,
		updatedAt: new Date("2026-10-13T00:00:00.000Z"),
	};
	const db = {
		purelymailCredential: {
			findUnique: async () => credential,
			findFirst: async () => credential,
			upsert: async () => credential,
			updateMany: async () => ({ count: 1 }),
			deleteMany: async () => ({ count: 1 }),
		},
		mailboxSync: {
			findUnique: async () => ({
				status: GoogleSyncStatus.RUNNING,
				lastSyncedAt: null,
				lastError: "old error",
			}),
			upsert: async () => ({}),
			updateMany: async (input: SyncUpdate) => {
				syncUpdates.push(input);
				return { count: 0 };
			},
		},
		mailboxSyncDisposition: {
			count: async () => skippedCount,
		},
	};
	const service = new PurelymailCredentialService(
		{ get: () => encodedKey } as never,
		db as never,
	);

	return { service, syncUpdates };
}

function createRaceHarness() {
	const encrypted = encryptPurelymailPassword("fixture-password", key);
	let record: CredentialRecord = {
		userId: PURELYMAIL_OWNER_USER_ID,
		encryptedPassword: encrypted.ciphertext,
		nonce: encrypted.nonce,
		authTag: encrypted.authTag,
		keyVersion: encrypted.keyVersion,
		folder: "Sent",
		enabled: true,
		updatedAt: new Date("2026-10-13T00:00:00.000Z"),
	};
	let releaseRead!: () => void;
	let readSeen!: () => void;
	const firstRead = new Promise<void>((resolve) => {
		readSeen = resolve;
	});
	const readReleased = new Promise<void>((resolve) => {
		releaseRead = resolve;
	});
	let blockFirstRead = true;
	const db = {
		purelymailCredential: {
			findUnique: async () => {
				const snapshot = { ...record };
				if (blockFirstRead) {
					blockFirstRead = false;
					readSeen();
					await readReleased;
				}
				return snapshot;
			},
			findFirst: async () => record,
			upsert: async (input: CredentialUpsert) => {
				record = {
					...record,
					...input.update,
					updatedAt: new Date("2026-10-13T00:00:01.000Z"),
				};
				return record;
			},
			updateMany: async (input: CredentialUpdate) => {
				if (
					input.where.updatedAt &&
					input.where.updatedAt.getTime() !== record.updatedAt.getTime()
				) {
					return { count: 0 };
				}
				record = {
					...record,
					...input.data,
					updatedAt: new Date("2026-10-13T00:00:02.000Z"),
				};
				return { count: 1 };
			},
			deleteMany: async () => ({ count: 1 }),
		},
		mailboxSync: {
			findUnique: async () => ({
				status: GoogleSyncStatus.RUNNING,
				lastSyncedAt: null,
				lastError: null,
			}),
			upsert: async () => ({}),
			updateMany: async () => ({ count: 0 }),
		},
		mailboxSyncDisposition: {
			count: async () => 0,
		},
	};
	const service = new PurelymailCredentialService(
		{ get: () => encodedKey } as never,
		db as never,
	);

	return { service, firstRead, releaseRead };
}

describe("Purelymail credential controls", () => {
	it("does not clear a running lease while enabling or replacing credentials", async () => {
		const harness = createHarness();

		await harness.service.enable(PURELYMAIL_OWNER_USER_ID);
		await harness.service.save(
			PURELYMAIL_OWNER_USER_ID,
			"replacement-password",
			"Sent",
		);

		expect(
			harness.syncUpdates
				.filter((value) => value.data?.retryAfter === null)
				.every(
					(value) => value.where?.status?.not === GoogleSyncStatus.RUNNING,
				),
		).toBe(true);
	});

	it("reports skipped history as incomplete in status", async () => {
		const harness = createHarness(3);

		expect(
			(await harness.service.status(PURELYMAIL_OWNER_USER_ID)).sync,
		).toEqual(
			expect.objectContaining({
				skippedCount: 3,
				historyIncomplete: true,
			}),
		);
	});

	it("rejects an enable that loses a race with replacement or pause", async () => {
		for (const mutation of ["replace", "pause"] as const) {
			const harness = createRaceHarness();
			const enabling = harness.service.enable(PURELYMAIL_OWNER_USER_ID);
			await harness.firstRead;

			if (mutation === "replace") {
				await harness.service.save(
					PURELYMAIL_OWNER_USER_ID,
					"replacement-password",
					"Sent",
				);
			} else {
				await harness.service.pause(PURELYMAIL_OWNER_USER_ID);
			}

			harness.releaseRead();
			await expect(enabling).rejects.toThrow(
				"Purelymail credential changed. Save it again before enabling.",
			);
		}
	});
});
