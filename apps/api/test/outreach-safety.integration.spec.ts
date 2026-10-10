import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ActivityType, db, EmailDirection } from "@crm/db";
import { reserveOutreachInput } from "../src/outreach/outreach.contracts";
import { OutreachService } from "../src/outreach/outreach.service";
import { DATAGEAR_SENDER } from "../src/outreach/outreach-config";

const suffix = process.env.TEST_RUN_ID ?? `b379f49-${Date.now()}`;
const dataGearKey = "data-gear";
const otherKey = `history-other-${suffix}`;
const dataGearSenderAddress = "sales@data-gear.com";
const service = new OutreachService(db);

let dataGearId: string;
let otherUnitId: string;
let dataGearCreated = false;

function input(
	company: { id: string; name: string; domain: string },
	overrides: {
		outreachMode?: "NEW_OUTREACH" | "FOLLOW_UP";
		idempotencyKey?: string;
		approvedCrossBusinessContact?: boolean;
	} = {},
) {
	return reserveOutreachInput.parse({
		companyId: company.id,
		companyName: company.name,
		domain: company.domain,
		recipientEmail: `buyer@${company.domain}`,
		targetBusinessUnit: dataGearKey,
		outreachMode: overrides.outreachMode ?? "NEW_OUTREACH",
		senderIdentity: DATAGEAR_SENDER,
		campaignType: "history-safety-test",
		purpose: "history safety test",
		subject: "History safety test",
		provider: "test",
		idempotencyKey: overrides.idempotencyKey ?? null,
		approvedCrossBusinessContact:
			overrides.approvedCrossBusinessContact ?? false,
		metadata: null,
		notes: null,
	});
}

async function createCompany(
	name: string,
	domain: string,
	businessUnitId?: string,
) {
	const company = await db.company.create({
		data: {
			name,
			domain,
			businessUnitId: businessUnitId ?? null,
		},
		select: { id: true, name: true, domain: true },
	});
	if (!company.domain) throw new Error("Test company domain was not stored.");
	return { ...company, domain: company.domain };
}

async function createOutboundHistory(
	companyId: string,
	options: { evidenceKey?: string; fromEmail?: string; suffix: string },
) {
	const sentAt = new Date("2026-09-27T16:14:26.000Z");
	const evidence = options.evidenceKey
		? {
				key: options.evidenceKey,
				source: "verified-sender",
				immutable: true,
			}
		: undefined;
	return db.emailThread.create({
		data: {
			rootMessageId: `<history-${options.suffix}@example.test>`,
			provider: "gmail",
			mailbox: dataGearSenderAddress,
			providerThreadId: `history-thread-${options.suffix}`,
			subject: "Historical outbound message",
			companyId,
			firstMessageAt: sentAt,
			lastMessageAt: sentAt,
			messageCount: 1,
			activity: {
				create: {
					type: ActivityType.EMAIL,
					subject: "Historical outbound message",
					body: "Historical body",
					occurredAt: sentAt,
					meta: evidence ? { sendingBusinessUnit: evidence } : undefined,
				},
			},
			messages: {
				create: {
					rfcMessageId: `<message-${options.suffix}@example.test>`,
					direction: EmailDirection.OUTBOUND,
					fromEmail: options.fromEmail ?? dataGearSenderAddress,
					recipients: [{ email: "buyer@example.test", kind: "to" }],
					subject: "Historical outbound message",
					snippet: "Historical body",
					body: "Historical body",
					sentAt,
				},
			},
		},
		select: { id: true },
	});
}

async function clean() {
	const companies = await db.company.findMany({
		where: { domain: { startsWith: `history-safety-${suffix}-` } },
		select: { id: true },
	});
	const companyIds = companies.map((company) => company.id);
	if (companyIds.length > 0) {
		await db.outreachLedger.deleteMany({
			where: { companyId: { in: companyIds } },
		});
		await db.emailThread.deleteMany({
			where: { companyId: { in: companyIds } },
		});
		await db.contact.deleteMany({ where: { companyId: { in: companyIds } } });
		await db.company.deleteMany({ where: { id: { in: companyIds } } });
	}
	await db.businessUnit.deleteMany({ where: { key: otherKey } });
}

beforeAll(async () => {
	await clean();
	const existingDataGear = await db.businessUnit.findUnique({
		where: { key: dataGearKey },
		select: { id: true },
	});
	const dataGear =
		existingDataGear ??
		(await db.businessUnit.create({
			data: { key: dataGearKey, name: "Data-Gear", enabled: true },
			select: { id: true },
		}));
	dataGearCreated = existingDataGear === null;
	const other = await db.businessUnit.create({
		data: { key: otherKey, name: "History Other", enabled: true },
		select: { id: true },
	});
	dataGearId = dataGear.id;
	otherUnitId = other.id;
});

afterAll(async () => {
	await clean();
	if (dataGearCreated) {
		await db.businessUnit.delete({ where: { id: dataGearId } });
	}
	await db.$disconnect();
});

describe("outreach history safety against the isolated database", () => {
	it("uses immutable sending evidence after company reassociation", async () => {
		const company = await createCompany(
			"History Safety Evidence",
			`history-safety-${suffix}-evidence.test`,
			dataGearId,
		);
		await createOutboundHistory(company.id, {
			evidenceKey: dataGearKey,
			suffix: `${suffix}-evidence`,
		});
		await db.company.update({
			where: { id: company.id },
			data: { businessUnitId: otherUnitId },
		});

		const result = await service.preflight(input(company));

		expect(result.status).toBe("FOLLOW_UP_REQUIRED");
		expect(result.newOutreachPermitted).toBe(false);
		expect(result.priorCanonicalMailboxContact.businessUnitKeys).toEqual([
			dataGearKey,
		]);
		const approved = await service.preflight(
			input(company, { approvedCrossBusinessContact: true }),
		);
		expect(approved.status).toBe("FOLLOW_UP_REQUIRED");
		expect(approved.newOutreachPermitted).toBe(false);
	});

	it("fails closed for unattributed outbound history after reassociation", async () => {
		const company = await createCompany(
			"History Safety Unattributed",
			`history-safety-${suffix}-unattributed.test`,
			otherUnitId,
		);
		await createOutboundHistory(company.id, {
			fromEmail: "legacy@unknown.example",
			suffix: `${suffix}-unattributed`,
		});

		const result = await service.preflight(input(company));

		expect(result.status).toBe("OUTBOUND_DISABLED");
		expect(result.newOutreachPermitted).toBe(false);
		expect(result.priorCanonicalMailboxContact.unattributedCount).toBe(1);
	});

	it("allows imported-only history to reserve an explicit follow-up", async () => {
		const company = await createCompany(
			"History Safety Follow Up",
			`history-safety-${suffix}-follow-up.test`,
			otherUnitId,
		);
		await createOutboundHistory(company.id, {
			evidenceKey: dataGearKey,
			suffix: `${suffix}-follow-up`,
		});

		const result = await service.reserve(
			input(company, {
				outreachMode: "FOLLOW_UP",
				idempotencyKey: `${suffix}-follow-up-reservation`,
			}),
		);

		expect(result.status).toBe("RESERVED");
		if (result.status !== "RESERVED" || !result.reservationId) {
			throw new Error("Imported-only follow-up was not reserved.");
		}
		expect(
			await db.outreachLedger.count({ where: { companyId: company.id } }),
		).toBe(1);
	});

	it("serializes concurrent new reservations and rechecks terminal history", async () => {
		const company = await createCompany(
			"History Safety Race",
			`history-safety-${suffix}-race.test`,
		);
		const [first, second] = await Promise.all([
			service.reserve(input(company, { idempotencyKey: `${suffix}-race-a` })),
			service.reserve(input(company, { idempotencyKey: `${suffix}-race-b` })),
		]);

		expect([first.status, second.status].sort()).toEqual([
			"BLOCKED_DUPLICATE",
			"RESERVED",
		]);
		expect(
			await db.outreachLedger.count({ where: { companyId: company.id } }),
		).toBe(1);

		const reserved = first.status === "RESERVED" ? first : second;
		if (reserved.status !== "RESERVED" || !reserved.reservationId) {
			throw new Error("Reservation was not created.");
		}
		await service.finalize({
			reservationId: reserved.reservationId,
			status: "SENT",
			provider: "test",
			providerMessageId: `${suffix}-sent-message`,
			sentAt: "2026-10-10T00:00:00.000Z",
		});

		const afterSent = await service.reserve(
			input(company, { idempotencyKey: `${suffix}-race-after-sent` }),
		);
		expect(afterSent.status).toBe("FOLLOW_UP_REQUIRED");
		expect(
			await db.outreachLedger.count({ where: { companyId: company.id } }),
		).toBe(1);
	});
});