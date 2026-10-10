import { z } from "zod";

export const EXECUTOR_ENVELOPE_VERSION = "COMP-CRM-EXECUTOR-V1" as const;
export const PARTWALL_COMPARISON_OPERATION =
	"partwall-canonical-comparison" as const;
export const PARTWALL_COMPARISON_TASK =
	"partwall-production-leads-001" as const;

export const executorEnvelope = z
	.object({
		version: z.literal(EXECUTOR_ENVELOPE_VERSION),
		jobId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
		operation: z.literal(PARTWALL_COMPARISON_OPERATION),
		taskRef: z.literal(PARTWALL_COMPARISON_TASK),
		expiresAt: z.string().datetime({ offset: true }),
		payloadHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	})
	.strict();

export const executorEnvelopePayload = executorEnvelope
	.omit({ payloadHash: true })
	.strict();

export type ExecutorEnvelope = z.infer<typeof executorEnvelope>;
export type ExecutorEnvelopePayload = z.infer<typeof executorEnvelopePayload>;

export const executorJobStatus = z.enum([
	"ACCEPTED",
	"QUEUED",
	"RUNNING",
	"COMPLETED",
	"PARTIALLY_FAILED",
	"FAILED",
	"REJECTED",
	"EXPIRED",
]);

export type ExecutorJobStatus = z.infer<typeof executorJobStatus>;
