import type { JsonValue } from "@crm/db/json";
import { z } from "zod";

const sendingBusinessUnitEvidenceSchema = z
	.object({
		key: z.string().trim().min(1).max(96),
		source: z.literal("verified-sender"),
		immutable: z.literal(true),
	})
	.strict();

const emailActivityMetaSchema = z
	.object({
		sendingBusinessUnit: sendingBusinessUnitEvidenceSchema.optional(),
	})
	.catchall(z.json());

export type SendingBusinessUnitEvidence = z.infer<
	typeof sendingBusinessUnitEvidenceSchema
>;

export function verifiedSendingBusinessUnitKey(email: string): string | null {
	return email.toLowerCase() === "sales@data-gear.com" ? "data-gear" : null;
}

export function evidenceForSender(
	email: string,
): SendingBusinessUnitEvidence | null {
	const key = verifiedSendingBusinessUnitKey(email);
	return key ? { key, source: "verified-sender", immutable: true } : null;
}

export function sendingBusinessUnitEvidence(
	value: JsonValue | null | undefined,
): SendingBusinessUnitEvidence | null {
	const parsed = emailActivityMetaSchema.safeParse(value);
	return parsed.success ? (parsed.data.sendingBusinessUnit ?? null) : null;
}