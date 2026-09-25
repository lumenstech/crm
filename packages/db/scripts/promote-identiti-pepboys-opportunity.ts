import { createHash } from "node:crypto";
import { db } from "../src/index";

const SOURCE_SYSTEM = "outlook-scan";
const SOURCE_TYPE = "finding";
const SOURCE_ID = "outlook:danny@lumenstechnology.com:0-4799:finding:0";
const BUSINESS_UNIT_KEY = "lumens-technology";
const PIPELINE_NAME = "Lumens Technology Sales";
const OPPORTUNITY_NAME = "Pep Boys - Lake Grove, NY - Electrical Quote";
const OPPORTUNITY_STAGE = "qualified";

type SourceRow = {
	id: string;
	businessUnitId: string;
	payload: unknown;
	opportunityId: string | null;
};

type CompanyRow = {
	id: string;
	name: string;
	domain: string | null;
	website: string | null;
};

function stableId(prefix: string, value: string): string {
	const digest = createHash("sha256").update(value).digest("hex").slice(0, 24);
	return `${prefix}-${digest}`;
}

function normalizeName(value: string): string {
	return value
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

async function main() {
	if (!process.argv.includes("--apply")) {
		throw new Error("Refusing to write without --apply.");
	}

	const sourceRows = await db.$queryRaw<SourceRow[]>`
		SELECT id, "businessUnitId", payload, "opportunityId"
		FROM source_record
		WHERE "sourceSystem" = ${SOURCE_SYSTEM}
		  AND "sourceType" = ${SOURCE_TYPE}
		  AND "sourceId" = ${SOURCE_ID}
		LIMIT 1
	`;

	const source = sourceRows[0];
	if (!source) throw new Error(`Source record not found: ${SOURCE_ID}`);

	const unit = await db.businessUnit.findUnique({
		where: { key: BUSINESS_UNIT_KEY },
		select: { id: true, key: true, name: true },
	});
	if (!unit) throw new Error(`Business unit not found: ${BUSINESS_UNIT_KEY}`);

	const payload =
		source.payload && typeof source.payload === "object"
			? (source.payload as Record<string, any>)
			: {};

	const compCompanyId =
		payload?.promotion?.compCompanyId ?? payload?.promotion?.companyId ?? null;

	if (!compCompanyId) {
		throw new Error("Source record does not contain promotion.compCompanyId.");
	}

	const compCompanyRows = await db.$queryRaw<CompanyRow[]>`
		SELECT id, name, domain, website
		FROM company
		WHERE id = ${String(compCompanyId)}
		  AND "archivedAt" IS NULL
		LIMIT 1
	`;

	const compCompany = compCompanyRows[0];
	if (!compCompany)
		throw new Error(`Comp CRM company not found: ${compCompanyId}`);

	const normalizedCompany = normalizeName(compCompany.name);
	const canonicalCompanyId = stableId(
		"outlook-canonical-company",
		`${unit.id}:${normalizedCompany}`,
	);
	const pipelineId = stableId(
		"outlook-pipeline",
		`${unit.id}:${PIPELINE_NAME}`,
	);
	const opportunityId = stableId(
		"outlook-opportunity",
		`${unit.id}:${SOURCE_ID}`,
	);
	const companyMappingId = stableId(
		"outlook-map-company",
		`${SOURCE_SYSTEM}:${SOURCE_TYPE}:${SOURCE_ID}:company`,
	);
	const opportunityMappingId = stableId(
		"outlook-map-opportunity",
		`${SOURCE_SYSTEM}:${SOURCE_TYPE}:${SOURCE_ID}:opportunity`,
	);

	const result = await db.$transaction(
		async (tx) => {
			const canonicalCompany = await tx.canonicalCompany.upsert({
				where: {
					businessUnitId_normalizedName: {
						businessUnitId: unit.id,
						normalizedName: normalizedCompany,
					},
				},
				create: {
					id: canonicalCompanyId,
					businessUnitId: unit.id,
					name: compCompany.name,
					normalizedName: normalizedCompany,
					domain: compCompany.domain,
					website: compCompany.website,
					fields: {
						source: "outlook-scan",
						compCompanyId: compCompany.id,
						relationshipContext: "Pep Boys / Identiti electrical quote",
					},
				},
				update: {
					domain: compCompany.domain ?? undefined,
					website: compCompany.website ?? undefined,
				},
				select: {
					id: true,
					name: true,
					domain: true,
				},
			});

			const pipeline = await tx.pipeline.upsert({
				where: {
					businessUnitId_name: {
						businessUnitId: unit.id,
						name: PIPELINE_NAME,
					},
				},
				create: {
					id: pipelineId,
					businessUnitId: unit.id,
					name: PIPELINE_NAME,
					stages: ["qualified", "proposal", "contract", "won", "lost"],
				},
				update: {},
				select: {
					id: true,
					name: true,
				},
			});

			const opportunity = await tx.canonicalOpportunity.upsert({
				where: { id: opportunityId },
				create: {
					id: opportunityId,
					businessUnitId: unit.id,
					companyId: canonicalCompany.id,
					pipelineId: pipeline.id,
					name: OPPORTUNITY_NAME,
					stage: OPPORTUNITY_STAGE,
					fields: {
						source: "outlook-scan",
						sourceId: SOURCE_ID,
						customer: "Pep Boys",
						primeRelationship: "Identiti",
						projectLocation: "Lake Grove, NY",
						context:
							"Quote follow-up received Apr 7, 2026; later permit details requested.",
						priority: "high",
						reviewed: true,
						approvedForOpportunity: true,
					},
				},
				update: {
					businessUnitId: unit.id,
					companyId: canonicalCompany.id,
					pipelineId: pipeline.id,
					name: OPPORTUNITY_NAME,
					stage: OPPORTUNITY_STAGE,
				},
				select: {
					id: true,
					name: true,
					stage: true,
					companyId: true,
					pipelineId: true,
				},
			});

			await tx.sourceRecord.update({
				where: {
					sourceSystem_sourceType_sourceId: {
						sourceSystem: SOURCE_SYSTEM,
						sourceType: SOURCE_TYPE,
						sourceId: SOURCE_ID,
					},
				},
				data: {
					businessUnitId: unit.id,
					companyId: canonicalCompany.id,
					opportunityId: opportunity.id,
				},
			});

			await tx.recordMapping.upsert({
				where: {
					sourceSystem_sourceType_sourceId_canonicalType: {
						sourceSystem: SOURCE_SYSTEM,
						sourceType: SOURCE_TYPE,
						sourceId: SOURCE_ID,
						canonicalType: "company",
					},
				},
				create: {
					id: companyMappingId,
					sourceSystem: SOURCE_SYSTEM,
					sourceType: SOURCE_TYPE,
					sourceId: SOURCE_ID,
					canonicalType: "company",
					canonicalId: canonicalCompany.id,
					application: "comp-crm",
					applicationId: compCompany.id,
					matchMethod: "approved-outlook-scan",
					status: "active",
				},
				update: {
					canonicalId: canonicalCompany.id,
					application: "comp-crm",
					applicationId: compCompany.id,
					matchMethod: "approved-outlook-scan",
					status: "active",
				},
			});

			await tx.recordMapping.upsert({
				where: {
					sourceSystem_sourceType_sourceId_canonicalType: {
						sourceSystem: SOURCE_SYSTEM,
						sourceType: SOURCE_TYPE,
						sourceId: SOURCE_ID,
						canonicalType: "opportunity",
					},
				},
				create: {
					id: opportunityMappingId,
					sourceSystem: SOURCE_SYSTEM,
					sourceType: SOURCE_TYPE,
					sourceId: SOURCE_ID,
					canonicalType: "opportunity",
					canonicalId: opportunity.id,
					application: "comp-crm",
					applicationId: null,
					matchMethod: "approved-outlook-scan",
					status: "active",
				},
				update: {
					canonicalId: opportunity.id,
					application: "comp-crm",
					applicationId: null,
					matchMethod: "approved-outlook-scan",
					status: "active",
				},
			});

			return {
				businessUnit: unit,
				canonicalCompany,
				pipeline,
				opportunity,
				jllAction: "left-as-source-record-only",
			};
		},
		{ maxWait: 10_000, timeout: 30_000 },
	);

	console.log(JSON.stringify(result, null, 2));
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
	});
