import { Injectable } from "@nestjs/common";
import type {
	IngestGuyanaOpportunityInput,
	IngestGuyanaOpportunityOutput,
} from "./guyana-opportunity.contracts";
import { IngestService } from "./ingest.service";
import { OpportunityOpsService } from "./opportunity-ops.service";

@Injectable()
export class GuyanaOpportunityService {
	constructor(
		private readonly ingest: IngestService,
		private readonly opportunityOps: OpportunityOpsService,
	) {}

	async ingestOpportunity(
		input: IngestGuyanaOpportunityInput,
	): Promise<IngestGuyanaOpportunityOutput> {
		const capabilityFit = this.capabilityFit(input);
		const hardBlockers = this.hardBlockers(input);
		const signalScore = Math.round(
			capabilityFit +
				input.components.activeNeed +
				input.components.commercialValue +
				input.components.timingUrgency +
				input.components.buyerAccess +
				input.components.strategicValue,
		);

		const accepted = await this.ingest.signal({
			project: input.project,
			source: `guyana-${input.source}`,
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
				source_trust: "approved-source-registry",
			},
		});

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
			evidence: {
				...input.evidence,
				source: input.sourceUrl,
				buyer: input.buyer,
				electrical_requirement: input.electrical.requirement,
				electrical_scope_match: input.electrical.scopeMatch,
				electrical_license_status: input.electrical.licenseStatus,
				...(input.electrical.licenseEvidenceRef
					? { electrical_license_evidence: input.electrical.licenseEvidenceRef }
					: {}),
			},
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
			electricalLicenseApplied:
				input.electrical.licenseStatus === "verified" &&
				input.electrical.scopeMatch !== "none",
			capabilityFit,
		};
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

		if (input.electrical.requirement === "required" && input.electrical.scopeMatch === "none") {
			return 0;
		}

		return Math.min(30, score);
	}

	private hardBlockers(input: IngestGuyanaOpportunityInput) {
		const blockers: Array<
			| "expired_deadline"
			| "eligibility_mismatch"
			| "geography_ineligible"
			| "mandatory_requirement_gap"
			| "deadline_not_feasible"
			| "registration_not_feasible"
			| "unacceptable_mandatory_terms"
			| "low_source_trust"
		> = [];

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
