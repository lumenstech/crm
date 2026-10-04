import { createListSearchParams } from "@/components/data-table/list-search-params";

export const dealsSearchParams = createListSearchParams({
	defaultSort: "createdAt",
	defaultDir: "desc",
	tabId: "status",
	facetIds: ["businessUnit", "owner", "stage", "closing"] as const,
});
