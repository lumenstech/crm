import { createHash } from "node:crypto";
import type { Db } from "@crm/db";
import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { IngestService } from "./ingest.service";
import { OpportunityOpsService } from "./opportunity-ops.service";
import type {
	ScanOpportunitySourceInput,
	ScanOpportunitySourceOutput,
} from "./opportunity-source.contracts";
import {
	fetchNassauFormalSolicitations,
	fetchNjstartOpenBids,
	type PublicSourceCandidate,
} from "./opportunity-source.public-providers";

type ExistingEvaluation = {
	score: number;
	recommendation: "pursue" | "qualify" | "watch" | "pass";
	hardBlocked: boolean;
};

@Injectable()
export class RegionalOpportunitySourceService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly ingest: IngestService,
		private readonly opportunityOps: OpportunityOpsService,
	) {}

	canHandle(provider: ScanOpportunitySourceInput["provider"]) {
		return (
			provider === "nassau-formal-solicitations" ||
			provider === "njstart-open-bids"
		);
	}

	async scan(
		input: ScanOpportunitySourceInput,
	): Promise<ScanOpportunitySourceOutput> {
		if (!this.canHandle(input.provider)) {
			throw new BadRequestException(
				`Regional scanner does not handle provider ${input.provider}.`,
			);
		}
		const candidates =
			input.provider === "nassau-formal-solicitations"
				? await fetchNassauFormalSolicitations(input.limit)
				: await fetchNjstartOpenBids(input.limit);
		const rows: ScanOpportunitySourceOutput["rows"] = [];
		let matched = 0;
		let deduplicated = 0;
		let skipped = 0;

		for (const candidate of candidates) {
			const capabilityMatches = this.matches(
				candidate,
				input.capabilityKeywords,
			);
			const strategicMatches = this.matches(
				candidate,
				input.strategicKeywords,
			);
			if (capabilityMatches.length === 0) {
				skipped += 1;
				continue;
			}
			matched += 1;

			const fingerprint = this.fingerprint(candidate);
			const components = this.components(
				candidate,
				capabilityMatches,
				strategicMatches,
			);
			const hardBlockers = this.hardBlockers(candidate);
			const accepted = await this.ingest.signal({
				project: input.project,
				source: input.provider,
				sourceType: "bid",
				sourceId: candidate.sourceId,
				sourceUrl: candidate.sourceUrl,
				observedAt: candidate.postedDate ?? undefined,
				entity: candidate.buyer,
				signalScore: this.score(components),
				tags: [
					"opportunity-ops",
					"procurement",
					"regional",
					input.provider,
					...capabilityMatches.slice(0, 15),
				],
				payload: {
					workflow: "opportunity-ops",
					pipeline: "opportunity-ops",
					provider: input.provider,
					buyer: candidate.buyer,
					company: candidate.buyer,
					subject: candidate.title,
					opportunity_name: candidate.title,
					description: candidate.description,
					posted_date: candidate.postedDate,
					deadline: candidate.dueDate,
					categories: candidate.categories,
					estimated_value: candidate.estimatedValue,
					currency: candidate.currency,
					matched_capability_keywords: capabilityMatches,
					matched_strategic_keywords: strategicMatches,
					source_fingerprint: fingerprint,
					source_trust: "official-public-source",
				},
			});
			if (accepted.deduplicated) deduplicated += 1;

			const existing = await this.sameFingerprintEvaluation(
				accepted.sourceRecordId,
				fingerprint,
			);
			const evaluation =
				existing ??
				(await this.opportunityOps.evaluate({
					sourceRecordId: accepted.sourceRecordId,
					components,
					evidence: {
						source: candidate.sourceUrl ?? input.provider,
						provider: input.provider,
						source_fingerprint: fingerprint,
						matched_capabilities: capabilityMatches.join(", "),
						matched_strategic: strategicMatches.join(", "),
					},
					rationale: `Official regional procurement source matched ${capabilityMatches.length} capability keyword(s).`,
					hardBlockers,
				}));

			rows.push({
				sourceRecordId: accepted.sourceRecordId,
				sourceId: candidate.sourceId,
				provider: input.provider,
				title: candidate.title,
				buyer: candidate.buyer,
				sourceUrl: candidate.sourceUrl,
				dueDate: candidate.dueDate,
				matchedCapabilityKeywords: capabilityMatches,
				matchedStrategicKeywords: strategicMatches,
				score: evaluation.score,
				recommendation: evaluation.recommendation,
				reviewState: "pending",
				hardBlocked: evaluation.hardBlocked,
				deduplicated: accepted.deduplicated,
			});
		}

		return {
			provider: input.provider,
			status: "ok",
			fetched: candidates.length,
			matched,
			ingested: rows.length,
			deduplicated,
			skipped,
			message: null,
			rows,
		};
	}

	private components(
		candidate: PublicSourceCandidate,
		capabilityMatches: string[],
		strategicMatches: string[],
	) {
		const days = candidate.dueDate
			? Math.ceil(
					(new Date(candidate.dueDate).getTime() - Date.now()) / 86_400_000,
				)
			: null;
		return {
			capabilityFit: Math.min(30, 14 + capabilityMatches.length * 5),
			activeNeed: 20,
			commercialValue:
				candidate.estimatedValue && candidate.estimatedValue >= 100_000 ? 15 : 8,
			timingUrgency:
				days === null
					? 7
					: days <= 7
						? 15
						: days <= 30
							? 12
							: days <= 90
								? 9
								: 6,
			buyerAccess: candidate.contactAvailable ? 10 : 5,
			strategicValue: Math.min(10, 4 + strategicMatches.length * 2),
		};
	}

	private hardBlockers(candidate: PublicSourceCandidate) {
		if (
			candidate.dueDate &&
			new Date(candidate.dueDate).getTime() < Date.now()
		) {
			return ["expired_deadline" as const];
		}
		return [];
	}

	private matches(candidate: PublicSourceCandidate, keywords: string[]) {
		if (keywords.length === 0) return [];
		const haystack = [
			candidate.title,
			candidate.buyer,
			candidate.description,
			...candidate.categories,
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
		return keywords.filter((keyword) =>
			haystack.includes(keyword.toLowerCase()),
		);
	}

	private fingerprint(candidate: PublicSourceCandidate) {
		return createHash("sha256")
			.update(
				JSON.stringify({
					sourceId: candidate.sourceId,
					title: candidate.title,
					buyer: candidate.buyer,
					description: candidate.description,
					dueDate: candidate.dueDate,
					categories: candidate.categories,
					estimatedValue: candidate.estimatedValue,
				}),
			)
			.digest("hex");
	}

	private async sameFingerprintEvaluation(
		sourceRecordId: string,
		fingerprint: string,
	): Promise<ExistingEvaluation | null> {
		const [row] = await this.db.$queryRaw<
			Array<{
				score: number | null;
				recommendation: ExistingEvaluation["recommendation"] | null;
				scoreBreakdown: Record<string, unknown> | null;
			}>
		>`
			SELECT score, recommendation, "scoreBreakdown" AS "scoreBreakdown"
			FROM opportunity_review_event
			WHERE "sourceRecordId" = ${sourceRecordId} AND "eventType" = 'evaluation'
			ORDER BY "createdAt" DESC, id DESC
			LIMIT 1
		`;
		const evidence =
			row?.scoreBreakdown instanceof Object
				? (row.scoreBreakdown.evidence as Record<string, unknown> | undefined)
				: undefined;
		if (
			!row ||
			evidence?.source_fingerprint !== fingerprint ||
			row.score === null ||
			!row.recommendation
		) {
			return null;
		}
		const blockers = Array.isArray(row.scoreBreakdown?.hardBlockers)
			? row.scoreBreakdown.hardBlockers
			: [];
		return {
			score: row.score,
			recommendation: row.recommendation,
			hardBlocked: blockers.length > 0,
		};
	}

	private score(components: ReturnType<RegionalOpportunitySourceService["components"]>) {
		return Math.round(
			components.capabilityFit +
				components.activeNeed +
				components.commercialValue +
				components.timingUrgency +
				components.buyerAccess +
				components.strategicValue,
		);
	}
}
