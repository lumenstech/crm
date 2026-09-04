import type { Db } from "@crm/db";
import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CompaniesService } from "../companies/companies.service";
import { normalizeDomain } from "../companies/domain";
import { InjectDatabase } from "../database/database.constants";
import type {
	IngestSignalInput,
	IngestSignalOutput,
	ResolveSignalCompanyInput,
	ResolveSignalCompanyOutput,
	SignalCompanyCandidatesOutput,
	SignalInboxInput,
	SignalInboxOutput,
} from "./ingest.contracts";

type BusinessUnitRow = { id: string; key?: string; enabled: boolean };
type SourceRecordRow = { id: string };
type SignalRow = {
	id: string;
	businessUnitId: string;
	project: string;
	sourceSystem: string;
	sourceType: string;
	sourceId: string;
	payload: Record<string, unknown>;
};
type CandidateRow = {
	id: string;
	name: string;
	domain: string | null;
	businessUnitId: string | null;
};
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
	payload: Record<string, unknown>;
};

@Injectable()
export class IngestService {
	private readonly logger = new Logger(IngestService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly companies: CompaniesService,
	) {}

	async signal(input: IngestSignalInput): Promise<IngestSignalOutput> {
		const [businessUnit] = await this.db.$queryRaw<BusinessUnitRow[]>`
			SELECT id, enabled FROM business_unit WHERE key = ${input.project} LIMIT 1
		`;
		if (!businessUnit) {
			throw new BadRequestException(
				`Unknown business unit: ${input.project}. Register it before ingesting signals.`,
			);
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
			ON CONFLICT ("sourceSystem", "sourceType", "sourceId")
			DO UPDATE SET
				"businessUnitId" = EXCLUDED."businessUnitId",
				"sourceUrl" = EXCLUDED."sourceUrl",
				"observedAt" = EXCLUDED."observedAt",
				payload = EXCLUDED.payload
			RETURNING id
		`;
		if (!saved) throw new Error("Signal ingest did not return a source record.");

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
						AND rm."canonicalType" = 'company'
						AND rm.status = 'active'
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
						SELECT 1 FROM record_mapping rm
						WHERE rm."sourceSystem" = sr."sourceSystem"
							AND rm."sourceType" = sr."sourceType"
							AND rm."sourceId" = sr."sourceId"
							AND rm."canonicalType" = 'company' AND rm.status = 'active'
					))
					OR (${input.status} = 'unresolved' AND NOT EXISTS (
						SELECT 1 FROM record_mapping rm
						WHERE rm."sourceSystem" = sr."sourceSystem"
							AND rm."sourceType" = sr."sourceType"
							AND rm."sourceId" = sr."sourceId"
							AND rm."canonicalType" = 'company' AND rm.status = 'active'
					))
				)
			ORDER BY COALESCE(
				NULLIF(sr.payload->>'signal_score','')::float,
				NULLIF(sr.payload->'metadata'->>'fit_score','')::float, 0
			) DESC, sr."observedAt" DESC
			LIMIT ${input.limit}
		`;
		return {
			rows: rows.map((row) => ({ ...row, observedAt: row.observedAt.toISOString() })),
			count: rows.length,
		};
	}

	async companyCandidates(sourceRecordId: string): Promise<SignalCompanyCandidatesOutput> {
		const signal = await this.loadSignal(sourceRecordId);
		const entity = this.signalEntity(signal.payload);
		const domain = this.signalDomain(signal.payload);

		const [mapped] = await this.db.$queryRaw<Array<{ applicationId: string | null }>>`
			SELECT "applicationId" FROM record_mapping
			WHERE "sourceSystem" = ${signal.sourceSystem}
				AND "sourceType" = ${signal.sourceType}
				AND "sourceId" = ${signal.sourceId}
				AND "canonicalType" = 'company' AND status = 'active'
			LIMIT 1
		`;

		const rows = entity || domain
			? await this.db.company.findMany({
					where: {
						archivedAt: null,
						OR: [
							...(entity
								? [
									{ name: { equals: entity, mode: "insensitive" as const } },
									{ name: { contains: entity, mode: "insensitive" as const } },
								]
								: []),
							...(domain ? [{ domain }] : []),
						],
					},
					select: { id: true, name: true, domain: true, businessUnitId: true },
					take: 20,
			  })
			: [];

		const candidates = (rows as CandidateRow[])
			.map((row) => this.scoreCandidate(row, entity, domain, signal.businessUnitId))
			.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

		return {
			sourceRecordId,
			project: signal.project,
			entity,
			domain,
			mappedCompanyId: mapped?.applicationId ?? null,
			candidates,
		};
	}

	async resolveCompany(input: ResolveSignalCompanyInput): Promise<ResolveSignalCompanyOutput> {
		const signal = await this.loadSignal(input.sourceRecordId);
		const entity = input.companyName ?? this.signalEntity(signal.payload);
		const requestedDomain = normalizeDomain(input.domain ?? this.signalDomain(signal.payload));
		let matchMethod = "manual";
		let created = false;

		let company = input.companyId
			? await this.db.company.findFirst({
					where: { id: input.companyId, archivedAt: null },
					select: { id: true, name: true, domain: true, businessUnitId: true },
			  })
			: null;

		if (!company && requestedDomain) {
			company = await this.db.company.findFirst({
				where: { domain: requestedDomain, archivedAt: null },
				select: { id: true, name: true, domain: true, businessUnitId: true },
			});
			if (company) matchMethod = "domain";
		}
		if (!company && entity) {
			company = await this.db.company.findFirst({
				where: { name: { equals: entity, mode: "insensitive" }, archivedAt: null },
				select: { id: true, name: true, domain: true, businessUnitId: true },
			});
			if (company) matchMethod = "name-exact";
		}

		if (!company && !input.createIfMissing) {
			throw new BadRequestException(
				"No exact company match. Review /ingest/signals/{sourceRecordId}/company-candidates or set createIfMissing=true after verification.",
			);
		}
		if (!company) {
			if (!entity) throw new BadRequestException("A company name is required to create a company.");
			const made = await this.companies.create({
				name: entity,
				domain: requestedDomain ?? undefined,
			});
			await this.db.company.update({
				where: { id: made.id },
				data: { businessUnitId: signal.businessUnitId },
			});
			company = {
				id: made.id,
				name: made.name,
				domain: made.domain,
				businessUnitId: signal.businessUnitId,
			};
			matchMethod = "created";
			created = true;
		}

		const normalizedName = company.name.trim().toLowerCase();
		const canonicalId = randomUUID();
		const [canonical] = await this.db.$queryRaw<Array<{ id: string }>>`
			INSERT INTO canonical_company (
				id, "businessUnitId", name, "normalizedName", domain, website,
				fields, "createdAt", "updatedAt"
			)
			VALUES (
				${canonicalId}, ${signal.businessUnitId}, ${company.name}, ${normalizedName},
				${company.domain}, ${company.domain ? `https://${company.domain}` : null},
				${JSON.stringify({ source_signal_id: signal.id })}::jsonb,
				CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
			)
			ON CONFLICT ("businessUnitId", "normalizedName") DO UPDATE SET
				domain = COALESCE(canonical_company.domain, EXCLUDED.domain),
				website = COALESCE(canonical_company.website, EXCLUDED.website),
				"updatedAt" = CURRENT_TIMESTAMP
			RETURNING id
		`;
		if (!canonical) throw new Error("Canonical company resolution failed.");

		await this.db.$queryRaw`
			INSERT INTO record_mapping (
				id, "sourceSystem", "sourceType", "sourceId", "canonicalType",
				"canonicalId", application, "applicationId", "matchMethod", status,
				"createdAt", "updatedAt"
			)
			VALUES (
				${randomUUID()}, ${signal.sourceSystem}, ${signal.sourceType}, ${signal.sourceId},
				'company', ${canonical.id}, 'comp-ai-core', ${company.id}, ${matchMethod},
				'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
			)
			ON CONFLICT ("sourceSystem", "sourceType", "sourceId", "canonicalType")
			DO UPDATE SET
				"canonicalId" = EXCLUDED."canonicalId",
				application = EXCLUDED.application,
				"applicationId" = EXCLUDED."applicationId",
				"matchMethod" = EXCLUDED."matchMethod",
				status = 'active',
				"updatedAt" = CURRENT_TIMESTAMP
		`;

		let researchQueued = false;
		if (input.queueResearch) {
			const queued = await this.companies.enrich(company.id);
			researchQueued = queued.queued;
		}

		this.logger.log({
			message: "Signal company resolved",
			sourceRecordId: input.sourceRecordId,
			companyId: company.id,
			canonicalCompanyId: canonical.id,
			matchMethod,
			created,
			researchQueued,
		});

		return {
			sourceRecordId: input.sourceRecordId,
			canonicalCompanyId: canonical.id,
			companyId: company.id,
			companyName: company.name,
			matchMethod,
			created,
			researchQueued,
		};
	}

	private async loadSignal(sourceRecordId: string): Promise<SignalRow> {
		const [row] = await this.db.$queryRaw<SignalRow[]>`
			SELECT sr.id, sr."businessUnitId" AS "businessUnitId", bu.key AS project,
				sr."sourceSystem" AS "sourceSystem", sr."sourceType" AS "sourceType",
				sr."sourceId" AS "sourceId", sr.payload
			FROM source_record sr
			JOIN business_unit bu ON bu.id = sr."businessUnitId"
			WHERE sr.id = ${sourceRecordId}
			LIMIT 1
		`;
		if (!row) throw new NotFoundException(`No source signal with id ${sourceRecordId}.`);
		return row;
	}

	private signalEntity(payload: Record<string, unknown>): string | null {
		for (const key of ["entity", "company"] as const) {
			const value = payload[key];
			if (typeof value === "string" && value.trim()) return value.trim();
		}
		return null;
	}

	private signalDomain(payload: Record<string, unknown>): string | null {
		for (const key of ["domain", "website"] as const) {
			const value = payload[key];
			if (typeof value === "string") {
				const domain = normalizeDomain(value);
				if (domain) return domain;
			}
		}
		return null;
	}

	private scoreCandidate(
		row: CandidateRow,
		entity: string | null,
		domain: string | null,
		businessUnitId: string,
	) {
		let score = 0;
		const reasons: string[] = [];
		if (domain && row.domain === domain) {
			score += 100;
			reasons.push("exact-domain");
		}
		if (entity) {
			const wanted = entity.toLowerCase();
			const actual = row.name.toLowerCase();
			if (actual === wanted) {
				score += 95;
				reasons.push("exact-name");
			} else if (actual.startsWith(wanted) || wanted.startsWith(actual)) {
				score += 80;
				reasons.push("name-prefix");
			} else if (actual.includes(wanted) || wanted.includes(actual)) {
				score += 70;
				reasons.push("name-contains");
			}
		}
		if (row.businessUnitId === businessUnitId) {
			score += 10;
			reasons.push("same-business-unit");
		}
		return {
			companyId: row.id,
			name: row.name,
			domain: row.domain,
			businessUnitId: row.businessUnitId,
			score: Math.min(110, score),
			reasons,
		};
	}
}
