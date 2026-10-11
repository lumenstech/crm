import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	finalizeOutreachInput,
	finalizeOutreachOutput,
	listCompanyOutreachHistoryInput,
	listCompanyOutreachHistoryOutput,
	preflightOutreachInput,
	preflightOutreachOutput,
	reserveOutreachInput,
	reserveOutreachOutput,
} from "./outreach.contracts";
import { OutreachService } from "./outreach.service";

@Router({ alias: "outreach" })
@UseMiddlewares(AuthMiddleware)
export class OutreachRouter {
	constructor(
		@Inject(OutreachService) private readonly outreach: OutreachService,
	) {}

	@Mutation({
		input: preflightOutreachInput,
		output: preflightOutreachOutput,
		meta: restMeta("POST", "/outreach/preflight", ["Outreach"]),
	})
	async preflight(@Input() input: z.infer<typeof preflightOutreachInput>) {
		return this.outreach.preflight(input);
	}

	@Mutation({
		input: reserveOutreachInput,
		output: reserveOutreachOutput,
		meta: restMeta("POST", "/outreach/reserve", ["Outreach"]),
	})
	async reserve(@Input() input: z.infer<typeof reserveOutreachInput>) {
		return this.outreach.reserve(input);
	}

	@Mutation({
		input: finalizeOutreachInput,
		output: finalizeOutreachOutput,
		meta: restMeta("POST", "/outreach/finalize", ["Outreach"]),
	})
	async finalize(@Input() input: z.infer<typeof finalizeOutreachInput>) {
		return this.outreach.finalize(input);
	}

	@Query({
		input: listCompanyOutreachHistoryInput,
		output: listCompanyOutreachHistoryOutput,
		meta: restMeta("GET", "/outreach/history", ["Outreach"]),
	})
	async history(
		@Input() input: z.infer<typeof listCompanyOutreachHistoryInput>,
	) {
		return this.outreach.history(input);
	}
}
