import { describe, expect, it } from "bun:test";
import { makeSignature } from "better-auth/crypto";
import { verifiedOAuthConsentQuery } from "./oauth-consent";

const secret = "test-secret-at-least-long-enough-to-be-a-secret";

function signatureInput(params: URLSearchParams) {
	return new URLSearchParams(
		[...params.entries()].sort(([keyA, valueA], [keyB, valueB]) => {
			if (keyA < keyB) return -1;
			if (keyA > keyB) return 1;
			if (valueA < valueB) return -1;
			if (valueA > valueB) return 1;
			return 0;
		}),
	).toString();
}

describe("verifiedOAuthConsentQuery", () => {
	it("preserves the signed query for the provider consent request", async () => {
		process.env.BETTER_AUTH_SECRET = secret;
		const expiresAt = Math.floor(Date.now() / 1000) + 300;
		const unsigned = new URLSearchParams([
			["client_id", "client-id"],
			["scope", "crm:read crm:write offline_access"],
			["redirect_uri", "https://chatgpt.com/connector_platform_oauth_redirect"],
			["exp", String(expiresAt)],
			["ba_param", "state"],
			["ba_param", "code_challenge"],
		]);
		const signature = await makeSignature(signatureInput(unsigned), secret);
		const values = Object.fromEntries(unsigned.entries());
		const verified = await verifiedOAuthConsentQuery({
			...values,
			ba_param: ["state", "code_challenge"],
			sig: signature,
		});

		expect(verified?.params.get("sig")).toBeNull();
		const signedQuery = new URLSearchParams(verified?.oauthQuery);
		expect(signedQuery.get("sig")).toBe(signature);
		expect(signedQuery.getAll("ba_param")).toEqual(["state", "code_challenge"]);
	});

	it("rejects a query with a changed signed value", async () => {
		process.env.BETTER_AUTH_SECRET = secret;
		const expiresAt = Math.floor(Date.now() / 1000) + 300;
		const unsigned = new URLSearchParams([
			["client_id", "client-id"],
			["scope", "crm:read"],
			["redirect_uri", "https://chatgpt.com/connector_platform_oauth_redirect"],
			["exp", String(expiresAt)],
		]);
		const signature = await makeSignature(signatureInput(unsigned), secret);

		const verified = await verifiedOAuthConsentQuery({
			client_id: "different-client-id",
			scope: "crm:read",
			redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
			exp: String(expiresAt),
			sig: signature,
		});

		expect(verified).toBeNull();
	});
});
