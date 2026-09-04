import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { IngestService } from "../src/ingest/ingest.service";

const suffix = `mcp-${Date.now()}`;
const service = new IngestService(db);
const dataUnit = {
	id: `${suffix}-data`,
	key: `${suffix}-data`,
	name: "Data-Gear",
};
const deployUnit = {
	id: `${suffix}-deploy`,
	key: `${suffix}-deploy`,
	name: "DeployLocal",
};
const businessUnits = [dataUnit, deployUnit];

describe("central signal ingestion", () => {
	beforeAll(async () => {
		await db.businessUnit.createMany({ data: businessUnits });
	});

	afterAll(async () => {
		await db.recordMapping.deleteMany({
			where: {
				sourceRecord: {
					businessUnitId: { in: businessUnits.map((unit) => unit.id) },
				},
			},
		});
		await db.sourceRecord.deleteMany({
			where: { businessUnitId: { in: businessUnits.map((unit) => unit.id) } },
		});
		await db.businessUnit.deleteMany({
			where: { id: { in: businessUnits.map((unit) => unit.id) } },
		});
	});

	it("stores provenance without creating or matching visible CRM records", async () => {
		const input = {
			project: dataUnit.key,
			source: "test",
			sourceType: "signal",
			sourceId: `${suffix}-company`,
			sourceUrl: "https://example.test/signal",
			entity: "Acme",
			tags: [],
			payload: { company: "Acme", nested: { fit: 9 } },
		};
		const accepted = await service.signal(input);
		const row = await db.sourceRecord.findUnique({
			where: { id: accepted.sourceRecordId },
		});

		expect(accepted.promoted).toBe(false);
		expect(row?.sourceUrl).toBe(input.sourceUrl);
		expect(row?.payload).toMatchObject(input.payload);
		expect(await db.company.count({ where: { name: "Acme" } })).toBe(0);
		expect(
			await db.contact.count({ where: { email: `${suffix}@example.test` } }),
		).toBe(0);
		expect(await db.deal.count({ where: { name: "Acme" } })).toBe(0);
	});

	it("deduplicates sequential and concurrent submissions per business unit", async () => {
		const input = {
			project: dataUnit.key,
			source: "test",
			sourceType: "signal",
			sourceId: `${suffix}-duplicate`,
			tags: [],
			payload: { version: 1 },
		};
		const first = await service.signal(input);
		const second = await service.signal({ ...input, payload: { version: 2 } });
		const concurrent = await Promise.all(
			Array.from({ length: 5 }, () => service.signal(input)),
		);
		const rows = await db.sourceRecord.count({
			where: { businessUnitId: dataUnit.id, sourceId: input.sourceId },
		});

		expect(second.sourceRecordId).toBe(first.sourceRecordId);
		expect(second.deduplicated).toBe(true);
		expect(
			concurrent.every(
				(result) => result.sourceRecordId === first.sourceRecordId,
			),
		).toBe(true);
		expect(rows).toBe(1);
	});

	it("keeps the same event distinct across business units", async () => {
		const sourceId = `${suffix}-multi-unit`;
		const [data, deploy] = await Promise.all(
			businessUnits.map((unit) =>
				service.signal({
					project: unit.key,
					source: "test",
					sourceType: "signal",
					sourceId,
					tags: [],
					payload: { interest: unit.key },
				}),
			),
		);
		if (!data || !deploy)
			throw new Error("Expected both business-unit writes.");
		expect(data.sourceRecordId).not.toBe(deploy.sourceRecordId);
		expect(await db.sourceRecord.count({ where: { sourceId } })).toBe(2);
	});
});
