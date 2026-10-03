import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { BusinessUnitsService } from "../src/business-units/business-units.service";
import { SearchService } from "../src/search/search.service";

const SOURCE_KEY = "test-source-reuse";
const TARGET_KEY = "energybms";
const USER_ID = "test-cross-unit-user";
const COMPANY_NAME = "Cross Unit Property Management";
const CONTACT_EMAIL = "cross-unit-manager@example.invalid";

const service = new BusinessUnitsService(db);
const search = new SearchService(db);

async function cleanup() {
	const units = await db.businessUnit.findMany({
		where: { key: SOURCE_KEY },
		select: { id: true },
	});
	const unitIds = units.map((row) => row.id);

	const contacts = await db.contact.findMany({
		where: { email: CONTACT_EMAIL },
		select: { id: true, companyId: true },
	});
	const contactIds = contacts.map((row) => row.id);
	const companyIds = contacts
		.map((row) => row.companyId)
		.filter((value): value is string => Boolean(value));

	await db.dealContact.deleteMany({
		where: { contactId: { in: contactIds } },
	});
	await db.deal.deleteMany({
		where: {
			OR: [
				{ companyId: { in: companyIds } },
				{ businessUnitId: { in: unitIds } },
			],
		},
	});
	await db.businessUnitRecordAssociation.deleteMany({
		where: {
			OR: [
				{ recordId: { in: [...contactIds, ...companyIds] } },
				{ targetBusinessUnitId: { in: unitIds } },
				{ sourceBusinessUnitId: { in: unitIds } },
			],
		},
	});
	await db.contact.deleteMany({ where: { id: { in: contactIds } } });
	await db.company.deleteMany({
		where: {
			OR: [{ id: { in: companyIds } }, { name: COMPANY_NAME }],
		},
	});
	await db.user.deleteMany({ where: { id: USER_ID } });
	await db.businessUnit.deleteMany({
		where: { key: SOURCE_KEY },
	});
}

async function contactSearch(q: string, contactId: string) {
	const result = await search.quick(q);
	return result.hits.find(
		(hit) => hit.kind === "contact" && hit.id === contactId,
	);
}

beforeEach(cleanup);
afterAll(cleanup);

describe("cross-business-unit relationship reuse", () => {
	it("reuses one company/contact without reassigning or duplicating them", async () => {
		const [source, target] = await Promise.all([
			db.businessUnit.create({
				data: { key: SOURCE_KEY, name: "Source Unit", enabled: true },
			}),
			db.businessUnit.findUniqueOrThrow({
				where: { key: TARGET_KEY },
			}),
		]);
		expect(target.enabled).toBe(true);
		const owner = await db.user.create({
			data: {
				id: USER_ID,
				name: "Cross Unit Test Owner",
				email: "cross-unit-owner@example.invalid",
			},
		});
		const company = await db.company.create({
			data: {
				name: COMPANY_NAME,
				businessUnit: { connect: { id: source.id } },
				owner: { connect: { id: owner.id } },
			},
		});
		const contact = await db.contact.create({
			data: {
				firstName: "Building",
				lastName: "Manager",
				email: CONTACT_EMAIL,
				title: "Building Manager",
				company: { connect: { id: company.id } },
				owner: { connect: { id: owner.id } },
			},
		});

		const before = {
			companies: await db.company.count({ where: { name: COMPANY_NAME } }),
			contacts: await db.contact.count({ where: { email: CONTACT_EMAIL } }),
		};

		for (const term of [
			"Building",
			CONTACT_EMAIL,
			"Building Manager",
			COMPANY_NAME,
		]) {
			const hit = await contactSearch(term, contact.id);
			expect(hit?.sourceBusinessUnit?.id).toBe(source.id);
			expect(hit?.associatedBusinessUnits).toEqual([]);
		}

		const association = await service.associateRecord({
			recordType: "contact",
			recordId: contact.id,
			targetBusinessUnit: TARGET_KEY,
			useCase: "LL97",
		});
		expect(association.sourceBusinessUnit?.id).toBe(source.id);
		expect(association.targetBusinessUnit.id).toBe(target.id);
		expect(association.useCase).toBe("LL97");

		const opportunity = await service.createBusinessUnitOpportunity({
			companyId: company.id,
			contactId: contact.id,
			targetBusinessUnit: TARGET_KEY,
			name: "LL97 controls opportunity",
			useCase: "LL97",
		});
		expect(opportunity.businessUnit.id).toBe(target.id);
		expect(opportunity.companyId).toBe(company.id);
		expect(opportunity.contactId).toBe(contact.id);

		const persistedCompany = await db.company.findUniqueOrThrow({
			where: { id: company.id },
			select: { businessUnitId: true },
		});
		expect(persistedCompany.businessUnitId).toBe(source.id);

		const deal = await db.deal.findUniqueOrThrow({
			where: { id: opportunity.dealId },
			select: {
				businessUnitId: true,
				companyId: true,
				contacts: { select: { contactId: true } },
			},
		});
		expect(deal.businessUnitId).toBe(target.id);
		expect(deal.companyId).toBe(company.id);
		expect(deal.contacts.map((row) => row.contactId)).toContain(contact.id);

		expect(await db.company.count({ where: { name: COMPANY_NAME } })).toBe(
			before.companies,
		);
		expect(await db.contact.count({ where: { email: CONTACT_EMAIL } })).toBe(
			before.contacts,
		);

		const reusedHit = await contactSearch("Building Manager", contact.id);
		expect(reusedHit?.sourceBusinessUnit?.id).toBe(source.id);
		expect(reusedHit?.associatedBusinessUnits).toContainEqual({
			id: target.id,
			key: TARGET_KEY,
			name: "EnergyBMS",
		});

		const associations = await service.recordAssociations(
			"contact",
			contact.id,
		);
		expect(associations).toHaveLength(1);
		expect(associations[0]?.targetBusinessUnit.id).toBe(target.id);
	});
});
