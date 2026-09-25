import { z } from "zod";
import { redactSecrets } from "./redact";
import {
	signalPayloadValue,
	type AssociateRecordWithBusinessUnitInput,
	type CreateBusinessUnitOpportunityInput,
	type IngestLeadsInput,
	type ListRecordBusinessUnitsInput,
	type SignalPayloadValue,
} from "./schemas";

type RequestOptions<TBody = never> = {
	method?: "GET" | "POST";
	query?: Record<string, string | undefined>;
	body?: TBody;
};

const ingestBatchResponse = z
	.object({
		items: z.array(
			z.object({
				sourceId: z.string(),
				status: z.string(),
				sourceRecordId: z.string().nullable(),
			}),
		),
	})
	.catchall(signalPayloadValue);

const optionalText = z.string().trim().min(1);

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
		const batch = ingestBatchResponse.parse(
			await this.request("/rest/ingest/signals/batch", {
				method: "POST",
				body: { project: input.businessUnit, signals: input.signals },
			}),
		);

		const resolutions: SignalPayloadValue[] = [];
		for (const item of batch.items) {
			if (item.status !== "accepted" || !item.sourceRecordId) continue;
			const signal = input.signals.find(
				(candidate) => candidate.sourceId === item.sourceId,
			);
			if (!signal) continue;

			const payloadDomain = optionalText.safeParse(signal.payload.domain);
			const payloadWebsite = optionalText.safeParse(signal.payload.website);
			const domain = payloadDomain.success
				? payloadDomain.data
				: payloadWebsite.success
					? payloadWebsite.data
					: null;

			try {
				const resolved = await this.request(
					`/rest/ingest/signals/${encodeURIComponent(item.sourceRecordId)}/resolve-company`,
					{
						method: "POST",
						body: {
							sourceRecordId: item.sourceRecordId,
							companyName: signal.entity ?? null,
							domain,
							createIfMissing: true,
							queueResearch: false,
						},
					},
				);
				resolutions.push({
					sourceId: item.sourceId,
					sourceRecordId: item.sourceRecordId,
					status: "resolved",
					result: resolved,
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
			...batch,
			resolutions,
		};
	}

	createBusinessUnitOpportunity(input: CreateBusinessUnitOpportunityInput) {
		return this.request("/rest/business-units/opportunities", {
			method: "POST",
			body: input,
		});
	}

	private async request<TBody = never>(
		path: string,
		options?: RequestOptions<TBody>,
	): Promise<SignalPayloadValue> {
		const url = new URL(`${this.baseUrl}${path}`);
		for (const [key, value] of Object.entries(options?.query ?? {})) {
			if (value !== undefined) url.searchParams.set(key, value);
		}

		const headers = new Headers({
			accept: "application/json",
			"x-api-key": this.apiKey,
		});
		if (options?.body !== undefined) {
			headers.set("content-type", "application/json");
		}

		const response = await fetch(url, {
			method: options?.method ?? "GET",
			headers,
			body:
				options?.body === undefined
					? undefined
					: JSON.stringify(options.body),
			signal: AbortSignal.timeout(30_000),
		});

		const text = await response.text();
		let parsed: SignalPayloadValue = null;
		if (text) {
			try {
				parsed = signalPayloadValue.parse(JSON.parse(text));
			} catch {
				parsed = text;
			}
		}

		if (!response.ok) {
			throw new Error(
				redactSecrets(
					`Comp CRM API ${response.status} ${response.statusText} at ${path}: ${text.slice(0, 2000)}`,
					[this.apiKey],
				),
			);
		}

		return parsed;
	}
}
