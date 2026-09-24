export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export type SignalInput = {
	project: string;
	source: string;
	sourceType: string;
	sourceId: string;
	sourceUrl?: string | null;
	observedAt?: string | null;
	entity?: string | null;
	signalScore?: number | null;
	tags?: string[];
	payload?: Record<string, JsonValue>;
};

type RequestOptions = {
	method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
	query?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
};

export class CrmClient {
	private readonly baseUrl: string;

	constructor(
		baseUrl: string,
		private readonly apiKey: string,
	) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
	}

	async businessUnits() {
		return this.request("/ingest/business-units");
	}

	async ingestSignal(input: SignalInput) {
		return this.request("/ingest/signal", { method: "POST", body: input });
	}

	async signals(input: {
		project?: string;
		source?: string;
		minScore?: number;
		status?: "all" | "unresolved" | "mapped";
		limit?: number;
	}) {
		return this.request("/ingest/signals", {
			query: {
				project: input.project,
				source: input.source,
				minScore: input.minScore,
				status: input.status ?? "unresolved",
				limit: input.limit ?? 50,
			},
		});
	}

	async companyCandidates(sourceRecordId: string) {
		return this.request(
			`/ingest/signals/${encodeURIComponent(sourceRecordId)}/company-candidates`,
		);
	}

	async resolveCompany(input: {
		sourceRecordId: string;
		companyId?: string | null;
		companyName?: string | null;
		domain?: string | null;
		createIfMissing?: boolean;
		queueResearch?: boolean;
	}) {
		return this.request(
			`/ingest/signals/${encodeURIComponent(input.sourceRecordId)}/resolve-company`,
			{ method: "POST", body: input },
		);
	}

	async qualifySignal(input: {
		sourceRecordId: string;
		components?: {
			icpMatch: number;
			commercialTrigger: number;
			projectRelevance: number;
			companyValue: number;
			location: number;
			decisionMaker: number;
			recency: number;
		};
		evidence?: Record<string, string>;
		notes?: string | null;
	}) {
		return this.request(
			`/ingest/signals/${encodeURIComponent(input.sourceRecordId)}/qualify`,
			{ method: "POST", body: input },
		);
	}

	async promoteSignal(input: {
		sourceRecordId: string;
		createDeal?: boolean;
		ownerId?: string | null;
		amountUsd?: number | null;
	}) {
		return this.request(
			`/ingest/signals/${encodeURIComponent(input.sourceRecordId)}/promote`,
			{ method: "POST", body: input },
		);
	}

	async searchCompanies(q: string) {
		return this.request("/companies/options", { query: { q } });
	}

	async company(id: string) {
		return this.request(`/companies/${encodeURIComponent(id)}`);
	}

	async searchContacts(q: string, pageSize = 25) {
		return this.request("/contacts/search", {
			method: "POST",
			body: {
				q,
				sort: "",
				dir: "asc",
				page: 1,
				pageSize,
				owner: [],
				company: [],
				source: [],
				title: [],
				seniority: [],
				persona: [],
				activity: [],
				fields: {},
				archived: false,
			},
		});
	}

	async contact(id: string) {
		return this.request(`/contacts/${encodeURIComponent(id)}`);
	}

	async createContact(input: {
		firstName: string;
		lastName?: string;
		email?: string;
		phone?: string;
		title?: string;
		companyId: string;
		ownerId?: string | null;
	}) {
		return this.request("/contacts", { method: "POST", body: input });
	}

	private async request(path: string, options: RequestOptions = {}) {
		const url = new URL(`${this.baseUrl}${path}`);
		for (const [key, value] of Object.entries(options.query ?? {})) {
			if (value !== undefined) url.searchParams.set(key, String(value));
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
				`Comp CRM API ${response.status} ${response.statusText}: ${detail.slice(0, 2000)}`,
			);
		}

		return parsed;
	}
}
