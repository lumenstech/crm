import {
	Body,
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Param,
	Post,
	Put,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { z } from "zod";
import type { EnvironmentVariables } from "../config/env.validation";
import {
	executorAcceptInput,
	executorCheckpointInput,
	executorFailureInput,
	executorResultEmailInput,
	executorResultInput,
} from "./executor.contracts";
import { ExecutorService } from "./executor.service";

@Controller("internal/executor")
export class ExecutorController {
	private readonly secret: string | undefined;

	constructor(
		private readonly executor: ExecutorService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Post("jobs")
	@AllowAnonymous()
	async accept(
		@Headers("authorization") authorization: string | undefined,
		@Body() body: z.input<typeof executorAcceptInput>,
	) {
		this.authorize(authorization);
		return this.executor.accept(executorAcceptInput.parse(body));
	}

	@Get("checkpoints/:provider/:account")
	@AllowAnonymous()
	async checkpoint(
		@Headers("authorization") authorization: string | undefined,
		@Param("provider") provider: string,
		@Param("account") account: string,
	) {
		this.authorize(authorization);
		if (provider !== "resend") throw new ForbiddenException();
		return this.executor.readCheckpoint(provider, account);
	}

	@Put("checkpoints")
	@AllowAnonymous()
	async saveCheckpoint(
		@Headers("authorization") authorization: string | undefined,
		@Body() body: z.input<typeof executorCheckpointInput>,
	) {
		this.authorize(authorization);
		return this.executor.checkpoint(executorCheckpointInput.parse(body));
	}

	@Post("jobs/claim")
	@AllowAnonymous()
	async claim(@Headers("authorization") authorization: string | undefined) {
		this.authorize(authorization);
		return this.executor.claim();
	}

	@Post("jobs/:id/result")
	@AllowAnonymous()
	async result(
		@Headers("authorization") authorization: string | undefined,
		@Param("id") id: string,
		@Body() body: z.input<typeof executorResultInput>,
	) {
		this.authorize(authorization);
		return this.executor.recordResult(id, executorResultInput.parse(body));
	}

	@Post("jobs/:id/result-email")
	@AllowAnonymous()
	async resultEmail(
		@Headers("authorization") authorization: string | undefined,
		@Param("id") id: string,
		@Body() body: z.input<typeof executorResultEmailInput>,
	) {
		this.authorize(authorization);
		return this.executor.recordResultEmail(
			id,
			executorResultEmailInput.parse(body),
		);
	}

	@Post("jobs/:id/failure")
	@AllowAnonymous()
	async failure(
		@Headers("authorization") authorization: string | undefined,
		@Param("id") id: string,
		@Body() body: z.input<typeof executorFailureInput>,
	) {
		this.authorize(authorization);
		return this.executor.recordFailure(id, executorFailureInput.parse(body));
	}

	@Post("jobs/:id/result-delivery-failure")
	@AllowAnonymous()
	async resultDeliveryFailure(
		@Headers("authorization") authorization: string | undefined,
		@Param("id") id: string,
		@Body() body: z.input<typeof executorFailureInput>,
	) {
		this.authorize(authorization);
		return this.executor.markResultDeliveryFailure(
			id,
			executorFailureInput.parse(body),
		);
	}

	@Get("jobs/:id")
	@AllowAnonymous()
	async get(
		@Headers("authorization") authorization: string | undefined,
		@Param("id") id: string,
	) {
		this.authorize(authorization);
		return this.executor.get(id);
	}

	private authorize(authorization?: string) {
		if (!this.secret) {
			throw new ServiceUnavailableException("Executor is not configured.");
		}
		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}
	}
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}
	return mismatch === 0;
}