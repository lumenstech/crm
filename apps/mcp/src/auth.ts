import { timingSafeEqual } from "node:crypto";

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

export function isAuthorized(header: string | undefined, tokens: readonly string[]): boolean {
  const supplied = bearerToken(header);
  if (!supplied) return false;
  return tokens.some((token) => equalSecret(supplied, token));
}
