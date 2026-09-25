import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import type { CompaniesService } from "../src/companies/companies.service";
import { IngestService } from "../src/ingest/ingest.service";

const SOURCE = "business-unit-isolation-test";
const ingest = new IngestService(db, {} as CompaniesService);

beforeEach(async () => {
	await db.sourceRecord.deleteMany({ where: { sourceSystem: SOURCE } });
});

afterAll(async () => {
	await db.sourceRecord.deleteMany({ where: { sourceSystem: SOURCE } });
});

describe("project-scoped lead ingestion", () => {
	it("keeps the same external lead separate across business units", async () => {
		const common = {
			source: SOURCE,
			sourceType: "lead",
			sourceId: "same-external-id",
			entity: "Example Buyer",
			tags: [],
			payload: { company: "Example Buyer" },
		};

		const dataGear = await ingest.signal({ ...common, project: "data-gear" });
		const partWall = await ingest.signal({ ...common, project: "partwall" });

		expect(dataGear.sourceRecordId).not.toBe(partWall.sourceRecordId);
		expect(dataGear.deduplicated).toBe(false);
		expect(partWall.deduplicated).toBe(false);

		const repeated = await ingest.signal({ ...common, project: "data-gear" });
		expect(repeated.sourceRecordId).toBe(dataGear.sourceRecordId);
		expect(repeated.deduplicated).toBe(true);
	});

	it("returns per-record outcomes for a project batch", async () => {
		const result = await ingest.batch({
			project: "516labs",
			signals: [
				{
					source: SOURCE,
					sourceType: "lead",
					sourceId: "batch-1",
					entity: "Buyer One",
					payload: {},
					tags: [],
				},
				{
					source: SOURCE,
					sourceType: "lead",
					sourceId: "batch-2",
					entity: "Buyer Two",
					payload: {},
					tags: [],
				},
			],
		});

		expect(result.accepted).toBe(2);
		expect(result.failed).toBe(0);
		expect(result.deduplicated).toBe(0);
	});
});
