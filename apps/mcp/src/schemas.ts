import { z } from "zod";
export const businessUnitKey = z.string().trim().min(1).max(96);

export const searchCrmInput = z.object({
	q: z.string().trim().min(1).max(320),
});

export const signalPayloadValue = z.json();
export const jsonObject = z.record(z.string(), signalPayloadValue);
export type SignalPayloadValue = z.infer<typeof signalPayloadValue>;

export const ingestSignalInput = z.object({
	source: z.string().trim().min(1).max(96),
	sourceType: z.string().trim().min(1).max(160),
	sourceId: z.string().trim().min(1).max(320),
	sourceUrl: z.url().nullable().optional(),
	observedAt: z.iso.datetime({ offset: true }).nullable().optional(),
	entity: z.string().trim().min(1).max(320).nullable().optional(),
	signalScore: z.number().min(0).max(100).nullable().optional(),
	tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
	payload: z.record(z.string(), signalPayloadValue).default({}),
});

export const ingestLeadsInput = z.object({
	businessUnit: businessUnitKey,
	signals: z.array(ingestSignalInput).min(1).max(100),
});

export type IngestLeadsInput = z.infer<typeof ingestLeadsInput>;

export const reusableRecordType = z.enum(["company", "contact"]);

export const associateRecordWithBusinessUnitInput = z.object({
	recordType: reusableRecordType,
	recordId: z.string().trim().min(1),
	targetBusinessUnit: businessUnitKey,
	useCase: z.string().trim().min(1).max(240).nullable().optional(),
	notes: z.string().trim().max(2000).nullable().optional(),
});

export const listRecordBusinessUnitsInput = z.object({
	recordType: reusableRecordType,
	recordId: z.string().trim().min(1),
});

export const createBusinessUnitOpportunityInput = z.object({
	companyId: z.string().trim().min(1),
	contactId: z.string().trim().min(1).nullable().optional(),
	targetBusinessUnit: businessUnitKey,
	ownerId: z.string().trim().min(1).nullable().optional(),
	name: z.string().trim().min(1).max(240),
	useCase: z.string().trim().min(1).max(240).nullable().optional(),
	notes: z.string().trim().max(4000).nullable().optional(),
});

export type AssociateRecordWithBusinessUnitInput = z.infer<
	typeof associateRecordWithBusinessUnitInput
>;
export type ListRecordBusinessUnitsInput = z.infer<
	typeof listRecordBusinessUnitsInput
>;
export type CreateBusinessUnitOpportunityInput = z.infer<
	typeof createBusinessUnitOpportunityInput
>;


export const interactionChannel = z.enum(["whatsapp", "email", "sms", "phone", "web", "other"]);
export const interactionDirection = z.enum(["inbound", "outbound", "internal"]);

export const recordInteractionInput = z
	.object({
		channel: interactionChannel,
		direction: interactionDirection,
		externalMessageId: z.string().trim().min(1).max(320).nullable().optional(),
		conversationId: z.string().trim().min(1).max(320).nullable().optional(),
		subject: z.string().trim().max(320).nullable().optional(),
		body: z.string().trim().max(12000).nullable().optional(),
		occurredAt: z.iso.datetime({ offset: true }).nullable().optional(),
		companyId: z.string().trim().min(1).nullable().optional(),
		contactId: z.string().trim().min(1).nullable().optional(),
		dealId: z.string().trim().min(1).nullable().optional(),
		businessUnit: businessUnitKey.nullable().optional(),
		attachments: z
			.array(
				z.object({
					id: z.string().trim().min(1).max(320).nullable().optional(),
					name: z.string().trim().min(1).max(500).nullable().optional(),
					mediaType: z.string().trim().min(1).max(160).nullable().optional(),
					url: z.url().nullable().optional(),
				}),
			)
			.max(20)
			.default([]),
	})
	.refine((input) => input.companyId || input.contactId || input.dealId, {
		message: "An interaction must reference a company, contact, or deal.",
	});

export const listRecordInteractionsInput = z
	.object({
		companyId: z.string().trim().min(1).nullable().optional(),
		contactId: z.string().trim().min(1).nullable().optional(),
		dealId: z.string().trim().min(1).nullable().optional(),
		channel: interactionChannel.nullable().optional(),
		limit: z.number().int().min(1).max(100).default(30),
	})
	.refine((input) => input.companyId || input.contactId || input.dealId, {
		message: "A timeline must reference a company, contact, or deal.",
	});

export type RecordInteractionInput = z.infer<typeof recordInteractionInput>;
export type ListRecordInteractionsInput = z.infer<typeof listRecordInteractionsInput>;
