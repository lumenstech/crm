import { BadGatewayException } from "@nestjs/common";

export type PublicSourceCandidate = {
	sourceId: string;
	title: string;
	buyer: string | null;
	description: string | null;
	sourceUrl: string | null;
	postedDate: string | null;
	dueDate: string | null;
	categories: string[];
	contactAvailable: boolean;
	estimatedValue: number | null;
	currency: string | null;
	raw: Record<string, unknown>;
};

const NASSAU_FORMAL_SOLICITATIONS =
	"https://apex5.nassaucountyny.gov/ords/f?p=533:226";
const NJSTART_OPEN_BIDS =
	"https://www.njstart.gov/bso/view/search/external/advancedSearchBid.xhtml?openBids=true";

export async function fetchNassauFormalSolicitations(
	limit: number,
): Promise<PublicSourceCandidate[]> {
	const html = await fetchHtml(NASSAU_FORMAL_SOLICITATIONS);
	const tables = parseTables(html);
	const table = tables.find((candidate) =>
		hasHeaders(candidate.headers, [
			"department",
			"solicitation/contract #",
			"title",
			"status",
			"issue date",
			"end date",
		]),
	);
	if (!table) {
		throw new BadGatewayException(
			"Nassau County solicitation board did not contain the expected public table.",
		);
	}
	return table.rows
		.map((row) => {
			const sourceId = field(row, table.headers, "solicitation/contract #");
			const title = field(row, table.headers, "title");
			if (!sourceId || !title) return null;
			const department = field(row, table.headers, "department");
			const status = field(row, table.headers, "status");
			return {
				sourceId,
				title,
				buyer: department ? `Nassau County / ${department}` : "Nassau County",
				description: null,
				sourceUrl: NASSAU_FORMAL_SOLICITATIONS,
				postedDate: parsePublicDate(field(row, table.headers, "issue date")),
				dueDate: parsePublicDate(field(row, table.headers, "end date")),
				categories: ["Nassau County", status].filter(
					(value): value is string => Boolean(value),
				),
				contactAvailable: false,
				estimatedValue: null,
				currency: "USD",
				raw: {
					department,
					status,
					board: NASSAU_FORMAL_SOLICITATIONS,
				},
			} satisfies PublicSourceCandidate;
		})
		.filter((value): value is PublicSourceCandidate => value !== null)
		.slice(0, limit);
}

export async function fetchNjstartOpenBids(
	limit: number,
): Promise<PublicSourceCandidate[]> {
	const html = await fetchHtml(NJSTART_OPEN_BIDS);
	const tables = parseTables(html);
	const table = tables.find((candidate) =>
		hasHeaders(candidate.headers, [
			"bid solicitation #",
			"organization name",
			"description",
			"bid opening date",
			"status",
		]),
	);
	if (!table) {
		throw new BadGatewayException(
			"NJSTART open-bid page did not expose the expected public results table. The adapter is failing closed rather than reporting a false empty result.",
		);
	}
	return table.rows
		.map((row) => {
			const sourceId = field(row, table.headers, "bid solicitation #");
			const title = field(row, table.headers, "description");
			if (!sourceId || !title) return null;
			const organization = field(row, table.headers, "organization name");
			const buyer = field(row, table.headers, "buyer");
			const status = field(row, table.headers, "status");
			const alternateId = field(row, table.headers, "alternate id");
			return {
				sourceId,
				title,
				buyer: [organization, buyer].filter(Boolean).join(" / ") || "State of New Jersey",
				description: null,
				sourceUrl: NJSTART_OPEN_BIDS,
				postedDate: null,
				dueDate: parsePublicDate(field(row, table.headers, "bid opening date")),
				categories: ["NJSTART", status, alternateId].filter(
					(value): value is string => Boolean(value),
				),
				contactAvailable: Boolean(buyer),
				estimatedValue: null,
				currency: "USD",
				raw: {
					organization,
					buyer,
					status,
					alternateId,
					board: NJSTART_OPEN_BIDS,
				},
			} satisfies PublicSourceCandidate;
		})
		.filter((value): value is PublicSourceCandidate => value !== null)
		.slice(0, limit);
}

async function fetchHtml(url: string) {
	const response = await fetch(url, {
		headers: {
			accept: "text/html,application/xhtml+xml",
			"user-agent": "Lumens-Opportunity-Ops/1.0",
		},
		signal: AbortSignal.timeout(20_000),
	});
	if (!response.ok) {
		throw new BadGatewayException(
			`Opportunity provider returned HTTP ${response.status}.`,
		);
	}
	return response.text();
}

type ParsedTable = { headers: string[]; rows: string[][] };

function parseTables(html: string): ParsedTable[] {
	const tables: ParsedTable[] = [];
	for (const tableMatch of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
		const body = tableMatch[1] ?? "";
		const rowHtml = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
			(match) => match[1] ?? "",
		);
		if (rowHtml.length === 0) continue;
		const parsedRows = rowHtml.map((row) =>
			[...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(
				(cell) => cleanCell(cell[1] ?? ""),
			),
		);
		const headerIndex = parsedRows.findIndex((row) => row.length >= 3);
		if (headerIndex === -1) continue;
		const headers = parsedRows[headerIndex].map(normalizeHeader);
		const rows = parsedRows
			.slice(headerIndex + 1)
			.filter((row) => row.length >= Math.min(3, headers.length));
		tables.push({ headers, rows });
	}
	return tables;
}

function hasHeaders(headers: string[], required: string[]) {
	return required.every((requiredHeader) => headers.includes(requiredHeader));
}

function field(row: string[], headers: string[], header: string) {
	const index = headers.indexOf(header);
	if (index === -1) return null;
	const value = row[index]?.trim();
	return value ? value : null;
}

function normalizeHeader(value: string) {
	return value
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/\u00a0/g, " ")
		.trim();
}

function cleanCell(value: string) {
	return decodeEntities(
		value
			.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
			.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

function decodeEntities(value: string) {
	return value
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">");
}

function parsePublicDate(value: string | null) {
	if (!value) return null;
	const normalized = value
		.replace(/\b(?:EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b/g, "")
		.trim();
	const date = new Date(normalized);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
