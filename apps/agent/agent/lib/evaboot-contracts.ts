import { z } from "zod";
import { EVABOOT } from "./evaboot-config.ts";

const count = z.number().int().nonnegative();
const text = z.string().max(4_000);
const column = text.nullish();

export const evabootExtractionId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

export const evabootQuotaResponse = z.object({
	success: z.literal(true),
	quota: z.object({
		daily_limit: count,
		used_today: count,
		remaining: count,
		has_valid_salesnav: z.boolean(),
		credits: z.number().nonnegative(),
		salesnavs: z.array(
			z.object({
				id: z.string().min(1),
				status: z.string(),
				daily_limit: count,
				used_today: count,
				remaining: count,
			}),
		),
	}),
});

export const evabootProspect = z.object({
	"Full Name": column,
	"First Name": column,
	"Last Name": column,
	"Current Job": column,
	"Company Name": column,
	Email: column,
	"Email Status": column,
});

export const evabootExtractionState = z.object({
	search_id: evabootExtractionId,
	status: z.enum([
		"ACCEPTED",
		"SCHEDULED",
		"EXECUTING",
		"EXECUTED",
		"PAUSED",
		"FAILED",
	]),
	progress: count.max(100),
});

export const evabootExtractionPage = evabootExtractionState.extend({
	status: z.literal("EXECUTED"),
	prospects: z.array(evabootProspect).max(EVABOOT.pageSize),
	start: count,
	limit: count.positive().max(EVABOOT.pageSize),
	returned_count: count,
	total_count: count,
	has_more: z.boolean(),
});

export const evabootExtractionResponse = z.discriminatedUnion("status", [
	evabootExtractionPage,
	evabootExtractionState.extend({
		status: z.enum(["ACCEPTED", "SCHEDULED", "EXECUTING", "PAUSED", "FAILED"]),
	}),
]);

export const evabootPageRequest = z.object({
	extractionId: evabootExtractionId,
	start: count,
	limit: count.positive().max(EVABOOT.pageSize),
});

export const evabootPreviewRequest = z.object({
	extractionId: evabootExtractionId,
	start: count,
	maxRecords: count.positive().max(EVABOOT.maxPreviewRecords),
});

export const evabootProfilePlanRequest = z.object({
	profiles: count.positive().max(EVABOOT.maxProfileBatch),
	maxCredits: z.number().positive(),
});

export type EvabootQuota = z.infer<typeof evabootQuotaResponse>["quota"];
export type EvabootProspect = z.infer<typeof evabootProspect>;
export type EvabootExtractionPage = z.infer<typeof evabootExtractionPage>;
export type EvabootExtractionResponse = z.infer<
	typeof evabootExtractionResponse
>;
export type EvabootPageRequest = z.infer<typeof evabootPageRequest>;
export type EvabootPreviewRequest = z.infer<typeof evabootPreviewRequest>;
