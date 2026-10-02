import { describe, expect, it } from "bun:test";
import {
	associateRecordWithBusinessUnitInput,
	createBusinessUnitOpportunityInput,
	ingestLeadsInput,
	listRecordInteractionsInput,
	recordInteractionInput,
} from "../src/schemas";

describe("ingest_leads schema", () => {
	it("requires a business unit", () => {
		expect(() =>
			ingestLeadsInput.parse({
				signals: [{ source: "test", sourceType: "lead", sourceId: "1" }],
			}),
		).toThrow();
	});

	it("accepts an explicit business-unit key and leaves existence checks to CRM", () => {
		const parsed = ingestLeadsInput.parse({
			businessUnit: "energybms",
			signals: [{ source: "test", sourceType: "lead", sourceId: "1" }],
		});
		expect(parsed.businessUnit).toBe("energybms");
	});

	it("rejects a blank business-unit key", () => {
		expect(() =>
			ingestLeadsInput.parse({
				businessUnit: " ",
				signals: [{ source: "test", sourceType: "lead", sourceId: "1" }],
			}),
		).toThrow();
	});
});

describe("cross-business-unit reuse schemas", () => {
	it("accepts explicit company reuse for another business unit", () => {
		const parsed = associateRecordWithBusinessUnitInput.parse({
			recordType: "company",
			recordId: "company-1",
			targetBusinessUnit: "lumens-technology",
			useCase: "LL97",
		});
		expect(parsed.targetBusinessUnit).toBe("lumens-technology");
		expect(parsed.useCase).toBe("LL97");
	});

	it("supports creating a business-unit opportunity without forcing ownerId", () => {
		const parsed = createBusinessUnitOpportunityInput.parse({
			companyId: "company-1",
			contactId: "contact-1",
			targetBusinessUnit: "energybms",
			name: "LL97 energy controls opportunity",
			useCase: "LL97",
		});
		expect(parsed.ownerId).toBeUndefined();
		expect(parsed.targetBusinessUnit).toBe("energybms");
	});
});


it("record interaction requires a CRM record anchor", () => {
	expect(
		recordInteractionInput.safeParse({
			channel: "whatsapp",
			direction: "inbound",
			body: "Need pricing on 8 B300 systems.",
		}).success).toBe(false);
	expect(
		recordInteractionInput.safeParse({
			channel: "whatsapp",
			direction: "inbound",
			body: "Need pricing on 8 B300 systems.",
			contactId: "contact_123",
			externalMessageId: "wamid.123",
		}).success).toBe(true);
});

it("record interaction validates WhatsApp attachments", () => {
	const parsed = recordInteractionInput.parse({
		channel: "whatsapp",
		direction: "inbound",
		companyId: "company_123",
		attachments: [
			{
				id: "media_123",
				name: "rfq.pdf",
				mediaType: "application/pdf",
			},
		],
	});
	expect(parsed.attachments.length).toBe(1);
});

it("list record interactions supports channel filtering", () => {
	const parsed = listRecordInteractionsInput.parse({
		companyId: "company_123",
		channel: "whatsapp",
	});
	expect(parsed.channel).toBe("whatsapp");
	expect(parsed.limit).toBe(30);
});
