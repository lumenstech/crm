import { z } from "zod";

export const sourceIdInput = z.object({
	sourceRecordId: z.string().min(1),
	confirm: z.literal(true),
});
export const reviewIdInput = z.object({ reviewId: z.string().min(1) });
export const reviewDecisionInput = z.object({
	reviewId: z.string().min(1),
	decision: z.enum(["approved_match", "approved_new", "rejected", "ignored"]),
	canonicalId: z.string().min(1).optional(),
	ownerId: z.string().min(1).optional(),
	reason: z.string().trim().min(1).max(1000),
	confirm: z.literal(true),
});
export const reviewListInput = z.object({
	status: z.string().optional(),
	businessUnitId: z.string().optional(),
	limit: z.number().int().min(1).max(100).default(50),
});
export const batchInput = z.object({
	limit: z.number().int().min(1).max(50).default(10),
	cursor: z.string().optional(),
	confirm: z.literal(true),
});

export const resolutionResult = z.object({
	status: z.string(),
	sourceRecordId: z.string(),
	canonicalId: z.string().optional(),
	visibleId: z.string().optional(),
	reviewId: z.string().optional(),
});
export const reviewOutput = z.object({
	id: z.string(),
	status: z.string(),
	entityType: z.string(),
	reasonCode: z.string(),
	sourceRecordId: z.string(),
	candidates: z
		.array(
			z.object({
				canonicalType: z.string(),
				canonicalId: z.string(),
				score: z.number(),
			}),
		)
		.optional(),
});
