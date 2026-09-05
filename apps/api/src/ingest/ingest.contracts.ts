import { z } from "zod";

export const signalPayload = z.record(z.string(), z.json());

export const ingestSignalInput = z.object({
	project: z.string().trim().min(1).max(96),
	source: z.string().trim().min(1).max(96),
	sourceType: z.string().trim().min(1).max(160),
	sourceId: z.string().trim().min(1).max(320),
	sourceUrl: z.string().url().nullable().optional(),
	observedAt: z.string().datetime({ offset: true }).nullable().optional(),
	entity: z.string().trim().min(1).max(320).nullable().optional(),
	signalScore: z.number().min(0).max(100).nullable().optional(),
	tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
	payload: signalPayload.default({}),
});

export const ingestSignalOutput = z.object({
	status: z.literal("accepted"),
	sourceRecordId: z.string(),
	project: z.string(),
	deduplicated: z.boolean(),
	promoted: z.boolean(),
	resolution: z.enum(["promoted", "review"]).optional(),
	canonicalId: z.string().optional(),
	visibleId: z.string().optional(),
	reviewId: z.string().optional(),
});

export const signalInboxInput = z.object({
	project: z.string().trim().min(1).max(96).optional(),
	minScore: z.number().min(0).max(100).optional(),
	status: z.enum(["all", "unresolved", "mapped"]).default("unresolved"),
	limit: z.number().int().min(1).max(200).default(50),
});

export const signalInboxItem = z.object({
	sourceRecordId: z.string(),
	project: z.string(),
	source: z.string(),
	sourceType: z.string(),
	sourceId: z.string(),
	sourceUrl: z.string().nullable(),
	observedAt: z.string(),
	entity: z.string().nullable(),
	signalScore: z.number().nullable(),
	company: z.string().nullable(),
	subject: z.string().nullable(),
	stageKey: z.string().nullable(),
	priority: z.string().nullable(),
	demandTrigger: z.string().nullable(),
	nextAction: z.string().nullable(),
	mapped: z.boolean(),
	payload: signalPayload,
});

export const signalInboxOutput = z.object({
	rows: z.array(signalInboxItem),
	count: z.number().int().nonnegative(),
});

export type SignalPayload = z.infer<typeof signalPayload>;
export type IngestSignalInput = z.infer<typeof ingestSignalInput>;
export type IngestSignalOutput = z.infer<typeof ingestSignalOutput>;
export type SignalInboxInput = z.infer<typeof signalInboxInput>;
export type SignalInboxOutput = z.infer<typeof signalInboxOutput>;
