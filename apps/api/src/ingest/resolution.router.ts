import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	batchInput,
	resolutionResult,
	reviewDecisionInput,
	reviewIdInput,
	reviewListInput,
	reviewOutput,
	sourceIdInput,
} from "./resolution.contracts";
import { ResolutionService } from "./resolution.service";

@Router({ alias: "resolution" })
@UseMiddlewares(AuthMiddleware)
export class ResolutionRouter {
	constructor(private readonly resolution: ResolutionService) {}
	@Mutation({
		input: sourceIdInput,
		output: resolutionResult,
		meta: restMeta("POST", "/resolution/process", ["Resolution"]),
	})
	process(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof sourceIdInput>,
	) {
		return this.resolution
			.process(input.sourceRecordId, ctx.user.id)
			.then((result) => ({ ...result, sourceRecordId: input.sourceRecordId }));
	}
	@Mutation({
		input: batchInput,
		meta: restMeta("POST", "/resolution/batch", ["Resolution"]),
	})
	batch(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof batchInput>,
	) {
		return this.resolution.batch(input.limit, input.cursor, ctx.user.id);
	}
	@Query({
		input: reviewListInput,
		meta: restMeta("GET", "/resolution/reviews", ["Resolution"]),
	})
	listReviews(@Input() input: z.infer<typeof reviewListInput>) {
		return this.resolution.listReviews(input);
	}
	@Query({
		input: reviewIdInput,
		output: reviewOutput,
		meta: restMeta("GET", "/resolution/reviews/{reviewId}", ["Resolution"]),
	})
	async review(@Input("reviewId") reviewId: string) {
		const row = await this.resolution.getReview(reviewId);
		if (!row) throw new Error("Review case was not found.");
		return row;
	}
	@Mutation({
		input: reviewDecisionInput,
		meta: restMeta("POST", "/resolution/reviews/decide", ["Resolution"]),
	})
	decide(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof reviewDecisionInput>,
	) {
		return this.resolution.decide(input, ctx.user.id);
	}
}
