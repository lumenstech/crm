import { redactSecrets } from "./redact";
import type { IngestLeadsInput } from "./schemas";

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

	ingestLeads(input: IngestLeadsInput) {
		return this.request("/rest/ingest/signals/batch", {
			method: "POST",
			body: { project: input.businessUnit, signals: input.signals },
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
