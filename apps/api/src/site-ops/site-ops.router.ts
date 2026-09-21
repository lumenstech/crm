import { Inject } from "@nestjs/common";
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
	acknowledgeAlertInput,
	acknowledgeAlertOutput,
	assetDetailInput,
	assetDetailOutput,
	createTaskFromAlertInput,
	createTaskFromAlertOutput,
	operationsOverviewOutput,
	siteListInput,
	siteListOutput,
	siteOverviewInput,
	siteOverviewOutput,
} from "./site-ops.contracts";
import { SiteOpsService } from "./site-ops.service";
import { SiteOpsCommandService } from "./site-ops-command.service";

@Router({ alias: "siteOps" })
@UseMiddlewares(AuthMiddleware)
export class SiteOpsRouter {
	constructor(
		@Inject(SiteOpsService) private readonly sites: SiteOpsService,
		@Inject(SiteOpsCommandService)
		private readonly commands: SiteOpsCommandService,
	) {}

	@Query({
		output: operationsOverviewOutput,
		meta: restMeta("GET", "/site-ops/overview", ["Site Operations"]),
	})
	async overview(@Ctx() ctx: AuthedTrpcContext) {
		await this.commands.assertCanView(ctx.user.id);
		return this.sites.operationsOverview();
	}

	@Query({
		input: siteListInput,
		output: siteListOutput,
		meta: restMeta("GET", "/site-ops/sites", ["Site Operations"]),
	})
	async sites_(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof siteListInput>,
	) {
		await this.commands.assertCanView(ctx.user.id);
		return this.sites.siteList(input.status);
	}

	@Query({
		input: siteOverviewInput,
		output: siteOverviewOutput,
		meta: restMeta("GET", "/site-ops/site-overview", ["Site Operations"]),
	})
	async siteOverview(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof siteOverviewInput>,
	) {
		await this.commands.assertCanView(ctx.user.id);
		return this.sites.siteOverview(input);
	}

	@Query({
		input: assetDetailInput,
		output: assetDetailOutput,
		meta: restMeta("GET", "/site-ops/asset-detail", ["Site Operations"]),
	})
	async assetDetail(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof assetDetailInput>,
	) {
		await this.commands.assertCanView(ctx.user.id);
		return this.sites.assetDetail(input);
	}

	@Mutation({
		input: acknowledgeAlertInput,
		output: acknowledgeAlertOutput,
		meta: restMeta("POST", "/site-ops/acknowledge-alert", ["Site Operations"]),
	})
	async acknowledgeAlert(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof acknowledgeAlertInput>,
	) {
		return this.commands.acknowledgeAlert(ctx.user.id, input);
	}

	@Mutation({
		input: createTaskFromAlertInput,
		output: createTaskFromAlertOutput,
		meta: restMeta("POST", "/site-ops/create-task-from-alert", [
			"Site Operations",
		]),
	})
	async createTaskFromAlert(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof createTaskFromAlertInput>,
	) {
		return this.commands.createTaskFromAlert(ctx.user.id, input);
	}
}
