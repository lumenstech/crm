import type { Db } from "@crm/db";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { InjectDatabase } from "../database/database.constants";
import type { IngestSignalInput, IngestSignalOutput } from "./ingest.contracts";

type BusinessUnitRow = {
	id: string;
	enabled: boolean;
};

type SourceRecordRow = {
	id: string;
};

@Injectable()
export class IngestService {
	private readonly logger = new Logger(IngestService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async signal(input: IngestSignalInput): Promise<IngestSignalOutput> {
		const [businessUnit] = await this.db.$queryRaw<BusinessUnitRow[]>`
			SELECT id, enabled
			FROM business_unit
			WHERE key = ${input.project}
			LIMIT 1
		`;

		if (!businessUnit) {
			throw new BadRequestException(
				`Unknown business unit: ${input.project}. Register it before ingesting signals.`,
			);
		}

		if (!businessUnit.enabled) {
			throw new BadRequestException(
				`Business unit is disabled: ${input.project}.`,
			);
		}

		const [existing] = await this.db.$queryRaw<SourceRecordRow[]>`
			SELECT id
			FROM source_record
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
				id,
				"businessUnitId",
				"sourceSystem",
				"sourceType",
				"sourceId",
				"sourceUrl",
				"observedAt",
				payload,
				"createdAt"
			)
			VALUES (
				${sourceRecordId},
				${businessUnit.id},
				${input.source},
				${input.sourceType},
				${input.sourceId},
				${input.sourceUrl ?? null},
				${observedAt},
				${payload}::jsonb,
				CURRENT_TIMESTAMP
			)
			ON CONFLICT ("sourceSystem", "sourceType", "sourceId")
			DO UPDATE SET
				"businessUnitId" = EXCLUDED."businessUnitId",
				"sourceUrl" = EXCLUDED."sourceUrl",
				"observedAt" = EXCLUDED."observedAt",
				payload = EXCLUDED.payload
			RETURNING id
		`;

		if (!saved) {
			throw new Error("Signal ingest did not return a source record.");
		}

		this.logger.log({
			message: "Signal ingested",
			project: input.project,
			source: input.source,
			sourceType: input.sourceType,
			sourceId: input.sourceId,
			sourceRecordId: saved.id,
			deduplicated: Boolean(existing),
		});

		return {
			status: "accepted",
			sourceRecordId: saved.id,
			project: input.project,
			deduplicated: Boolean(existing),
			promoted: false,
		};
	}
}
