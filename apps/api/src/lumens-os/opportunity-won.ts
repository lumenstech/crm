import { randomUUID } from "node:crypto";
import type { Db, Prisma } from "@crm/db";

export const OPPORTUNITY_WON_EVENT = "opportunity.won" as const;
export const GAUZY_PROMOTION_TASK = "gauzy_promotion" as const;

export type OpportunityWonPayloadV1 = {
	version: 1;
	opportunityId: string;
	companyId: string | null;
	contactIds: string[];
	businessUnitId: string;
	provenanceIds: string[];
};

type TransactionDb = Prisma.TransactionClient;

export async function emitOpportunityWon(
	tx: TransactionDb,
	input: OpportunityWonPayloadV1,
) {
	const idempotencyKey = `${OPPORTUNITY_WON_EVENT}:${input.opportunityId}`;
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
			eventType: OPPORTUNITY_WON_EVENT,
			aggregateType: "canonical_opportunity",
			aggregateId: input.opportunityId,
			businessUnitId: input.businessUnitId,
			payload: input,
			idempotencyKey,
			createdAt: now,
			updatedAt: now,
		},
	});

	await tx.gauzyPromotion.upsert({
		where: { opportunityId: input.opportunityId },
		create: {
			id: randomUUID(),
			opportunityId: input.opportunityId,
			companyId: input.companyId,
			businessUnitId: input.businessUnitId,
			eventId,
			payload: input,
			createdAt: now,
			updatedAt: now,
		},
		update: { eventId, payload: input, updatedAt: now },
	});

	await tx.agentTask.create({
		data: {
			kind: GAUZY_PROMOTION_TASK,
			reason: "Promote a won canonical opportunity into Gauzy operations.",
			subject: eventId,
			companyId: input.companyId,
			businessUnitId: input.businessUnitId,
			payload: { eventId, opportunityId: input.opportunityId },
			dueAt: now,
		},
	});

	return { eventId, created: true as const };
}

export async function emitOpportunityWonFromCanonical(
	db: Db,
	opportunityId: string,
) {
	return db.$transaction(async (tx) => {
		const opportunity = await tx.canonicalOpportunity.findUnique({
			where: { id: opportunityId },
			select: {
				id: true,
				stage: true,
				companyId: true,
				businessUnitId: true,
				sources: { select: { id: true } },
				company: {
					select: {
						people: { select: { personId: true } },
					},
				},
			},
		});
		if (!opportunity) throw new Error(`Canonical opportunity ${opportunityId} not found.`);
		if (opportunity.stage.toLowerCase() !== "won") {
			throw new Error(`Canonical opportunity ${opportunityId} is not WON.`);
		}
		return emitOpportunityWon(tx, {
			version: 1,
			opportunityId: opportunity.id,
			companyId: opportunity.companyId,
			contactIds: opportunity.company?.people.map((row) => row.personId) ?? [],
			businessUnitId: opportunity.businessUnitId,
			provenanceIds: opportunity.sources.map((row) => row.id),
		});
	});
}
