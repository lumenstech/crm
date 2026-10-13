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

function createHarness() {
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
			update: async () => credential,
			updateMany: async (input: SyncUpdate) => {
				syncUpdates.push(input);
				return { count: 0 };
			},
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
	};
	const service = new PurelymailCredentialService(
		{ get: () => encodedKey } as never,
		db as never,
	);

	return { service, syncUpdates };
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
});
