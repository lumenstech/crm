import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { BusinessUnitsService } from "../src/business-units/business-units.service";

const DOMAIN = "comp-crm-multi-unit-test.invalid";
const COMPANY_NAME = "COMP CRM Multi Unit Test";
const service = new BusinessUnitsService(db);

async function cleanup() {
	const companies = await db.company.findMany({
		where: { domain: DOMAIN },
		select: { id: true },
	});
	for (const company of companies) {
		await db.$queryRaw`
			DELETE FROM canonical_opportunity
			WHERE fields->>'applicationCompanyId' = ${company.id}
		`;
		await db.$queryRaw`
			DELETE FROM canonical_company
			WHERE fields->>'applicationCompanyId' = ${company.id}
		`;
	}
	await db.company.deleteMany({ where: { domain: DOMAIN } });
}

beforeEach(cleanup);
afterAll(cleanup);

describe("multi-business-unit CRM records", () => {
	it("reuses one company across multiple business units", async () => {
		const company = await db.company.create({
			data: { name: COMPANY_NAME, domain: DOMAIN },
			select: { id: true },
		});

		const first = await service.associate({
			recordType: "company",
			recordId: company.id,
			targetBusinessUnit: "data-gear",
			useCase: "GPU server procurement",
		});
		const second = await service.associate({
			recordType: "company",
			recordId: company.id,
			targetBusinessUnit: "partwall",
			useCase: "Trade-show infrastructure",
		});

		expect(first.created).toBe(true);
		expect(second.created).toBe(true);

		const listed = await service.recordAssociations({
			recordType: "company",
			recordId: company.id,
		});
		expect(
			listed.associations.map((row) => row.businessUnitKey).sort(),
		).toEqual(["data-gear", "partwall"]);
		expect(await db.company.count({ where: { domain: DOMAIN } })).toBe(1);
	});

	it("creates an idempotent qualified opportunity only after association", async () => {
		const company = await db.company.create({
			data: { name: COMPANY_NAME, domain: DOMAIN },
			select: { id: true },
		});

		await service.associate({
			recordType: "company",
			recordId: company.id,
			targetBusinessUnit: "data-gear",
		});

		const first = await service.createOpportunity({
			companyId: company.id,
			targetBusinessUnit: "data-gear",
			name: "GPU infrastructure requirement",
			useCase: "GPU/server procurement",
		});
		const repeated = await service.createOpportunity({
			companyId: company.id,
			targetBusinessUnit: "data-gear",
			name: "GPU infrastructure requirement",
			useCase: "GPU/server procurement",
		});

		expect(first.created).toBe(true);
		expect(first.stage).toBe("qualified");
		expect(repeated.created).toBe(false);
		expect(repeated.opportunityId).toBe(first.opportunityId);
	});

	it("refuses an opportunity for a unit the company is not associated with", async () => {
		const company = await db.company.create({
			data: { name: COMPANY_NAME, domain: DOMAIN },
			select: { id: true },
		});

		await expect(
			service.createOpportunity({
				companyId: company.id,
				targetBusinessUnit: "data-gear",
				name: "Should not be created",
			}),
		).rejects.toThrow("is not associated with business unit data-gear");
	});
});
