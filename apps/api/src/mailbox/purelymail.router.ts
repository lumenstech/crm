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
import { SessionOnlyMiddleware } from "../trpc/middlewares/session-only.middleware";
import { restMeta } from "../trpc/openapi";
import {
	purelymailCredentialStatusOutput,
	savePurelymailCredentialInput,
} from "./purelymail.contracts";
import { PurelymailCredentialService } from "./purelymail-credential.service";

@Router({ alias: "purelymail" })
@UseMiddlewares(AuthMiddleware, SessionOnlyMiddleware)
export class PurelymailRouter {
	constructor(
		@Inject(PurelymailCredentialService)
		private readonly credentials: PurelymailCredentialService,
	) {}

	@Query({
		output: purelymailCredentialStatusOutput,
		meta: restMeta("GET", "/purelymail/status", ["Purelymail"]),
	})
	async status(@Ctx() ctx: AuthedTrpcContext) {
		return this.credentials.status(ctx.user.id);
	}

	@Mutation({
		input: savePurelymailCredentialInput,
		output: purelymailCredentialStatusOutput,
		meta: restMeta("POST", "/purelymail/credential", ["Purelymail"]),
	})
	async save(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof savePurelymailCredentialInput>,
	) {
		return this.credentials.save(ctx.user.id, input.password, input.folder);
	}

	@Mutation({
		output: purelymailCredentialStatusOutput,
		meta: restMeta("POST", "/purelymail/enable", ["Purelymail"]),
	})
	async enable(@Ctx() ctx: AuthedTrpcContext) {
		return this.credentials.enable(ctx.user.id);
	}

	@Mutation({
		output: purelymailCredentialStatusOutput,
		meta: restMeta("POST", "/purelymail/pause", ["Purelymail"]),
	})
	async pause(@Ctx() ctx: AuthedTrpcContext) {
		return this.credentials.pause(ctx.user.id);
	}

	@Mutation({
		output: purelymailCredentialStatusOutput,
		meta: restMeta("DELETE", "/purelymail/credential", ["Purelymail"]),
	})
	async remove(@Ctx() ctx: AuthedTrpcContext) {
		return this.credentials.remove(ctx.user.id);
	}
}
