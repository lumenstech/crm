import type { JsonValue } from "@crm/db";
import { z } from "zod";
import {
	guyanaOpportunitySource,
	ingestGuyanaOpportunityInput,
	ingestGuyanaOpportunityOutput,
} from "../src/ingest/guyana-opportunity.contracts";
import {
	type GuyanaOpportunitySourceKey,
	guyanaOpportunitySources,
	isApprovedGuyanaOpportunitySourceUrl,
} from "../src/ingest/guyana-opportunity.sources";

const scoutCandidate = ingestGuyanaOpportunityInput.omit({ project: true });
const scoutOutput = z.object({
	candidates: z.array(scoutCandidate).max(100),
});
const sourceUrlOverrides = z.partialRecord(
	guyanaOpportunitySource,
	z.array(z.string().url()).min(1),
);
const jsonString = z.string();
const jsonArray = z.array(z.json());
const jsonObject = z.record(z.string(), z.json());

const sourceKeys = Object.keys(
	guyanaOpportunitySources,
) as GuyanaOpportunitySourceKey[];
const MAX_SOURCE_TEXT = 180_000;

function requiredEnv(name: string) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

function decodeHtml(value: string) {
	return value
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">");
}

function htmlToText(html: string) {
	return decodeHtml(
		html
			.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
			.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
			.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

function configuredSourceUrls() {
	const overrides = process.env.GUYANA_COLLECTOR_SOURCE_URLS_JSON?.trim();
	if (!overrides) {
		return Object.fromEntries(
			sourceKeys.map((key) => [key, [guyanaOpportunitySources[key].url]]),
		) as Record<GuyanaOpportunitySourceKey, string[]>;
	}

	const parsed = sourceUrlOverrides.parse(JSON.parse(overrides));
	const output = {} as Record<GuyanaOpportunitySourceKey, string[]>;
	for (const key of sourceKeys) {
		const urls = parsed[key]?.length
			? parsed[key]
			: [guyanaOpportunitySources[key].url];
		for (const url of urls) {
			if (!isApprovedGuyanaOpportunitySourceUrl(key, url)) {
				throw new Error(`Unapproved collector URL for ${key}: ${url}`);
			}
		}
		output[key] = urls;
	}
	return output;
}

async function fetchSource(url: string) {
	const response = await fetch(url, {
		headers: {
			accept:
				"text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
			"user-agent": "CompCRM-GuyanaOpportunityCollector/1.0",
		},
		redirect: "follow",
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok)
		throw new Error(`Source fetch failed ${response.status}: ${url}`);
	const contentType = response.headers.get("content-type") ?? "";
	const body = await response.text();
	const text = contentType.includes("json") ? body : htmlToText(body);
	return text.slice(0, MAX_SOURCE_TEXT);
}

function findJsonText(value: JsonValue): string | null {
	const stringResult = jsonString.safeParse(value);
	if (stringResult.success) {
		const trimmed = stringResult.data.trim();
		if (
			(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
			(trimmed.startsWith("[") && trimmed.endsWith("]"))
		) {
			return trimmed;
		}
		const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
		if (fenced) return fenced;
		return null;
	}
	const arrayResult = jsonArray.safeParse(value);
	if (arrayResult.success) {
		for (const item of arrayResult.data) {
			const found = findJsonText(item);
			if (found) return found;
		}
		return null;
	}
	const objectResult = jsonObject.safeParse(value);
	if (objectResult.success) {
		for (const child of Object.values(objectResult.data)) {
			const found = findJsonText(child);
			if (found) return found;
		}
	}
	return null;
}

async function runScout(input: string) {
	const controlPlane = requiredEnv("GUYANA_COLLECTOR_LANGFLOW_URL").replace(
		/\/$/,
		"",
	);
	const token = requiredEnv("GUYANA_COLLECTOR_LANGFLOW_TOKEN");
	const response = await fetch(`${controlPlane}/api/langflow/run`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			flow: "guyana.opportunity-scout",
			input_value: input,
		}),
		signal: AbortSignal.timeout(120_000),
	});
	const body = await response.text();
	if (!response.ok) {
		throw new Error(
			`Langflow scout failed ${response.status}: ${body.slice(0, 1000)}`,
		);
	}
	const parsed = z.json().parse(JSON.parse(body));
	const jsonText = findJsonText(parsed);
	if (!jsonText)
		throw new Error("Langflow scout did not return a JSON candidate envelope.");
	return scoutOutput.parse(JSON.parse(jsonText)).candidates;
}

async function submitCandidate(candidate: z.infer<typeof scoutCandidate>) {
	const crmUrl = requiredEnv("GUYANA_COLLECTOR_CRM_URL").replace(/\/$/, "");
	const token = requiredEnv("GUYANA_COLLECTOR_CRM_TOKEN");
	const project = requiredEnv("GUYANA_COLLECTOR_PROJECT");
	const payload = ingestGuyanaOpportunityInput.parse({
		project,
		...candidate,
	});
	const response = await fetch(`${crmUrl}/ingest/guyana/opportunities`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(30_000),
	});
	const body = await response.text();
	if (!response.ok) {
		throw new Error(
			`CRM ingest failed ${response.status}: ${body.slice(0, 1000)}`,
		);
	}
	return ingestGuyanaOpportunityOutput.parse(JSON.parse(body));
}

async function collectSource(source: GuyanaOpportunitySourceKey, url: string) {
	const pageText = await fetchSource(url);
	const prompt = [
		"Review the following approved Guyana opportunity source snapshot.",
		`SOURCE_KEY: ${source}`,
		`SOURCE_URL: ${url}`,
		'Return ONLY valid JSON with this top-level shape: {"candidates":[...]}',
		"Each candidate must match the Guyana opportunity ingest contract exactly and must use the supplied SOURCE_KEY.",
		"Use a stable official notice/tender/project ID for sourceId when available. Do not invent missing facts.",
		'If no current Guyana opportunity is supported by the source snapshot, return {"candidates":[]}.',
		"SNAPSHOT:",
		pageText,
	].join("\n\n");
	const candidates = await runScout(prompt);
	const results: Array<z.infer<typeof ingestGuyanaOpportunityOutput>> = [];
	for (const candidate of candidates) {
		if (candidate.source !== source) {
			throw new Error(
				`Scout returned source ${candidate.source} for requested source ${source}.`,
			);
		}
		if (!isApprovedGuyanaOpportunitySourceUrl(source, candidate.sourceUrl)) {
			throw new Error(
				`Scout returned an unapproved source URL: ${candidate.sourceUrl}`,
			);
		}
		results.push(await submitCandidate(candidate));
	}
	return { source, url, candidates: candidates.length, results };
}

async function main() {
	const sourceUrls = configuredSourceUrls();
	const summary: Array<{
		source: string;
		url: string;
		candidates?: number;
		error?: string;
	}> = [];
	for (const source of sourceKeys) {
		for (const url of sourceUrls[source]) {
			try {
				const result = await collectSource(source, url);
				summary.push({ source, url, candidates: result.candidates });
			} catch (error) {
				summary.push({
					source,
					url,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}
	console.log(
		JSON.stringify({ ranAt: new Date().toISOString(), summary }, null, 2),
	);
	if (summary.every((item) => item.error)) process.exitCode = 1;
}

await main();
