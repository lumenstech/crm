import { z } from "zod";

const sortDirection = z.enum(["asc", "desc"]);

export const projectExperienceListInput = z.object({
	q: z.string().trim().max(200).default(""),
	sort: z.string().trim().max(80).default("projectName"),
	dir: sortDirection.default("asc"),
	page: z.number().int().min(1).default(1),
	pageSize: z.number().int().min(1).max(100).default(25),
	sector: z.array(z.string().trim().min(1).max(120)).default([]),
	projectType: z.array(z.string().trim().min(1).max(120)).default([]),
	claimTier: z.array(z.string().trim().min(1).max(120)).default([]),
	eligibility: z.array(z.string().trim().min(1).max(40)).default([]),
});

export const projectExperienceRow = z.object({
	sourceRecordId: z.string(),
	projectId: z.string(),
	companyId: z.string().nullable(),
	canonicalCompanyName: z.string().nullable(),
	projectName: z.string(),
	clientLabel: z.string(),
	siteName: z.string().nullable(),
	city: z.string().nullable(),
	state: z.string().nullable(),
	startDate: z.string().nullable(),
	endDate: z.string().nullable(),
	sector: z.string().nullable(),
	projectType: z.string().nullable(),
	scopeSummary: z.string().nullable(),
	systems: z.string().nullable(),
	deliveryPartner: z.string().nullable(),
	completionStatus: z.string().nullable(),
	claimTier: z.string().nullable(),
	evidenceStrength: z.string().nullable(),
	amountUsd: z.number().nullable(),
	amountBasis: z.string().nullable(),
	portfolioLanguage: z.string().nullable(),
	commercialNotes: z.string().nullable(),
	caveats: z.string().nullable(),
	evidenceItems: z.number().int().nonnegative(),
	tags: z.array(z.string()),
	salesEligible: z.boolean(),
	sourceUrl: z.string().nullable(),
	lastVerifiedAt: z.string().nullable(),
});

const facetCounts = z.record(
	z.string(),
	z.record(z.string(), z.number().int()),
);

export const projectExperienceListOutput = z.object({
	rows: z.array(projectExperienceRow),
	total: z.number().int().nonnegative(),
	facetCounts,
});

export const projectExperienceSummaryOutput = z.object({
	total: z.number().int().nonnegative(),
	salesReady: z.number().int().nonnegative(),
	headline: z.number().int().nonnegative(),
	review: z.number().int().nonnegative(),
	evidenceItems: z.number().int().nonnegative(),
	linkedCompanies: z.number().int().nonnegative(),
	duplicateCandidates: z.number().int().nonnegative(),
});

export const opportunityProjectMatchInput = z.object({
	dealId: z.string().trim().min(1),
});

export const opportunityProjectMatchOutput = z.object({
	status: z.enum(["idle", "queued", "running", "ready", "failed"]),
	computedAt: z.string().nullable(),
	rows: z.array(
		z.object({
			sourceRecordId: z.string(),
			projectId: z.string(),
			projectName: z.string(),
			clientLabel: z.string(),
			sector: z.string().nullable(),
			projectType: z.string().nullable(),
			scopeSummary: z.string().nullable(),
			portfolioLanguage: z.string().nullable(),
			evidenceStrength: z.string().nullable(),
			salesEligible: z.boolean(),
			score: z.number().int().min(0).max(100),
			matchedSignals: z.array(z.string()),
			rationale: z.string(),
		}),
	),
});

export const refreshOpportunityProjectMatchOutput = z.object({
	dealId: z.string(),
	queued: z.boolean(),
});

export type ProjectExperienceListInput = z.infer<
	typeof projectExperienceListInput
>;
