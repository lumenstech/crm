import { createHash } from "node:crypto";
import {
	type Db,
	EmailDirection,
	OutreachMode,
	OutreachStatus,
	Prisma,
} from "@crm/db";
import { jsonObject } from "@crm/db/json";
import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { normalizeDomain } from "../companies/domain";
import { InjectDatabase } from "../database/database.constants";
import type {
	FinalizeOutreachInput,
	ListCompanyOutreachHistoryInput,
	PreflightOutreachInput,
	ReserveOutreachInput,
} from "./outreach.contracts";
import {
	DATAGEAR_OUTBOUND_V1,
	DATAGEAR_SENDER,
	dataGearOutboundBody,
} from "./outreach-config";

const INITIAL_HISTORY_STATUSES: OutreachStatus[] = [
	OutreachStatus.RESERVED,
	OutreachStatus.QUEUED,
	OutreachStatus.SENT,
	OutreachStatus.DELIVERED,
	OutreachStatus.BOUNCED,
	OutreachStatus.FAILED,
];

const ACTIVE_STATUSES: OutreachStatus[] = [
	OutreachStatus.RESERVED,
	OutreachStatus.QUEUED,
];

const companySelect = {
	id: true,
	name: true,
	domain: true,
	website: true,
	archivedAt: true,
	businessUnitId: true,
	businessUnit: { select: { id: true, key: true, name: true } },
} as const;

const historyInclude = {
	businessUnit: { select: { id: true, key: true, name: true } },
	company: { select: { id: true, name: true } },
} as const;

type CompanyRecord = Prisma.CompanyGetPayload<{ select: typeof companySelect }>;

type CompanyResolution = {
	company: CompanyRecord | null;
	contactId: string | null;
	matchedIdentifiers: {
		kind:
			| "companyId"
			| "contactId"
			| "companyName"
			| "domain"
			| "recipientEmail";
		value: string;
	}[];
	status: "resolved" | "unverified" | "ambiguous";
};

type PriorMailboxHistory = {
	count: number;
	latestSentAt: string | null;
	contactIds: string[];
};

@Injectable()
export class OutreachService {
	private readonly logger = new Logger(OutreachService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async preflight(input: PreflightOutreachInput) {
		try {
			const target = await this.db.businessUnit.findUnique({
				where: { key: input.targetBusinessUnit },
				select: { id: true, key: true, name: true, enabled: true },
			});
			if (!target?.enabled)
				return this.disabled("The target business unit is unavailable.");

			const identity = this.senderFor(target.key, input.senderIdentity);
			if (!identity.ok) return this.disabled(identity.reason);
			if (!input.recipientEmail) {
				return {
					status: "UNVERIFIED_ROUTE" as const,
					canonicalCompanyId: null,
					canonicalCompanyName: null,
					matchedIdentifiers: [],
					existingBusinessUnitAssociations: [],
					previousOutreach: [],
					priorCanonicalMailboxContact: emptyMailboxHistory(),
					newOutreachPermitted: false,
					reason:
						"A verified recipient email is required before outbound activity.",
					requiredNextAction:
						"Resolve a verified contact route through the CRM before reserving outreach.",
					senderIdentity: identity.sender,
					template: identity.template,
				};
			}

			const resolution = await this.findCompany(input);
			if (resolution.status !== "resolved" || !resolution.company) {
				return {
					status:
						resolution.status === "ambiguous"
							? "AMBIGUOUS_COMPANY"
							: "UNVERIFIED_ROUTE",
					canonicalCompanyId: null,
					canonicalCompanyName: null,
					matchedIdentifiers: resolution.matchedIdentifiers,
					existingBusinessUnitAssociations: [],
					previousOutreach: [],
					priorCanonicalMailboxContact: emptyMailboxHistory(),
					newOutreachPermitted: false,
					reason:
						resolution.status === "ambiguous"
							? "More than one canonical company matches the supplied identifiers."
							: "No canonical CRM company matches the supplied identifiers.",
					requiredNextAction:
						"Resolve one canonical CRM company before outbound activity.",
					senderIdentity: identity.sender,
					template: identity.template,
				};
			}

			const [
				associations,
				history,
				suppressedContact,
				suppressedDomain,
				originalReservation,
				canonicalMailboxMessages,
			] = await Promise.all([
				this.db.businessUnitRecordAssociation.findMany({
					where: { recordType: "company", recordId: resolution.company.id },
					select: {
						targetBusinessUnit: {
							select: { id: true, key: true, name: true },
						},
					},
				}),
				this.db.outreachLedger.findMany({
					where: { companyId: resolution.company.id },
					include: historyInclude,
					orderBy: { createdAt: "asc" },
					take: 100,
				}),
				input.recipientEmail
					? this.db.suppressedContact.findUnique({
							where: { email: input.recipientEmail.toLowerCase() },
						})
					: Promise.resolve(null),
				this.db.suppressedDomain.findUnique({
					where: {
						domain:
							normalizeDomain(
								input.domain ?? input.recipientEmail?.split("@").at(-1),
							) ?? "",
					},
				}),
				input.originalReservationId
					? this.db.outreachLedger.findUnique({
							where: { id: input.originalReservationId },
							select: {
								id: true,
								companyId: true,
								businessUnitId: true,
								status: true,
							},
						})
					: Promise.resolve(null),
				this.db.emailMessage.findMany({
					where: {
						direction: EmailDirection.OUTBOUND,
						thread: { companyId: resolution.company.id },
					},
					select: {
						sentAt: true,
						thread: { select: { contactId: true } },
					},
					orderBy: { sentAt: "desc" },
					take: 100,
				}),
			]);

			const existingBusinessUnitAssociations = [
				...(resolution.company.businessUnit
					? [resolution.company.businessUnit]
					: []),
				...associations.map((row) => row.targetBusinessUnit),
			].filter(
				(unit, index, rows) =>
					rows.findIndex((candidate) => candidate.id === unit.id) === index,
			);
			const previousOutreach = history.map((row) => this.serialize(row));
			const targetHistory = history.filter(
				(row) => row.businessUnitId === target.id,
			);
			const active = targetHistory.find((row) =>
				ACTIVE_STATUSES.includes(row.status),
			);
			const bounced = targetHistory.some(
				(row) => row.status === OutreachStatus.BOUNCED,
			);
			const attempted = targetHistory.some((row) =>
				INITIAL_HISTORY_STATUSES.includes(row.status),
			);
			const otherBusinessActivity = history.some(
				(row) => row.businessUnitId !== target.id,
			);
			const priorCanonicalMailboxContact = {
				count: canonicalMailboxMessages.length,
				latestSentAt: canonicalMailboxMessages[0]?.sentAt.toISOString() ?? null,
				contactIds: [
					...new Set(
						canonicalMailboxMessages
							.map((message) => message.thread.contactId)
							.filter((contactId): contactId is string => contactId !== null),
					),
				],
			};
			const retryPermitted = Boolean(
				originalReservation &&
					originalReservation.companyId === resolution.company.id &&
					originalReservation.businessUnitId === target.id &&
					originalReservation.status === OutreachStatus.BOUNCED,
			);

			if (suppressedContact || suppressedDomain) {
				return this.decision(
					"SUPPRESSED",
					resolution,
					matchedIdentifiers(resolution, input),
					existingBusinessUnitAssociations,
					previousOutreach,
					false,
					"The recipient route is suppressed.",
					"Remove the suppression through the approved CRM workflow before review.",
					identity,
				);
			}

			if (active) {
				return this.decision(
					"IN_FLIGHT",
					resolution,
					matchedIdentifiers(resolution, input),
					existingBusinessUnitAssociations,
					previousOutreach,
					false,
					"An active outreach reservation already exists for this company and business unit.",
					"Use the existing reservation and do not submit another message.",
					identity,
				);
			}

			if (input.outreachMode === "RETRY_BOUNCED_ROUTE" && bounced) {
				return this.decision(
					"BOUNCED_PREVIOUSLY",
					resolution,
					matchedIdentifiers(resolution, input),
					existingBusinessUnitAssociations,
					previousOutreach,
					false,
					"The company has a bounced outreach attempt. A route retry needs its original reservation context.",
					retryPermitted
						? null
						: "Provide the original reservation ID for explicit retry review.",
					identity,
				);
			}

			if (input.outreachMode === "FOLLOW_UP" && attempted) {
				return this.decision(
					"EXISTING_ACCOUNT",
					resolution,
					matchedIdentifiers(resolution, input),
					existingBusinessUnitAssociations,
					previousOutreach,
					false,
					"This company has existing outreach history in the target business unit.",
					"Use the existing company history and thread context for the follow-up.",
					identity,
				);
			}

			if (attempted) {
				return this.decision(
					bounced ? "BOUNCED_PREVIOUSLY" : "FOLLOW_UP_REQUIRED",
					resolution,
					matchedIdentifiers(resolution, input),
					existingBusinessUnitAssociations,
					previousOutreach,
					false,
					bounced
						? "This company was already attempted and includes a bounced route."
						: "This company already has outreach history in the target business unit.",
					bounced
						? "Use RETRY_BOUNCED_ROUTE with the original reservation ID."
						: "Use FOLLOW_UP with the existing company history.",
					identity,
				);
			}

			if (priorCanonicalMailboxContact.count > 0) {
				const targetOwnsCompany = existingBusinessUnitAssociations.some(
					(unit) => unit.id === target.id,
				);
				if (targetOwnsCompany) {
					return this.decision(
						"FOLLOW_UP_REQUIRED",
						resolution,
						matchedIdentifiers(resolution, input),
						existingBusinessUnitAssociations,
						previousOutreach,
						false,
						"Canonical outbound mailbox history shows prior contact with this company.",
						"Review the existing canonical mailbox thread before any new outreach.",
						identity,
						priorCanonicalMailboxContact,
					);
				}
				if (existingBusinessUnitAssociations.length > 0) {
					return this.decision(
						"CROSS_BUSINESS_CONTACT",
						resolution,
						matchedIdentifiers(resolution, input),
						existingBusinessUnitAssociations,
						previousOutreach,
						input.outreachMode === "NEW_OUTREACH" &&
							input.approvedCrossBusinessContact,
						"Canonical outbound mailbox history exists under another business unit.",
						input.approvedCrossBusinessContact
							? null
							: "Obtain explicit cross-business review before reserving new outreach.",
						identity,
						priorCanonicalMailboxContact,
					);
				}
				return this.decision(
					"OUTBOUND_DISABLED",
					resolution,
					matchedIdentifiers(resolution, input),
					existingBusinessUnitAssociations,
					previousOutreach,
					false,
					"Canonical outbound mailbox history has no business-unit ownership.",
					"Assign the canonical company to a business unit through the approved CRM workflow before outreach.",
					identity,
					priorCanonicalMailboxContact,
				);
			}

			if (otherBusinessActivity && input.outreachMode === "NEW_OUTREACH") {
				return this.decision(
					"CROSS_BUSINESS_CONTACT",
					resolution,
					matchedIdentifiers(resolution, input),
					existingBusinessUnitAssociations,
					previousOutreach,
					input.approvedCrossBusinessContact,
					"Another business unit has prior outreach history for this canonical company.",
					input.approvedCrossBusinessContact
						? null
						: "Obtain explicit cross-business review before reserving new outreach.",
					identity,
				);
			}

			return this.decision(
				"CLEAR_NEW_ACCOUNT",
				resolution,
				matchedIdentifiers(resolution, input),
				existingBusinessUnitAssociations,
				previousOutreach,
				input.outreachMode === "NEW_OUTREACH",
				"No prior outreach exists for the canonical company in the target business unit.",
				"Create an atomic reservation before submitting any email.",
				identity,
			);
		} catch (error) {
			this.logger.error(
				{ message: "Outreach preflight failed closed" },
				error instanceof Error ? error.stack : String(error),
			);
			return this.disabled("CRM state could not be verified.");
		}
	}

	async reserve(input: ReserveOutreachInput) {
		const idempotencyKey =
			input.idempotencyKey?.trim() || this.derivedIdempotencyKey(input);
		try {
			const existing = await this.db.outreachLedger.findUnique({
				where: { idempotencyKey },
				include: historyInclude,
			});
			if (existing)
				return this.duplicate(
					existing,
					idempotencyKey,
					"The idempotency key already has a reservation.",
				);
		} catch (error) {
			this.logger.error(
				{ message: "Outreach idempotency check failed closed" },
				error instanceof Error ? error.stack : String(error),
			);
			return {
				status: "OUTBOUND_DISABLED" as const,
				reservationId: null,
				reservationKey: null,
				idempotencyKey,
				canonicalCompanyId: null,
				canonicalCompanyName: null,
				senderIdentity: null,
				template: null,
				duplicate: false,
				reason: "The CRM idempotency state could not be read.",
				requiredNextAction:
					"Do not send. Restore CRM availability and rerun the reservation.",
				reservation: null,
			};
		}
		const preflight = await this.preflight(input);
		const allowed = this.allowedReservation(
			input,
			preflight.status,
			preflight.newOutreachPermitted,
			preflight.requiredNextAction === null,
		);
		if (!allowed) {
			return {
				status: preflight.status,
				reservationId: null,
				reservationKey: null,
				idempotencyKey,
				canonicalCompanyId: preflight.canonicalCompanyId,
				canonicalCompanyName: preflight.canonicalCompanyName,
				senderIdentity: preflight.senderIdentity,
				template: preflight.template,
				duplicate: false,
				reason: preflight.reason,
				requiredNextAction: preflight.requiredNextAction,
				reservation: null,
			};
		}

		try {
			const company = await this.db.company.findUnique({
				where: { id: preflight.canonicalCompanyId ?? "" },
				select: { id: true },
			});
			const target = await this.db.businessUnit.findUnique({
				where: { key: input.targetBusinessUnit },
				select: { id: true, key: true },
			});
			if (!company || !target)
				return this.disabled("CRM state changed before reservation.");

			const sender = preflight.senderIdentity ?? input.senderIdentity ?? "";
			const reservationKey = `outreach:${target.key}:${company.id}:${input.outreachMode}:${idempotencyKey}`;
			const row = await this.db.outreachLedger.create({
				data: {
					companyId: company.id,
					contactId: input.contactId ?? null,
					businessUnitId: target.id,
					outreachMode: input.outreachMode,
					campaignType: input.campaignType ?? null,
					purpose: input.purpose ?? null,
					senderIdentity: sender,
					recipientEmail: input.recipientEmail?.toLowerCase() ?? "",
					subject: input.subject,
					status: OutreachStatus.RESERVED,
					provider: input.provider,
					reservationKey,
					idempotencyKey,
					metadata: input.metadata
						? (input.metadata as Prisma.InputJsonValue)
						: undefined,
					notes: input.notes ?? null,
				},
				include: historyInclude,
			});
			return {
				status: "RESERVED" as const,
				reservationId: row.id,
				reservationKey: row.reservationKey,
				idempotencyKey,
				canonicalCompanyId: row.companyId,
				canonicalCompanyName: preflight.canonicalCompanyName,
				senderIdentity: row.senderIdentity,
				template: preflight.template,
				duplicate: false,
				reason: "Atomic outreach reservation created.",
				requiredNextAction:
					"Submit the approved payload, then finalize this reservation.",
				reservation: this.serialize(row),
			};
		} catch (error) {
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2002"
			) {
				const existing = await this.db.outreachLedger.findFirst({
					where: {
						OR: [
							{ idempotencyKey },
							{
								companyId: preflight.canonicalCompanyId ?? "",
								businessUnit: { key: input.targetBusinessUnit },
								outreachMode: OutreachMode.NEW_OUTREACH,
								status: { in: [...ACTIVE_STATUSES] },
							},
						],
					},
					include: historyInclude,
					orderBy: { createdAt: "asc" },
				});
				if (existing)
					return this.duplicate(
						existing,
						idempotencyKey,
						"A concurrent or existing reservation already claims this company.",
					);
			}
			this.logger.error(
				{ message: "Outreach reservation failed closed" },
				error instanceof Error ? error.stack : String(error),
			);
			return {
				status: "OUTBOUND_DISABLED" as const,
				reservationId: null,
				reservationKey: null,
				idempotencyKey,
				canonicalCompanyId: preflight.canonicalCompanyId,
				canonicalCompanyName: preflight.canonicalCompanyName,
				senderIdentity: preflight.senderIdentity,
				template: preflight.template,
				duplicate: false,
				reason: "The reservation transaction failed.",
				requiredNextAction:
					"Do not send. Resolve the CRM transaction failure and rerun preflight.",
				reservation: null,
			};
		}
	}

	async finalize(input: FinalizeOutreachInput) {
		const existing = await this.db.outreachLedger.findUnique({
			where: { id: input.reservationId },
			include: historyInclude,
		});
		if (!existing)
			throw new ConflictException("The outreach reservation does not exist.");
		if (
			input.recipientEmail &&
			input.recipientEmail.toLowerCase() !== existing.recipientEmail
		) {
			throw new ConflictException(
				"The finalized recipient differs from the reserved recipient.",
			);
		}
		if (
			existing.providerMessageId &&
			input.providerMessageId &&
			existing.providerMessageId !== input.providerMessageId
		) {
			throw new ConflictException(
				"The reservation already has a different provider message ID.",
			);
		}
		if (isTerminal(existing.status) && existing.status !== input.status) {
			throw new ConflictException(
				"The reservation already has a terminal status.",
			);
		}

		const now = new Date();
		const data: Prisma.OutreachLedgerUpdateInput = {
			status: input.status,
			provider: input.provider ?? existing.provider,
			providerMessageId: input.providerMessageId ?? existing.providerMessageId,
			queuedAt: dateOrNow(
				input.queuedAt,
				input.status === "QUEUED" ? now : existing.queuedAt,
			),
			sentAt: dateOrNow(
				input.sentAt,
				input.status === "SENT" ? now : existing.sentAt,
			),
			deliveredAt: dateOrNow(
				input.deliveredAt,
				input.status === "DELIVERED" ? now : existing.deliveredAt,
			),
			bouncedAt: dateOrNow(
				input.bouncedAt,
				input.status === "BOUNCED" ? now : existing.bouncedAt,
			),
			failedAt: dateOrNow(
				input.failedAt,
				input.status === "FAILED" ? now : existing.failedAt,
			),
			errorReason: input.failureReason ?? existing.errorReason,
			metadata: input.metadata
				? (input.metadata as Prisma.InputJsonValue)
				: (existing.metadata ?? undefined),
		};
		try {
			const row = await this.db.outreachLedger.update({
				where: { id: existing.id },
				data,
				include: historyInclude,
			});
			return this.serialize(row);
		} catch (error) {
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2002" &&
				input.providerMessageId
			) {
				const duplicate = await this.db.outreachLedger.findUnique({
					where: { providerMessageId: input.providerMessageId },
					include: historyInclude,
				});
				if (duplicate?.id === existing.id) return this.serialize(duplicate);
			}
			throw error;
		}
	}

	async history(input: ListCompanyOutreachHistoryInput) {
		const where: Prisma.OutreachLedgerWhereInput = {
			companyId: input.companyId,
		};
		if (input.targetBusinessUnit) {
			where.businessUnit = { key: input.targetBusinessUnit };
		}
		const rows = await this.db.outreachLedger.findMany({
			where,
			include: historyInclude,
			orderBy: { createdAt: "asc" },
		});
		return {
			companyId: input.companyId,
			rows: rows.map((row) => this.serialize(row)),
		};
	}

	buildDataGearPayload(body: string) {
		return {
			from: DATAGEAR_SENDER,
			template: DATAGEAR_OUTBOUND_V1,
			text: dataGearOutboundBody(body),
		};
	}

	private async findCompany(
		input: PreflightOutreachInput,
	): Promise<CompanyResolution> {
		const candidates = new Map<string, CompanyRecord>();
		const identifiers: CompanyResolution["matchedIdentifiers"] = [];
		let contactId: string | null = input.contactId ?? null;

		if (input.companyId) {
			const company = await this.db.company.findUnique({
				where: { id: input.companyId },
				select: companySelect,
			});
			if (company && !company.archivedAt) {
				candidates.set(company.id, company);
				identifiers.push({ kind: "companyId", value: input.companyId });
			}
		}

		if (input.contactId) {
			const contact = await this.db.contact.findUnique({
				where: { id: input.contactId },
				select: { id: true, email: true, company: { select: companySelect } },
			});
			if (contact?.company && !contact.company.archivedAt) {
				candidates.set(contact.company.id, contact.company);
				contactId = contact.id;
				identifiers.push({ kind: "contactId", value: input.contactId });
			}
		}

		if (input.recipientEmail) {
			const contact = await this.db.contact.findFirst({
				where: {
					email: {
						equals: input.recipientEmail.toLowerCase(),
						mode: "insensitive",
					},
					archivedAt: null,
				},
				select: { id: true, company: { select: companySelect } },
			});
			if (contact?.company && !contact.company.archivedAt) {
				candidates.set(contact.company.id, contact.company);
				contactId ??= contact.id;
				identifiers.push({
					kind: "recipientEmail",
					value: input.recipientEmail.toLowerCase(),
				});
			}
		}

		const domain = normalizeDomain(
			input.domain ?? input.recipientEmail?.split("@").at(-1),
		);
		if (domain) {
			const companies = await this.db.company.findMany({
				where: {
					archivedAt: null,
					domain: { equals: domain, mode: "insensitive" },
				},
				select: companySelect,
			});
			for (const company of companies) candidates.set(company.id, company);
			if (companies.length > 0)
				identifiers.push({ kind: "domain", value: domain });
		}

		if (input.companyName) {
			const companies = await this.db.company.findMany({
				where: {
					archivedAt: null,
					name: { equals: input.companyName, mode: "insensitive" },
				},
				select: companySelect,
			});
			for (const company of companies) candidates.set(company.id, company);
			if (companies.length > 0)
				identifiers.push({ kind: "companyName", value: input.companyName });
		}

		const values = [...candidates.values()];
		return {
			company: values.length === 1 ? (values[0] ?? null) : null,
			contactId,
			matchedIdentifiers: identifiers,
			status:
				values.length === 0
					? "unverified"
					: values.length === 1
						? "resolved"
						: "ambiguous",
		} satisfies CompanyResolution;
	}

	private senderFor(
		targetBusinessUnit: string,
		requested: string | null | undefined,
	) {
		if (targetBusinessUnit !== "data-gear")
			return { ok: true as const, sender: requested ?? null, template: null };
		if (requested && requested !== DATAGEAR_SENDER) {
			return {
				ok: false as const,
				reason: "Data-Gear outbound requires the approved sender identity.",
			};
		}
		return {
			ok: true as const,
			sender: DATAGEAR_SENDER,
			template: DATAGEAR_OUTBOUND_V1,
		};
	}

	private allowedReservation(
		input: ReserveOutreachInput,
		status: string,
		newOutreachPermitted: boolean,
		retryPermitted: boolean,
	): boolean {
		if (input.outreachMode === "NEW_OUTREACH") {
			return (
				newOutreachPermitted &&
				(status === "CLEAR_NEW_ACCOUNT" ||
					(status === "CROSS_BUSINESS_CONTACT" &&
						input.approvedCrossBusinessContact))
			);
		}
		if (input.outreachMode === "FOLLOW_UP")
			return status === "EXISTING_ACCOUNT";
		return (
			status === "BOUNCED_PREVIOUSLY" &&
			retryPermitted &&
			Boolean(input.originalReservationId)
		);
	}

	private decision(
		status: string,
		resolution: CompanyResolution,
		matched: CompanyResolution["matchedIdentifiers"],
		associations: { id: string; key: string; name: string }[],
		previous: ReturnType<OutreachService["serialize"]>[],
		permitted: boolean,
		reason: string,
		next: string | null,
		identity: { sender: string | null; template: string | null },
		priorCanonicalMailboxContact: PriorMailboxHistory = emptyMailboxHistory(),
	) {
		return {
			status,
			canonicalCompanyId: resolution.company?.id ?? null,
			canonicalCompanyName: resolution.company?.name ?? null,
			matchedIdentifiers: matched,
			existingBusinessUnitAssociations: associations,
			previousOutreach: previous,
			priorCanonicalMailboxContact,
			newOutreachPermitted: permitted,
			reason,
			requiredNextAction: next,
			senderIdentity: identity.sender,
			template: identity.template,
		};
	}

	private disabled(reason: string) {
		return {
			status: "OUTBOUND_DISABLED" as const,
			canonicalCompanyId: null,
			canonicalCompanyName: null,
			matchedIdentifiers: [],
			existingBusinessUnitAssociations: [],
			previousOutreach: [],
			priorCanonicalMailboxContact: emptyMailboxHistory(),
			newOutreachPermitted: false,
			reason,
			requiredNextAction:
				"Do not send. Restore CRM availability and rerun preflight.",
			senderIdentity: null,
			template: null,
		};
	}

	private duplicate(
		row: Parameters<OutreachService["serialize"]>[0] & {
			company: { id: string; name: string };
		},
		idempotencyKey: string,
		reason: string,
	) {
		return {
			status: "BLOCKED_DUPLICATE" as const,
			reservationId: row.id,
			reservationKey: row.reservationKey,
			idempotencyKey,
			canonicalCompanyId: row.companyId,
			canonicalCompanyName: row.company.name,
			senderIdentity: row.senderIdentity,
			template:
				row.businessUnit.key === "data-gear" ? DATAGEAR_OUTBOUND_V1 : null,
			duplicate: true,
			reason,
			requiredNextAction:
				"Use the existing reservation. Do not submit another message.",
			reservation: this.serialize(row),
		};
	}

	private serialize(row: {
		id: string;
		companyId: string;
		contactId: string | null;
		businessUnit: { id: string; key: string; name: string };
		outreachMode: OutreachMode;
		campaignType: string | null;
		purpose: string | null;
		senderIdentity: string;
		recipientEmail: string;
		subject: string;
		status: OutreachStatus;
		provider: string;
		providerMessageId: string | null;
		reservationKey: string;
		idempotencyKey: string;
		metadata: Prisma.JsonValue | null;
		notes: string | null;
		errorReason: string | null;
		createdAt: Date;
		reservedAt: Date;
		queuedAt: Date | null;
		sentAt: Date | null;
		deliveredAt: Date | null;
		bouncedAt: Date | null;
		failedAt: Date | null;
		updatedAt: Date;
	}) {
		return {
			id: row.id,
			companyId: row.companyId,
			contactId: row.contactId,
			businessUnit: row.businessUnit,
			outreachMode: row.outreachMode,
			campaignType: row.campaignType,
			purpose: row.purpose,
			senderIdentity: row.senderIdentity,
			recipientEmail: row.recipientEmail,
			subject: row.subject,
			status: row.status,
			provider: row.provider,
			providerMessageId: row.providerMessageId,
			reservationKey: row.reservationKey,
			idempotencyKey: row.idempotencyKey,
			metadata: jsonObject(row.metadata ?? undefined),
			notes: row.notes,
			errorReason: row.errorReason,
			createdAt: row.createdAt.toISOString(),
			reservedAt: row.reservedAt.toISOString(),
			queuedAt: row.queuedAt?.toISOString() ?? null,
			sentAt: row.sentAt?.toISOString() ?? null,
			deliveredAt: row.deliveredAt?.toISOString() ?? null,
			bouncedAt: row.bouncedAt?.toISOString() ?? null,
			failedAt: row.failedAt?.toISOString() ?? null,
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	private derivedIdempotencyKey(input: ReserveOutreachInput): string {
		return `derived:${createHash("sha256")
			.update(
				JSON.stringify({
					companyId: input.companyId ?? null,
					companyName: input.companyName?.trim().toLowerCase() ?? null,
					domain: input.domain?.trim().toLowerCase() ?? null,
					recipientEmail: input.recipientEmail?.trim().toLowerCase() ?? null,
					targetBusinessUnit: input.targetBusinessUnit,
					outreachMode: input.outreachMode,
					campaignType: input.campaignType ?? null,
					purpose: input.purpose ?? null,
					jobId: input.jobId ?? null,
					subject: input.subject,
				}),
			)
			.digest("hex")}`;
	}

}

function matchedIdentifiers(
	resolution: CompanyResolution,
	input: PreflightOutreachInput,
) {
	const identifiers = [...resolution.matchedIdentifiers];
	if (
		input.companyId &&
		!identifiers.some((item) => item.kind === "companyId")
	) {
		identifiers.push({ kind: "companyId", value: input.companyId });
	}
	return identifiers;
}

function dateOrNow(
	value: string | null | undefined,
	fallback: Date | null,
): Date | null {
	return value ? new Date(value) : fallback;
}

function isTerminal(status: OutreachStatus): boolean {
	return (
		[
			OutreachStatus.SENT,
			OutreachStatus.DELIVERED,
			OutreachStatus.BOUNCED,
			OutreachStatus.FAILED,
			OutreachStatus.CANCELED,
		] as OutreachStatus[]
	).includes(status);
}

function emptyMailboxHistory(): PriorMailboxHistory {
	return { count: 0, latestSentAt: null, contactIds: [] as string[] };
}
