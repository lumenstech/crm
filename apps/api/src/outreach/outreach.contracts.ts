import { z } from "zod";

export const outreachMode = z.enum([
	"NEW_OUTREACH",
	"FOLLOW_UP",
	"RETRY_BOUNCED_ROUTE",
]);

export const outreachStatus = z.enum([
	"RESERVED",
	"QUEUED",
	"SENT",
	"DELIVERED",
	"BOUNCED",
	"FAILED",
	"CANCELED",
]);

export const outreachDecisionStatus = z.enum([
	"CLEAR_NEW_ACCOUNT",
	"EXISTING_ACCOUNT",
	"FOLLOW_UP_REQUIRED",
	"CROSS_BUSINESS_CONTACT",
	"BOUNCED_PREVIOUSLY",
	"SUPPRESSED",
	"UNVERIFIED_ROUTE",
	"IN_FLIGHT",
	"BLOCKED_DUPLICATE",
	"AMBIGUOUS_COMPANY",
	"OUTBOUND_DISABLED",
	"RESERVED",
]);

const companyResolutionInput = z.object({
	companyId: z.string().trim().min(1).max(160).nullable().optional(),
	companyName: z.string().trim().min(1).max(320).nullable().optional(),
	domain: z.string().trim().max(320).nullable().optional(),
	contactId: z.string().trim().min(1).max(160).nullable().optional(),
	recipientEmail: z.string().email().max(320).nullable().optional(),
	targetBusinessUnit: z.string().trim().min(1).max(96),
	outreachMode: outreachMode.default("NEW_OUTREACH"),
	senderIdentity: z.string().trim().max(320).nullable().optional(),
	campaignType: z.string().trim().max(160).nullable().optional(),
	purpose: z.string().trim().max(400).nullable().optional(),
	subject: z.string().trim().min(1).max(998),
	provider: z.string().trim().min(1).max(80).default("resend"),
	originalReservationId: z
		.string()
		.trim()
		.min(1)
		.max(160)
		.nullable()
		.optional(),
	approvedCrossBusinessContact: z.boolean().default(false),
	jobId: z.string().trim().min(1).max(160).nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).nullable().optional(),
	notes: z.string().trim().max(4000).nullable().optional(),
});

export const preflightOutreachInput = companyResolutionInput;

export const reserveOutreachInput = companyResolutionInput.extend({
	idempotencyKey: z.string().trim().min(1).max(320).nullable().optional(),
});

export const finalizeOutreachInput = z.object({
	reservationId: z.string().trim().min(1).max(160),
	status: z.enum([
		"QUEUED",
		"SENT",
		"DELIVERED",
		"BOUNCED",
		"FAILED",
		"CANCELED",
	]),
	provider: z.string().trim().min(1).max(80).optional(),
	providerMessageId: z.string().trim().min(1).max(320).nullable().optional(),
	recipientEmail: z.string().email().max(320).nullable().optional(),
	queuedAt: z.string().datetime({ offset: true }).nullable().optional(),
	sentAt: z.string().datetime({ offset: true }).nullable().optional(),
	deliveredAt: z.string().datetime({ offset: true }).nullable().optional(),
	bouncedAt: z.string().datetime({ offset: true }).nullable().optional(),
	failedAt: z.string().datetime({ offset: true }).nullable().optional(),
	failureReason: z.string().trim().max(4000).nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const listCompanyOutreachHistoryInput = z.object({
	companyId: z.string().trim().min(1).max(160),
	targetBusinessUnit: z.string().trim().max(96).nullable().optional(),
});

const businessUnitRefOutput = z.object({
	id: z.string(),
	key: z.string(),
	name: z.string(),
});

const matchedIdentifierOutput = z.object({
	kind: z.enum([
		"companyId",
		"contactId",
		"companyName",
		"domain",
		"recipientEmail",
	]),
	value: z.string(),
});

const priorCanonicalMailboxContactOutput = z.object({
	count: z.number().int().nonnegative(),
	latestSentAt: z.string().nullable(),
	contactIds: z.array(z.string()),
});

const outreachHistoryOutput = z.object({
	id: z.string(),
	companyId: z.string(),
	contactId: z.string().nullable(),
	businessUnit: businessUnitRefOutput,
	outreachMode,
	campaignType: z.string().nullable(),
	purpose: z.string().nullable(),
	senderIdentity: z.string(),
	recipientEmail: z.string(),
	subject: z.string(),
	status: outreachStatus,
	provider: z.string(),
	providerMessageId: z.string().nullable(),
	reservationKey: z.string(),
	idempotencyKey: z.string(),
	metadata: z.record(z.string(), z.unknown()).nullable(),
	notes: z.string().nullable(),
	errorReason: z.string().nullable(),
	createdAt: z.string(),
	reservedAt: z.string(),
	queuedAt: z.string().nullable(),
	sentAt: z.string().nullable(),
	deliveredAt: z.string().nullable(),
	bouncedAt: z.string().nullable(),
	failedAt: z.string().nullable(),
	updatedAt: z.string(),
});

export const preflightOutreachOutput = z.object({
	status: outreachDecisionStatus,
	canonicalCompanyId: z.string().nullable(),
	canonicalCompanyName: z.string().nullable(),
	matchedIdentifiers: z.array(matchedIdentifierOutput),
	existingBusinessUnitAssociations: z.array(businessUnitRefOutput),
	previousOutreach: z.array(outreachHistoryOutput),
	priorCanonicalMailboxContact: priorCanonicalMailboxContactOutput,
	newOutreachPermitted: z.boolean(),
	reason: z.string(),
	requiredNextAction: z.string().nullable(),
	senderIdentity: z.string().nullable(),
	template: z.string().nullable(),
});

export const reserveOutreachOutput = z.object({
	status: outreachDecisionStatus,
	reservationId: z.string().nullable(),
	reservationKey: z.string().nullable(),
	idempotencyKey: z.string(),
	canonicalCompanyId: z.string().nullable(),
	canonicalCompanyName: z.string().nullable(),
	senderIdentity: z.string().nullable(),
	template: z.string().nullable(),
	duplicate: z.boolean(),
	reason: z.string(),
	requiredNextAction: z.string().nullable(),
	reservation: outreachHistoryOutput.nullable(),
});

export const finalizeOutreachOutput = outreachHistoryOutput;
export const listCompanyOutreachHistoryOutput = z.object({
	companyId: z.string(),
	rows: z.array(outreachHistoryOutput),
});

export type PreflightOutreachInput = z.infer<typeof preflightOutreachInput>;
export type ReserveOutreachInput = z.infer<typeof reserveOutreachInput>;
export type FinalizeOutreachInput = z.infer<typeof finalizeOutreachInput>;
export type ListCompanyOutreachHistoryInput = z.infer<
	typeof listCompanyOutreachHistoryInput
>;
