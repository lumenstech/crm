import { randomUUID } from "node:crypto";
import { type Db, type Prisma, RecordSource } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { normalizeDomain } from "../companies/domain";
import { normalizeEmail } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";

type JsonRecord = { [key: string]: Prisma.JsonValue };
const jsonRecord = z.record(z.string(), z.json());
type PromotionResult = {
	status: "promoted" | "review";
	entityType: string;
	reason?: string;
	candidates?: Array<{ id: string; score: number; reasons: string[] }>;
	canonicalId?: string;
	visibleId?: string;
	reviewId?: string;
};

const text = (payload: JsonRecord, ...keys: string[]) => {
	for (const key of keys) {
		const value = payload[key];
		const parsed = z.string().trim().safeParse(value);
		if (parsed.success && parsed.data) return parsed.data;
	}
	return null;
};

const objectAt = (payload: JsonRecord, key: string): JsonRecord => {
	const value = payload[key];
	const parsed = jsonRecord.safeParse(value);
	return parsed.success ? (parsed.data as JsonRecord) : payload;
};

const normalizedName = (value: string) =>
	value
		.toLocaleLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

@Injectable()
export class PromotionService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async process(
		sourceRecordId: string,
		actorId?: string,
	): Promise<PromotionResult> {
		return this.db.$transaction((tx) =>
			this.processInTransaction(tx, sourceRecordId, actorId),
		);
	}

	async processInTransaction(
		tx: Prisma.TransactionClient,
		sourceRecordId: string,
		actorId?: string,
	): Promise<PromotionResult> {
		return (async () => {
			const source = await tx.sourceRecord.findUnique({
				where: { id: sourceRecordId },
				include: { businessUnit: true },
			});
			if (!source) throw new Error("Source record was not found.");
			const payload = jsonRecord.parse(source.payload) as JsonRecord;
			const entityType = text(payload, "entityType", "entity") ?? "company";
			const result =
				entityType === "person" || entityType === "contact"
					? await this.person(tx, source, payload)
					: entityType === "opportunity" || entityType === "deal"
						? await this.opportunity(tx, source, payload)
						: await this.company(tx, source, payload);

			if (result.status === "review")
				return this.review(tx, source, result, actorId);
			await tx.sourceRecord.update({
				where: { id: source.id },
				data: { status: "promoted", error: null },
			});
			await tx.promotionAudit.create({
				data: {
					id: randomUUID(),
					sourceRecordId: source.id,
					businessUnitId: source.businessUnitId,
					action: "promote",
					outcome: "promoted",
					canonicalType: result.entityType,
					canonicalId: result.canonicalId,
					visibleId: result.visibleId,
					actorId: actorId ?? null,
				},
			});
			return result;
		})();
	}

	async approveInTransaction(
		tx: Prisma.TransactionClient,
		sourceRecordId: string,
		entityType: string,
		canonicalId: string | undefined,
		ownerId: string | undefined,
	): Promise<{ canonicalId: string; visibleId?: string }> {
		let targetId = canonicalId;
		const source = await tx.sourceRecord.findUnique({
			where: { id: sourceRecordId },
		});
		if (!source) throw new Error("Source record was not found.");
		if (
			!targetId &&
			(entityType === "company" ||
				entityType === "person" ||
				entityType === "contact")
		) {
			const payload = jsonRecord.parse(source.payload) as JsonRecord;
			if (entityType === "company") {
				const input = objectAt(payload, "company");
				const name =
					text(input, "name", "companyName") ??
					text(payload, "name", "companyName");
				if (!name) throw new Error("A company name is required.");
				const visible = await tx.company.create({
					data: {
						name,
						domain: normalizeDomain(text(input, "domain", "website")),
						source: RecordSource.IMPORT,
					},
					select: { id: true },
				});
				const created = await tx.canonicalCompany.create({
					data: {
						displayName: name,
						normalizedName: normalizedName(name),
						companyId: visible.id,
					},
					select: { id: true },
				});
				targetId = created.id;
			} else {
				const input = objectAt(payload, "person");
				const firstName =
					text(input, "firstName", "name") ??
					text(payload, "firstName", "name");
				if (!firstName) throw new Error("A person name is required.");
				const lastName = text(input, "lastName");
				const email = normalizeEmail(
					text(input, "email") ?? text(payload, "email") ?? "",
				);
				const visible = await tx.contact.create({
					data: { firstName, lastName, email, source: RecordSource.IMPORT },
					select: { id: true },
				});
				const created = await tx.canonicalPerson.create({
					data: {
						firstName,
						lastName,
						email,
						normalizedName: normalizedName(
							[firstName, lastName].filter(Boolean).join(" "),
						),
						contactId: visible.id,
					},
					select: { id: true },
				});
				targetId = created.id;
			}
		}
		if (!targetId) throw new Error("A canonical target is required.");
		if (entityType === "company") {
			const canonical = await tx.canonicalCompany.findUnique({
				where: { id: targetId },
			});
			if (!canonical) throw new Error("Canonical company was not found.");
			let visibleId = canonical.companyId;
			if (!visibleId) {
				const payload = jsonRecord.parse(source.payload) as JsonRecord;
				const input = objectAt(payload, "company");
				const name =
					text(input, "name", "companyName") ??
					text(payload, "name", "companyName") ??
					canonical.displayName;
				const visible = await tx.company.create({
					data: {
						name,
						domain: canonical.domain,
						website: canonical.website,
						source: RecordSource.IMPORT,
					},
					select: { id: true },
				});
				visibleId = visible.id;
				await tx.canonicalCompany.update({
					where: { id: canonical.id },
					data: { companyId: visibleId },
				});
			}
			await tx.canonicalCompanyBusinessUnit.upsert({
				where: {
					canonicalCompanyId_businessUnitId: {
						canonicalCompanyId: canonical.id,
						businessUnitId: source.businessUnitId,
					},
				},
				create: {
					canonicalCompanyId: canonical.id,
					businessUnitId: source.businessUnitId,
				},
				update: {},
			});
			await this.mapping(
				tx,
				source.id,
				"company",
				canonical.id,
				"review_approved",
				1,
			);
			return { canonicalId: canonical.id, visibleId };
		}
		if (entityType === "person" || entityType === "contact") {
			const canonical = await tx.canonicalPerson.findUnique({
				where: { id: targetId },
			});
			if (!canonical) throw new Error("Canonical person was not found.");
			let visibleId = canonical.contactId;
			if (!visibleId) {
				const visible = await tx.contact.create({
					data: {
						firstName: canonical.firstName,
						lastName: canonical.lastName,
						email: canonical.email,
						phone: canonical.phone,
						source: RecordSource.IMPORT,
					},
					select: { id: true },
				});
				visibleId = visible.id;
				await tx.canonicalPerson.update({
					where: { id: canonical.id },
					data: { contactId: visibleId },
				});
			}
			await tx.canonicalPersonBusinessUnit.upsert({
				where: {
					canonicalPersonId_businessUnitId: {
						canonicalPersonId: canonical.id,
						businessUnitId: source.businessUnitId,
					},
				},
				create: {
					canonicalPersonId: canonical.id,
					businessUnitId: source.businessUnitId,
				},
				update: {},
			});
			await this.mapping(
				tx,
				source.id,
				"person",
				canonical.id,
				"review_approved",
				1,
			);
			return { canonicalId: canonical.id, visibleId };
		}
		const opportunity = await tx.canonicalOpportunity.findUnique({
			where: { id: targetId },
		});
		if (!opportunity) throw new Error("Canonical opportunity was not found.");
		if (
			!ownerId ||
			!(await tx.user.findUnique({
				where: { id: ownerId },
				select: { id: true },
			}))
		)
			throw new Error("A valid Deal owner is required.");
		const company = await tx.canonicalCompany.findUnique({
			where: { id: opportunity.canonicalCompanyId },
			select: { companyId: true },
		});
		if (!company?.companyId)
			throw new Error("The opportunity company is not promoted.");
		const deal = opportunity.dealId
			? { id: opportunity.dealId }
			: await tx.deal.create({
					data: {
						name: opportunity.title,
						companyId: company.companyId,
						ownerId,
					},
					select: { id: true },
				});
		await tx.canonicalOpportunity.update({
			where: { id: opportunity.id },
			data: { dealId: deal.id, ownerId },
		});
		await this.mapping(
			tx,
			source.id,
			"opportunity",
			opportunity.id,
			"review_approved",
			1,
		);
		return { canonicalId: opportunity.id, visibleId: deal.id };
	}

	private async company(
		tx: Prisma.TransactionClient,
		source: {
			id: string;
			businessUnitId: string;
			sourceSystem: string;
			sourceType?: string;
			sourceId?: string;
		},
		payload: JsonRecord,
	): Promise<PromotionResult> {
		const input = objectAt(payload, "company");
		const name =
			text(input, "name", "companyName") ??
			text(payload, "companyName", "name");
		const domain = normalizeDomain(
			text(input, "domain", "website") ?? text(payload, "domain", "website"),
		);
		if (!name && !domain) return { status: "review", entityType: "company" };
		const normalized = normalizedName(name ?? domain ?? "");
		const mapped = await tx.recordMapping.findFirst({
			where: {
				sourceRecordId: source.id,
				canonicalType: "company",
				status: "active",
			},
			select: { canonicalId: true },
		});
		const externalId =
			text(input, "externalId", "companyId", "sourceCompanyId") ??
			text(payload, "externalId", "companyId");
		const identifier = externalId
			? await tx.canonicalCompanyIdentifier.findUnique({
					where: {
						sourceSystem_identifierType_normalizedValue: {
							sourceSystem: source.sourceSystem,
							identifierType: "external_id",
							normalizedValue: externalId.toLocaleLowerCase(),
						},
					},
					select: { canonicalCompanyId: true },
				})
			: null;
		const mappedCanonical = mapped
			? await tx.canonicalCompany.findUnique({
					where: { id: mapped.canonicalId },
					select: { id: true, companyId: true, displayName: true },
				})
			: null;
		const candidates = await tx.canonicalCompany.findMany({
			where:
				externalId || mappedCanonical || identifier
					? { id: mappedCanonical?.id ?? identifier?.canonicalCompanyId ?? "" }
					: domain
						? { domain }
						: { normalizedName: normalized },
			take: 10,
			select: { id: true, companyId: true, displayName: true },
		});
		if (candidates.length > 1)
			return {
				status: "review",
				entityType: "company",
				reason: "ambiguous_match",
				candidates: candidates.map((candidate, position) => ({
					id: candidate.id,
					score: domain ? 1 : Math.max(0.5, 0.9 - position * 0.05),
					reasons: [domain ? "exact_domain" : "name_only"],
				})),
			};
		const soleCandidate = candidates[0];
		if (soleCandidate && !domain)
			return {
				status: "review",
				entityType: "company",
				reason: "ambiguous_match",
				canonicalId: soleCandidate.id,
				candidates: [
					{ id: soleCandidate.id, score: 0.5, reasons: ["name_only"] },
				],
			};
		let canonical = candidates[0];
		if (!canonical) {
			const displayName = name ?? domain;
			if (!displayName)
				return {
					status: "review",
					entityType: "company",
					reason: "insufficient_data",
				};
			const visible = await tx.company.create({
				data: {
					name: displayName,
					domain,
					website: domain ? `https://${domain}` : null,
					source: RecordSource.IMPORT,
				},
				select: { id: true },
			});
			canonical = await tx.canonicalCompany.create({
				data: {
					displayName,
					normalizedName: normalized,
					domain,
					website: domain ? `https://${domain}` : null,
					companyId: visible.id,
				},
				select: { id: true, companyId: true, displayName: true },
			});
		}
		await tx.canonicalCompanyBusinessUnit.upsert({
			where: {
				canonicalCompanyId_businessUnitId: {
					canonicalCompanyId: canonical.id,
					businessUnitId: source.businessUnitId,
				},
			},
			create: {
				canonicalCompanyId: canonical.id,
				businessUnitId: source.businessUnitId,
			},
			update: {},
		});
		if (externalId)
			await tx.canonicalCompanyIdentifier.upsert({
				where: {
					sourceSystem_identifierType_normalizedValue: {
						sourceSystem: source.sourceSystem,
						identifierType: "external_id",
						normalizedValue: externalId.toLocaleLowerCase(),
					},
				},
				create: {
					canonicalCompanyId: canonical.id,
					sourceSystem: source.sourceSystem,
					identifierType: "external_id",
					normalizedValue: externalId.toLocaleLowerCase(),
					verified: true,
				},
				update: { canonicalCompanyId: canonical.id, verified: true },
			});
		if (domain)
			await tx.canonicalCompanyIdentifier.upsert({
				where: {
					sourceSystem_identifierType_normalizedValue: {
						sourceSystem: "normalized",
						identifierType: "domain",
						normalizedValue: domain,
					},
				},
				create: {
					canonicalCompanyId: canonical.id,
					sourceSystem: "normalized",
					identifierType: "domain",
					normalizedValue: domain,
					verified: true,
				},
				update: { canonicalCompanyId: canonical.id, verified: true },
			});
		await this.mapping(
			tx,
			source.id,
			"company",
			canonical.id,
			domain ? "exact_domain" : "new",
			domain ? 1 : null,
		);
		return {
			status: "promoted",
			entityType: "company",
			canonicalId: canonical.id,
			visibleId: canonical.companyId ?? undefined,
		};
	}

	private async person(
		tx: Prisma.TransactionClient,
		source: {
			id: string;
			sourceSystem: string;
			sourceId: string;
			businessUnitId: string;
		},
		payload: JsonRecord,
	): Promise<PromotionResult> {
		const input = objectAt(payload, "person");
		const email = normalizeEmail(
			text(input, "email") ?? text(payload, "email") ?? "",
		);
		const firstName =
			text(input, "firstName", "name") ?? text(payload, "firstName", "name");
		if (!email && !firstName) return { status: "review", entityType: "person" };
		const normalized = normalizedName(
			[firstName, text(input, "lastName")].filter(Boolean).join(" "),
		);
		const externalId =
			text(input, "externalId", "profileId", "personId") ??
			text(payload, "externalId", "profileId", "personId");
		const identifier = externalId
			? await tx.canonicalPersonIdentifier.findUnique({
					where: {
						sourceSystem_identifierType_normalizedValue: {
							sourceSystem: source.sourceSystem,
							identifierType: "external_id",
							normalizedValue: externalId.toLocaleLowerCase(),
						},
					},
					select: { canonicalPersonId: true },
				})
			: null;
		const candidates = await tx.canonicalPerson.findMany({
			where:
				externalId || identifier
					? { id: identifier?.canonicalPersonId ?? "" }
					: email
						? { email }
						: { normalizedName: normalized },
			take: 2,
			select: { id: true, contactId: true },
		});
		if (candidates.length > 1)
			return { status: "review", entityType: "person" };
		let canonical = candidates[0];
		if (!canonical) {
			const contact = await tx.contact.create({
				data: {
					firstName: firstName ?? "Unknown",
					lastName: text(input, "lastName"),
					email,
					source: RecordSource.IMPORT,
				},
				select: { id: true },
			});
			canonical = await tx.canonicalPerson.create({
				data: {
					firstName: firstName ?? "Unknown",
					lastName: text(input, "lastName"),
					normalizedName: normalized,
					email,
					contactId: contact.id,
				},
				select: { id: true, contactId: true },
			});
		}
		await tx.canonicalPersonBusinessUnit.upsert({
			where: {
				canonicalPersonId_businessUnitId: {
					canonicalPersonId: canonical.id,
					businessUnitId: source.businessUnitId,
				},
			},
			create: {
				canonicalPersonId: canonical.id,
				businessUnitId: source.businessUnitId,
			},
			update: {},
		});
		if (externalId)
			await tx.canonicalPersonIdentifier.upsert({
				where: {
					sourceSystem_identifierType_normalizedValue: {
						sourceSystem: source.sourceSystem,
						identifierType: "external_id",
						normalizedValue: externalId.toLocaleLowerCase(),
					},
				},
				create: {
					canonicalPersonId: canonical.id,
					sourceSystem: source.sourceSystem,
					identifierType: "external_id",
					normalizedValue: externalId.toLocaleLowerCase(),
					verified: true,
				},
				update: { canonicalPersonId: canonical.id, verified: true },
			});
		if (email)
			await tx.canonicalPersonIdentifier.upsert({
				where: {
					sourceSystem_identifierType_normalizedValue: {
						sourceSystem: "normalized",
						identifierType: "email",
						normalizedValue: email,
					},
				},
				create: {
					canonicalPersonId: canonical.id,
					sourceSystem: "normalized",
					identifierType: "email",
					normalizedValue: email,
					verified: true,
				},
				update: { canonicalPersonId: canonical.id, verified: true },
			});
		await this.mapping(
			tx,
			source.id,
			"person",
			canonical.id,
			email ? "exact_email" : "new",
			email ? 1 : null,
		);
		return {
			status: "promoted",
			entityType: "person",
			canonicalId: canonical.id,
			visibleId: canonical.contactId ?? undefined,
		};
	}

	private async opportunity(
		tx: Prisma.TransactionClient,
		source: { id: string; businessUnitId: string; sourceSystem: string },
		payload: JsonRecord,
	): Promise<PromotionResult> {
		const input = objectAt(payload, "opportunity");
		const companyResult = await this.company(tx, source, payload);
		if (companyResult.status === "review" || !companyResult.canonicalId)
			return { status: "review", entityType: "opportunity" };
		const title =
			text(input, "title", "name") ?? text(payload, "title", "name");
		if (!title) return { status: "review", entityType: "opportunity" };
		const externalId =
			text(input, "externalId", "opportunityId", "dealId") ??
			text(payload, "externalId", "opportunityId", "dealId");
		const ownerId = text(input, "ownerId") ?? text(payload, "ownerId");
		const validOwner = ownerId
			? await tx.user.findUnique({
					where: { id: ownerId },
					select: { id: true },
				})
			: null;
		const visibleCompanyId = companyResult.visibleId;
		if (!visibleCompanyId)
			return {
				status: "review",
				entityType: "opportunity",
				reason: "insufficient_data",
			};
		const existingIdentifier = externalId
			? await tx.canonicalOpportunityIdentifier.findUnique({
					where: {
						sourceSystem_identifierType_normalizedValue: {
							sourceSystem: source.sourceSystem,
							identifierType: "external_id",
							normalizedValue: externalId.toLocaleLowerCase(),
						},
					},
					select: { canonicalOpportunityId: true },
				})
			: null;
		const opportunityData = {
			canonicalCompanyId: companyResult.canonicalId,
			businessUnitId: source.businessUnitId,
			title,
			normalizedTitle: normalizedName(title),
			ownerId: validOwner?.id,
			currency: text(input, "currency") ?? "USD",
		};
		const canonical = existingIdentifier
			? await tx.canonicalOpportunity.findUnique({
					where: { id: existingIdentifier.canonicalOpportunityId },
					select: { id: true, dealId: true },
				})
			: await tx.canonicalOpportunity.create({
					data: opportunityData,
					select: { id: true, dealId: true },
				});
		if (!canonical)
			return {
				status: "review",
				entityType: "opportunity",
				reason: "insufficient_data",
			};
		if (!existingIdentifier && externalId)
			await tx.canonicalOpportunityIdentifier.create({
				data: {
					canonicalOpportunityId: canonical.id,
					sourceSystem: source.sourceSystem,
					identifierType: "external_id",
					normalizedValue: externalId.toLocaleLowerCase(),
					verified: true,
				},
			});
		if (!validOwner)
			return {
				status: "review",
				entityType: "opportunity",
				reason: "owner_required",
				canonicalId: canonical.id,
			};
		if (canonical.dealId)
			return {
				status: "promoted",
				entityType: "opportunity",
				canonicalId: canonical.id,
				visibleId: canonical.dealId,
			};
		const deal = await tx.deal.create({
			data: {
				name: title,
				companyId: visibleCompanyId,
				ownerId: validOwner.id,
			},
			select: { id: true },
		});
		await tx.canonicalOpportunity.update({
			where: { id: canonical.id },
			data: { dealId: deal.id },
		});
		await this.mapping(tx, source.id, "opportunity", canonical.id, "new", null);
		return {
			status: "promoted",
			entityType: "opportunity",
			canonicalId: canonical.id,
			visibleId: deal.id,
		};
	}

	private async mapping(
		tx: Prisma.TransactionClient,
		sourceRecordId: string,
		canonicalType: string,
		canonicalId: string,
		matchMethod: string,
		confidence: number | null,
	) {
		await tx.recordMapping.upsert({
			where: {
				sourceRecordId_canonicalType_canonicalId: {
					sourceRecordId,
					canonicalType,
					canonicalId,
				},
			},
			create: {
				id: randomUUID(),
				sourceRecordId,
				canonicalType,
				canonicalId,
				matchMethod,
				confidence,
			},
			update: { matchMethod, confidence },
		});
	}

	private async review(
		tx: Prisma.TransactionClient,
		source: { id: string; businessUnitId: string },
		result: PromotionResult,
		actorId?: string,
	): Promise<PromotionResult> {
		const reasonCode =
			result.reason ??
			(result.entityType === "opportunity"
				? "owner_required"
				: "insufficient_data");
		const review = await tx.resolutionReview.upsert({
			where: {
				sourceRecordId_entityType_reasonCode_status: {
					sourceRecordId: source.id,
					entityType: result.entityType,
					reasonCode,
					status: "pending",
				},
			},
			create: {
				sourceRecordId: source.id,
				entityType: result.entityType,
				reasonCode,
				proposedOperation: "promote",
				resultCanonicalId: result.canonicalId,
			},
			update: {},
		});
		if (result.candidates) {
			for (const [position, candidate] of result.candidates.entries()) {
				await tx.resolutionCandidate.upsert({
					where: {
						reviewId_canonicalType_canonicalId: {
							reviewId: review.id,
							canonicalType: result.entityType,
							canonicalId: candidate.id,
						},
					},
					create: {
						reviewId: review.id,
						canonicalType: result.entityType,
						canonicalId: candidate.id,
						score: candidate.score,
						matchReasons: candidate.reasons,
						position,
					},
					update: {
						score: candidate.score,
						matchReasons: candidate.reasons,
						position,
					},
				});
			}
		}
		await tx.sourceRecord.update({
			where: { id: source.id },
			data: { status: "review" },
		});
		await tx.promotionAudit.create({
			data: {
				id: randomUUID(),
				sourceRecordId: source.id,
				businessUnitId: source.businessUnitId,
				action: "promote",
				outcome: "review",
				canonicalType: result.entityType,
				error: reasonCode,
				actorId: actorId ?? null,
			},
		});
		return {
			status: "review",
			entityType: result.entityType,
			canonicalId: result.canonicalId,
			reviewId: review.id,
		};
	}
}
