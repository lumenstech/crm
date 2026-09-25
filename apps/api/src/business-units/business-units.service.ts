import type { Db } from "@crm/db";
import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { InjectDatabase } from "../database/database.constants";
import type {
	AssociateRecordBusinessUnitInput,
	CreateBusinessUnitOpportunityInput,
	RecordBusinessUnitsInput,
} from "./business-units.types";

type BusinessUnitRow = {
	id: string;
	key: string;
	name: string;
	enabled: boolean;
};

type AssociationRow = {
	recordType: "company" | "contact";
	recordId: string;
	businessUnitId: string;
	businessUnitKey: string;
	businessUnitName: string;
	useCase: string | null;
	notes: string | null;
	createdAt: Date;
};

@Injectable()
export class BusinessUnitsService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async list() {
		return this.db.businessUnit.findMany({
			where: { enabled: true },
			select: {
				id: true,
				key: true,
				name: true,
				description: true,
				enabled: true,
			},
			orderBy: { name: "asc" },
		});
	}

	async recordAssociations(input: RecordBusinessUnitsInput) {
		await this.requireRecord(input.recordType, input.recordId);
		const rows =
			input.recordType === "company"
				? await this.db.$queryRaw<AssociationRow[]>`
					SELECT
						'company'::text AS "recordType",
						cbu."companyId" AS "recordId",
						cbu."businessUnitId" AS "businessUnitId",
						bu.key AS "businessUnitKey",
						bu.name AS "businessUnitName",
						cbu."useCase" AS "useCase",
						cbu.notes,
						cbu."createdAt" AS "createdAt"
					FROM company_business_unit cbu
					JOIN business_unit bu ON bu.id = cbu."businessUnitId"
					WHERE cbu."companyId" = ${input.recordId}
					ORDER BY bu.name ASC
				`
				: await this.db.$queryRaw<AssociationRow[]>`
					SELECT
						'contact'::text AS "recordType",
						cbu."contactId" AS "recordId",
						cbu."businessUnitId" AS "businessUnitId",
						bu.key AS "businessUnitKey",
						bu.name AS "businessUnitName",
						cbu."useCase" AS "useCase",
						cbu.notes,
						cbu."createdAt" AS "createdAt"
					FROM contact_business_unit cbu
					JOIN business_unit bu ON bu.id = cbu."businessUnitId"
					WHERE cbu."contactId" = ${input.recordId}
					ORDER BY bu.name ASC
				`;

		return {
			recordType: input.recordType,
			recordId: input.recordId,
			associations: rows.map((row) => ({
				...row,
				createdAt: row.createdAt.toISOString(),
			})),
		};
	}

	async associate(input: AssociateRecordBusinessUnitInput) {
		await this.requireRecord(input.recordType, input.recordId);
		const unit = await this.requireBusinessUnit(input.targetBusinessUnit);

		const existing =
			input.recordType === "company"
				? await this.db.$queryRaw<Array<{ exists: boolean }>>`
					SELECT EXISTS(
						SELECT 1 FROM company_business_unit
						WHERE "companyId" = ${input.recordId}
							AND "businessUnitId" = ${unit.id}
					) AS exists
				`
				: await this.db.$queryRaw<Array<{ exists: boolean }>>`
					SELECT EXISTS(
						SELECT 1 FROM contact_business_unit
						WHERE "contactId" = ${input.recordId}
							AND "businessUnitId" = ${unit.id}
					) AS exists
				`;
		const created = !existing[0]?.exists;

		const rows =
			input.recordType === "company"
				? await this.db.$queryRaw<AssociationRow[]>`
					INSERT INTO company_business_unit (
						"companyId", "businessUnitId", "useCase", notes, "createdAt"
					)
					VALUES (
						${input.recordId}, ${unit.id}, ${input.useCase ?? null},
						${input.notes ?? null}, CURRENT_TIMESTAMP
					)
					ON CONFLICT ("companyId", "businessUnitId") DO UPDATE SET
						"useCase" = COALESCE(EXCLUDED."useCase", company_business_unit."useCase"),
						notes = COALESCE(EXCLUDED.notes, company_business_unit.notes)
					RETURNING
						'company'::text AS "recordType",
						"companyId" AS "recordId",
						"businessUnitId" AS "businessUnitId",
						${unit.key}::text AS "businessUnitKey",
						${unit.name}::text AS "businessUnitName",
						"useCase" AS "useCase",
						notes,
						"createdAt" AS "createdAt"
				`
				: await this.db.$queryRaw<AssociationRow[]>`
					INSERT INTO contact_business_unit (
						"contactId", "businessUnitId", "useCase", notes, "createdAt"
					)
					VALUES (
						${input.recordId}, ${unit.id}, ${input.useCase ?? null},
						${input.notes ?? null}, CURRENT_TIMESTAMP
					)
					ON CONFLICT ("contactId", "businessUnitId") DO UPDATE SET
						"useCase" = COALESCE(EXCLUDED."useCase", contact_business_unit."useCase"),
						notes = COALESCE(EXCLUDED.notes, contact_business_unit.notes)
					RETURNING
						'contact'::text AS "recordType",
						"contactId" AS "recordId",
						"businessUnitId" AS "businessUnitId",
						${unit.key}::text AS "businessUnitKey",
						${unit.name}::text AS "businessUnitName",
						"useCase" AS "useCase",
						notes,
						"createdAt" AS "createdAt"
				`;

		const association = rows[0];
		if (!association) throw new Error("Business-unit association did not return a row.");

		if (input.recordType === "company") {
			await this.db.$queryRaw`
				UPDATE company
				SET "businessUnitId" = ${unit.id}
				WHERE id = ${input.recordId} AND "businessUnitId" IS NULL
			`;
		}

		return {
			...association,
			createdAt: association.createdAt.toISOString(),
			created,
		};
	}

	async createOpportunity(input: CreateBusinessUnitOpportunityInput) {
		const unit = await this.requireBusinessUnit(input.targetBusinessUnit);
		const [company] = await this.db.$queryRaw<
			Array<{ id: string; name: string; domain: string | null }>
		>`
			SELECT id, name, domain
			FROM company
			WHERE id = ${input.companyId} AND "archivedAt" IS NULL
			LIMIT 1
		`;
		if (!company) throw new NotFoundException(`No company with id ${input.companyId}.`);

		const [association] = await this.db.$queryRaw<Array<{ exists: boolean }>>`
			SELECT EXISTS(
				SELECT 1 FROM company_business_unit
				WHERE "companyId" = ${company.id} AND "businessUnitId" = ${unit.id}
			) AS exists
		`;
		if (!association?.exists) {
			throw new BadRequestException(
				`Company ${company.id} is not associated with business unit ${unit.key}.`,
			);
		}

		if (input.contactId) {
			const [contact] = await this.db.$queryRaw<Array<{ companyId: string | null }>>`
				SELECT "companyId" FROM contact
				WHERE id = ${input.contactId} AND "archivedAt" IS NULL LIMIT 1
			`;
			if (!contact) throw new NotFoundException(`No contact with id ${input.contactId}.`);
			if (contact.companyId !== company.id) {
				throw new BadRequestException("The requested contact does not belong to the company.");
			}
		}

		const normalizedName = company.name.trim().toLowerCase();
		const [canonicalCompany] = await this.db.$queryRaw<Array<{ id: string }>>`
			INSERT INTO canonical_company (
				id, "businessUnitId", name, "normalizedName", domain, website, fields,
				"createdAt", "updatedAt"
			)
			VALUES (
				${randomUUID()}, ${unit.id}, ${company.name}, ${normalizedName},
				${company.domain}, ${company.domain ? `https://${company.domain}` : null},
				${JSON.stringify({ application: "comp-ai-core", applicationCompanyId: company.id })}::jsonb,
				CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
			)
			ON CONFLICT ("businessUnitId", "normalizedName") DO UPDATE SET
				domain = COALESCE(canonical_company.domain, EXCLUDED.domain),
				website = COALESCE(canonical_company.website, EXCLUDED.website),
				fields = COALESCE(canonical_company.fields, '{}'::jsonb) || EXCLUDED.fields,
				"updatedAt" = CURRENT_TIMESTAMP
			RETURNING id
		`;
		if (!canonicalCompany) throw new Error("Canonical company upsert failed.");

		const [existing] = await this.db.$queryRaw<Array<{ id: string; stage: string }>>`
			SELECT id, stage
			FROM canonical_opportunity
			WHERE "businessUnitId" = ${unit.id}
				AND "companyId" = ${canonicalCompany.id}
				AND lower(name) = lower(${input.name})
				AND stage NOT IN ('won', 'lost', 'closed')
			ORDER BY "createdAt" DESC
			LIMIT 1
		`;
		if (existing) {
			return {
				opportunityId: existing.id,
				companyId: company.id,
				canonicalCompanyId: canonicalCompany.id,
				targetBusinessUnit: unit.key,
				name: input.name,
				stage: existing.stage,
				created: false,
			};
		}

		const opportunityId = randomUUID();
		const stage = "qualified";
		const fields = JSON.stringify({
			application: "comp-ai-core",
			applicationCompanyId: company.id,
			contactId: input.contactId ?? null,
			ownerId: input.ownerId ?? null,
			useCase: input.useCase ?? null,
			notes: input.notes ?? null,
		});
		await this.db.$queryRaw`
			INSERT INTO canonical_opportunity (
				id, "businessUnitId", "companyId", name, stage, fields,
				"createdAt", "updatedAt"
			)
			VALUES (
				${opportunityId}, ${unit.id}, ${canonicalCompany.id}, ${input.name},
				${stage}, ${fields}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
			)
		`;

		return {
			opportunityId,
			companyId: company.id,
			canonicalCompanyId: canonicalCompany.id,
			targetBusinessUnit: unit.key,
			name: input.name,
			stage,
			created: true,
		};
	}

	private async requireBusinessUnit(key: string): Promise<BusinessUnitRow> {
		const [unit] = await this.db.$queryRaw<BusinessUnitRow[]>`
			SELECT id, key, name, enabled
			FROM business_unit
			WHERE key = ${key}
			LIMIT 1
		`;
		if (!unit) throw new BadRequestException(`Unknown business unit: ${key}.`);
		if (!unit.enabled)
			throw new BadRequestException(`Business unit is disabled: ${key}.`);
		return unit;
	}

	private async requireRecord(type: "company" | "contact", id: string) {
		const rows =
			type === "company"
				? await this.db.$queryRaw<Array<{ id: string }>>`
					SELECT id FROM company WHERE id = ${id} AND "archivedAt" IS NULL LIMIT 1
				`
				: await this.db.$queryRaw<Array<{ id: string }>>`
					SELECT id FROM contact WHERE id = ${id} AND "archivedAt" IS NULL LIMIT 1
				`;
		if (!rows[0]) throw new NotFoundException(`No ${type} with id ${id}.`);
	}
}
