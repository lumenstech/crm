import type { Db } from "@crm/db";
import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { InjectDatabase } from "../database/database.constants";
import {
	signalPayload,
	type IngestSignalInput,
	type IngestSignalOutput,
	type SignalInboxInput,
	type SignalInboxOutput,
	type SignalPayload,
} from "./ingest.contracts";

type BusinessUnitRow = { id: string; enabled: boolean };
type SourceRecordRow = { id: string };
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
	constructor(@InjectDatabase() private readonly db: Db) {}

	async signal(input: IngestSignalInput): Promise<IngestSignalOutput> {
		const [businessUnit] = await this.db.$queryRaw<BusinessUnitRow[]>`
			SELECT id, enabled FROM business_unit WHERE key = ${input.project} LIMIT 1
		`;
		if (!businessUnit) {
			throw new BadRequestException(`Unknown business unit: ${input.project}.`);
		}
		if (!businessUnit.enabled) {
			throw new BadRequestException(`Business unit is disabled: ${input.project}.`);
		}

		const [existing] = await this.db.$queryRaw<SourceRecordRow[]>`
			SELECT id FROM source_record
			WHERE "sourceSystem" = ${input.source}
				AND "sourceType" = ${input.sourceType}
				AND "sourceId" = ${input.sourceId}
			LIMIT 1
		`;

		const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();
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
		const sourceRecordId = existing?.id ?? randomUUID();

		const [saved] = await this.db.$queryRaw<SourceRecordRow[]>`
			INSERT INTO source_record (
				id, "businessUnitId", "sourceSystem", "sourceType", "sourceId",
				"sourceUrl", "observedAt", payload, "createdAt"
			)
			VALUES (
				${sourceRecordId}, ${businessUnit.id}, ${input.source}, ${input.sourceType},
				${input.sourceId}, ${input.sourceUrl ?? null}, ${observedAt}, ${payload}::jsonb,
				CURRENT_TIMESTAMP
			)
			ON CONFLICT ("sourceSystem", "sourceType", "sourceId") DO UPDATE SET
				"businessUnitId" = EXCLUDED."businessUnitId",
				"sourceUrl" = EXCLUDED."sourceUrl",
				"observedAt" = EXCLUDED."observedAt",
				payload = EXCLUDED.payload
			RETURNING id
		`;
		if (!saved) throw new Error("Signal ingest did not return a source record.");
		return {
			status: "accepted",
			sourceRecordId: saved.id,
			project: input.project,
			deduplicated: Boolean(existing),
			promoted: false,
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
					WHERE rm."sourceSystem" = sr."sourceSystem"
						AND rm."sourceType" = sr."sourceType"
						AND rm."sourceId" = sr."sourceId"
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
						SELECT 1 FROM record_mapping rm WHERE rm."sourceSystem" = sr."sourceSystem"
							AND rm."sourceType" = sr."sourceType" AND rm."sourceId" = sr."sourceId"
							AND rm."canonicalType" = 'company' AND rm.status = 'active'))
					OR (${input.status} = 'unresolved' AND NOT EXISTS (
						SELECT 1 FROM record_mapping rm WHERE rm."sourceSystem" = sr."sourceSystem"
							AND rm."sourceType" = sr."sourceType" AND rm."sourceId" = sr."sourceId"
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
