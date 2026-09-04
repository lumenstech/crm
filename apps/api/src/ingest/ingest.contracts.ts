import { z } from "zod";

const signalPayload = z.record(z.string(), z.unknown());

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
	promoted: z.literal(false),
});

export type IngestSignalInput = z.infer<typeof ingestSignalInput>;
export type IngestSignalOutput = z.infer<typeof ingestSignalOutput>;
