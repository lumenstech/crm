import { createListSearchParams } from "@/components/data-table/list-search-params";

export const projectExperienceSearchParams = createListSearchParams({
	defaultSort: "projectName",
	defaultDir: "asc",
	facetIds: ["sector", "projectType", "claimTier", "eligibility"] as const,
});
