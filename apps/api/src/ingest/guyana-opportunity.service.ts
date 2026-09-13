import { createHash } from "node:crypto";
import type { Db, Prisma } from "@crm/db";
import { parse } from "@crm/validation";
import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type {
	IngestGuyanaOpportunityInput,
	IngestGuyanaOpportunityOutput,
} from "./guyana-opportunity.contracts";
import {
	guyanaOpportunitySources,
	isApprovedGuyanaOpportunitySourceUrl,
} from "./guyana-opportunity.sources";
import { IngestService } from "./ingest.service";
import type { OpportunityRecommendation } from "./opportunity-ops.contracts";
import {
	type OpportunityHardBlocker,
	opportunityScoreBreakdown,
} from "./opportunity-ops.contracts";
import { OpportunityOpsService } from "./opportunity-ops.service";

type ExistingOpportunityRow = {
	id: string;
	contentHash: string | null;
};

type EvaluationRow = {
	score: number;
	recommendation: OpportunityRecommendation;
	scoreBreakdown: Prisma.JsonValue | null;
};

@Injectable()
export class GuyanaOpportunityService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly ingest: IngestService,
		private readonly opportunityOps: OpportunityOpsService,
	) {}

	async ingestOpportunity(
		input: IngestGuyanaOpportunityInput,
	): Promise<IngestGuyanaOpportunityOutput> {
		if (!isApprovedGuyanaOpportunitySourceUrl(input.source, input.sourceUrl)) {
			throw new BadRequestException(
				`sourceUrl does not match the approved host for ${input.source}.`,
			);
		}

		const capabilityFit = this.capabilityFit(input);
		const hardBlockers = this.hardBlockers(input);
		const contentHash = this.contentHash(input);
		const sourceSystem = `guyana-${input.source}`;
		const electricalLicenseApplied =
			input.electrical.licenseStatus === "verified" &&
			input.electrical.scopeMatch !== "none";

		const [existing] = await this.db.$queryRaw<ExistingOpportunityRow[]>`
			SELECT id, payload->>'collector_content_hash' AS "contentHash"
			FROM source_record
			WHERE "sourceSystem" = ${sourceSystem}
				AND "sourceType" = 'guyana-opportunity'
				AND "sourceId" = ${input.sourceId}
			LIMIT 1
		`;

		if (existing?.contentHash === contentHash) {
			const [evaluation] = await this.db.$queryRaw<EvaluationRow[]>`
				SELECT score, recommendation, "scoreBreakdown" AS "scoreBreakdown"
				FROM opportunity_review_event
				WHERE "sourceRecordId" = ${existing.id} AND "eventType" = 'evaluation'
				ORDER BY "createdAt" DESC, id DESC
				LIMIT 1
			`;
			if (evaluation) {
				const breakdown = evaluation.scoreBreakdown
					? parse(
							opportunityScoreBreakdown,
							evaluation.scoreBreakdown,
							"opportunity score breakdown",
						)
					: null;
				return {
					sourceRecordId: existing.id,
					deduplicated: true,
					score: evaluation.score,
					recommendation: evaluation.recommendation,
					reviewState: "pending",
					hardBlocked: (breakdown?.hardBlockers.length ?? 0) > 0,
					electricalLicenseApplied,
					capabilityFit,
				};
			}
		}

		const signalScore = Math.round(
			capabilityFit +
				input.components.activeNeed +
				input.components.commercialValue +
				input.components.timingUrgency +
				input.components.buyerAccess +
				input.components.strategicValue,
		);
		const registryEntry = guyanaOpportunitySources[input.source];

		const accepted = await this.ingest.signal({
			project: input.project,
			source: sourceSystem,
			sourceType: "guyana-opportunity",
			sourceId: input.sourceId,
			sourceUrl: input.sourceUrl,
			observedAt: input.observedAt ?? undefined,
			entity: input.buyer,
			signalScore,
			tags: [
				"guyana",
				"opportunity-ops",
				input.source,
				...input.categories.slice(0, 20),
			],
			payload: {
				workflow: "opportunity-ops",
				market: "guyana",
				country: "GY",
				buyer: input.buyer,
				company: input.buyer,
				subject: input.title,
				opportunity_name: input.title,
				description: input.description ?? null,
				deadline: input.deadline ?? null,
				estimated_value: input.estimatedValue ?? null,
				currency: input.currency ?? null,
				opportunity_type: input.opportunityType ?? null,
				categories: input.categories,
				electrical: {
					requirement: input.electrical.requirement,
					scope_match: input.electrical.scopeMatch,
					license_status: input.electrical.licenseStatus,
					license_evidence_ref: input.electrical.licenseEvidenceRef ?? null,
					license_scope_notes: input.electrical.licenseScopeNotes ?? null,
				},
				capability_fit: capabilityFit,
				source_trust: registryEntry.trust,
				source_registry_key: input.source,
				collector_content_hash: contentHash,
			},
		});

		const baseEvidence = {
			...input.evidence,
			source: input.sourceUrl,
			buyer: input.buyer,
			electrical_requirement: input.electrical.requirement,
			electrical_scope_match: input.electrical.scopeMatch,
			electrical_license_status: input.electrical.licenseStatus,
		};
		const evidence = input.electrical.licenseEvidenceRef
			? {
					...baseEvidence,
					electrical_license_evidence: input.electrical.licenseEvidenceRef,
				}
			: baseEvidence;

		const evaluation = await this.opportunityOps.evaluate({
			sourceRecordId: accepted.sourceRecordId,
			components: {
				capabilityFit,
				activeNeed: input.components.activeNeed,
				commercialValue: input.components.commercialValue,
				timingUrgency: input.components.timingUrgency,
				buyerAccess: input.components.buyerAccess,
				strategicValue: input.components.strategicValue,
			},
			evidence,
			rationale: input.rationale ?? null,
			hardBlockers,
		});

		return {
			sourceRecordId: accepted.sourceRecordId,
			deduplicated: accepted.deduplicated,
			score: evaluation.score,
			recommendation: evaluation.recommendation,
			reviewState: "pending",
			hardBlocked: evaluation.hardBlocked,
			electricalLicenseApplied,
			capabilityFit,
		};
	}

	private contentHash(input: IngestGuyanaOpportunityInput) {
		const canonical = {
			source: input.source,
			sourceId: input.sourceId,
			sourceUrl: input.sourceUrl,
			buyer: input.buyer,
			title: input.title,
			description: input.description ?? null,
			deadline: input.deadline ?? null,
			estimatedValue: input.estimatedValue ?? null,
			currency: input.currency ?? null,
			opportunityType: input.opportunityType ?? null,
			categories: [...input.categories].sort(),
			electrical: input.electrical,
			components: input.components,
			evidence: Object.entries(input.evidence).sort(([left], [right]) =>
				left.localeCompare(right),
			),
			rationale: input.rationale ?? null,
		};
		return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
	}

	private capabilityFit(input: IngestGuyanaOpportunityInput) {
		let score = 8;

		if (input.electrical.scopeMatch === "direct") score += 12;
		else if (input.electrical.scopeMatch === "adjacent") score += 6;

		if (input.electrical.licenseStatus === "verified") {
			if (input.electrical.requirement === "required") score += 10;
			else if (input.electrical.requirement === "preferred") score += 7;
			else if (input.electrical.requirement === "adjacent") score += 4;
		}

		if (
			input.electrical.requirement === "required" &&
			input.electrical.scopeMatch === "none"
		) {
			return 0;
		}

		return Math.min(30, score);
	}

	private hardBlockers(input: IngestGuyanaOpportunityInput) {
		const blockers: OpportunityHardBlocker[] = [];

		if (input.deadline && new Date(input.deadline).getTime() < Date.now()) {
			blockers.push("expired_deadline");
		}
		if (
			input.electrical.requirement === "required" &&
			input.electrical.scopeMatch === "none"
		) {
			blockers.push("mandatory_requirement_gap");
		}
		if (
			input.electrical.requirement === "required" &&
			input.electrical.licenseStatus !== "verified"
		) {
			blockers.push("mandatory_requirement_gap");
		}

		return [...new Set(blockers)];
	}
}
