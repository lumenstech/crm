import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import type {
	ObservationValidation,
	SiteObservationPayload,
	SourceHealthStatus,
} from "@crm/validation/site-operations";
import {
	parseSiteObservationPayload,
	sourceHealthId,
} from "@crm/validation/site-operations";
import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

export type RecordObservationInput = {
	assetId: string;
	provider: string;
	sourceEventId: string;
	metric: string;
	numericValue?: number | null;
	textValue?: string | null;
	unit?: string | null;
	observedAt: Date;
	receivedAt?: Date;
	validation?: ObservationValidation;
	rejectionCode?: string | null;
	evidenceRef?: string | null;
	rawPayload?: SiteObservationPayload;
};

export type RecordObservationResult = {
	observationId: string;
	deduplicated: boolean;
};

export type RecordSourceHealthInput = {
	provider: string;
	siteId: string;
	assetId?: string | null;
	status: SourceHealthStatus;
	lastAttemptAt?: Date | null;
	lastSuccessAt?: Date | null;
	lastError?: string | null;
	expectedIntervalSeconds: number;
};

@Injectable()
export class SiteOpsIngestService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	/**
	 * The only writer of `site_ops_observation`. A row here means a reading arrived.
	 * Absence of a reading is never written; it is derived by `deriveSignalState`.
	 *
	 * The insert is atomically idempotent. Two deliveries of the same source event
	 * race safely: the unique index arbitrates, the loser reads the winner's row,
	 * and no `P2002` escapes to the caller.
	 */
	async recordObservation(
		input: RecordObservationInput,
	): Promise<RecordObservationResult> {
		const asset = await this.db.siteOpsAsset.findUnique({
			where: { id: input.assetId },
			select: { id: true, siteId: true },
		});
		if (!asset) {
			throw new NotFoundException(`No site asset with id ${input.assetId}.`);
		}

		const id = randomUUID();
		const inserted = await this.db.$queryRaw<Array<{ id: string }>>`
			INSERT INTO site_ops_observation (
				id, site_id, asset_id, provider, source_event_id, metric,
				numeric_value, text_value, unit, observed_at, received_at,
				validation, rejection_code, evidence_ref, raw_payload, created_at
			)
			VALUES (
				${id}, ${asset.siteId}, ${asset.id}, ${input.provider},
				${input.sourceEventId}, ${input.metric},
				${input.numericValue ?? null}, ${input.textValue ?? null},
				${input.unit ?? null}, ${input.observedAt},
				${input.receivedAt ?? new Date()},
				${input.validation ?? "accepted"}, ${input.rejectionCode ?? null},
				${input.evidenceRef ?? null},
				${JSON.stringify(parseSiteObservationPayload(input.rawPayload))}::jsonb,
				CURRENT_TIMESTAMP
			)
			ON CONFLICT (provider, asset_id, source_event_id) DO NOTHING
			RETURNING id
		`;

		const createdId = inserted[0]?.id;
		if (createdId) return { observationId: createdId, deduplicated: false };

		const existing = await this.db.siteOpsObservation.findUnique({
			where: {
				provider_assetId_sourceEventId: {
					provider: input.provider,
					assetId: asset.id,
					sourceEventId: input.sourceEventId,
				},
			},
			select: { id: true },
		});
		if (!existing) {
			throw new Error(
				`Observation ${input.provider}/${input.sourceEventId} was neither inserted nor found.`,
			);
		}
		return { observationId: existing.id, deduplicated: true };
	}

	/**
	 * Source health is keyed by provider and scope. When a scope names an asset the
	 * site is derived from that asset, because two separately valid foreign keys can
	 * still describe an asset that does not stand at the named site.
	 */
	async recordSourceHealth(input: RecordSourceHealthInput): Promise<string> {
		let siteId = input.siteId;

		if (input.assetId) {
			const asset = await this.db.siteOpsAsset.findUnique({
				where: { id: input.assetId },
				select: { id: true, siteId: true },
			});
			if (!asset) {
				throw new NotFoundException(`No site asset with id ${input.assetId}.`);
			}
			if (asset.siteId !== input.siteId) {
				throw new BadRequestException(
					`Asset ${input.assetId} belongs to site ${asset.siteId}, not ${input.siteId}.`,
				);
			}
			siteId = asset.siteId;
		} else {
			const site = await this.db.siteOpsSite.findUnique({
				where: { id: siteId },
				select: { id: true },
			});
			if (!site) throw new NotFoundException(`No site with id ${siteId}.`);
		}

		const id = sourceHealthId(input.provider, siteId, input.assetId ?? null);
		const row = await this.db.siteOpsSourceHealth.upsert({
			where: { id },
			create: {
				id,
				provider: input.provider,
				siteId,
				assetId: input.assetId ?? null,
				status: input.status,
				lastAttemptAt: input.lastAttemptAt ?? null,
				lastSuccessAt: input.lastSuccessAt ?? null,
				lastError: input.lastError ?? null,
				expectedIntervalSeconds: input.expectedIntervalSeconds,
			},
			update: {
				status: input.status,
				lastAttemptAt: input.lastAttemptAt ?? null,
				lastSuccessAt: input.lastSuccessAt ?? null,
				lastError: input.lastError ?? null,
				expectedIntervalSeconds: input.expectedIntervalSeconds,
			},
			select: { id: true },
		});
		return row.id;
	}
}
