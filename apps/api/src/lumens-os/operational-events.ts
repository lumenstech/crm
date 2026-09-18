import { randomUUID } from "node:crypto";
import type { Prisma } from "@crm/db";

export const GAUZY_OPERATION_TASK = "gauzy_operation" as const;

export const OPERATIONAL_EVENT_TYPES = [
	"project.sync",
	"task.sync",
	"task.assign",
	"task.schedule",
] as const;

export type OperationalEventType = (typeof OPERATIONAL_EVENT_TYPES)[number];

export type OperationalEventV1 = {
	version: 1;
	eventType: OperationalEventType;
	canonicalType: string;
	canonicalId: string;
	businessUnitId: string;
	data: Record<string, unknown>;
};

type TransactionDb = Prisma.TransactionClient;

export async function emitOperationalEvent(tx: TransactionDb, input: OperationalEventV1) {
	const idempotencyKey = `${input.eventType}:${input.canonicalType}:${input.canonicalId}`;
	const existing = await tx.lumensOsEvent.findUnique({
		where: { idempotencyKey },
		select: { id: true },
	});
	if (existing) return { eventId: existing.id, created: false as const };

	const eventId = randomUUID();
	const now = new Date();
	await tx.lumensOsEvent.create({
		data: {
			id: eventId,
			eventType: input.eventType,
			aggregateType: input.canonicalType,
			aggregateId: input.canonicalId,
			businessUnitId: input.businessUnitId,
			payload: input,
			idempotencyKey,
			createdAt: now,
			updatedAt: now,
		},
	});

	await tx.agentTask.create({
		data: {
			kind: GAUZY_OPERATION_TASK,
			reason: `Execute Lumens OS ${input.eventType} in Gauzy.`,
			subject: eventId,
			businessUnitId: input.businessUnitId,
			payload: { eventId, eventType: input.eventType },
			dueAt: now,
		},
	});

	return { eventId, created: true as const };
}
