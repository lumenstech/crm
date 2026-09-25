import { redactSecrets } from "./redact";
import type {
	AssociateRecordWithBusinessUnitInput,
	CreateBusinessUnitOpportunityInput,
	IngestLeadsInput,
	ListRecordBusinessUnitsInput,
} from "./schemas";

type RequestOptions = {
	method?: "GET" | "POST";
	query?: Record<string, string | undefined>;
	body?: unknown;
};

export class CrmClient {
	private readonly baseUrl: string;

	constructor(
		baseUrl: string,
		private readonly apiKey: string,
	) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
		if (!apiKey.startsWith("crm_")) {
			throw new Error(
				"COMP_CRM_API_KEY must be a Comp CRM API key with the crm_ prefix.",
			);
		}
	}

	businessUnits() {
		return this.request("/rest/business-units");
	}

	search(q: string) {
		return this.request("/rest/search", { query: { q } });
	}

	recordBusinessUnits(input: ListRecordBusinessUnitsInput) {
		return this.request("/rest/business-units/associations", {
			query: {
				recordType: input.recordType,
				recordId: input.recordId,
			},
		});
	}

	associateRecord(input: AssociateRecordWithBusinessUnitInput) {
		return this.request("/rest/business-units/associations", {
			method: "POST",
			body: input,
		});
	}

	async ingestLeads(input: IngestLeadsInput) {
		const batch = await this.request("/rest/ingest/signals/batch", {
			method: "POST",
			body: { project: input.businessUnit, signals: input.signals },
		});
		const items =
			batch &&
			typeof batch === "object" &&
			Array.isArray((batch as { items?: unknown }).items)
				? (
						batch as {
							items: Array<{
								sourceId: string;
								status: string;
								sourceRecordId: string | null;
							}>;
						}
					).items
				: [];

		const resolutions: Array<Record<string, unknown>> = [];
		for (const item of items) {
			if (item.status !== "accepted" || !item.sourceRecordId) continue;
			const signal = input.signals.find(
				(candidate) => candidate.sourceId === item.sourceId,
			);
			if (!signal) continue;
			try {
				const resolved = await this.request(
					`/rest/ingest/signals/${encodeURIComponent(item.sourceRecordId)}/resolve-company`,
					{
						method: "POST",
						body: {
							sourceRecordId: item.sourceRecordId,
							companyName: signal.entity ?? null,
							domain:
								typeof signal.payload.domain === "string"
									? signal.payload.domain
									: typeof signal.payload.website === "string"
										? signal.payload.website
										: null,
							createIfMissing: true,
							queueResearch: false,
						},
					},
				);
				resolutions.push({
					sourceId: item.sourceId,
					sourceRecordId: item.sourceRecordId,
					status: "resolved",
					...(resolved && typeof resolved === "object"
						? (resolved as Record<string, unknown>)
						: { result: resolved }),
				});
			} catch (error) {
				resolutions.push({
					sourceId: item.sourceId,
					sourceRecordId: item.sourceRecordId,
					status: "resolution_failed",
					error:
						error instanceof Error
							? error.message
							: "Company resolution failed.",
				});
			}
		}

		return {
			...(batch && typeof batch === "object"
				? (batch as Record<string, unknown>)
				: { batch }),
			resolutions,
		};
	}

	createBusinessUnitOpportunity(input: CreateBusinessUnitOpportunityInput) {
		return this.request("/rest/business-units/opportunities", {
			method: "POST",
			body: input,
		});
	}

	private async request(path: string, options: RequestOptions = {}) {
		const url = new URL(`${this.baseUrl}${path}`);
		for (const [key, value] of Object.entries(options.query ?? {})) {
			if (value !== undefined) url.searchParams.set(key, value);
		}

		const response = await fetch(url, {
			method: options.method ?? "GET",
			headers: {
				accept: "application/json",
				"x-api-key": this.apiKey,
				...(options.body === undefined
					? {}
					: { "content-type": "application/json" }),
			},
			body:
				options.body === undefined ? undefined : JSON.stringify(options.body),
			signal: AbortSignal.timeout(30_000),
		});

		const text = await response.text();
		let parsed: unknown = null;
		if (text) {
			try {
				parsed = JSON.parse(text) as unknown;
			} catch {
				parsed = text;
			}
		}

		if (!response.ok) {
			const detail =
				typeof parsed === "string" ? parsed : JSON.stringify(parsed ?? {});
			throw new Error(
				redactSecrets(
					`Comp CRM API ${response.status} ${response.statusText} at ${path}: ${detail.slice(0, 2000)}`,
					[this.apiKey],
				),
			);
		}

		return parsed;
	}
}
