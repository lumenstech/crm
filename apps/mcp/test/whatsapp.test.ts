import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import {
	verifyWhatsappChallenge,
	verifyWhatsappSignature,
} from "../src/whatsapp";

describe("WhatsApp webhook verification", () => {
	it("accepts the configured Meta verification challenge", () => {
		const url = new URL(
			"https://example.test/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=challenge-value",
		);
		expect(verifyWhatsappChallenge(url, "verify-me")).toBe("challenge-value");
	});

	it("rejects a mismatched verification token", () => {
		const url = new URL(
			"https://example.test/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=value",
		);
		expect(verifyWhatsappChallenge(url, "verify-me")).toBeNull();
	});

	it("verifies X-Hub-Signature-256 against the raw request body", () => {
		const body = Buffer.from('{"entry":[]}');
		const secret = "app-secret";
		const signature =
			`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
		expect(verifyWhatsappSignature(body, signature, secret)).toBe(true);
		expect(verifyWhatsappSignature(body, "sha256=deadbeef", secret)).toBe(
			false,
		);
	});
});
