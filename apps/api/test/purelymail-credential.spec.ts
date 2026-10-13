import { describe, expect, it } from "bun:test";
import {
	decryptPurelymailPassword,
	encryptPurelymailPassword,
	parsePurelymailCredentialKey,
	sanitizePurelymailError,
} from "../src/mailbox/purelymail-credential.crypto";
import {
	parseCursor,
	selectPurelymailUids,
} from "../src/mailbox/purelymail-cursor";

const key = Buffer.alloc(32, 7);

describe("Purelymail credential protection", () => {
	it("round-trips the password without storing it as plaintext", () => {
		const encrypted = encryptPurelymailPassword("fixture-password", key);

		expect(encrypted.ciphertext).not.toContain("fixture-password");
		expect(decryptPurelymailPassword(encrypted, key)).toBe("fixture-password");
	});

	it("accepts only the configured versioned 32-byte key", () => {
		const encoded = key.toString("base64url");
		expect(parsePurelymailCredentialKey(`v1:${encoded}`)).toEqual(key);
		expect(parsePurelymailCredentialKey(`v2:${encoded}`)).toBeNull();
		expect(parsePurelymailCredentialKey("v1:short")).toBeNull();
	});

	it("reduces credential-bearing errors to safe categories", () => {
		const password = "synthetic-password-canary-42";
		const safe = sanitizePurelymailError(
			new Error(`AUTH failed for password=${password}; stack=${password}`),
		);

		expect(safe).toBe("Purelymail authentication failed.");
		expect(safe).not.toContain(password);
	});
});

describe("Purelymail cursor progress", () => {
	it("advances to the next batch instead of repeating the first 50", () => {
		const first = selectPurelymailUids(
			Array.from({ length: 100 }, (_, index) => index + 1),
			null,
			"Sent",
			"11",
			50,
		);
		const second = selectPurelymailUids(
			Array.from({ length: 100 }, (_, index) => index + 1),
			first.nextCursor,
			"Sent",
			"11",
			50,
		);

		expect(first.uids).toHaveLength(50);
		expect(first.nextCursor.uid).toBe(50);
		expect(second.uids[0]).toBe(51);
		expect(second.nextCursor.uid).toBe(100);
	});

	it("restarts safely when folder or UIDVALIDITY changes", () => {
		const cursor = parseCursor(
			JSON.stringify({ folder: "Sent", uidValidity: "11", uid: 99 }),
		);

		expect(
			selectPurelymailUids([1, 2, 3], cursor, "Sent", "12", 50).uids,
		).toEqual([1, 2, 3]);
		expect(
			selectPurelymailUids([1, 2, 3], cursor, "Archive/Sent", "11", 50).uids,
		).toEqual([1, 2, 3]);
		expect(parseCursor(JSON.stringify({ uid: 99 }))).toBeNull();
	});
});
