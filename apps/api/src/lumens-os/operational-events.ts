import { randomUUID } from "node:crypto";
import type { Prisma } from "@crm/db";

export const GAUZY_OPERATION_TASK = "gauzy_operation" as const;

export const OPERATIONAL_EVENT_TYPES = [
	"project.sync",
	"task.sync",
	"task.assign",
	"task.schedule",
	"task.create",
] as const;

export type OperationalEventType = (typeof OPERATIONAL_EVENT_TYPES)[number];

const COMMAND_ID_REQUIRED = new Set<OperationalEventType>([
	"task.assign",
	"task.schedule",
	"task.create",
]);

/**
 * Event types the Gauzy adapter can execute today. An event outside this set is
 * still written durably and still deduplicated, but no `gauzy_operation` task is
 * queued for it, because nothing downstream can run it yet. `task.create` waits on
 * the ServiceFixes work-order path.
 */
const GAUZY_EXECUTABLE: ReadonlySet<OperationalEventType> = new Set([
	"project.sync",
	"task.sync",
	"task.assign",
	"task.schedule",
]);

export function isGauzyExecutable(eventType: OperationalEventType): boolean {
	return GAUZY_EXECUTABLE.has(eventType);
}

export type OperationalEventV1 = {
	version: 1;
	eventType: OperationalEventType;
	canonicalType: string;
	canonicalId: string;
	businessUnitId: string;
	/** Stable command/revision identifier. Required for mutable operations so later updates are not suppressed. */
	commandId?: string;
	data: Prisma.InputJsonObject;
};

export type EmitOperationalEventResult = {
	eventId: string;
	created: boolean;
};

type TransactionDb = Prisma.TransactionClient;

export function operationalEventIdempotencyKey(
	input: Pick<
		OperationalEventV1,
		"eventType" | "canonicalType" | "canonicalId" | "commandId"
	>,
): string {
	return [
		input.eventType,
		input.canonicalType,
		input.canonicalId,
		input.commandId,
	]
		.filter(Boolean)
		.join(":");
}

export async function emitOperationalEvent(
	tx: TransactionDb,
	input: OperationalEventV1,
): Promise<EmitOperationalEventResult> {
	if (COMMAND_ID_REQUIRED.has(input.eventType) && !input.commandId) {
		throw new Error(`Lumens OS ${input.eventType} requires commandId.`);
	}

	const idempotencyKey = operationalEventIdempotencyKey(input);
	const candidateId = randomUUID();
	const now = new Date();

	const inserted = await tx.$queryRaw<Array<{ id: string }>>`
		INSERT INTO lumens_os_event (
			id, event_type, aggregate_type, aggregate_id, business_unit_id,
			payload, idempotency_key, created_at, updated_at
		)
		VALUES (
			${candidateId}, ${input.eventType}, ${input.canonicalType}, ${input.canonicalId},
			${input.businessUnitId}, ${JSON.stringify(input)}::jsonb, ${idempotencyKey},
			${now}, ${now}
		)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id
	`;

	const createdId = inserted[0]?.id;
	if (!createdId) {
		const existing = await tx.lumensOsEvent.findUnique({
			where: { idempotencyKey },
			select: { id: true },
		});
		if (!existing) {
			throw new Error(
				`Lumens OS event ${idempotencyKey} was neither inserted nor found.`,
			);
		}
		return { eventId: existing.id, created: false };
	}

	if (isGauzyExecutable(input.eventType)) {
		await tx.agentTask.create({
			data: {
				kind: GAUZY_OPERATION_TASK,
				reason: `Execute Lumens OS ${input.eventType} in Gauzy.`,
				subject: createdId,
				businessUnitId: input.businessUnitId,
				payload: { eventId: createdId, eventType: input.eventType },
				dueAt: now,
			},
		});
	}

	return { eventId: createdId, created: true };
}
