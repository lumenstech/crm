import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	type IngestSignalInput,
	type IngestSignalOutput,
	type SignalInboxInput,
	type SignalInboxOutput,
	type SignalPayload,
	signalPayload,
} from "./ingest.contracts";
import { PromotionService } from "./promotion.service";

type BusinessUnitRow = { id: string; enabled: boolean };
type SourceRecordRow = { id: string; deduplicated: boolean };
type InboxRow = {
	sourceRecordId: string;
	project: string;
	source: string;
	sourceType: string;
	sourceId: string;
	sourceUrl: string | null;
	observedAt: Date;
	entity: string | null;
	signalScore: number | null;
	company: string | null;
	subject: string | null;
	stageKey: string | null;
	priority: string | null;
	demandTrigger: string | null;
	nextAction: string | null;
	mapped: boolean;
	payload: SignalPayload;
};

@Injectable()
export class IngestService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		@Optional() private readonly promotion?: PromotionService,
	) {}

	async signal(input: IngestSignalInput): Promise<IngestSignalOutput> {
		const [businessUnit] = await this.db.$queryRaw<BusinessUnitRow[]>`
			SELECT id, enabled FROM business_unit WHERE key = ${input.project} LIMIT 1
		`;
		if (!businessUnit) {
			throw new BadRequestException(`Unknown business unit: ${input.project}.`);
		}
		if (!businessUnit.enabled) {
			throw new BadRequestException(
				`Business unit is disabled: ${input.project}.`,
			);
		}

		const observedAt = input.observedAt
			? new Date(input.observedAt)
			: new Date();
		const payload = JSON.stringify({
			...input.payload,
			project: input.project,
			source: input.source,
			source_type: input.sourceType,
			source_id: input.sourceId,
			entity: input.entity ?? null,
			signal_score: input.signalScore ?? null,
			tags: input.tags,
			ingested_at: new Date().toISOString(),
		});
		const candidateId = randomUUID();
		const { saved, promotion } = await this.db.$transaction(async (tx) => {
			const [saved] = await tx.$queryRaw<SourceRecordRow[]>`
				INSERT INTO source_record (
					id, "businessUnitId", "sourceSystem", "sourceType", "sourceId",
					"sourceUrl", "observedAt", payload, "ingestedAt", status,
					"createdAt", "updatedAt"
				)
				VALUES (
					${candidateId}, ${businessUnit.id}, ${input.source}, ${input.sourceType},
					${input.sourceId}, ${input.sourceUrl ?? null}, ${observedAt}, ${payload}::jsonb,
					CURRENT_TIMESTAMP, 'accepted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
				)
				ON CONFLICT ("businessUnitId", "sourceSystem", "sourceType", "sourceId") DO UPDATE SET
					"sourceUrl" = EXCLUDED."sourceUrl",
					"observedAt" = EXCLUDED."observedAt",
					payload = EXCLUDED.payload,
					"ingestedAt" = EXCLUDED."ingestedAt",
					status = 'accepted',
					error = NULL,
					"updatedAt" = CURRENT_TIMESTAMP
				RETURNING id, (id <> ${candidateId}) AS deduplicated
			`;
			if (!saved)
				throw new Error("Signal ingest did not return a source record.");
			const promotion = this.promotion
				? await this.promotion.processInTransaction(tx, saved.id)
				: { status: "review" as const, entityType: "company" };
			return { saved, promotion };
		});
		return {
			status: "accepted",
			sourceRecordId: saved.id,
			project: input.project,
			deduplicated: saved.deduplicated,
			promoted: promotion.status === "promoted",
			resolution: promotion.status,
			canonicalId: promotion.canonicalId,
			visibleId: promotion.visibleId,
			reviewId: promotion.reviewId,
		};
	}

	async inbox(input: SignalInboxInput): Promise<SignalInboxOutput> {
		const rows = await this.db.$queryRaw<InboxRow[]>`
			SELECT
				sr.id AS "sourceRecordId", bu.key AS project,
				sr."sourceSystem" AS source, sr."sourceType" AS "sourceType",
				sr."sourceId" AS "sourceId", sr."sourceUrl" AS "sourceUrl",
				sr."observedAt" AS "observedAt",
				COALESCE(sr.payload->>'entity', sr.payload->>'company') AS entity,
				COALESCE(NULLIF(sr.payload->>'signal_score','')::float,
					NULLIF(sr.payload->'metadata'->>'fit_score','')::float) AS "signalScore",
				sr.payload->>'company' AS company,
				sr.payload->>'subject' AS subject,
				sr.payload->>'stage_key' AS "stageKey",
				sr.payload->>'priority' AS priority,
				sr.payload->>'demand_trigger' AS "demandTrigger",
				sr.payload->>'next_action' AS "nextAction",
				EXISTS (
					SELECT 1 FROM record_mapping rm
					WHERE rm."sourceRecordId" = sr.id
						AND rm."canonicalType" = 'company' AND rm.status = 'active'
				) AS mapped,
				sr.payload AS payload
			FROM source_record sr
			JOIN business_unit bu ON bu.id = sr."businessUnitId"
			WHERE (${input.project ?? null}::text IS NULL OR bu.key = ${input.project ?? null})
				AND (${input.minScore ?? null}::float IS NULL OR COALESCE(
					NULLIF(sr.payload->>'signal_score','')::float,
					NULLIF(sr.payload->'metadata'->>'fit_score','')::float, 0
				) >= ${input.minScore ?? null})
				AND (
					${input.status} = 'all'
					OR (${input.status} = 'mapped' AND EXISTS (
						SELECT 1 FROM record_mapping rm WHERE rm."sourceRecordId" = sr.id
							AND rm."canonicalType" = 'company' AND rm.status = 'active'))
					OR (${input.status} = 'unresolved' AND NOT EXISTS (
						SELECT 1 FROM record_mapping rm WHERE rm."sourceRecordId" = sr.id
							AND rm."canonicalType" = 'company' AND rm.status = 'active'))
				)
			ORDER BY COALESCE(NULLIF(sr.payload->>'signal_score','')::float,
				NULLIF(sr.payload->'metadata'->>'fit_score','')::float, 0) DESC,
				sr."observedAt" DESC
			LIMIT ${input.limit}
		`;
		return {
			rows: rows.map((row) => ({
				...row,
				observedAt: row.observedAt.toISOString(),
				payload: signalPayload.parse(row.payload),
			})),
			count: rows.length,
		};
	}
}
