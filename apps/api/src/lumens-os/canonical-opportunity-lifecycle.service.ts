import type { Db } from "@crm/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { emitOpportunityWon } from "./opportunity-won";

export type TransitionCanonicalOpportunityStageInput = { opportunityId: string; stage: string };

@Injectable()
export class CanonicalOpportunityLifecycleService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async transitionStage(input: TransitionCanonicalOpportunityStageInput) {
		const nextStage = input.stage.trim();
		if (!nextStage) throw new Error("Canonical opportunity stage cannot be empty.");
		return this.db.$transaction(async (tx) => {
			const rows = await tx.$queryRaw<Array<{ id: string; stage: string; companyId: string | null; businessUnitId: string }>>`
				SELECT id, stage, "companyId", "businessUnitId" FROM canonical_opportunity
				WHERE id = ${input.opportunityId} FOR UPDATE
			`;
			const current = rows[0];
			if (!current) throw new NotFoundException(`Canonical opportunity ${input.opportunityId} not found.`);
			const previousStage = current.stage;
			if (previousStage === nextStage) return { opportunityId: current.id, previousStage, stage: nextStage, changed: false, wonEventCreated: false };
			await tx.canonicalOpportunity.update({ where: { id: current.id }, data: { stage: nextStage } });
			let wonEventCreated = false;
			if (previousStage.trim().toLowerCase() !== "won" && nextStage.toLowerCase() === "won") {
				const [sources, people] = await Promise.all([
					tx.sourceRecord.findMany({ where: { opportunityId: current.id }, select: { id: true } }),
					current.companyId ? tx.companyPerson.findMany({ where: { companyId: current.companyId }, select: { personId: true } }) : Promise.resolve([]),
				]);
				const emitted = await emitOpportunityWon(tx, { version: 1, opportunityId: current.id, companyId: current.companyId, contactIds: people.map((row) => row.personId), businessUnitId: current.businessUnitId, provenanceIds: sources.map((row) => row.id) });
				wonEventCreated = emitted.created;
			}
			return { opportunityId: current.id, previousStage, stage: nextStage, changed: true, wonEventCreated };
		});
	}
}
