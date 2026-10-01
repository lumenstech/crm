import { constantTimeEqual, makeSignature } from "better-auth/crypto";

type ConsentSearchParams = Record<string, string | string[] | undefined>;

function canonicalize(params: URLSearchParams) {
	const canonical = new URLSearchParams();
	const entries = [...params.entries()].sort(
		([keyA, valueA], [keyB, valueB]) => {
			if (keyA < keyB) return -1;
			if (keyA > keyB) return 1;
			if (valueA < valueB) return -1;
			if (valueA > valueB) return 1;
			return 0;
		},
	);
	for (const [key, value] of entries) canonical.append(key, value);
	return canonical;
}

function toSearchParams(values: ConsentSearchParams) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (Array.isArray(value)) {
			for (const item of value) params.append(key, item);
		} else if (value !== undefined) {
			params.append(key, value);
		}
	}
	return params;
}

export async function verifiedOAuthConsentQuery(values: ConsentSearchParams) {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) return null;

	const params = toSearchParams(values);
	const signatures = params.getAll("sig");
	const signature = params.get("sig");
	const expiresAt = Number(params.get("exp"));
	params.delete("sig");

	if (
		signatures.length !== 1 ||
		!signature ||
		!Number.isFinite(expiresAt) ||
		expiresAt * 1000 < Date.now()
	) {
		return null;
	}

	const expected = await makeSignature(canonicalize(params).toString(), secret);
	if (!constantTimeEqual(signature, expected)) return null;

	return params;
}
