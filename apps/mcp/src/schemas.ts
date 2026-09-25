import { z } from "zod";

export const businessUnitKey = z.string().trim().min(1).max(96);

export const searchCrmInput = z.object({
	q: z.string().trim().min(1).max(320),
});

export const recordType = z.enum(["company", "contact"]);

export const listRecordBusinessUnitsInput = z.object({
	recordType,
	recordId: z.string().trim().min(1),
});

export const associateRecordWithBusinessUnitInput = z.object({
	recordType,
	recordId: z.string().trim().min(1),
	targetBusinessUnit: businessUnitKey,
	useCase: z.string().trim().max(1000).nullable().optional(),
	notes: z.string().trim().max(8000).nullable().optional(),
});

export const createBusinessUnitOpportunityInput = z.object({
	companyId: z.string().trim().min(1),
	contactId: z.string().trim().min(1).nullable().optional(),
	targetBusinessUnit: businessUnitKey,
	ownerId: z.string().trim().min(1).nullable().optional(),
	name: z.string().trim().min(1).max(320),
	useCase: z.string().trim().max(4000).nullable().optional(),
	notes: z.string().trim().max(8000).nullable().optional(),
});

export const signalPayloadValue: z.ZodType<
	string | number | boolean | null | unknown[] | Record<string, unknown>
> = z.lazy(() =>
	z.union([
		z.string(),
		z.number().finite(),
		z.boolean(),
		z.null(),
		z.array(signalPayloadValue),
		z.record(z.string(), signalPayloadValue),
	]),
);

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
export type ListRecordBusinessUnitsInput = z.infer<
	typeof listRecordBusinessUnitsInput
>;
export type AssociateRecordWithBusinessUnitInput = z.infer<
	typeof associateRecordWithBusinessUnitInput
>;
export type CreateBusinessUnitOpportunityInput = z.infer<
	typeof createBusinessUnitOpportunityInput
>;
