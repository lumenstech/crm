import type { Prisma } from "@crm/db";
import { Inject } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	executorAcceptInput,
	executorAcceptOutput,
} from "./executor.contracts";
import { ExecutorService } from "./executor.service";

const jobInput = z.object({ id: z.string().trim().min(1).max(160) });
const jobOutput = z.object({
	id: z.string(),
	status: z.enum([
		"ACCEPTED",
		"QUEUED",
		"RUNNING",
		"COMPLETED",
		"PARTIALLY_FAILED",
		"FAILED",
		"REJECTED",
		"EXPIRED",
	]),
	operation: z.string(),
	taskRef: z.string(),
	payloadHash: z.string(),
	result: z.record(z.string(), z.unknown()).nullable(),
	receipt: z.record(z.string(), z.unknown()).nullable(),
	errorCode: z.string().nullable(),
	errorMessage: z.string().nullable(),
	resultEmailId: z.string().nullable(),
	createdAt: z.string(),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
});

@Router({ alias: "executor" })
@UseMiddlewares(AuthMiddleware)
export class ExecutorRouter {
	constructor(
		@Inject(ExecutorService) private readonly executor: ExecutorService,
	) {}

	@Mutation({
		input: executorAcceptInput,
		output: executorAcceptOutput,
		meta: restMeta("POST", "/executor/jobs", ["Executor"]),
	})
	async accept(@Input() input: z.infer<typeof executorAcceptInput>) {
		if (Date.parse(input.envelope.expiresAt) <= Date.now()) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "The executor request has expired.",
			});
		}
		const result = await this.executor.accept(input);
		return { job: serializeJob(result.job), duplicate: result.duplicate };
	}

	@Query({
		input: jobInput,
		output: jobOutput,
		meta: restMeta("GET", "/executor/jobs/{id}", ["Executor"]),
	})
	async get(@Input("id") id: string) {
		const job = await this.executor.get(id);
		return serializeJob(job);
	}
}

function serializeJob(job: Awaited<ReturnType<ExecutorService["get"]>>) {
	return {
		id: job.id,
		status: job.status,
		operation: job.operation,
		taskRef: job.taskRef,
		payloadHash: job.payloadHash,
		result: asRecord(job.result),
		receipt: asRecord(job.receipt),
		errorCode: job.errorCode,
		errorMessage: job.errorMessage,
		resultEmailId: job.resultEmailId,
		createdAt: job.createdAt.toISOString(),
		startedAt: job.startedAt?.toISOString() ?? null,
		finishedAt: job.finishedAt?.toISOString() ?? null,
	};
}

function asRecord(value: Prisma.JsonValue | null): Prisma.JsonObject | null {
	const parsed = z.record(z.string(), z.json()).safeParse(value);
	return parsed.success ? parsed.data : null;
}