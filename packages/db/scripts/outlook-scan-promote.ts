import { createHash } from "node:crypto";
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
	businessUnitId: string | null;
};

type BusinessUnitRow = {
	id: string;
	key: string;
	name: string;
};

type UnitTarget =
	| "data-gear"
	| "trustaccept"
	| "lumens-technology"
	| "lumens-guyana"
	| "general"
	| "unassigned";

type PromotionPolicy = {
	companyName: string | null;
	contactName: string | null;
	unitTarget: UnitTarget;
	dealCandidate: boolean;
	dealReason?: string;
};

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
	general: ["general"],
};

const POLICY: Record<number, PromotionPolicy> = {
	0: {
		companyName: "Identiti",
		contactName: "Tristan Limbrunner",
		unitTarget: "lumens-technology",
		dealCandidate: true,
		dealReason: "Pep Boys / Identiti quote follow-up",
	},
	1: {
		companyName: "Divisions Maintenance Group",
		contactName: "Alyssa Finke",
		unitTarget: "lumens-technology",
		dealCandidate: false,
	},
	2: {
		companyName: null,
		contactName: null,
		unitTarget: "lumens-technology",
		dealCandidate: false,
	},
	3: {
		companyName: "Sung Co",
		contactName: "Vera Sung",
		unitTarget: "lumens-technology",
		dealCandidate: false,
	},
	4: {
		companyName: "Ingram Micro",
		contactName: null,
		unitTarget: "data-gear",
		dealCandidate: false,
	},
	5: {
		companyName: "Ingram Micro",
		contactName: "James Noble",
		unitTarget: "data-gear",
		dealCandidate: false,
	},
	6: {
		companyName: "MA Labs",
		contactName: "Hope Tian",
		unitTarget: "data-gear",
		dealCandidate: false,
	},
	7: {
		companyName: "MA Labs",
		contactName: "Sopher Zhan",
		unitTarget: "data-gear",
		dealCandidate: false,
	},
	8: {
		companyName: "Supermicro",
		contactName: "Jimmy Liu",
		unitTarget: "data-gear",
		dealCandidate: false,
	},
	9: {
		companyName: "Object First",
		contactName: "Michelle Medlock",
		unitTarget: "data-gear",
		dealCandidate: false,
	},
	10: {
		companyName: "TP-Link",
		contactName: "Dave Markwell",
		unitTarget: "data-gear",
		dealCandidate: false,
	},
	11: {
		companyName: "GridVest",
		contactName: "Josh Rhoades",
		unitTarget: "data-gear",
		dealCandidate: false,
	},
	12: {
		companyName: "UNIX CCTV",
		contactName: "Nicolas Rizo",
		unitTarget: "data-gear",
		dealCandidate: false,
	},
	13: {
		companyName: "IDS Imaging",
		contactName: "Nicole Ertel",
		unitTarget: "data-gear",
		dealCandidate: false,
	},
	14: {
		companyName: "Auth0",
		contactName: null,
		unitTarget: "trustaccept",
		dealCandidate: false,
	},
	15: {
		companyName: "Auth0",
		contactName: null,
		unitTarget: "trustaccept",
		dealCandidate: false,
	},
	16: {
		companyName: "Okta",
		contactName: "Kenny Lee",
		unitTarget: "trustaccept",
		dealCandidate: false,
	},
	17: {
		companyName: "ElevenLabs",
		contactName: "Henry Kearing",
		unitTarget: "trustaccept",
		dealCandidate: false,
	},
	18: {
		companyName: "Linkup",
		contactName: "Sacha Uzan",
		unitTarget: "lumens-technology",
		dealCandidate: false,
	},
	19: {
		companyName: "WP Engine",
		contactName: "Michael McBride",
		unitTarget: "lumens-technology",
		dealCandidate: false,
	},
	20: {
		companyName: "Stripe",
		contactName: "Thomas Garces",
		unitTarget: "general",
		dealCandidate: false,
	},
	21: {
		companyName: "OneValley",
		contactName: "Laura Dawson",
		unitTarget: "trustaccept",
		dealCandidate: false,
	},
	22: {
		companyName: "IBM",
		contactName: "Shreya Sisodia",
		unitTarget: "trustaccept",
		dealCandidate: false,
	},
	23: {
		companyName: "Otis",
		contactName: null,
		unitTarget: "lumens-guyana",
		dealCandidate: false,
	},
	24: {
		companyName: "F.W. Webb",
		contactName: null,
		unitTarget: "lumens-technology",
		dealCandidate: false,
	},
	25: {
		companyName: "Upper West Strategies",
		contactName: "Bill Hamersly",
		unitTarget: "lumens-technology",
		dealCandidate: false,
	},
	26: {
		companyName: "Grant Associates",
		contactName: null,
		unitTarget: "lumens-technology",
		dealCandidate: false,
	},
	27: {
		companyName: "JLL",
		contactName: "Emilie Goldman",
		unitTarget: "lumens-technology",
		dealCandidate: true,
		dealReason: "potential-client relationship; review before creating a Deal",
	},
	28: {
		companyName: "T-Mobile",
		contactName: null,
		unitTarget: "lumens-technology",
		dealCandidate: false,
	},
	29: {
		companyName: "Dostmann Electronic",
		contactName: "Marcel Hahn",
		unitTarget: "lumens-technology",
		dealCandidate: false,
	},
	30: {
		companyName: "SVB",
		contactName: null,
		unitTarget: "trustaccept",
		dealCandidate: false,
	},
	31: {
		companyName: "GNBS",
		contactName: null,
		unitTarget: "lumens-guyana",
		dealCandidate: false,
	},
	32: {
		companyName: "International Labour Organization (ILO)",
		contactName: "Ariel Pino",
		unitTarget: "lumens-guyana",
		dealCandidate: false,
	},
};

function arg(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv
		.find((value) => value.startsWith(prefix))
		?.slice(prefix.length);
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
	"gmail.com",
	"googlemail.com",
	"yahoo.com",
	"outlook.com",
	"hotmail.com",
	"icloud.com",
	"me.com",
	"live.com",
	"msn.com",
	"atlassian.net",
]);

const ROLE_LOCALS = [
	"info",
	"sales",
	"support",
	"hello",
	"contact",
	"admin",
	"office",
	"generalinquiry",
	"standards",
	"connectwithsvb",
	"partnershipsisp",
	"accountchangerequest",
	"cloudsi-clouddeployments",
	"jira",
	"auth0startups",
];

function isRoleAddress(email: string | null | undefined): boolean {
	const value = (email ?? "").trim().toLowerCase();
	const at = value.indexOf("@");
	if (at < 1) return false;
	const local = value.slice(0, at);
	return ROLE_LOCALS.some(
		(prefix) => local === prefix || local.startsWith(`${prefix}+`),
	);
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
	return partial.length === 1 ? (partial[0] ?? null) : null;
}

function splitName(value: string): {
	firstName: string;
	lastName: string | null;
} {
	const parts = value.trim().split(/\s+/).filter(Boolean);
	return {
		firstName: parts[0] ?? value,
		lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
	};
}

function stableId(prefix: string, value: string): string {
	const digest = createHash("sha256").update(value).digest("hex").slice(0, 24);
	return `${prefix}-${digest}`;
}

function sourceId(scanId: string, index: number): string {
	return `${scanId}:finding:${index}`;
}

async function main() {
	if (!process.argv.includes("--apply")) {
		throw new Error(
			"Refusing to write without --apply. Run outlook-scan-dry-run.ts first, then rerun this script with --apply.",
		);
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

	const [businessUnits, initialCompanies, initialContacts] = await Promise.all([
		db.$queryRaw<BusinessUnitRow[]>`
			SELECT id, key, name FROM business_unit WHERE enabled = TRUE ORDER BY key
		`,
		db.$queryRaw<CompanyRow[]>`
			SELECT id, name, LOWER(domain) AS domain, "businessUnitId"
			FROM company WHERE "archivedAt" IS NULL
		`,
		db.$queryRaw<ContactRow[]>`
			SELECT id, "firstName", "lastName", LOWER(email) AS email, "companyId"
			FROM contact WHERE "archivedAt" IS NULL AND email IS NOT NULL
		`,
	]);

	const summary = {
		scanId,
		sourceRecordsCreated: 0,
		sourceRecordsExisting: 0,
		companiesCreated: 0,
		companiesMatched: 0,
		contactsCreated: 0,
		contactsMatched: 0,
		skippedUnresolvedBusinessUnit: 0,
		skippedAmbiguousCompany: 0,
		skippedRoleOrUncleanContact: 0,
		dealCandidates: [] as Array<{
			index: number;
			company: string | null;
			reason: string | null;
		}>,
		skipped: [] as Array<{ index: number; reason: string }>,
	};

	await db.$transaction(
		async (tx) => {
			const companies = [...initialCompanies];
			const contacts = [...initialContacts];

			const findCompany = (
				companyName: string | null,
				email: string | null,
			) => {
				if (!companyName)
					return { match: null as CompanyRow | null, ambiguous: false };

				const domain = domainForCompany(email);
				const byDomain = domain
					? companies.filter((company) => company.domain === domain)
					: [];
				const byName = companies.filter(
					(company) => normalize(company.name) === normalize(companyName),
				);

				const matches = new Map<string, CompanyRow>();
				for (const company of [...byDomain, ...byName])
					matches.set(company.id, company);

				return {
					match: matches.size === 1 ? ([...matches.values()][0] ?? null) : null,
					ambiguous: matches.size > 1,
				};
			};

			for (const [index, finding] of findings.entries()) {
				const policy = POLICY[index] ?? {
					companyName: finding.company ?? null,
					contactName: finding.contact ?? null,
					unitTarget: "unassigned" as const,
					dealCandidate: false,
				};

				if (policy.dealCandidate) {
					summary.dealCandidates.push({
						index,
						company: policy.companyName,
						reason: policy.dealReason ?? null,
					});
				}

				const unit = resolveBusinessUnit(policy.unitTarget, businessUnits);
				if (!unit) {
					summary.skippedUnresolvedBusinessUnit += 1;
					summary.skipped.push({
						index,
						reason: `business unit not resolved for target ${policy.unitTarget}`,
					});
					continue;
				}

				const email = finding.email?.trim().toLowerCase() || null;

				let companyId: string | null = null;
				if (policy.companyName) {
					const found = findCompany(policy.companyName, email);
					if (found.ambiguous) {
						summary.skippedAmbiguousCompany += 1;
						summary.skipped.push({ index, reason: "ambiguous company match" });
						continue;
					}

					if (found.match) {
						companyId = found.match.id;
						summary.companiesMatched += 1;
					} else {
						const domain = domainForCompany(email);
						const companyKey = domain ?? normalize(policy.companyName);
						const id = stableId("outlook-company", companyKey);

						await tx.$executeRaw`
						INSERT INTO company
							(id, name, domain, website, source, "businessUnitId", "createdAt", "updatedAt")
						VALUES
							(
								${id},
								${policy.companyName},
								${domain},
								${domain ? `https://${domain}` : null},
								CAST('IMPORT' AS "RecordSource"),
								${unit.id},
								NOW(),
								NOW()
							)
						ON CONFLICT (id) DO NOTHING
					`;

						companyId = id;
						companies.push({
							id,
							name: policy.companyName,
							domain,
							businessUnitId: unit.id,
						});
						summary.companiesCreated += 1;
					}
				}

				let contactId: string | null = null;
				const existingContact = email
					? (contacts.find((contact) => contact.email === email) ?? null)
					: null;

				if (existingContact) {
					contactId = existingContact.id;
					summary.contactsMatched += 1;
				} else if (
					email &&
					policy.contactName &&
					companyId &&
					!isRoleAddress(email) &&
					!policy.contactName.includes("/") &&
					!policy.contactName.toLowerCase().includes("and others")
				) {
					const parsed = splitName(policy.contactName);
					const id = stableId("outlook-contact", email);

					await tx.$executeRaw`
					INSERT INTO contact
						(
							id, "firstName", "lastName", email, "companyId",
							source, "createdAt", "updatedAt"
						)
					VALUES
						(
							${id},
							${parsed.firstName},
							${parsed.lastName},
							${email},
							${companyId},
							CAST('IMPORT' AS "RecordSource"),
							NOW(),
							NOW()
						)
					ON CONFLICT (id) DO NOTHING
				`;

					contactId = id;
					contacts.push({
						id,
						firstName: parsed.firstName,
						lastName: parsed.lastName,
						email,
						companyId,
					});
					summary.contactsCreated += 1;
				} else if (email) {
					summary.skippedRoleOrUncleanContact += 1;
				}

				const sid = sourceId(scanId, index);
				const existing = await tx.$queryRaw<{ sourceId: string }[]>`
				SELECT "sourceId"
				FROM source_record
				WHERE "sourceSystem" = 'outlook-scan'
				  AND "sourceType" = 'finding'
				  AND "sourceId" = ${sid}
				LIMIT 1
			`;

				if (existing.length > 0) {
					summary.sourceRecordsExisting += 1;
					continue;
				}

				const sourcePayload = JSON.stringify({
					scan: {
						scanId: archive.scan_id,
						mailbox: archive.mailbox,
						messagesScanned: archive.messages_scanned,
						nextScanIndex: archive.next_scan_index,
						payloadHash: archive.payload_hash,
						findingIndex: index,
					},
					finding,
					promotion: {
						companyName: policy.companyName,
						contactName: policy.contactName,
						businessUnitTarget: policy.unitTarget,
						businessUnitId: unit.id,
						businessUnitKey: unit.key,
						compCompanyId: companyId,
						compContactId: contactId,
						dealCandidate: policy.dealCandidate,
						dealReason: policy.dealReason ?? null,
					},
				});

				const rowId = stableId("outlook-source", sid);

				await tx.$executeRaw`
				INSERT INTO source_record
					(
						id, "businessUnitId", "sourceSystem", "sourceType",
						"sourceId", "sourceUrl", "observedAt", payload, "createdAt"
					)
				VALUES
					(
						${rowId},
						${unit.id},
						'outlook-scan',
						'finding',
						${sid},
						NULL,
						NULL,
						${sourcePayload}::jsonb,
						NOW()
					)
				ON CONFLICT ("sourceSystem", "sourceType", "sourceId") DO NOTHING
			`;

				summary.sourceRecordsCreated += 1;
			}
		},
		{ maxWait: 10_000, timeout: 30_000 },
	);

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
