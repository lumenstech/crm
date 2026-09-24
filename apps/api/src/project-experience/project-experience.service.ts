import { type Db, Prisma } from "@crm/db";
import { parse } from "@crm/validation";
import {
	opportunityProjectSignals,
	projectExperienceTags,
} from "@crm/validation/project-experience";
import { Injectable, NotFoundException } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { InjectDatabase } from "../database/database.constants";
import type { ProjectExperienceListInput } from "./project-experience.contracts";

type ProjectRow = {
	sourceRecordId: string;
	projectId: string;
	companyId: string | null;
	canonicalCompanyName: string | null;
	projectName: string;
	clientLabel: string;
	siteName: string | null;
	city: string | null;
	state: string | null;
	startDate: string | null;
	endDate: string | null;
	sector: string | null;
	projectType: string | null;
	scopeSummary: string | null;
	systems: string | null;
	deliveryPartner: string | null;
	completionStatus: string | null;
	claimTier: string | null;
	evidenceStrength: string | null;
	amountUsd: number | null;
	amountBasis: string | null;
	portfolioLanguage: string | null;
	commercialNotes: string | null;
	caveats: string | null;
	evidenceItems: number;
	tags: unknown;
	salesEligible: boolean;
	sourceUrl: string | null;
	lastVerifiedAt: Date | null;
};

type MatchRow = {
	sourceRecordId: string;
	projectId: string;
	projectName: string;
	clientLabel: string;
	sector: string | null;
	projectType: string | null;
	scopeSummary: string | null;
	portfolioLanguage: string | null;
	evidenceStrength: string | null;
	salesEligible: boolean;
	score: number;
	matchedSignals: unknown;
	rationale: string;
	computedAt: Date;
};

const PROJECT_SELECT = Prisma.sql`
	p.source_record_id AS "sourceRecordId",
	p.project_id AS "projectId",
	p.company_id AS "companyId",
	p.canonical_company_name AS "canonicalCompanyName",
	p.project_name AS "projectName",
	p.client_label AS "clientLabel",
	p.site_name AS "siteName",
	p.city,
	p.state,
	p.start_date AS "startDate",
	p.end_date AS "endDate",
	p.sector,
	p.project_type AS "projectType",
	p.scope_summary AS "scopeSummary",
	p.systems,
	p.delivery_partner AS "deliveryPartner",
	p.completion_status AS "completionStatus",
	p.claim_tier AS "claimTier",
	p.evidence_strength AS "evidenceStrength",
	p.amount_usd::float8 AS "amountUsd",
	p.amount_basis AS "amountBasis",
	p.portfolio_language AS "portfolioLanguage",
	p.commercial_notes AS "commercialNotes",
	p.caveats,
	p.evidence_items AS "evidenceItems",
	p.tags,
	p.sales_eligible AS "salesEligible",
	p.source_url AS "sourceUrl",
	p.last_verified_at AS "lastVerifiedAt"
`;

function orderBy(input: ProjectExperienceListInput): Prisma.Sql {
	const direction = input.dir === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
	let column = Prisma.sql`p.project_name`;
	if (input.sort === "client") column = Prisma.sql`p.client_label`;
	if (input.sort === "sector") column = Prisma.sql`p.sector`;
	if (input.sort === "projectType") column = Prisma.sql`p.project_type`;
	if (input.sort === "claimTier") column = Prisma.sql`p.claim_tier`;
	if (input.sort === "evidence") column = Prisma.sql`p.evidence_items`;
	if (input.sort === "verified") column = Prisma.sql`p.last_verified_at`;

	return Prisma.sql`${column} ${direction} NULLS LAST, p.project_id ASC`;
}

@Injectable()
export class ProjectExperienceService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
	) {}

	async list(input: ProjectExperienceListInput) {
		const offset = (input.page - 1) * input.pageSize;
		const query = input.q || null;
		const salesReady = input.eligibility.includes("sales-ready");
		const review = input.eligibility.includes("review");
		const eligibilityIgnored = salesReady === review;
		const filters = Prisma.sql`
			(${query}::text IS NULL OR concat_ws(' ', p.project_name, p.client_label, p.site_name, p.city, p.state, p.sector, p.project_type, p.scope_summary, p.systems, p.portfolio_language) ILIKE ${query ? `%${query}%` : null})
			AND (cardinality(${input.sector}::text[]) = 0 OR p.sector = ANY(${input.sector}::text[]))
			AND (cardinality(${input.projectType}::text[]) = 0 OR p.project_type = ANY(${input.projectType}::text[]))
			AND (cardinality(${input.claimTier}::text[]) = 0 OR p.claim_tier = ANY(${input.claimTier}::text[]))
			AND (${eligibilityIgnored}::boolean OR p.sales_eligible = ${salesReady})
		`;

		const [rows, totals, sectors, projectTypes, claimTiers] = await Promise.all(
			[
				this.db.$queryRaw<ProjectRow[]>(Prisma.sql`
				SELECT ${PROJECT_SELECT}
				FROM project_experience_index p
				WHERE ${filters}
				ORDER BY ${orderBy(input)}
				LIMIT ${input.pageSize} OFFSET ${offset}
			`),
				this.db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
				SELECT COUNT(*)::bigint AS count
				FROM project_experience_index p
				WHERE ${filters}
			`),
				this.facet("sector"),
				this.facet("project_type"),
				this.facet("claim_tier"),
			],
		);

		return {
			rows: rows.map((row) => ({
				...row,
				tags: parse(
					projectExperienceTags,
					row.tags,
					`Project ${row.projectId} tags`,
				),
				lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
			})),
			total: Number(totals[0]?.count ?? 0),
			facetCounts: {
				sector: Object.fromEntries(
					sectors.map((row) => [row.value, row.count]),
				),
				projectType: Object.fromEntries(
					projectTypes.map((row) => [row.value, row.count]),
				),
				claimTier: Object.fromEntries(
					claimTiers.map((row) => [row.value, row.count]),
				),
				eligibility: {
					"sales-ready": await this.countEligibility(true),
					review: await this.countEligibility(false),
				},
			},
		};
	}

	async summary() {
		const [row] = await this.db.$queryRaw<
			Array<{
				total: number;
				salesReady: number;
				headline: number;
				review: number;
				evidenceItems: number;
				linkedCompanies: number;
				duplicateCandidates: number;
			}>
		>`
			SELECT
				COUNT(*)::int AS total,
				COUNT(*) FILTER (WHERE sales_eligible)::int AS "salesReady",
				COUNT(*) FILTER (WHERE claim_tier = 'headline')::int AS headline,
				COUNT(*) FILTER (WHERE NOT sales_eligible OR evidence_strength IN ('low','medium'))::int AS review,
				COALESCE(SUM(evidence_items), 0)::int AS "evidenceItems",
				COUNT(DISTINCT company_id) FILTER (WHERE company_id IS NOT NULL)::int AS "linkedCompanies",
				(SELECT COUNT(*)::int FROM project_experience_duplicate_candidates) AS "duplicateCandidates"
			FROM project_experience_index
		`;

		return (
			row ?? {
				total: 0,
				salesReady: 0,
				headline: 0,
				review: 0,
				evidenceItems: 0,
				linkedCompanies: 0,
				duplicateCandidates: 0,
			}
		);
	}

	async matches(dealId: string) {
		const [rows, task] = await Promise.all([
			this.db.$queryRaw<MatchRow[]>`
				SELECT
					m."sourceRecordId", p.project_id AS "projectId",
					p.project_name AS "projectName", p.client_label AS "clientLabel",
					p.sector, p.project_type AS "projectType",
					p.scope_summary AS "scopeSummary",
					p.portfolio_language AS "portfolioLanguage",
					p.evidence_strength AS "evidenceStrength",
					p.sales_eligible AS "salesEligible", m.score,
					m."matchedSignals", m.rationale, m."computedAt"
				FROM opportunity_project_match m
				JOIN project_experience_index p ON p.source_record_id = m."sourceRecordId"
				WHERE m."dealId" = ${dealId}
				ORDER BY m.score DESC, p.project_name ASC
			`,
			this.db.agentTask.findFirst({
				where: { dealId, kind: "project-experience-match" },
				orderBy: { createdAt: "desc" },
				select: { startedAt: true, finishedAt: true, outcome: true },
			}),
		]);

		const computedAt = rows[0]?.computedAt ?? null;
		const status = task
			? task.finishedAt
				? task.outcome?.startsWith("Stored ")
					? rows.length > 0
						? "ready"
						: "idle"
					: "failed"
				: task.startedAt
					? "running"
					: "queued"
			: rows.length > 0
				? "ready"
				: "idle";

		return {
			status,
			computedAt: computedAt?.toISOString() ?? null,
			rows: rows.map(({ computedAt: _computedAt, ...row }) => ({
				...row,
				matchedSignals: parse(
					opportunityProjectSignals,
					row.matchedSignals,
					`Project match ${row.sourceRecordId} signals`,
				),
			})),
		};
	}

	async refreshMatches(dealId: string) {
		const deal = await this.db.deal.findUnique({
			where: { id: dealId },
			select: { id: true },
		});
		if (!deal) throw new NotFoundException("Deal not found.");

		return {
			dealId,
			queued: await this.agent.projectExperienceRequested(dealId),
		};
	}

	private async facet(column: "sector" | "project_type" | "claim_tier") {
		const field = {
			sector: Prisma.sql`sector`,
			project_type: Prisma.sql`project_type`,
			claim_tier: Prisma.sql`claim_tier`,
		}[column];

		return this.db.$queryRaw<
			Array<{ value: string; count: number }>
		>(Prisma.sql`
			SELECT ${field} AS value, COUNT(*)::int AS count
			FROM project_experience_index
			WHERE ${field} IS NOT NULL
			GROUP BY ${field}
			ORDER BY ${field}
		`);
	}

	private async countEligibility(salesEligible: boolean) {
		const [row] = await this.db.$queryRaw<Array<{ count: number }>>`
			SELECT COUNT(*)::int AS count
			FROM project_experience_index
			WHERE sales_eligible = ${salesEligible}
		`;
		return row?.count ?? 0;
	}
}
