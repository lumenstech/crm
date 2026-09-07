import { z } from "zod";
import { opportunityRecommendation } from "./opportunity-ops.contracts";

export const opportunitySourceProvider = z.enum([
	"nyc-current-solicitations",
	"nassau-formal-solicitations",
	"njstart-open-bids",
	"sam-opportunities",
]);

export const samProcurementType = z.enum(["p", "r", "s", "o", "k"]);

export const scanOpportunitySourceInput = z.object({
	provider: opportunitySourceProvider,
	project: z.string().trim().min(1).max(96),
	capabilityKeywords: z
		.array(z.string().trim().min(2).max(120))
		.min(1)
		.max(50),
	strategicKeywords: z
		.array(z.string().trim().min(2).max(120))
		.max(30)
		.default([]),
	lookbackDays: z.number().int().min(1).max(365).default(14),
	dueWithinDays: z.number().int().min(1).max(365).nullable().optional(),
	state: z.string().trim().length(2).toUpperCase().nullable().optional(),
	naics: z.string().trim().regex(/^\d{2,6}$/).nullable().optional(),
	procurementTypes: z
		.array(samProcurementType)
		.max(5)
		.default(["p", "r", "s", "o", "k"]),
	limit: z.number().int().min(1).max(200).default(50),
});

export const opportunitySourceScanRow = z.object({
	sourceRecordId: z.string(),
	sourceId: z.string(),
	provider: opportunitySourceProvider,
	title: z.string(),
	buyer: z.string().nullable(),
	sourceUrl: z.string().nullable(),
	dueDate: z.string().nullable(),
	matchedCapabilityKeywords: z.array(z.string()),
	matchedStrategicKeywords: z.array(z.string()),
	score: z.number().int().min(0).max(100),
	recommendation: opportunityRecommendation,
	reviewState: z.literal("pending"),
	hardBlocked: z.boolean(),
	deduplicated: z.boolean(),
});

export const scanOpportunitySourceOutput = z.object({
	provider: opportunitySourceProvider,
	status: z.enum(["ok", "missing-api-key"]),
	fetched: z.number().int().nonnegative(),
	matched: z.number().int().nonnegative(),
	ingested: z.number().int().nonnegative(),
	deduplicated: z.number().int().nonnegative(),
	skipped: z.number().int().nonnegative(),
	message: z.string().nullable(),
	rows: z.array(opportunitySourceScanRow),
});

export type OpportunitySourceProvider = z.infer<
	typeof opportunitySourceProvider
>;
export type ScanOpportunitySourceInput = z.infer<
	typeof scanOpportunitySourceInput
>;
export type ScanOpportunitySourceOutput = z.infer<
	typeof scanOpportunitySourceOutput
>;
