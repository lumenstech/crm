import { createHash } from "node:crypto";
import type { Db } from "@crm/db";
import {
	BadGatewayException,
	BadRequestException,
	Injectable,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { IngestService } from "./ingest.service";
import type {
	OpportunitySourceProvider,
	ScanOpportunitySourceInput,
	ScanOpportunitySourceOutput,
} from "./opportunity-source.contracts";
import {
	fetchNassauFormalSolicitations,
	fetchNjstartOpenBids,
	type PublicSourceCandidate,
} from "./opportunity-source.public-providers";
import { OpportunityOpsService } from "./opportunity-ops.service";

const NYC_SOLICITATIONS_ENDPOINT =
	"https://data.cityofnewyork.us/resource/3khw-qi8f.json";
const SAM_OPPORTUNITIES_ENDPOINT = "https://api.sam.gov/opportunities/v2/search";

type SourceCandidate = PublicSourceCandidate;
type ReviewState = ScanOpportunitySourceOutput["rows"][number]["reviewState"];

type ExistingEvaluation = {
	score: number;
	recommendation: "pursue" | "qualify" | "watch" | "pass";
	hardBlocked: boolean;
	reviewState: ReviewState;
};

@Injectable()
export class OpportunitySourceService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly ingest: IngestService,
		private readonly opportunityOps: OpportunityOpsService,
	) {}

	async scan(
		input: ScanOpportunitySourceInput,
	): Promise<ScanOpportunitySourceOutput> {
		if (input.provider === "sam-opportunities" && !process.env.SAM_GOV_API_KEY) {
			return {
				provider: input.provider,
				status: "missing-api-key",
				fetched: 0,
				matched: 0,
				ingested: 0,
				deduplicated: 0,
				skipped: 0,
				message:
					"SAM_GOV_API_KEY is not configured; public no-key providers remain available.",
				rows: [],
			};
		}

		const candidates = await this.fetchProvider(input);
		const rows: ScanOpportunitySourceOutput["rows"] = [];
		let matched = 0;
		let deduplicated = 0;
		let skipped = 0;

		for (const candidate of candidates) {
			if (!this.withinDueWindow(candidate, input.dueWithinDays ?? null)) {
				skipped += 1;
				continue;
			}

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
					rationale: `Official-source opportunity matched ${capabilityMatches.length} capability keyword(s).`,
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
				reviewState: existing?.reviewState ?? "pending",
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

	private async fetchProvider(
		input: ScanOpportunitySourceInput,
	): Promise<SourceCandidate[]> {
		switch (input.provider) {
			case "nyc-current-solicitations":
				return this.fetchNyc(input);
			case "nassau-formal-solicitations":
				return fetchNassauFormalSolicitations(input.limit);
			case "njstart-open-bids":
				return fetchNjstartOpenBids(input.limit);
			case "sam-opportunities":
				return this.fetchSam(input);
			default:
				return this.assertNeverProvider(input.provider);
		}
	}

	private async fetchNyc(
		input: ScanOpportunitySourceInput,
	): Promise<SourceCandidate[]> {
		const url = new URL(NYC_SOLICITATIONS_ENDPOINT);
		url.searchParams.set("$limit", String(input.limit));
		url.searchParams.set("$order", "due_date ASC");
		const today = new Date();
		const where = [
			`due_date >= '${today.toISOString().slice(0, 10)}T00:00:00.000'`,
		];
		if (input.dueWithinDays) {
			const cutoff = new Date(today.getTime() + input.dueWithinDays * 86_400_000);
			where.push(
				`due_date <= '${cutoff.toISOString().slice(0, 10)}T23:59:59.999'`,
			);
		}
		url.searchParams.set("$where", where.join(" AND "));
		const data = (await this.fetchJson(url)) as Array<Record<string, unknown>>;
		return data.map((row) => this.normalizeNyc(row)).filter(this.present);
	}

	private normalizeNyc(row: Record<string, unknown>): SourceCandidate | null {
		const sourceId = this.text(row, ["request_id", "pin", "id"]);
		const title = this.text(row, [
			"short_title",
			"title",
			"procurement_description",
		]);
		if (!sourceId || !title) return null;
		const buyer = this.text(row, [
			"agency_name",
			"agency",
			"agency_full_name",
		]);
		const dueDate = this.isoDate(this.text(row, ["due_date", "end_date"]));
		const postedDate = this.isoDate(
			this.text(row, ["start_date", "publication_date"]),
		);
		const sourceUrl =
			this.text(row, ["document_links", "url", "link"]) ??
			`https://a856-cityrecord.nyc.gov/RequestDetail/${encodeURIComponent(sourceId)}`;
		const description = this.text(row, [
			"procurement_description",
			"additional_description_1",
			"other_info_1",
			"description",
		]);
		return {
			sourceId,
			title,
			buyer,
			description,
			sourceUrl,
			postedDate,
			dueDate,
			categories: [
				this.text(row, ["category_description"]),
				this.text(row, ["selection_method_description"]),
			].filter((value): value is string => Boolean(value)),
			contactAvailable: Boolean(
				this.text(row, ["contact_name", "contact_email", "contact_phone"]),
			),
			estimatedValue: this.number(row, [
				"contract_amount",
				"estimated_contract_amount",
			]),
			currency: "USD",
			raw: row,
		};
	}

	private async fetchSam(
		input: ScanOpportunitySourceInput,
	): Promise<SourceCandidate[]> {
		const url = new URL(SAM_OPPORTUNITIES_ENDPOINT);
		const now = new Date();
		const from = new Date(now.getTime() - input.lookbackDays * 86_400_000);
		url.searchParams.set("api_key", process.env.SAM_GOV_API_KEY ?? "");
		url.searchParams.set("postedFrom", this.samDate(from));
		url.searchParams.set("postedTo", this.samDate(now));
		url.searchParams.set("limit", String(input.limit));
		url.searchParams.set("offset", "0");
		if (input.state) url.searchParams.set("state", input.state);
		if (input.naics) url.searchParams.set("ncode", input.naics);
		for (const procurementType of input.procurementTypes) {
			url.searchParams.append("ptype", procurementType);
		}
		const data = (await this.fetchJson(url)) as Record<string, unknown>;
		const records = Array.isArray(data.opportunitiesData)
			? (data.opportunitiesData as Array<Record<string, unknown>>)
			: [];
		return records.map((row) => this.normalizeSam(row)).filter(this.present);
	}

	private normalizeSam(row: Record<string, unknown>): SourceCandidate | null {
		const sourceId = this.text(row, ["noticeId", "solicitationNumber"]);
		const title = this.text(row, ["title"]);
		if (!sourceId || !title) return null;
		const department = this.text(row, ["department"]);
		const subTier = this.text(row, ["subTier"]);
		const office = this.text(row, ["office"]);
		const buyer =
			[department, subTier, office].filter(Boolean).join(" / ") || null;
		const points = Array.isArray(row.pointOfContact) ? row.pointOfContact : [];
		const sourceUrl =
			this.text(row, ["uiLink"]) ??
			`https://sam.gov/opp/${encodeURIComponent(sourceId)}/view`;
		return {
			sourceId,
			title,
			buyer,
			description: this.text(row, ["description"]),
			sourceUrl,
			postedDate: this.isoDate(this.text(row, ["postedDate"])),
			dueDate: this.isoDate(
				this.text(row, ["responseDeadLine", "responseDeadline"]),
			),
			categories: [
				this.text(row, ["type"]),
				this.text(row, ["typeOfSetAsideDescription"]),
				this.text(row, ["naicsCode"]),
			].filter((value): value is string => Boolean(value)),
			contactAvailable: points.length > 0,
			estimatedValue: null,
			currency: "USD",
			raw: row,
		};
	}

	private components(
		candidate: SourceCandidate,
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

	private hardBlockers(candidate: SourceCandidate) {
		if (
			candidate.dueDate &&
			new Date(candidate.dueDate).getTime() < Date.now()
		) {
			return ["expired_deadline" as const];
		}
		return [];
	}

	private withinDueWindow(candidate: SourceCandidate, dueWithinDays: number | null) {
		if (!dueWithinDays || !candidate.dueDate) return true;
		const due = new Date(candidate.dueDate).getTime();
		if (Number.isNaN(due)) return true;
		return due <= Date.now() + dueWithinDays * 86_400_000;
	}

	private matches(candidate: SourceCandidate, keywords: string[]) {
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

	private fingerprint(candidate: SourceCandidate) {
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
		const [evaluation] = await this.db.$queryRaw<
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
			evaluation?.scoreBreakdown instanceof Object
				? (evaluation.scoreBreakdown.evidence as
						| Record<string, unknown>
						| undefined)
				: undefined;
		if (
			!evaluation ||
			evidence?.source_fingerprint !== fingerprint ||
			evaluation.score === null ||
			!evaluation.recommendation
		) {
			return null;
		}
		const [latest] = await this.db.$queryRaw<Array<{ state: ReviewState }>>`
			SELECT state
			FROM opportunity_review_event
			WHERE "sourceRecordId" = ${sourceRecordId}
			ORDER BY "createdAt" DESC, id DESC
			LIMIT 1
		`;
		const blockers = Array.isArray(evaluation.scoreBreakdown?.hardBlockers)
			? evaluation.scoreBreakdown.hardBlockers
			: [];
		return {
			score: evaluation.score,
			recommendation: evaluation.recommendation,
			hardBlocked: blockers.length > 0,
			reviewState: latest?.state ?? "pending",
		};
	}

	private score(
		components: ReturnType<OpportunitySourceService["components"]>,
	) {
		return Math.round(
			components.capabilityFit +
				components.activeNeed +
				components.commercialValue +
				components.timingUrgency +
				components.buyerAccess +
				components.strategicValue,
		);
	}

	private async fetchJson(url: URL) {
		const response = await fetch(url, {
			headers: {
				accept: "application/json",
				"user-agent": "Lumens-Opportunity-Ops/1.0",
			},
			signal: AbortSignal.timeout(20_000),
		});
		if (!response.ok) {
			throw new BadGatewayException(
				`Opportunity provider returned HTTP ${response.status}.`,
			);
		}
		return response.json();
	}

	private text(row: Record<string, unknown>, keys: string[]) {
		for (const key of keys) {
			const value = row[key];
			if (typeof value === "string" && value.trim()) return value.trim();
		}
		return null;
	}

	private number(row: Record<string, unknown>, keys: string[]) {
		const value = this.text(row, keys);
		if (!value) return null;
		const parsed = Number(value.replace(/[$,]/g, ""));
		return Number.isFinite(parsed) ? parsed : null;
	}

	private isoDate(value: string | null) {
		if (!value) return null;
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}

	private samDate(date: Date) {
		return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(
			date.getDate(),
		).padStart(2, "0")}/${date.getFullYear()}`;
	}

	private present<T>(value: T | null): value is T {
		return value !== null;
	}

	private assertNeverProvider(provider: never): never {
		throw new BadRequestException(`Unsupported opportunity provider: ${provider}.`);
	}
}
