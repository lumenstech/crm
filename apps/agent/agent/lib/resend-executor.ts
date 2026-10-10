import "@crm/env/load";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { JsonObject, JsonValue } from "@crm/db/json";
import {
	executorEnvelope,
	PARTWALL_COMPARISON_TASK,
} from "@crm/validation/executor";
import { z } from "zod";

const RESEND_URL = "https://api.resend.com";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3101";
const CRM_URL = process.env.COMP_CRM_BASE_URL ?? API_URL;
const MAX_PAGE_SIZE = 100;
const MAX_JOBS_PER_POLL = 1;
const CONTROL_SUBJECT_PREFIX = "[COMP CRM JOB]";
const RESULT_SUBJECT_PREFIX = "[COMP CRM RESULT]";
const ACCEPTED_LAST_EVENTS = new Set([
	"sent",
	"delivered",
	"opened",
	"clicked",
	"bounced",
	"complained",
	"delivery_delayed",
]);

const resendList = z.object({
	data: z.array(
		z.object({
			id: z.string(),
			message_id: z.string().nullable().optional(),
			from: z.string(),
			to: z.array(z.string()),
			subject: z.string().nullable().optional(),
			last_event: z.string().nullable().optional(),
			scheduled_at: z.string().nullable().optional(),
		}),
	),
	has_more: z.boolean(),
});

const resendEmail = z.object({
	id: z.string(),
	message_id: z.string().nullable().optional(),
	from: z.string(),
	to: z.array(z.string()),
	subject: z.string().nullable().optional(),
	text: z.string().nullable().optional(),
	html: z.string().nullable().optional(),
	attachments: z.array(z.unknown()).optional(),
});

const resendSend = z.object({ id: z.string() });
const searchHit = z
	.object({
		kind: z.string().optional(),
		id: z.string().optional(),
	})
	.catchall(z.json());

type SearchHit = JsonObject & { kind?: string; id?: string };

type ListedEmail = z.infer<typeof resendList>["data"][number];
type Job = {
	id: string;
	status: string;
	operation: string;
	taskRef: string;
	payloadHash: string;
	sourceEmailId: string;
	result: JsonObject | null;
	receipt: JsonObject | null;
	errorCode: string | null;
	errorMessage: string | null;
	resultEmailId: string | null;
};

type CoreConfig = {
	cronSecret: string;
	queuePath: string;
	crmApiKey: string;
};

type ResendConfig = CoreConfig & {
	apiKey: string;
	account: string;
	controlTo: Set<string>;
	allowedFrom: Set<string>;
};

type ResultNotificationConfig = CoreConfig & {
	apiKey: string;
	resultFrom: string;
	resultTo: string;
};

export async function pollAndRun(): Promise<{
	status: "disabled" | "ok";
	listed: number;
	accepted: number;
	completed: number;
	failed: number;
}> {
	if (!resendPollingEnabled()) {
		return {
			status: "disabled",
			listed: 0,
			accepted: 0,
			completed: 0,
			failed: 0,
		};
	}
	const config = resendConfig();
	const checkpointResponse = await internalFetch(
		`/internal/executor/checkpoints/resend/${encodeURIComponent(config.account)}`,
		config,
	);
	const checkpoint = checkpointResponse.ok
		? ((await checkpointResponse.json()) as { cursor?: string | null } | null)
		: null;

	let after: string | null = null;
	let listed = 0;
	let accepted = 0;
	let lastSeen: string | null = null;
	let boundaryFound = false;

	while (true) {
		const page = await listSent(config.apiKey, after);
		if (page.data.length === 0) break;

		for (const email of page.data) {
			listed += 1;
			lastSeen = email.id;
			if (checkpoint?.cursor && email.id === checkpoint.cursor) {
				boundaryFound = true;
				break;
			}
			if (await processListedEmail(email, config)) accepted += 1;
		}

		if (boundaryFound || !page.has_more) break;
		after = page.data.at(-1)?.id ?? null;
		if (!after) break;
	}

	if (lastSeen) {
		await internalFetch("/internal/executor/checkpoints", config, {
			method: "PUT",
			body: JSON.stringify({
				provider: "resend",
				account: config.account,
				cursor: boundaryFound ? (checkpoint?.cursor ?? lastSeen) : lastSeen,
			}),
		});
	}

	const durable = await runDurableJobsWithConfig(config);
	return { status: "ok", listed, accepted, ...durable };
}

export async function runDurableJobs(): Promise<{
	completed: number;
	failed: number;
}> {
	const config = coreConfig();
	return runDurableJobsWithConfig(config);
}

async function runDurableJobsWithConfig(config: CoreConfig): Promise<{
	completed: number;
	failed: number;
}> {
	let completed = 0;
	let failed = 0;
	for (let index = 0; index < MAX_JOBS_PER_POLL; index += 1) {
		const claimResponse = await internalFetch(
			"/internal/executor/jobs/claim",
			config,
			{ method: "POST" },
		);
		if (claimResponse.status === 204) break;
		if (!claimResponse.ok)
			throw new Error(`Executor claim failed: HTTP ${claimResponse.status}`);
		const job = (await claimResponse.json()) as Job | null;
		if (!job) break;
		try {
			await executeJob(job, config);
			completed += 1;
		} catch (error) {
			failed += 1;
			await recordFailure(
				job.id,
				config,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	return { completed, failed };
}

function coreConfig(): CoreConfig {
	const cronSecret = process.env.CRON_SECRET;
	const queuePath = process.env.CRM_EXECUTOR_PARTWALL_QUEUE_PATH?.trim();
	const crmApiKey = process.env.COMP_CRM_API_KEY;
	if (!cronSecret || !queuePath || !crmApiKey)
		throw new Error("Core executor is not configured.");
	return {
		cronSecret,
		queuePath,
		crmApiKey,
	};
}

function resendConfig(): ResendConfig {
	const core = coreConfig();
	const apiKey = process.env.RESEND_API_KEY;
	const account = process.env.RESEND_EXECUTOR_ACCOUNT?.trim();
	const controlTo = exactEmails(process.env.RESEND_EXECUTOR_CONTROL_TO);
	const allowedFrom = exactEmails(process.env.RESEND_EXECUTOR_ALLOWED_FROM);
	if (!apiKey || !account || controlTo.size === 0 || allowedFrom.size === 0)
		throw new Error("Resend polling is not configured.");
	return { ...core, apiKey, account, controlTo, allowedFrom };
}

function resultNotificationConfig(
	core: CoreConfig,
): ResultNotificationConfig | null {
	if (process.env.RESEND_EXECUTOR_RESULT_NOTIFICATION_ENABLED !== "true")
		return null;
	const apiKey = process.env.RESEND_API_KEY;
	const resultFrom = process.env.RESEND_EXECUTOR_RESULT_FROM?.trim();
	const resultTo = process.env.RESEND_EXECUTOR_RESULT_TO?.trim();
	if (!apiKey || !resultFrom || !resultTo) return null;
	return { ...core, apiKey, resultFrom, resultTo };
}

function resendPollingEnabled(): boolean {
	return process.env.RESEND_EXECUTOR_POLLING_ENABLED === "true";
}

async function processListedEmail(
	email: ListedEmail,
	config: ResendConfig,
): Promise<boolean> {
	if (!isAcceptedSentEmail(email)) return false;
	if (email.subject?.startsWith(RESULT_SUBJECT_PREFIX)) return false;
	if (!email.subject?.startsWith(CONTROL_SUBJECT_PREFIX)) return false;
	if (
		!email.to.some((recipient) => config.controlTo.has(emailAddress(recipient)))
	) {
		return false;
	}
	if (!config.allowedFrom.has(emailAddress(email.from))) return false;

	const body = await retrieveSentEmail(config.apiKey, email.id);
	if (!body.text?.trim() || (body.attachments?.length ?? 0) > 0) {
		console.error(
			`[executor] rejected email ${email.id}: text-only body required`,
		);
		return false;
	}

	const envelope = parseExecutorEnvelope(body.text);
	if (!envelope) {
		console.error(
			`[executor] rejected email ${email.id}: invalid control envelope`,
		);
		return false;
	}

	const response = await internalFetch("/internal/executor/jobs", config, {
		method: "POST",
		body: JSON.stringify({
			envelope,
			source: {
				account: config.account,
				emailId: email.id,
				messageId: body.message_id ?? email.message_id ?? null,
				from: email.from,
				subject: email.subject,
				to: email.to,
			},
		}),
	});
	if (!response.ok && response.status !== 410) {
		throw new Error(`Executor acceptance failed: HTTP ${response.status}`);
	}
	return response.ok;
}

function isAcceptedSentEmail(email: ListedEmail): boolean {
	return (
		!email.scheduled_at &&
		Boolean(email.last_event && ACCEPTED_LAST_EVENTS.has(email.last_event))
	);
}

export function parseExecutorEnvelope(text: string) {
	const marker = "COMP-CRM-EXECUTOR-V1";
	const trimmed = text.trim();
	if (!trimmed.startsWith(marker)) return null;
	try {
		const parsed = executorEnvelope.parse(
			JSON.parse(trimmed.slice(marker.length).trim()),
		);
		const payload = {
			version: parsed.version,
			jobId: parsed.jobId,
			operation: parsed.operation,
			taskRef: parsed.taskRef,
			expiresAt: parsed.expiresAt,
		};
		const payloadHash = executorPayloadHash(payload);
		return payloadHash === parsed.payloadHash ? parsed : null;
	} catch {
		return null;
	}
}

export function executorPayloadHash(payload: {
	version: string;
	jobId: string;
	operation: string;
	taskRef: string;
	expiresAt: string;
}): string {
	return `sha256:${createHash("sha256")
		.update(canonicalJson(payload))
		.digest("hex")}`;
}

async function executeJob(job: Job, config: CoreConfig) {
	if (job.taskRef !== PARTWALL_COMPARISON_TASK) {
		throw new Error("The task is not allowlisted.");
	}
	const startedAt = new Date().toISOString();
	const comparison = await comparePartWall(config);
	const finishedAt = new Date().toISOString();
	const receipt = {
		receiptId: crypto.randomUUID(),
		jobId: job.id,
		sourceEmailId: job.sourceEmailId,
		payloadHash: job.payloadHash,
		operation: job.operation,
		taskRef: job.taskRef,
		queueHash: comparison.queueHash,
		startedAt,
		completedAt: finishedAt,
		executedOperations: comparison.executedOperations,
		counts: comparison.counts,
	};
	const resultResponse = await internalFetch(
		`/internal/executor/jobs/${job.id}/result`,
		config,
		{
			method: "POST",
			body: JSON.stringify({
				result: comparison.result,
				queueHash: comparison.queueHash,
				receipt,
			}),
		},
	);
	if (!resultResponse.ok)
		throw new Error(
			`Executor result persistence failed: HTTP ${resultResponse.status}`,
		);

	const notification = resultNotificationConfig(config);
	if (!notification) return;
	try {
		const resultEmailId = await sendResultEmail(
			job.id,
			comparison.result,
			notification,
		);
		await internalFetch(
			`/internal/executor/jobs/${job.id}/result-email`,
			notification,
			{
				method: "POST",
				body: JSON.stringify({ resultEmailId }),
			},
		);
	} catch (error) {
		await internalFetch(
			`/internal/executor/jobs/${job.id}/result-delivery-failure`,
			notification,
			{
				method: "POST",
				body: JSON.stringify({
					code: "RESULT_DELIVERY_FAILED",
					message: error instanceof Error ? error.message : String(error),
				}),
			},
		);
	}
}

export async function comparePartWall(config: CoreConfig) {
	const queueBytes = await readFile(config.queuePath);
	const queueHash = `sha256:${createHash("sha256").update(queueBytes).digest("hex")}`;
	const rows = parseCsv(queueBytes.toString("utf8"));
	const headers = rows.shift() ?? [];
	const indexes = Object.fromEntries(
		headers.map((header, index) => [header, index]),
	);
	const candidates = rows
		.filter((row) => row.some(Boolean))
		.map((row) => ({
			name: cell(row, indexes, "company_name"),
			domain: domainOf(cell(row, indexes, "website")),
			email: cell(row, indexes, "contact_email") || null,
		}));
	if (candidates.length === 0)
		throw new Error("The approved PartWall queue is empty.");

	const unit = await crmJson<{ key: string; id: string }[]>(
		config,
		"/rest/business-units",
	);
	const partwall = unit.find((item) => item.key === "partwall");
	if (!partwall)
		throw new Error("The PartWall business unit is not available.");

	const dispositions = [];
	let searchRequests = 0;
	let associationRequests = 0;
	for (const candidate of candidates) {
		const identifiers = [candidate.name, candidate.domain];
		if (candidate.email) identifiers.push(candidate.email);
		const hits = new Map<string, SearchHit>();
		for (const identifier of identifiers) {
			const response = await crmJson<{ hits: JsonValue[] }>(
				config,
				`/rest/search?q=${encodeURIComponent(identifier)}`,
			);
			searchRequests += 1;
			for (const hit of parseSearchHits(response.hits ?? [])) {
				const kind = hit.kind ?? "unknown";
				const id = hit.id ?? JSON.stringify(hit);
				hits.set(`${kind}:${id}`, hit);
			}
		}
		const allHits = [...hits.values()];
		const companies = allHits.filter((hit) => hit.kind === "company");
		const associations = [];
		for (const hit of allHits) {
			if (hit.kind !== "company" && hit.kind !== "contact") continue;
			const recordId = hit.id ?? null;
			if (!recordId) continue;
			const association = await crmJson<JsonValue[]>(
				config,
				`/rest/business-units/associations?recordType=${encodeURIComponent(String(hit.kind))}&recordId=${encodeURIComponent(recordId)}`,
			);
			associationRequests += 1;
			associations.push({ kind: hit.kind, id: recordId, association });
		}
		const disposition =
			companies.length === 0 && allHits.length === 0
				? "no canonical match"
				: companies.length === 1 &&
						allHits.every((hit) => hit.kind === "company")
					? "existing canonical record"
					: "ambiguous match";
		dispositions.push({
			candidate: candidate.name,
			identifiers: {
				companyName: candidate.name,
				domain: candidate.domain,
				contactEmail: candidate.email,
			},
			disposition,
			hits: allHits,
			associations,
			partwallBusinessUnit: partwall,
		});
	}

	const tracked = [];
	for (const trackedRecord of [
		{ name: "UMC", status: "tracked" },
		{ name: "Verkada", status: "tracked" },
		{ name: "Arthur G. Russell", status: "hold" },
	]) {
		const response = await crmJson<{ hits: JsonValue[] }>(
			config,
			`/rest/search?q=${encodeURIComponent(trackedRecord.name)}`,
		);
		searchRequests += 1;
		tracked.push({
			name: trackedRecord.name,
			status: trackedRecord.status,
			hits: parseSearchHits(response.hits ?? []),
			preserved: true,
		});
	}

	return {
		queueHash,
		result: {
			queue: {
				taskRef: PARTWALL_COMPARISON_TASK,
				candidateCount: candidates.length,
			},
			partwallBusinessUnit: partwall,
			dispositions,
			tracked,
			outreachSent: false,
		},
		executedOperations: [
			"GET /rest/business-units",
			"GET /rest/search",
			"GET /rest/business-units/associations",
		],
		counts: {
			candidates: candidates.length,
			searchRequests,
			associationRequests,
			noCanonicalMatch: dispositions.filter(
				(item) => item.disposition === "no canonical match",
			).length,
			existingCanonical: dispositions.filter(
				(item) => item.disposition === "existing canonical record",
			).length,
			ambiguous: dispositions.filter(
				(item) => item.disposition === "ambiguous match",
			).length,
		},
	};
}

async function sendResultEmail(
	jobId: string,
	result: JsonObject,
	config: ResultNotificationConfig,
) {
	const response = await resendFetch("/emails", config.apiKey, {
		method: "POST",
		body: JSON.stringify({
			from: config.resultFrom,
			to: [config.resultTo],
			subject: `${RESULT_SUBJECT_PREFIX} ${jobId}`,
			text: JSON.stringify(result, null, 2),
		}),
		headers: { "Idempotency-Key": `comp-crm-result/${jobId}` },
	});
	if (!response.ok)
		throw new Error(`Resend result send failed: HTTP ${response.status}`);
	return resendSend.parse(await response.json()).id;
}

async function recordFailure(
	jobId: string,
	config: CoreConfig,
	error: Error | string,
) {
	await internalFetch(`/internal/executor/jobs/${jobId}/failure`, config, {
		method: "POST",
		body: JSON.stringify({
			code: "EXECUTOR_RUN_FAILED",
			message: error instanceof Error ? error.message : error,
		}),
	});
}

async function listSent(apiKey: string, after: string | null) {
	const query = new URLSearchParams({ limit: String(MAX_PAGE_SIZE) });
	if (after) query.set("after", after);
	const response = await resendFetch(`/emails?${query}`, apiKey);
	if (!response.ok)
		throw new Error(`Resend email listing failed: HTTP ${response.status}`);
	return resendList.parse(await response.json());
}

async function retrieveSentEmail(apiKey: string, id: string) {
	const response = await resendFetch(
		`/emails/${encodeURIComponent(id)}`,
		apiKey,
	);
	if (!response.ok)
		throw new Error(`Resend email retrieval failed: HTTP ${response.status}`);
	return resendEmail.parse(await response.json());
}

async function resendFetch(
	path: string,
	apiKey: string,
	init: RequestInit = {},
) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const response = await fetch(`${RESEND_URL}${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
				...(init.headers ?? {}),
			},
		});
		if (response.status !== 429 && response.status < 500) return response;
		if (attempt < 2)
			await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
	}
	throw new Error("Resend request failed after retries.");
}

async function internalFetch(
	path: string,
	config: CoreConfig,
	init: RequestInit = {},
) {
	return fetch(`${API_URL}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${config.cronSecret}`,
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
}

async function crmJson<T>(config: CoreConfig, path: string): Promise<T> {
	const response = await fetch(`${CRM_URL}${path}`, {
		headers: { "x-api-key": config.crmApiKey },
	});
	if (!response.ok)
		throw new Error(`CRM request failed: HTTP ${response.status}`);
	return (await response.json()) as T;
}

function exactEmails(value: string | undefined) {
	return new Set(
		(value ?? "")
			.split(",")
			.map((item) => emailAddress(item))
			.filter(Boolean),
	);
}

function emailAddress(value: string): string {
	const bracket = value.match(/<([^>]+)>/);
	return (bracket?.[1] ?? value).trim().toLowerCase();
}

function domainOf(value: string): string {
	try {
		return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
	} catch {
		return (
			value
				.replace(/^https?:\/\//i, "")
				.replace(/^www\./i, "")
				.split("/")[0] ?? ""
		).toLowerCase();
	}
}

function cell(
	row: string[],
	indexes: Record<string, number>,
	name: string,
): string {
	const index = indexes[name];
	return index === undefined ? "" : (row[index] ?? "");
}

function canonicalJson(value: JsonValue): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value instanceof Object) {
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry ?? null)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function parseSearchHits(values: JsonValue[]): SearchHit[] {
	return values.flatMap((value) => {
		const parsed = searchHit.safeParse(value);
		return parsed.success ? [parsed.data as SearchHit] : [];
	});
}

function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (quoted) {
			if (character === '"' && text[index + 1] === '"') {
				cell += '"';
				index += 1;
			} else if (character === '"') {
				quoted = false;
			} else {
				cell += character;
			}
		} else if (character === '"') quoted = true;
		else if (character === ",") {
			row.push(cell);
			cell = "";
		} else if (character === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else if (character !== "\r") cell += character;
	}
	if (cell.length || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}