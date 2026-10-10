import { describe, expect, it } from "bun:test";
import { type Db, OutreachMode, OutreachStatus, Prisma } from "@crm/db";
import { OutreachService } from "../src/outreach/outreach.service";
import {
	DATAGEAR_SENDER,
	DATAGEAR_SIGNATURE,
	dataGearOutboundBody,
} from "../src/outreach/outreach-config";

const dataGear = {
	id: "bu-data-gear",
	key: "data-gear",
	name: "Data-Gear",
	enabled: true,
};

const otherUnit = {
	id: "bu-516labs",
	key: "516labs",
	name: "516 Labs",
};

const company = {
	id: "company-lambda",
	name: "Lambda",
	domain: "lambda.ai",
	website: "https://lambda.ai",
	archivedAt: null,
	businessUnitId: null,
	businessUnit: null,
};

function row(overrides: Partial<Record<string, unknown>> = {}) {
	const now = new Date("2026-10-07T12:00:00.000Z");
	return {
		id: "reservation-1",
		companyId: company.id,
		contactId: null,
		businessUnitId: dataGear.id,
		businessUnit: dataGear,
		company: { id: company.id, name: company.name },
		outreachMode: OutreachMode.NEW_OUTREACH,
		campaignType: null,
		purpose: "test",
		senderIdentity: DATAGEAR_SENDER,
		recipientEmail: "sales@lambda.ai",
		subject: "Test subject",
		status: OutreachStatus.SENT,
		provider: "resend",
		providerMessageId: null,
		reservationKey: "history:1",
		idempotencyKey: "history:1",
		metadata: null,
		notes: null,
		errorReason: null,
		createdAt: now,
		reservedAt: now,
		queuedAt: null,
		sentAt: now,
		deliveredAt: null,
		bouncedAt: null,
		failedAt: null,
		updatedAt: now,
		...overrides,
	};
}

type MailboxHistoryRow = {
	sentAt: Date;
	thread: { contactId: string | null };
};

function serviceWithHistory(
	initial: ReturnType<typeof row>[] = [],
	options: {
		company?: Omit<typeof company, "businessUnit"> & {
			businessUnit: typeof dataGear | null;
		};
		associations?: { targetBusinessUnit: typeof otherUnit }[];
		mailboxMessages?: MailboxHistoryRow[];
	} = {},
) {
	const resolvedCompany = options.company ?? company;
	let history = initial;
	let claimed = false;
	let created = 0;
	const db = {
		businessUnit: {
			findUnique: async ({
				where,
			}: {
				where: { key?: string; id?: string };
			}) => (where.key ? dataGear : dataGear),
		},
		company: {
			findUnique: async () => resolvedCompany,
			findMany: async () => [resolvedCompany],
		},
		contact: {
			findUnique: async () => null,
			findFirst: async () => null,
		},
		businessUnitRecordAssociation: {
			findMany: async () => options.associations ?? [],
		},
		emailMessage: {
			findMany: async () => options.mailboxMessages ?? [],
		},
		suppressedContact: {
			findUnique: async () => null,
		},
		suppressedDomain: {
			findUnique: async () => null,
		},
		outreachLedger: {
			findMany: async () => history,
			findUnique: async ({ where }: { where: { idempotencyKey?: string } }) =>
				history.find((item) => item.idempotencyKey === where.idempotencyKey) ??
				null,
			findFirst: async () => history[0] ?? null,
			create: async ({ data }: { data: Record<string, unknown> }) => {
				if (claimed) {
					throw new Prisma.PrismaClientKnownRequestError("duplicate", {
						code: "P2002",
						clientVersion: "7.9.1",
					});
				}
				claimed = true;
				created += 1;
				const createdRow = row({
					...data,
					id: `reservation-${created}`,
					company: { id: company.id, name: company.name },
					businessUnit: dataGear,
					status: OutreachStatus.RESERVED,
					createdAt: new Date(),
					reservedAt: new Date(),
					updatedAt: new Date(),
				});
				history = [createdRow];
				return createdRow;
			},
		},
	} as unknown as Db;
	return {
		service: new OutreachService(db),
		setHistory: (next: ReturnType<typeof row>[]) => {
			history = next;
		},
		getCreated: () => created,
	};
}

function input(overrides: Record<string, unknown> = {}) {
	return {
		companyId: company.id,
		companyName: company.name,
		domain: company.domain,
		contactId: null,
		recipientEmail: "enterprise@lambda.ai",
		targetBusinessUnit: "data-gear",
		outreachMode: "NEW_OUTREACH" as const,
		senderIdentity: DATAGEAR_SENDER,
		campaignType: "test",
		purpose: "safety test",
		subject: "Test subject",
		provider: "resend",
		originalReservationId: null,
		approvedCrossBusinessContact: false,
		jobId: null,
		metadata: null,
		notes: null,
		...overrides,
	};
}

describe("outreach safety", () => {
	it("blocks the same company when the mailbox changes", async () => {
		const { service } = serviceWithHistory([row()]);
		const result = await service.preflight(input());
		expect(result.status).toBe("FOLLOW_UP_REQUIRED");
		expect(result.newOutreachPermitted).toBe(false);
	});

	it("requires explicit bounced-route retry", async () => {
		const { service } = serviceWithHistory([
			row({ status: OutreachStatus.BOUNCED, bouncedAt: new Date() }),
		]);
		const result = await service.preflight(input());
		expect(result.status).toBe("BOUNCED_PREVIOUSLY");
		expect(result.newOutreachPermitted).toBe(false);
	});

	it("reports prior activity from another business unit", async () => {
		const { service, setHistory } = serviceWithHistory([]);
		setHistory([
			row({ businessUnitId: otherUnit.id, businessUnit: otherUnit }),
		]);
		const result = await service.preflight(input());
		expect(result.status).toBe("CROSS_BUSINESS_CONTACT");
		expect(result.existingBusinessUnitAssociations).toEqual([]);
	});

	it("blocks a new address after prior canonical mailbox contact in the same unit", async () => {
		const { service, getCreated } = serviceWithHistory([], {
			company: { ...company, businessUnit: dataGear },
			mailboxMessages: [
				{
					sentAt: new Date("2026-09-27T16:14:26.000Z"),
					thread: { contactId: "old-contact" },
				},
			],
		});
		const result = await service.preflight(input());

		expect(result.status).toBe("FOLLOW_UP_REQUIRED");
		expect(result.newOutreachPermitted).toBe(false);
		expect(result.priorCanonicalMailboxContact).toEqual({
			count: 1,
			latestSentAt: "2026-09-27T16:14:26.000Z",
			contactIds: ["old-contact"],
		});
		expect(getCreated()).toBe(0);
	});

	it("requires cross-business review for prior canonical mailbox contact", async () => {
		const { service } = serviceWithHistory([], {
			associations: [{ targetBusinessUnit: otherUnit }],
			mailboxMessages: [
				{
					sentAt: new Date("2026-09-27T16:14:26.000Z"),
					thread: { contactId: "old-contact" },
				},
			],
		});
		const result = await service.preflight(input());

		expect(result.status).toBe("CROSS_BUSINESS_CONTACT");
		expect(result.newOutreachPermitted).toBe(false);
		expect(result.priorCanonicalMailboxContact.count).toBe(1);
	});

	it("fails closed when prior canonical mailbox contact has no unit owner", async () => {
		const { service } = serviceWithHistory([], {
			mailboxMessages: [
				{
					sentAt: new Date("2026-09-27T16:14:26.000Z"),
					thread: { contactId: "old-contact" },
				},
			],
		});
		const result = await service.preflight(input());

		expect(result.status).toBe("OUTBOUND_DISABLED");
		expect(result.newOutreachPermitted).toBe(false);
		expect(result.priorCanonicalMailboxContact.count).toBe(1);
	});

	it("fails closed when CRM lookup fails", async () => {
		const { service } = serviceWithHistory([]);
		const unavailable = service as unknown as {
			db: { businessUnit: { findUnique: () => Promise<never> } };
		};
		unavailable.db.businessUnit.findUnique = async () => {
			throw new Error("database down");
		};
		const result = await service.preflight(input());
		expect(result.status).toBe("OUTBOUND_DISABLED");
	});

	it("enforces the exact Data-Gear signature", () => {
		expect(DATAGEAR_SIGNATURE).toBe(
			[
				"Danny Ramroop",
				"VP of Data Center Solutions Engineering",
				"Data-Gear",
				"516-400-6149",
				"sales@data-gear.com",
				"data-gear.com",
			].join("\n"),
		);
		expect(dataGearOutboundBody("Hello")).toContain(DATAGEAR_SIGNATURE);
	});

	it("allows exactly one concurrent initial reservation", async () => {
		const { service, getCreated } = serviceWithHistory([]);
		const [first, second] = await Promise.all([
			service.reserve(input({ idempotencyKey: "job-a" })),
			service.reserve(input({ idempotencyKey: "job-b" })),
		]);
		expect([first.status, second.status].sort()).toEqual([
			"BLOCKED_DUPLICATE",
			"RESERVED",
		]);
		expect(getCreated()).toBe(1);
	});

	it("does not create a second reservation on executor retry", async () => {
		const { service, getCreated } = serviceWithHistory([]);
		const first = await service.reserve(input({ idempotencyKey: "job-retry" }));
		const second = await service.reserve(
			input({ idempotencyKey: "job-retry" }),
		);
		expect(first.status).toBe("RESERVED");
		expect(second.status).toBe("BLOCKED_DUPLICATE");
		expect(getCreated()).toBe(1);
	});
});
