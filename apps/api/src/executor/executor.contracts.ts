import { executorEnvelope, executorJobStatus } from "@crm/validation/executor";
import { z } from "zod";

export const executorSource = z
	.object({
		account: z.string().trim().min(1).max(160),
		emailId: z.string().trim().min(1).max(160),
		messageId: z.string().trim().max(320).nullable().optional(),
		from: z.string().trim().max(320).nullable().optional(),
		subject: z.string().trim().max(320).nullable().optional(),
		to: z.array(z.string().trim().min(1).max(320)).max(50),
	})
	.strict();

export const executorAcceptInput = z
	.object({ envelope: executorEnvelope, source: executorSource })
	.strict();

export const executorCheckpointInput = z
	.object({
		provider: z.literal("resend"),
		account: z.string().trim().min(1).max(160),
		cursor: z.string().trim().max(160).nullable(),
	})
	.strict();

export const executorResultInput = z
	.object({
		result: z.record(z.string(), z.unknown()),
		queueHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		receipt: z.record(z.string(), z.unknown()),
	})
	.strict();

export const executorResultEmailInput = z
	.object({
		resultEmailId: z.string().trim().min(1).max(160),
	})
	.strict();

export const executorFailureInput = z
	.object({
		code: z.string().trim().min(1).max(80),
		message: z.string().trim().min(1).max(1000),
	})
	.strict();

export const executorJobOutput = z.object({
	id: z.string(),
	status: executorJobStatus,
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

export const executorAcceptOutput = z.object({
	job: executorJobOutput,
	duplicate: z.boolean(),
});
