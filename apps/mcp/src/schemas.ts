import { z } from "zod";
import { BUSINESS_UNIT_KEYS } from "./businessUnits";

export const businessUnitKey = z.enum(BUSINESS_UNIT_KEYS);

export const searchCrmInput = z.object({
	q: z.string().trim().min(1).max(320),
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
