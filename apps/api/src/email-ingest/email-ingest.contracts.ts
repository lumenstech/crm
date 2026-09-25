import { z } from "zod";

export const CRM_EMAIL_VERSION = "COMP-CRM-INGEST-V1" as const;

const contact = z.object({
	name: z.string().trim().min(1).max(240).nullable().optional(),
	firstName: z.string().trim().min(1).max(120).nullable().optional(),
	lastName: z.string().trim().max(120).nullable().optional(),
	email: z.string().trim().email().nullable().optional(),
	phone: z.string().trim().max(80).nullable().optional(),
	title: z.string().trim().max(160).nullable().optional(),
	linkedinUrl: z.string().url().nullable().optional(),
});

export const crmEmailLead = z.object({
	sourceId: z.string().trim().min(1).max(320).nullable().optional(),
	company: z.string().trim().min(1).max(320),
	domain: z.string().trim().max(320).nullable().optional(),
	sourceUrl: z.string().url().nullable().optional(),
	signalScore: z.number().min(0).max(100).nullable().optional(),
	tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
	qualification: z.string().trim().max(2000).nullable().optional(),
	notes: z.string().trim().max(4000).nullable().optional(),
	contact: contact.nullable().optional(),
});

export const crmEmailBatch = z.object({
	version: z.literal(CRM_EMAIL_VERSION),
	mode: z.enum(["CHECK", "INGEST"]).default("INGEST"),
	batchId: z.string().trim().min(1).max(160),
	businessUnit: z.string().trim().min(1).max(96),
	leads: z.array(crmEmailLead).min(1).max(100),
});

export type CrmEmailLead = z.infer<typeof crmEmailLead>;
export type CrmEmailBatch = z.infer<typeof crmEmailBatch>;

export function parseCrmEmailBatch(text: string): CrmEmailBatch {
	const trimmed = text.trim();
	const hasHeader = trimmed.startsWith(CRM_EMAIL_VERSION);
	const jsonText = hasHeader
		? trimmed.slice(CRM_EMAIL_VERSION.length).trimStart()
		: trimmed;
	const parsed = JSON.parse(jsonText) as unknown;
	if (hasHeader && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
		return crmEmailBatch.parse({ version: CRM_EMAIL_VERSION, ...parsed });
	}
	return crmEmailBatch.parse(parsed);
}
