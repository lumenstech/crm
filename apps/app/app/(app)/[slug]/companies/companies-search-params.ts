import { createListSearchParams } from "@/components/data-table/list-search-params";

export const companiesSearchParams = createListSearchParams({
	defaultSort: "createdAt",
	defaultDir: "desc",
	facetIds: [
		"businessUnit",
		"owner",
		"industry",
		"enrichment",
		"activity",
	] as const,
});
