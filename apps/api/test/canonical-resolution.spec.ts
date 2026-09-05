import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, type Prisma } from "@crm/db";
import { PromotionService } from "../src/ingest/promotion.service";
import { ResolutionService } from "../src/ingest/resolution.service";

const suffix = `resolution-${Date.now()}`;
const units = [
	{ id: `${suffix}-data`, key: `${suffix}-data`, name: "Data-Gear" },
	{ id: `${suffix}-deploy`, key: `${suffix}-deploy`, name: "DeployLocal" },
];
const dataUnit = units[0] as (typeof units)[number];
const deployUnit = units[1] as (typeof units)[number];
const sourceIds: string[] = [];
const promotion = new PromotionService(db);
const reviewerId = `${suffix}-reviewer`;

async function source(
	unitId: string,
	sourceId: string,
	payload: Prisma.InputJsonObject,
) {
	const id = `${suffix}-${sourceId}`;
	sourceIds.push(id);
	return db.sourceRecord.create({
		data: {
			id,
			businessUnitId: unitId,
			sourceSystem: "resolution-test",
			sourceType: "signal",
			sourceId,
			payload,
		},
	});
}

describe("canonical resolution promotion", () => {
	beforeAll(async () => db.businessUnit.createMany({ data: units }));
	afterAll(async () => {
		await db.resolutionCandidate.deleteMany({
			where: { review: { sourceRecordId: { in: sourceIds } } },
		});
		await db.resolutionReview.deleteMany({
			where: { sourceRecordId: { in: sourceIds } },
		});
		await db.promotionAudit.deleteMany({
			where: { sourceRecordId: { in: sourceIds } },
		});
		await db.recordMapping.deleteMany({
			where: { sourceRecordId: { in: sourceIds } },
		});
		const companies = await db.canonicalCompany.findMany({
			where: { displayName: { startsWith: "Resolution " } },
			select: { id: true, companyId: true },
		});
		const people = await db.canonicalPerson.findMany({
			where: { firstName: { startsWith: "Resolution" } },
			select: { id: true, contactId: true },
		});
		await db.canonicalOpportunity.deleteMany({
			where: { canonicalCompanyId: { in: companies.map((row) => row.id) } },
		});
		await db.canonicalCompany.deleteMany({
			where: { id: { in: companies.map((row) => row.id) } },
		});
		await db.canonicalPerson.deleteMany({
			where: { id: { in: people.map((row) => row.id) } },
		});
		await db.company.deleteMany({
			where: {
				id: {
					in: companies.flatMap((row) =>
						row.companyId ? [row.companyId] : [],
					),
				},
			},
		});
		await db.contact.deleteMany({
			where: {
				id: {
					in: people.flatMap((row) => (row.contactId ? [row.contactId] : [])),
				},
			},
		});
		await db.sourceRecord.deleteMany({ where: { id: { in: sourceIds } } });
		await db.businessUnit.deleteMany({
			where: { id: { in: units.map((unit) => unit.id) } },
		});
		await db.user.deleteMany({ where: { id: reviewerId } });
	});

	it("persists a company identifier and is idempotent across business units", async () => {
		const first = await source(dataUnit.id, "company-1", {
			entity: "company",
			company: {
				name: "Resolution Example",
				domain: `${suffix}.example`,
				externalId: "COMP-1",
			},
		});
		const result = await promotion.process(first.id);
		const second = await source(deployUnit.id, "company-2", {
			entity: "company",
			company: {
				name: "Resolution Example",
				domain: `${suffix}.example`,
				externalId: "COMP-1",
			},
		});
		const secondResult = await promotion.process(second.id);
		expect(result.status).toBe("promoted");
		expect(secondResult.canonicalId).toBe(result.canonicalId);
		expect(
			await db.canonicalCompanyIdentifier.count({
				where: { sourceSystem: "resolution-test", normalizedValue: "comp-1" },
			}),
		).toBe(1);
		expect(
			await db.canonicalCompanyBusinessUnit.count({
				where: { canonicalCompanyId: result.canonicalId },
			}),
		).toBe(2);
		expect(
			await db.company.count({ where: { domain: `${suffix}.example` } }),
		).toBe(1);
	});

	it("persists and resolves a source-scoped person identifier", async () => {
		const first = await source(dataUnit.id, "person-1", {
			entity: "person",
			person: {
				firstName: "Resolution Ada",
				email: `ada-${suffix}@example.test`,
				externalId: "PERSON-1",
			},
		});
		const result = await promotion.process(first.id);
		const second = await source(deployUnit.id, "person-2", {
			entity: "person",
			person: {
				firstName: "Resolution Ada",
				email: `other-${suffix}@example.test`,
				externalId: "PERSON-1",
			},
		});
		const secondResult = await promotion.process(second.id);
		expect(secondResult.canonicalId).toBe(result.canonicalId);
		expect(
			await db.canonicalPersonIdentifier.count({
				where: { sourceSystem: "resolution-test", normalizedValue: "person-1" },
			}),
		).toBe(1);
	});

	it("routes name-only repeats to review and executes approval", async () => {
		const first = await source(dataUnit.id, "ambiguous-1", {
			entity: "company",
			company: { name: "Resolution Ambiguous" },
		});
		await promotion.process(first.id);
		const second = await source(dataUnit.id, "ambiguous-2", {
			entity: "company",
			company: { name: "Resolution Ambiguous" },
		});
		const reviewResult = await promotion.process(second.id);
		if (!reviewResult.reviewId || !reviewResult.canonicalId)
			throw new Error("Expected an actionable review");
		await db.user.create({
			data: {
				id: reviewerId,
				name: "Resolution Reviewer",
				email: `${reviewerId}@example.test`,
			},
		});
		const decision = await new ResolutionService(db, promotion).decide(
			{
				reviewId: reviewResult.reviewId,
				decision: "approved_match",
				canonicalId: reviewResult.canonicalId,
				reason: "Exact reviewer confirmation",
			},
			reviewerId,
		);
		expect(decision.status).toBe("resolved");
		expect(
			await db.recordMapping.count({ where: { sourceRecordId: second.id } }),
		).toBe(1);
	});
});
