import { z } from "zod";

export const historicalEmailSource = z.enum(["gmail", "outlook"]);

const participant = z
	.object({
		email: z
			.string()
			.email()
			.max(320)
			.transform((value) => value.toLowerCase()),
		name: z.string().trim().max(320).nullable(),
	})
	.strict();

const recipient = participant.extend({
	kind: z.enum(["to", "cc"]),
});

export const historicalEmailImportInput = z
	.object({
		source: historicalEmailSource,
		mailbox: z
			.string()
			.email()
			.max(320)
			.transform((value) => value.toLowerCase()),
		providerMessageId: z.string().trim().min(1).max(320),
		providerThreadId: z.string().trim().min(1).max(320),
		rfcMessageId: z.string().trim().min(1).max(500),
		rootMessageId: z.string().trim().min(1).max(500),
		subject: z.string().trim().max(998).nullable(),
		body: z.string().max(200_000),
		from: participant,
		recipients: z.array(recipient).min(1).max(100),
		sentAt: z.iso.datetime({ offset: true }),
		outlookWebLink: z.url().max(2_000).nullable().optional(),
	})
	.strict();

export const historicalEmailMatchCandidate = z.object({
	contactId: z.string().nullable(),
	contactEmail: z.string().nullable(),
	companyId: z.string().nullable(),
	companyName: z.string().nullable(),
});

export const historicalEmailImportOutput = z.object({
	status: z.enum([
		"imported",
		"duplicate",
		"unresolved",
		"ambiguous",
		"conflict",
	]),
	source: historicalEmailSource,
	providerMessageId: z.string(),
	providerThreadId: z.string(),
	rfcMessageId: z.string(),
	direction: z.enum(["inbound", "outbound"]),
	companyId: z.string().nullable(),
	contactId: z.string().nullable(),
	activityId: z.string().nullable(),
	emailThreadId: z.string().nullable(),
	originalSentAt: z.string(),
	candidates: z.array(historicalEmailMatchCandidate),
	reason: z.string().nullable(),
});

export type HistoricalEmailImportInput = z.infer<
	typeof historicalEmailImportInput
>;
export type HistoricalEmailImportOutput = z.infer<
	typeof historicalEmailImportOutput
>;
