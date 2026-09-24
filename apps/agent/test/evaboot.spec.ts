import { describe, expect, it } from "bun:test";
import {
	createEvabootClient,
	type EvabootFetch,
} from "../agent/lib/evaboot.ts";
import { EVABOOT } from "../agent/lib/evaboot-config.ts";
import { evabootQuotaResponse } from "../agent/lib/evaboot-contracts.ts";
import {
	planEvabootProfiles,
	previewEvabootExtraction,
} from "../agent/lib/evaboot-preview.ts";

const prospect = {
	"Full Name": "Synthetic Buyer",
	"Current Job": "IT Director",
	"Company Name": "Example Company",
	Email: "buyer@example.com",
	"Email Status": "safe",
};

function page(start: number, total: number, rows = [prospect], limit = 100) {
	return {
		search_id: "ext-test",
		status: "EXECUTED",
		progress: 100,
		prospects: rows,
		start,
		limit,
		returned_count: rows.length,
		total_count: total,
		has_more: start + rows.length < total,
	};
}

function response<T>(body: T, status = 200) {
	return Response.json(body, { status });
}

function clientFor(request: EvabootFetch) {
	const client = createEvabootClient("synthetic-secret", request);
	if (!client) throw new Error("Test client is missing.");
	return client;
}

const read = { extractionId: "ext-test", start: 0, limit: 100 };

describe("Evaboot read boundary", () => {
	it("makes no request without a key", () => {
		let called = false;
		const request: EvabootFetch = async () => {
			called = true;
			return response({});
		};
		expect(createEvabootClient("  ", request)).toBeNull();
		expect(called).toBe(false);
	});

	it("uses only GET on the fixed host and refuses redirects", async () => {
		const client = clientFor(async (url, options) => {
			expect(url.origin).toBe("https://api.evaboot.com");
			expect(url.pathname).toBe("/v1/extractions/ext-test/");
			expect(url.searchParams.get("limit")).toBe("100");
			expect(options.method).toBe("GET");
			expect(options.redirect).toBe("error");
			expect(new Headers(options.headers).get("authorization")).toBe(
				"Bearer synthetic-secret",
			);
			expect(options.signal).toBeInstanceOf(AbortSignal);
			return response(page(0, 1));
		});
		expect(await client.extraction(read)).toMatchObject({
			ok: true,
			value: { state: "complete" },
		});
	});

	it("rejects path traversal before sending credentials", async () => {
		let calls = 0;
		const client = clientFor(async () => {
			calls++;
			return response({});
		});
		expect(
			await client.extraction({ ...read, extractionId: "../quota" }),
		).toMatchObject({ ok: false, code: "invalid_input" });
		expect(calls).toBe(0);
	});

	it("returns pending without treating 202 as completed data", async () => {
		const client = clientFor(async () =>
			response(
				{ search_id: "ext-test", status: "EXECUTING", progress: 45 },
				202,
			),
		);
		expect(await client.extraction(read)).toEqual({
			ok: true,
			value: { state: "pending", progress: 45 },
		});
	});

	it.each(["PAUSED", "FAILED"])(
		"blocks %s even with HTTP 200",
		async (status) => {
			const client = clientFor(async () =>
				response({ search_id: "ext-test", status, progress: 30 }),
			);
			const result = await previewEvabootExtraction(client, {
				extractionId: "ext-test",
				start: 0,
				maxRecords: 100,
			});
			expect(result).toEqual({
				ok: false,
				code: `extraction_${status.toLowerCase()}`,
			});
		},
	);

	it("redacts provider errors and returns rate-limit timing without retries", async () => {
		let calls = 0;
		const client = clientFor(async () => {
			calls++;
			return new Response("synthetic-secret buyer@example.com", {
				status: 429,
				headers: { "retry-after": "120" },
			});
		});
		const result = await client.extraction(read);
		expect(result).toEqual({
			ok: false,
			code: "rate_limit",
			retryable: true,
			retryAfterSeconds: 120,
		});
		expect(JSON.stringify(result)).not.toContain("synthetic-secret");
		expect(calls).toBe(1);
	});

	it("treats authentication failures as non-retryable", async () => {
		const client = clientFor(
			async () => new Response("private detail", { status: 401 }),
		);
		expect(await client.quota()).toMatchObject({
			ok: false,
			code: "authentication",
			retryable: false,
		});
	});

	it("discards transport exception messages", async () => {
		const client = clientFor(async () => {
			throw new Error("synthetic-secret");
		});
		const result = await client.quota();
		expect(result).toMatchObject({ ok: false, code: "network_error" });
		expect(JSON.stringify(result)).not.toContain("synthetic-secret");
	});

	it("rejects oversized responses", async () => {
		const client = clientFor(
			async () =>
				new Response(" ".repeat(EVABOOT.maxResponseBytes + 1), {
					headers: { "content-type": "application/json" },
				}),
		);
		expect(await client.quota()).toMatchObject({
			ok: false,
			code: "invalid_response",
		});
	});

	it("rejects HTML login pages", async () => {
		const client = clientFor(
			async () =>
				new Response("<html>login</html>", {
					headers: { "content-type": "text/html" },
				}),
		);
		expect(await client.quota()).toMatchObject({
			ok: false,
			code: "invalid_response",
		});
	});

	it.each([
		{ ...page(0, 1), search_id: "ext-other" },
		{ ...page(0, 1), start: 3 },
		{ ...page(0, 1), limit: 50 },
		{ ...page(0, 1), returned_count: 2 },
		{ ...page(0, 1), has_more: true },
		{ ...page(0, 1), status: "UNKNOWN" },
		{ ...page(0, 1), prospects: [{ "Full Name": 123 }] },
		page(0, 2, []),
	])("rejects inconsistent extraction responses", async (body) => {
		const client = clientFor(async () => response(body));
		expect(await client.extraction(read)).toMatchObject({
			ok: false,
			code: "invalid_response",
		});
	});
});

describe("Evaboot preview", () => {
	it("advances by returned_count and marks every candidate for review", async () => {
		const starts: number[] = [];
		const client = clientFor(async (url) => {
			const start = Number(url.searchParams.get("start"));
			starts.push(start);
			return response(
				page(start, 2, [prospect], Number(url.searchParams.get("limit"))),
			);
		});
		const result = await previewEvabootExtraction(client, {
			extractionId: "ext-test",
			start: 0,
			maxRecords: 100,
		});
		expect(starts).toEqual([0, 1]);
		expect(result).toMatchObject({
			ok: true,
			value: {
				crmWrites: 0,
				returnedCount: 2,
				hasMore: false,
				nextStart: null,
			},
		});
		if (!result.ok) throw new Error("Preview failed.");
		expect(result.value.candidates.map((row) => row.sourceRecordId)).toEqual([
			"ext-test:0",
			"ext-test:1",
		]);
		for (const row of result.value.candidates) {
			expect(row.promotion).toBe("review_required");
			expect(row.email.assessment).toBe("provider_safe_employer_unchecked");
			expect(row.reviewReasons).toContain("suppression_unchecked");
		}
	});

	it("reports the continuation cursor when the preview reaches its record cap", async () => {
		const client = clientFor(async () => response(page(0, 5, [prospect], 1)));
		const result = await previewEvabootExtraction(client, {
			extractionId: "ext-test",
			start: 0,
			maxRecords: 1,
		});
		expect(result).toMatchObject({
			ok: true,
			value: { returnedCount: 1, totalCount: 5, hasMore: true, nextStart: 1 },
		});
	});

	it("refuses a result set that changes between pages", async () => {
		const client = clientFor(async (url) => {
			const start = Number(url.searchParams.get("start"));
			return response(
				page(
					start,
					start === 0 ? 2 : 3,
					[prospect],
					Number(url.searchParams.get("limit")),
				),
			);
		});
		expect(
			await previewEvabootExtraction(client, {
				extractionId: "ext-test",
				start: 0,
				maxRecords: 100,
			}),
		).toEqual({ ok: false, code: "results_changed" });
	});

	it.each([
		["buyer@gmail.com", "safe", "personal_domain_rejected", null],
		["sales@example.com", "safe", "shared_mailbox_rejected", null],
		["bad address", "safe", "missing_or_invalid", null],
		["buyer@example.com", "risky", "not_verified", "buyer@example.com"],
		["buyer@example.com", "new_status", "not_verified", "buyer@example.com"],
	])(
		"screens email %s with status %s",
		async (email, status, assessment, address) => {
			const client = clientFor(async () =>
				response(
					page(
						0,
						1,
						[{ ...prospect, Email: email ?? "", "Email Status": status ?? "" }],
						1,
					),
				),
			);
			const result = await previewEvabootExtraction(client, {
				extractionId: "ext-test",
				start: 0,
				maxRecords: 1,
			});
			if (!result.ok) throw new Error("Preview failed.");
			expect(result.value.candidates[0]?.email).toMatchObject({
				assessment,
				address,
			});
		},
	);
});

describe("Evaboot profile budget planning", () => {
	const quota = evabootQuotaResponse.parse({
		success: true,
		quota: {
			daily_limit: 300,
			used_today: 100,
			remaining: 200,
			has_valid_salesnav: true,
			credits: 400,
			salesnavs: [
				{
					id: "seat-a",
					status: "valid",
					daily_limit: 150,
					used_today: 50,
					remaining: 100,
				},
				{
					id: "seat-b",
					status: "valid",
					daily_limit: 150,
					used_today: 50,
					remaining: 100,
				},
				{
					id: "seat-c",
					status: "invalid",
					daily_limit: 999,
					used_today: 0,
					remaining: 999,
				},
			],
		},
	}).quota;

	it("checks a single valid seat instead of aggregate quota", () => {
		expect(planEvabootProfiles(quota, 150, 400)).toMatchObject({
			ok: true,
			value: {
				fitsSnapshot: false,
				largestAccountRemaining: 100,
				reasons: ["single_account_quota_exceeded"],
			},
		});
	});

	it("reserves worst-case email costs in the estimate", () => {
		expect(planEvabootProfiles(quota, 100, 150)).toMatchObject({
			ok: true,
			value: {
				reservedCredits: 200,
				fitsSnapshot: false,
				reasons: ["credit_cap_exceeded"],
				creditsReserved: false,
				jobSubmitted: false,
			},
		});
	});

	it("checks the actual provider balance", () => {
		expect(
			planEvabootProfiles({ ...quota, credits: 50 }, 100, 200),
		).toMatchObject({
			ok: true,
			value: {
				fitsSnapshot: false,
				reasons: ["insufficient_provider_credits"],
			},
		});
	});

	it("does not approve fractional or oversized profile batches", () => {
		expect(planEvabootProfiles(quota, 1.5, 200)).toEqual({
			ok: false,
			code: "invalid_input",
		});
		expect(planEvabootProfiles(quota, 2501, 6000)).toEqual({
			ok: false,
			code: "invalid_input",
		});
	});
});
