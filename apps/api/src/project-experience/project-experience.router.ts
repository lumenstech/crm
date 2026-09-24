import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	opportunityProjectMatchInput,
	opportunityProjectMatchOutput,
	projectExperienceListInput,
	projectExperienceListOutput,
	projectExperienceSummaryOutput,
	refreshOpportunityProjectMatchOutput,
} from "./project-experience.contracts";
import { ProjectExperienceService } from "./project-experience.service";

@Router({ alias: "projectExperience" })
@UseMiddlewares(AuthMiddleware)
export class ProjectExperienceRouter {
	constructor(
		@Inject(ProjectExperienceService)
		private readonly projectExperience: ProjectExperienceService,
	) {}

	@Query({
		input: projectExperienceListInput,
		output: projectExperienceListOutput,
		meta: restMeta("POST", "/project-experience/search", [
			"Project experience",
		]),
	})
	async list(@Input() input: z.infer<typeof projectExperienceListInput>) {
		return this.projectExperience.list(input);
	}

	@Query({
		output: projectExperienceSummaryOutput,
		meta: restMeta("GET", "/project-experience/summary", [
			"Project experience",
		]),
	})
	async summary() {
		return this.projectExperience.summary();
	}

	@Query({
		input: opportunityProjectMatchInput,
		output: opportunityProjectMatchOutput,
		meta: restMeta("GET", "/deals/{dealId}/project-matches", [
			"Project experience",
		]),
	})
	async matches(@Input("dealId") dealId: string) {
		return this.projectExperience.matches(dealId);
	}

	@Mutation({
		input: opportunityProjectMatchInput,
		output: refreshOpportunityProjectMatchOutput,
		meta: restMeta("POST", "/deals/{dealId}/project-matches", [
			"Project experience",
		]),
	})
	async refreshMatches(@Input("dealId") dealId: string) {
		return this.projectExperience.refreshMatches(dealId);
	}
}
