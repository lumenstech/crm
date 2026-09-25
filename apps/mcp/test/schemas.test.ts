import { describe, expect, it } from "bun:test";
import {
	associateRecordWithBusinessUnitInput,
	createBusinessUnitOpportunityInput,
	ingestLeadsInput,
	listRecordBusinessUnitsInput,
} from "../src/schemas";

describe("COMP CRM MCP schemas", () => {
	it("requires a business unit for lead ingestion", () => {
		expect(() =>
			ingestLeadsInput.parse({
				signals: [{ source: "test", sourceType: "lead", sourceId: "1" }],
			}),
		).toThrow();
	});

	it("accepts enabled-unit keys dynamically instead of hardcoding four units", () => {
		const parsed = ingestLeadsInput.parse({
			businessUnit: "data-gear",
			signals: [{ source: "test", sourceType: "lead", sourceId: "1" }],
		});
		expect(parsed.businessUnit).toBe("data-gear");

		const futureUnit = ingestLeadsInput.parse({
			businessUnit: "trustaccept",
			signals: [{ source: "test", sourceType: "lead", sourceId: "2" }],
		});
		expect(futureUnit.businessUnit).toBe("trustaccept");
	});

	it("validates record association inputs", () => {
		expect(
			listRecordBusinessUnitsInput.parse({
				recordType: "company",
				recordId: "company-1",
			}),
		).toEqual({ recordType: "company", recordId: "company-1" });

		expect(
			associateRecordWithBusinessUnitInput.parse({
				recordType: "company",
				recordId: "company-1",
				targetBusinessUnit: "data-gear",
			}).targetBusinessUnit,
		).toBe("data-gear");
	});

	it("requires company, business unit, and opportunity name", () => {
		const parsed = createBusinessUnitOpportunityInput.parse({
			companyId: "company-1",
			targetBusinessUnit: "data-gear",
			name: "GPU server procurement",
		});
		expect(parsed.name).toBe("GPU server procurement");
	});
});
