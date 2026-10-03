import { db } from "../src/index";

type ArchiveRow = {
	scan_id: string;
	mailbox: string;
	messages_scanned: number;
	next_scan_index: number;
	payload: unknown;
	payload_hash: string;
};

type Finding = {
	company?: string | null;
	contact?: string | null;
	email?: string | null;
	category?: string | null;
	subject?: string | null;
	notes?: string | null;
	priority?: string | null;
};

type ContactRow = {
	id: string;
	firstName: string;
	lastName: string | null;
	email: string | null;
	companyId: string | null;
};

type CompanyRow = {
	id: string;
	name: string;
	domain: string | null;
	email: string | null;
};

type BusinessUnitRow = {
	id: string;
	key: string;
	name: string;
};

type PromotionPolicy = {
	companyName: string | null;
	contactName: string | null;
	unitTarget: UnitTarget;
	dealCandidate: boolean;
	dealReason?: string;
};

type UnitTarget = "data-gear" | "trustaccept" | "lumens-technology" | "lumens-guyana" | "unassigned";

const DEFAULT_SCAN_ID = "outlook:danny@lumenstechnology.com:0-4799";

const UNIT_ALIASES: Record<Exclude<UnitTarget, "unassigned">, string[]> = {
	"data-gear": ["data-gear", "data gear", "datagear"],
	trustaccept: ["trustaccept", "sequence now", "sequence-now", "sequencenow"],
	"lumens-technology": [
		"lumens technology",
		"lumens technologies",
		"lumens-technology",
		"lumens ny",
		"lumens new york",
	],
	"lumens-guyana": [
		"lumens guyana",
		"lumensgy",
		"lumens-guyana",
		"lumens-guyana-contracting",
	],
};

const POLICY: Record<number, PromotionPolicy> = {
	0: { companyName: "Identiti", contactName: "Tristan Limbrunner", unitTarget: "lumens-technology", dealCandidate: true, dealReason: "Pep Boys / Identiti quote follow-up" },
	1: { companyName: "Divisions Maintenance Group", contactName: "Alyssa Finke", unitTarget: "lumens-technology", dealCandidate: false },
	2: { companyName: null, contactName: null, unitTarget: "lumens-technology", dealCandidate: false },
	3: { companyName: "Sung Co", contactName: "Vera Sung", unitTarget: "lumens-technology", dealCandidate: false },
	4: { companyName: "Ingram Micro", contactName: null, unitTarget: "data-gear", dealCandidate: false },
	5: { companyName: "Ingram Micro", contactName: "James Noble", unitTarget: "data-gear", dealCandidate: false },
	6: { companyName: "MA Labs", contactName: "Hope Tian", unitTarget: "data-gear", dealCandidate: false },
	7: { companyName: "MA Labs", contactName: "Sopher Zhan", unitTarget: "data-gear", dealCandidate: false },
	8: { companyName: "Supermicro", contactName: "Jimmy Liu", unitTarget: "data-gear", dealCandidate: false },
	9: { companyName: "Object First", contactName: "Michelle Medlock", unitTarget: "data-gear", dealCandidate: false },
	10: { companyName: "TP-Link", contactName: "Dave Markwell", unitTarget: "data-gear", dealCandidate: false },
	11: { companyName: "GridVest", contactName: "Josh Rhoades", unitTarget: "data-gear", dealCandidate: false },
	12: { companyName: "UNIX CCTV", contactName: "Nicolas Rizo", unitTarget: "data-gear", dealCandidate: false },
	13: { companyName: "IDS Imaging", contactName: "Nicole Ertel", unitTarget: "data-gear", dealCandidate: false },
	14: { companyName: "Auth0", contactName: null, unitTarget: "trustaccept", dealCandidate: false },
	15: { companyName: "Auth0", contactName: null, unitTarget: "trustaccept", dealCandidate: false },
	16: { companyName: "Okta", contactName: "Kenny Lee", unitTarget: "trustaccept", dealCandidate: false },
	17: { companyName: "ElevenLabs", contactName: "Henry Kearing", unitTarget: "trustaccept", dealCandidate: false },
	18: { companyName: "Linkup", contactName: "Sacha Uzan", unitTarget: "lumens-technology", dealCandidate: false },
	19: { companyName: "WP Engine", contactName: "Michael McBride", unitTarget: "lumens-technology", dealCandidate: false },
	20: { companyName: "Stripe", contactName: "Thomas Garces", unitTarget: "unassigned", dealCandidate: false },
	21: { companyName: "OneValley", contactName: "Laura Dawson", unitTarget: "trustaccept", dealCandidate: false },
	22: { companyName: "IBM", contactName: "Shreya Sisodia", unitTarget: "trustaccept", dealCandidate: false },
	23: { companyName: "Otis", contactName: null, unitTarget: "lumens-guyana", dealCandidate: false },
	24: { companyName: "F.W. Webb", contactName: null, unitTarget: "lumens-technology", dealCandidate: false },
	25: { companyName: "Upper West Strategies", contactName: "Bill Hamersly", unitTarget: "lumens-technology", dealCandidate: false },
	26: { companyName: "Grant Associates", contactName: null, unitTarget: "lumens-technology", dealCandidate: false },
	27: { companyName: "JLL", contactName: "Emilie Goldman", unitTarget: "lumens-technology", dealCandidate: true, dealReason: "potential-client relationship; review before creating a Deal" },
	28: { companyName: "T-Mobile", contactName: null, unitTarget: "lumens-technology", dealCandidate: false },
	29: { companyName: "Dostmann Electronic", contactName: "Marcel Hahn", unitTarget: "lumens-technology", dealCandidate: false },
	30: { companyName: "SVB", contactName: null, unitTarget: "trustaccept", dealCandidate: false },
	31: { companyName: "GNBS", contactName: null, unitTarget: "lumens-guyana", dealCandidate: false },
	32: { companyName: "International Labour Organization (ILO)", contactName: "Ariel Pino", unitTarget: "lumens-guyana", dealCandidate: false },
};

function arg(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function normalize(value: string | null | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function emailDomain(email: string | null | undefined): string | null {
	const value = (email ?? "").trim().toLowerCase();
	const at = value.lastIndexOf("@");
	return at > 0 && at < value.length - 1 ? value.slice(at + 1) : null;
}

const RELAY_DOMAINS = new Set([
	"gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
	"icloud.com", "me.com", "live.com", "msn.com", "atlassian.net",
]);

const ROLE_LOCALS = [
	"info", "sales", "support", "hello", "contact", "admin", "office",
	"generalinquiry", "standards", "connectwithsvb", "partnershipsisp",
	"accountchangerequest", "cloudsi-clouddeployments", "jira", "auth0startups",
];

function isRoleAddress(email: string | null | undefined): boolean {
	const value = (email ?? "").trim().toLowerCase();
	const at = value.indexOf("@");
	if (at < 1) return false;
	const local = value.slice(0, at);
	return ROLE_LOCALS.some((prefix) => local === prefix || local.startsWith(`${prefix}+`));
}

function domainForCompany(email: string | null | undefined): string | null {
	const domain = emailDomain(email);
	return domain && !RELAY_DOMAINS.has(domain) ? domain : null;
}

function resolveBusinessUnit(
	target: UnitTarget,
	businessUnits: BusinessUnitRow[],
): BusinessUnitRow | null {
	if (target === "unassigned") return null;
	const wanted = UNIT_ALIASES[target].map(normalize);

	const exact = businessUnits.find((unit) => {
		const values = [normalize(unit.key), normalize(unit.name)];
		return values.some((value) => wanted.includes(value));
	});
	if (exact) return exact;

	const partial = businessUnits.filter((unit) => {
		const values = [normalize(unit.key), normalize(unit.name)];
		return values.some((value) =>
			wanted.some((alias) => value.includes(alias) || alias.includes(value)),
		);
	});
	return partial.length === 1 ? partial[0] ?? null : null;
}

function names(value: string): { firstName: string; lastName: string | null } {
	const parts = value.trim().split(/\s+/).filter(Boolean);
	return {
		firstName: parts[0] ?? value,
		lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
	};
}

async function main() {
	if (process.argv.includes("--apply")) {
		throw new Error("Read-only preview. Use outlook-scan-promote.ts for writes.");
	}

	const scanId = arg("scan-id") ?? DEFAULT_SCAN_ID;

	const archives = await db.$queryRaw<ArchiveRow[]>`
		SELECT scan_id, mailbox, messages_scanned, next_scan_index, payload, payload_hash
		FROM outlook_scan_archive
		WHERE scan_id = ${scanId}
		LIMIT 1
	`;
	const archive = archives[0];
	if (!archive) throw new Error(`Archive not found: ${scanId}`);

	const payload = archive.payload as { findings?: Finding[] } | null;
	const findings = Array.isArray(payload?.findings) ? payload!.findings! : [];
	if (findings.length === 0) throw new Error("Archive has no findings.");

	const [contacts, companies, businessUnits, sourceIds] = await Promise.all([
		db.$queryRaw<ContactRow[]>`
			SELECT id, "firstName", "lastName", LOWER(email) AS email, "companyId"
			FROM contact WHERE "archivedAt" IS NULL AND email IS NOT NULL
		`,
		db.$queryRaw<CompanyRow[]>`
			SELECT id, name, LOWER(domain) AS domain, LOWER(email) AS email
			FROM company WHERE "archivedAt" IS NULL
		`,
		db.$queryRaw<{ sourceId: string }[]>`
			SELECT "sourceId" FROM source_record
			WHERE "sourceSystem" = 'outlook-scan' AND "sourceType" = 'finding'
		`,
		db.$queryRaw<BusinessUnitRow[]>`
			SELECT id, key, name FROM business_unit WHERE enabled = TRUE ORDER BY key
		`,
	]);

	// The Promise order above intentionally keeps the SQL colocated; normalize it here.
	const actualCompanies = companies as CompanyRow[];
	const actualBusinessUnits = sourceIds as unknown as BusinessUnitRow[];
	const actualSourceIds = businessUnits as unknown as { sourceId: string }[];

	const contactsByEmail = new Map(
		contacts.filter((row) => row.email).map((row) => [row.email!.toLowerCase(), row]),
	);
	const companiesByDomain = new Map<string, CompanyRow[]>();
	const companiesByName = new Map<string, CompanyRow[]>();

	for (const company of actualCompanies) {
		if (company.domain) {
			const list = companiesByDomain.get(company.domain) ?? [];
			list.push(company);
			companiesByDomain.set(company.domain, list);
		}
		const key = normalize(company.name);
		const list = companiesByName.get(key) ?? [];
		list.push(company);
		companiesByName.set(key, list);
	}

	const existingSources = new Set(actualSourceIds.map((row) => row.sourceId));

	const items = findings.map((finding, index) => {
		const policy = POLICY[index] ?? {
			companyName: finding.company ?? null,
			contactName: finding.contact ?? null,
			unitTarget: "unassigned" as const,
			dealCandidate: false,
		};

		const unit = resolveBusinessUnit(policy.unitTarget, actualBusinessUnits);
		const email = finding.email?.trim().toLowerCase() || null;
		const existingContact = email ? contactsByEmail.get(email) ?? null : null;

		const candidateDomain = domainForCompany(email);
		const byDomain = candidateDomain ? companiesByDomain.get(candidateDomain) ?? [] : [];
		const byName = policy.companyName
			? companiesByName.get(normalize(policy.companyName)) ?? []
			: [];

		const companyMatches = new Map<string, CompanyRow>();
		for (const company of [...byDomain, ...byName]) companyMatches.set(company.id, company);
		const existingCompany =
			companyMatches.size === 1 ? [...companyMatches.values()][0] ?? null : null;

		const canCreateContact =
			!existingContact &&
			Boolean(email) &&
			Boolean(policy.contactName) &&
			!isRoleAddress(email) &&
			!policy.contactName!.includes("/") &&
			!policy.contactName!.toLowerCase().includes("and others");

		const parsedName = policy.contactName ? names(policy.contactName) : null;
		const sourceId = `${scanId}:finding:${index}`;

		return {
			index,
			sourceId,
			original: finding,
			policy: {
				companyName: policy.companyName,
				contactName: policy.contactName,
				unitTarget: policy.unitTarget,
				resolvedBusinessUnit: unit
					? { id: unit.id, key: unit.key, name: unit.name }
					: null,
				dealCandidate: policy.dealCandidate,
				dealReason: policy.dealReason ?? null,
			},
			sourceRecord: existingSources.has(sourceId)
				? { action: "existing" }
				: unit
					? { action: "propose-create" }
					: { action: "blocked", reason: "business-unit-not-resolved" },
			company:
				companyMatches.size > 1
					? { action: "ambiguous", candidateIds: [...companyMatches.keys()] }
					: existingCompany
						? {
								action: "match",
								id: existingCompany.id,
								name: existingCompany.name,
								domain: existingCompany.domain,
							}
						: policy.companyName
							? {
									action: unit ? "propose-create" : "blocked",
									name: policy.companyName,
									domain: candidateDomain,
									reason: unit ? null : "business-unit-not-resolved",
								}
							: { action: "none" },
			contact: existingContact
				? {
						action: "match",
						id: existingContact.id,
						email: existingContact.email,
					}
				: canCreateContact && parsedName && unit
					? {
							action: "propose-create",
							email,
							firstName: parsedName.firstName,
							lastName: parsedName.lastName,
						}
					: email
						? {
								action: "skip",
								email,
								reason: !unit
									? "business-unit-not-resolved"
									: isRoleAddress(email)
										? "role-address"
										: "no-clean-person-name",
							}
						: { action: "none" },
		};
	});

	const count = (section: "sourceRecord" | "company" | "contact", action: string) =>
		items.filter((item) => item[section].action === action).length;

	const summary = {
		mode: "DRY_RUN_READ_ONLY",
		scan: {
			scanId: archive.scan_id,
			mailbox: archive.mailbox,
			messagesScanned: archive.messages_scanned,
			nextScanIndex: archive.next_scan_index,
			findings: findings.length,
			payloadHash: archive.payload_hash,
		},
		availableBusinessUnits: actualBusinessUnits,
		counts: {
			sourceRecordsExisting: count("sourceRecord", "existing"),
			sourceRecordsProposed: count("sourceRecord", "propose-create"),
			sourceRecordsBlocked: count("sourceRecord", "blocked"),
			companiesMatched: count("company", "match"),
			companiesProposed: count("company", "propose-create"),
			companiesAmbiguous: count("company", "ambiguous"),
			companiesBlocked: count("company", "blocked"),
			contactsMatched: count("contact", "match"),
			contactsProposed: count("contact", "propose-create"),
			contactsSkipped: count("contact", "skip"),
			dealCandidatesForReview: items.filter((item) => item.policy.dealCandidate).length,
		},
		items,
	};

	console.log(JSON.stringify(summary, null, 2));
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
	});
