import { Inject } from "@nestjs/common";
import { Ctx, Input, Mutation, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	historicalEmailImportInput,
	historicalEmailImportOutput,
} from "./history-import.contracts";
import { HistoricalEmailImportService } from "./history-import.service";

@Router({ alias: "mailbox" })
@UseMiddlewares(AuthMiddleware)
export class MailboxRouter {
	constructor(
		@Inject(HistoricalEmailImportService)
		private readonly history: HistoricalEmailImportService,
	) {}

	@Mutation({
		input: historicalEmailImportInput,
		output: historicalEmailImportOutput,
		meta: restMeta("POST", "/mailbox/import/email", ["Mailbox"]),
	})
	async importEmail(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof historicalEmailImportInput>,
	) {
		return this.history.import(input, ctx.user.id, ctx.user.email);
	}
}
