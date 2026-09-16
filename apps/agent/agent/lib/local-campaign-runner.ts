import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type CachedPage, fetchCachedPage } from "./local-campaign-cache";
import { extractLocalCampaignLead } from "./local-campaign-extraction";
import {
	type LocalCampaign,
	localCampaignSchema,
	localCampaignSeedSchema,
} from "./local-campaign-schema";
import { scoreLocalCampaignLead } from "./local-campaign-scoring";
import {
	type LocalStagedLead,
	normalizeDomain,
	stageCampaignLead,
} from "./local-campaign-staging";
import type { OllamaClient } from "./local-ollama";

export function assertLocalCampaignOnly(args: string[]): void {
	const forbidden = args.filter((arg) =>
		["--sync", "--sync-crm", "--production", "--neon"].includes(
			arg.split("=", 1)[0] ?? "",
		),
	);
	if (forbidden.length > 0) {
		throw new Error(
			`CRM synchronization is not implemented. Refused: ${forbidden.join(", ")}`,
		);
	}
}

export type LocalCampaignRunDependencies = {
	fetchImpl?: typeof fetch;
	client?: OllamaClient;
	pageLoader?: (
		url: string,
		fetchImpl?: typeof fetch,
	) => Promise<{
		page: CachedPage;
		cached: boolean;
	}>;
	stager?: typeof stageCampaignLead;
	stagingPath?: string;
};

export type LocalCampaignRunResult = {
	stagingPath: string;
	processed: number;
	cached: number;
	staged: number;
	duplicates: number;
	leads: LocalStagedLead[];
};

export async function loadCampaignFile(path: string): Promise<LocalCampaign> {
	return localCampaignSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function loadCampaignSeeds(path: string): Promise<string[]> {
	const raw = await readFile(path, "utf8");
	const urls: string[] = [];
	if (path.toLocaleLowerCase().endsWith(".csv")) {
		const lines = raw.split(/\r?\n/).filter((line) => line.trim());
		if (lines.some((line) => line.includes('"'))) {
			throw new Error(
				"Quoted CSV fields are not supported. Use JSONL for complex seed data.",
			);
		}
		const header =
			lines
				.shift()
				?.split(",")
				.map((value) => value.trim()) ?? [];
		const urlIndex = header.findIndex((value) =>
			["url", "source_url"].includes(value),
		);
		if (urlIndex < 0)
			throw new Error("Seed CSV needs a url or source_url column.");
		for (const line of lines) {
			const value = line.split(",")[urlIndex]?.trim();
			if (value) urls.push(localCampaignSeedSchema.parse({ url: value }).url);
		}
		return urls;
	}
	for (const line of raw.split(/\r?\n/).filter((value) => value.trim())) {
		const parsed: unknown = JSON.parse(line);
		urls.push(localCampaignSeedSchema.parse(parsed).url);
	}
	return urls;
}

export async function runLocalCampaign(
	campaign: LocalCampaign,
	seedUrls: string[] = campaign.seed_urls,
	dependencies: LocalCampaignRunDependencies = {},
): Promise<LocalCampaignRunResult> {
	const uniqueSeeds = [...new Set(seedUrls)];
	const domains = new Map<string, number>();
	const leads: LocalStagedLead[] = [];
	let cached = 0;
	let staged = 0;
	let duplicates = 0;
	for (const url of uniqueSeeds) {
		if (
			leads.filter((lead) => lead.status !== "duplicate").length >=
			campaign.max_companies
		)
			break;
		const domain = normalizeDomain(new URL(url).hostname);
		const pageCount = domains.get(domain) ?? 0;
		if (pageCount >= campaign.max_pages_per_domain) continue;
		domains.set(domain, pageCount + 1);
		const loaded = await (dependencies.pageLoader ?? fetchCachedPage)(
			url,
			dependencies.fetchImpl,
		);
		if (loaded.cached) cached += 1;
		const extracted = await extractLocalCampaignLead(
			loaded.page.text,
			url,
			dependencies.client,
		);
		const scores = scoreLocalCampaignLead(extracted, campaign);
		const missingRequired = campaign.required_fields.filter(
			(field) => extracted[field as keyof typeof extracted] === null,
		);
		const record: LocalStagedLead = {
			...extracted,
			...scores,
			campaign_id: campaign.campaign_id,
			lead_id: createHash("sha256")
				.update(`${campaign.campaign_id}:${extracted.content_hash}`, "utf8")
				.digest("hex"),
			source_domain: domain,
			status: missingRequired.length > 0 ? "needs_review" : "new",
		};
		const result = await (dependencies.stager ?? stageCampaignLead)(
			record,
			dependencies.stagingPath,
		);
		leads.push(result.staged);
		if (result.duplicate) duplicates += 1;
		else staged += 1;
	}
	return {
		stagingPath:
			dependencies.stagingPath ?? "var/local-leads/campaign-leads.jsonl",
		processed: leads.length,
		cached,
		staged,
		duplicates,
		leads,
	};
}
