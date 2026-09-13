import { randomUUID } from "node:crypto";
import { db, Prisma } from "@crm/db";
import { parse } from "@crm/validation";
import { projectExperienceTags } from "@crm/validation/project-experience";
import { PROJECT_EXPERIENCE_MATCH } from "./project-experience-config";
import { scoreProjectExperience } from "./project-experience-score";

type ProjectRow = {
	sourceRecordId: string;
	projectName: string;
	clientLabel: string;
	sector: string | null;
	projectType: string | null;
	scopeSummary: string | null;
	systems: string | null;
	portfolioLanguage: string | null;
	evidenceStrength: string | null;
	salesEligible: boolean;
	tags: unknown;
};

export type ProjectMatch = {
	sourceRecordId: string;
	score: number;
	matchedSignals: string[];
	rationale: string;
};

export async function runProjectExperienceMatch(dealId: string) {
	const [deal, rows] = await Promise.all([
		db.deal.findUnique({
			where: { id: dealId },
			select: {
				name: true,
				description: true,
				company: { select: { name: true, industry: true } },
			},
		}),
		db.$queryRaw<ProjectRow[]>`
			SELECT
				source_record_id AS "sourceRecordId",
				project_name AS "projectName",
				client_label AS "clientLabel",
				sector,
				project_type AS "projectType",
				scope_summary AS "scopeSummary",
				systems,
				portfolio_language AS "portfolioLanguage",
				evidence_strength AS "evidenceStrength",
				sales_eligible AS "salesEligible",
				tags
			FROM project_experience_index
		`,
	]);

	if (!deal) return { stored: 0, reason: "Deal not found." };

	const dealText = [
		deal.name,
		deal.description,
		deal.company.name,
		deal.company.industry,
	]
		.filter(Boolean)
		.join(" ");

	const matches = rows
		.map((row) => {
			const tags = parse(
				projectExperienceTags,
				row.tags,
				`Project ${row.sourceRecordId} tags`,
			);
			const match = scoreProjectExperience(dealText, { ...row, tags });
			return match ? { sourceRecordId: row.sourceRecordId, ...match } : null;
		})
		.filter((match): match is ProjectMatch => match !== null)
		.sort(
			(a, b) =>
				b.score - a.score || a.sourceRecordId.localeCompare(b.sourceRecordId),
		)
		.slice(0, PROJECT_EXPERIENCE_MATCH.limit);

	const computedAt = new Date();
	await db.$transaction(async (tx) => {
		await tx.$executeRaw`
			DELETE FROM opportunity_project_match WHERE "dealId" = ${dealId}
		`;
		for (const match of matches) {
			await tx.$executeRaw(Prisma.sql`
				INSERT INTO opportunity_project_match (
					id, "dealId", "sourceRecordId", score,
					"matchedSignals", rationale, "computedAt"
				) VALUES (
					${randomUUID()}, ${dealId}, ${match.sourceRecordId},
					${match.score}, ${JSON.stringify(match.matchedSignals)}::jsonb,
					${match.rationale}, ${computedAt}
				)
			`);
		}
	});

	return { stored: matches.length, reason: null };
}
