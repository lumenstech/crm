import { z } from "zod";

export const crmMobileAction = z.enum([
	"list_business_units",
	"search_crm",
	"associate_record_with_business_unit",
	"list_record_business_units",
	"create_business_unit_opportunity",
	"ingest_leads",
]);

export type CrmMobileAction = z.infer<typeof crmMobileAction>;

export const crmMobileActionNames = crmMobileAction.options;

const recordType = z.enum(["company", "contact"]);

const searchInput = z.object({
	q: z.string().trim().min(1).max(320),
});

const associateInput = z.object({
	recordType,
	recordId: z.string().trim().min(1),
	targetBusinessUnit: z.string().trim().min(1).max(96),
	useCase: z.string().trim().min(1).max(240).nullable().optional(),
	notes: z.string().trim().max(2000).nullable().optional(),
});

const listAssociationsInput = z.object({
	recordType,
	recordId: z.string().trim().min(1),
});

const createOpportunityInput = z.object({
	companyId: z.string().trim().min(1),
	contactId: z.string().trim().min(1).nullable().optional(),
	targetBusinessUnit: z.string().trim().min(1).max(96),
	ownerId: z.string().trim().min(1).nullable().optional(),
	name: z.string().trim().min(1).max(240),
	useCase: z.string().trim().min(1).max(240).nullable().optional(),
	notes: z.string().trim().max(4000).nullable().optional(),
});

const ingestSignal = z.object({
	source: z.string().trim().min(1).max(96),
	sourceType: z.string().trim().min(1).max(160),
	sourceId: z.string().trim().min(1).max(320),
	sourceUrl: z.string().url().nullable().optional(),
	observedAt: z.string().datetime({ offset: true }).nullable().optional(),
	entity: z.string().trim().min(1).max(320).nullable().optional(),
	signalScore: z.number().min(0).max(100).nullable().optional(),
	tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
	payload: z.record(z.string(), z.unknown()).default({}),
});

const ingestLeadsInput = z.object({
	businessUnit: z.string().trim().min(1).max(96),
	signals: z.array(ingestSignal).min(1).max(100),
});

export type CrmMobileRequest = {
	method: "GET" | "POST";
	path: string;
	body?: unknown;
};

export function buildCrmMobileRequest(
	action: CrmMobileAction,
	input: unknown,
): CrmMobileRequest {
	switch (action) {
		case "list_business_units":
			return { method: "GET", path: "/rest/business-units" };

		case "search_crm": {
			const parsed = searchInput.parse(input);
			return {
				method: "GET",
				path: `/rest/search?q=${encodeURIComponent(parsed.q)}`,
			};
		}

		case "associate_record_with_business_unit":
			return {
				method: "POST",
				path: "/rest/business-units/associations",
				body: associateInput.parse(input),
			};

		case "list_record_business_units": {
			const parsed = listAssociationsInput.parse(input);
			const query = new URLSearchParams({
				recordType: parsed.recordType,
				recordId: parsed.recordId,
			});
			return {
				method: "GET",
				path: `/rest/business-units/associations?${query.toString()}`,
			};
		}

		case "create_business_unit_opportunity":
			return {
				method: "POST",
				path: "/rest/business-units/opportunities",
				body: createOpportunityInput.parse(input),
			};

		case "ingest_leads": {
			const parsed = ingestLeadsInput.parse(input);
			return {
				method: "POST",
				path: "/rest/ingest/signals/batch",
				body: {
					project: parsed.businessUnit,
					signals: parsed.signals,
				},
			};
		}
	}
}

export const crmMobileExamples: Record<CrmMobileAction, unknown> = {
	list_business_units: {},
	search_crm: {
		q: "Mathpix",
	},
	associate_record_with_business_unit: {
		recordType: "company",
		recordId: "existing-company-id",
		targetBusinessUnit: "data-gear",
		useCase: "Data-Gear hardware relationship",
	},
	list_record_business_units: {
		recordType: "company",
		recordId: "existing-company-id",
	},
	create_business_unit_opportunity: {
		companyId: "existing-company-id",
		targetBusinessUnit: "data-gear",
		name: "Qualified Data-Gear opportunity",
		useCase: "GPU/server procurement",
	},
	ingest_leads: {
		businessUnit: "data-gear",
		signals: [
			{
				source: "chatgpt",
				sourceType: "prospect",
				sourceId: "stable-source-id",
				entity: "Prospect Company",
				tags: ["gpu", "data-center"],
				payload: {},
			},
		],
	},
};
