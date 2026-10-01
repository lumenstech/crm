import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const DEFAULT_ISSUER = "https://comp-crm-api.516labs.com";
const DEFAULT_RESOURCE = "https://comp-crm-mcp.516labs.com/mcp";

function equalSecret(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export function parseCallerTokens(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];

	if (!trimmed.startsWith("{")) return [trimmed];

	const parsed = JSON.parse(trimmed) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("MCP_CALLER_TOKENS JSON value must be an object.");
	}

	return Object.keys(parsed as Record<string, unknown>).filter(Boolean);
}

export function bearerToken(header: string | undefined): string | null {
	if (!header) return null;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1]?.trim() || null;
}

export function isAuthorized(
	header: string | undefined,
	tokens: readonly string[],
): boolean {
	const supplied = bearerToken(header);
	if (!supplied) return false;
	return tokens.some((token) => equalSecret(supplied, token));
}

export type OAuthVerifier = {
	issuer: string;
	resource: string;
	resourceMetadataUrl: string;
	isAuthorized: (header: string | undefined) => Promise<boolean>;
};

export function createOAuthVerifier(): OAuthVerifier {
	const issuer = process.env.MCP_OAUTH_ISSUER_URL?.trim() || DEFAULT_ISSUER;
	const resource = process.env.MCP_PUBLIC_URL?.trim() || DEFAULT_RESOURCE;
	const jwksUrl =
		process.env.MCP_OAUTH_JWKS_URL?.trim() || `${issuer}/api/auth/jwks`;
	const jwks = createRemoteJWKSet(new URL(jwksUrl));
	const resourceMetadataUrl =
		process.env.MCP_RESOURCE_METADATA_URL?.trim() ||
		`${new URL(resource).origin}/.well-known/oauth-protected-resource`;

	return {
		issuer,
		resource,
		resourceMetadataUrl,
		isAuthorized: async (header) => {
			const token = bearerToken(header);
			if (token?.split(".").length !== 3) return false;
			try {
				const { payload } = await jwtVerify(token, jwks, {
					issuer,
					audience: resource,
				});
				const scopes =
					typeof payload.scope === "string"
						? new Set(payload.scope.split(/\s+/).filter(Boolean))
						: new Set<string>();
				return scopes.has("crm:read") && scopes.has("crm:write");
			} catch {
				return false;
			}
		},
	};
}
