import { describe, expect, test } from "bun:test";
import { buildCrmMobileRequest } from "../lib/crm-mobile-actions";

describe("mobile CRM action mapping", () => {
	test("searches globally through the existing REST service", () => {
		expect(buildCrmMobileRequest("search_crm", { q: "Mathpix" })).toEqual({
			method: "GET",
			path: "/rest/search?q=Mathpix",
		});
	});

	test("associates an existing record without creating a duplicate", () => {
		expect(
			buildCrmMobileRequest("associate_record_with_business_unit", {
				recordType: "company",
				recordId: "company-1",
				targetBusinessUnit: "data-gear",
			}),
		).toEqual({
			method: "POST",
			path: "/rest/business-units/associations",
			body: {
				recordType: "company",
				recordId: "company-1",
				targetBusinessUnit: "data-gear",
			},
		});
	});

	test("maps lead ingest to the isolated business-unit batch endpoint", () => {
		expect(
			buildCrmMobileRequest("ingest_leads", {
				businessUnit: "data-gear",
				signals: [
					{
						source: "chatgpt",
						sourceType: "prospect",
						sourceId: "lead-1",
						entity: "Example Co",
						tags: [],
						payload: {},
					},
				],
			}),
		).toEqual({
			method: "POST",
			path: "/rest/ingest/signals/batch",
			body: {
				project: "data-gear",
				signals: [
					{
						source: "chatgpt",
						sourceType: "prospect",
						sourceId: "lead-1",
						entity: "Example Co",
						tags: [],
						payload: {},
					},
				],
			},
		});
	});

	test("maps opportunity creation to the business-unit opportunity endpoint", () => {
		expect(
			buildCrmMobileRequest("create_business_unit_opportunity", {
				companyId: "company-1",
				targetBusinessUnit: "data-gear",
				name: "GPU order",
			}),
		).toEqual({
			method: "POST",
			path: "/rest/business-units/opportunities",
			body: {
				companyId: "company-1",
				targetBusinessUnit: "data-gear",
				name: "GPU order",
			},
		});
	});
});
