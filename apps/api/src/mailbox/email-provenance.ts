import type { JsonValue } from "@crm/db/json";
import { z } from "zod";
import { parseVerifiedSenderBusinessUnits } from "../config/mailbox-identity";

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

export function verifiedSendingBusinessUnitKey(
	email: string | null | undefined,
): string | null {
	if (!email) return null;
	const normalized = email.trim().toLowerCase();
	return (
		parseVerifiedSenderBusinessUnits(
			process.env.CRM_VERIFIED_SENDER_BUSINESS_UNITS_JSON,
		).find((row) => row.email === normalized)?.businessUnit ?? null
	);
}

export function evidenceForSender(
	email: string | null | undefined,
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
