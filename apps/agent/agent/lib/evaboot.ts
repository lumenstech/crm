import { z } from "zod";
import { EVABOOT } from "./evaboot-config.ts";
import {
	type EvabootExtractionPage,
	type EvabootExtractionResponse,
	type EvabootPageRequest,
	type EvabootQuota,
	evabootExtractionResponse,
	evabootPageRequest,
	evabootQuotaResponse,
} from "./evaboot-contracts.ts";

export type EvabootFailure = {
	ok: false;
	code:
		| "invalid_input"
		| "authentication"
		| "credits"
		| "rate_limit"
		| "not_found"
		| "provider_error"
		| "network_error"
		| "invalid_response";
	retryable: boolean;
	retryAfterSeconds: number | null;
};

type Result<T> = { ok: true; value: T } | EvabootFailure;

export type EvabootExtractionResult = Result<
	| { state: "pending"; progress: number }
	| { state: "paused" | "failed" }
	| { state: "complete"; page: EvabootExtractionPage }
>;

export type EvabootFetch = (
	url: URL,
	options: RequestInit,
) => Promise<Response>;

export type EvabootClient = {
	quota(): Promise<Result<EvabootQuota>>;
	extraction(request: EvabootPageRequest): Promise<EvabootExtractionResult>;
};

function failure(
	code: EvabootFailure["code"],
	retryable = false,
	retryAfterSeconds: number | null = null,
): EvabootFailure {
	return { ok: false, code, retryable, retryAfterSeconds };
}

function retryAfter(value: string | null): number | null {
	if (!value) return null;
	const seconds = /^\d+$/.test(value)
		? Number(value)
		: Math.ceil((Date.parse(value) - Date.now()) / 1_000);
	if (!Number.isFinite(seconds)) return null;
	return Math.min(EVABOOT.maxRetryAfterSeconds, Math.max(0, seconds));
}

function httpFailure(response: Response): EvabootFailure {
	const status = response.status;
	if (status === 401 || status === 403) return failure("authentication");
	if (status === 402) return failure("credits");
	if (status === 404) return failure("not_found");
	if (status === 429) {
		return failure(
			"rate_limit",
			true,
			retryAfter(response.headers.get("retry-after")),
		);
	}
	return failure("provider_error", status >= 500 || status === 408);
}

async function readJson<T>(
	response: Response,
	schema: z.ZodType<T>,
): Promise<Result<T>> {
	if (!response.headers.get("content-type")?.includes("application/json")) {
		await response.body?.cancel();
		return failure("invalid_response");
	}
	const reader = response.body?.getReader();
	if (!reader) return failure("invalid_response");
	const decoder = new TextDecoder();
	let size = 0;
	let body = "";
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > EVABOOT.maxResponseBytes) {
				await reader.cancel();
				return failure("invalid_response");
			}
			body += decoder.decode(chunk.value, { stream: true });
		}
		body += decoder.decode();
		const value: unknown = JSON.parse(body);
		const parsed = schema.safeParse(value);
		if (!parsed.success) return failure("invalid_response");
		return { ok: true, value: parsed.data };
	} catch {
		return failure("invalid_response");
	} finally {
		reader.releaseLock();
	}
}

function parseExtraction(
	body: EvabootExtractionResponse,
	status: number,
	request: EvabootPageRequest,
): EvabootExtractionResult {
	if (body.search_id !== request.extractionId) {
		return failure("invalid_response");
	}
	if (status === 202) {
		if (!["ACCEPTED", "SCHEDULED", "EXECUTING"].includes(body.status)) {
			return failure("invalid_response");
		}
		return {
			ok: true,
			value: { state: "pending", progress: body.progress },
		};
	}
	if (body.status === "PAUSED" || body.status === "FAILED") {
		return {
			ok: true,
			value: { state: body.status === "PAUSED" ? "paused" : "failed" },
		};
	}
	if (body.status !== "EXECUTED") return failure("invalid_response");
	const page = body;
	const next = page.start + page.returned_count;
	if (
		page.start !== request.start ||
		page.limit !== request.limit ||
		page.returned_count !== page.prospects.length ||
		page.returned_count > request.limit ||
		next > page.total_count ||
		page.has_more !== next < page.total_count ||
		(page.has_more && page.returned_count === 0)
	) {
		return failure("invalid_response");
	}
	return { ok: true, value: { state: "complete", page } };
}

export function createEvabootClient(
	apiKey: string | undefined,
	request: EvabootFetch = fetch,
): EvabootClient | null {
	const key = apiKey?.trim();
	if (!key) return null;

	async function get<T>(
		path: string,
		schema: z.ZodType<T>,
	): Promise<Result<{ status: number; body: T }>> {
		try {
			const response = await request(new URL(path, EVABOOT.baseUrl), {
				method: "GET",
				headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
				redirect: "error",
				signal: AbortSignal.timeout(EVABOOT.timeoutMs),
			});
			if (response.status !== 200 && response.status !== 202) {
				const result = httpFailure(response);
				await response.body?.cancel();
				return result;
			}
			const parsed = await readJson(response, schema);
			if (!parsed.ok) return parsed;
			return {
				ok: true,
				value: { status: response.status, body: parsed.value },
			};
		} catch {
			return failure("network_error", true);
		}
	}

	return {
		async quota() {
			const result = await get("quota/", evabootQuotaResponse);
			if (!result.ok) return result;
			if (result.value.status !== 200) {
				return failure("invalid_response");
			}
			return { ok: true, value: result.value.body.quota };
		},
		async extraction(input) {
			const parsed = evabootPageRequest.safeParse(input);
			if (!parsed.success) return failure("invalid_input");
			const params = new URLSearchParams({
				start: String(parsed.data.start),
				limit: String(parsed.data.limit),
			});
			const result = await get(
				`extractions/${parsed.data.extractionId}/?${params}`,
				evabootExtractionResponse,
			);
			if (!result.ok) return result;
			return parseExtraction(
				result.value.body,
				result.value.status,
				parsed.data,
			);
		},
	};
}

export const evabootEmail = z.email().max(320);
