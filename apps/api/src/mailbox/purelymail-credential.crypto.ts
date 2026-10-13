import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const PURELYMAIL_CREDENTIAL_KEY_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;

export type EncryptedPurelymailPassword = {
	ciphertext: string;
	nonce: string;
	authTag: string;
	keyVersion: number;
};

export function parsePurelymailCredentialKey(
	raw: string | undefined,
): Buffer | null {
	if (!raw) return null;
	const match = /^v(\d+):([A-Za-z0-9_-]+)$/.exec(raw.trim());
	if (!match || Number(match[1]) !== PURELYMAIL_CREDENTIAL_KEY_VERSION) {
		return null;
	}

	const encoded = match[2];
	if (!encoded) return null;
	const key = Buffer.from(encoded, "base64url");
	return key.length === KEY_BYTES ? key : null;
}

export function encryptPurelymailPassword(
	password: string,
	key: Buffer,
): EncryptedPurelymailPassword {
	if (key.length !== KEY_BYTES) {
		throw new Error("Invalid Purelymail credential key.");
	}

	const nonce = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, nonce);
	const ciphertext = Buffer.concat([
		cipher.update(password, "utf8"),
		cipher.final(),
	]);

	return {
		ciphertext: ciphertext.toString("base64url"),
		nonce: nonce.toString("base64url"),
		authTag: cipher.getAuthTag().toString("base64url"),
		keyVersion: PURELYMAIL_CREDENTIAL_KEY_VERSION,
	};
}

export function decryptPurelymailPassword(
	value: Pick<
		EncryptedPurelymailPassword,
		"ciphertext" | "nonce" | "authTag" | "keyVersion"
	>,
	key: Buffer,
): string {
	if (
		key.length !== KEY_BYTES ||
		value.keyVersion !== PURELYMAIL_CREDENTIAL_KEY_VERSION
	) {
		throw new Error("Invalid Purelymail credential key version.");
	}

	const decipher = createDecipheriv(
		"aes-256-gcm",
		key,
		Buffer.from(value.nonce, "base64url"),
	);
	decipher.setAuthTag(Buffer.from(value.authTag, "base64url"));
	return Buffer.concat([
		decipher.update(Buffer.from(value.ciphertext, "base64url")),
		decipher.final(),
	]).toString("utf8");
}

export function sanitizePurelymailError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();

	if (
		normalized.includes("auth") ||
		normalized.includes("login") ||
		normalized.includes("credential") ||
		normalized.includes("password")
	) {
		return "Purelymail authentication failed.";
	}
	if (normalized.includes("timeout") || normalized.includes("timed out")) {
		return "Purelymail connection timed out.";
	}
	if (
		normalized.includes("socket") ||
		normalized.includes("connect") ||
		normalized.includes("network") ||
		normalized.includes("econn")
	) {
		return "Purelymail connection failed.";
	}
	if (
		normalized.includes("mailbox") ||
		normalized.includes("folder") ||
		normalized.includes("select") ||
		normalized.includes("sent")
	) {
		return "Purelymail Sent folder could not be selected.";
	}
	return "Purelymail synchronization failed.";
}
