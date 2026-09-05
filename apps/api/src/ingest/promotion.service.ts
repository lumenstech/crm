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

	private async company(
		tx: Prisma.TransactionClient,
		source: { id: string; businessUnitId: string },
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
		const candidates = await tx.canonicalCompany.findMany({
			where: domain ? { domain } : { normalizedName: normalized },
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
		const candidates = await tx.canonicalPerson.findMany({
			where: email ? { email } : { normalizedName: normalized },
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
		source: { id: string; businessUnitId: string },
		payload: JsonRecord,
	): Promise<PromotionResult> {
		const input = objectAt(payload, "opportunity");
		const companyResult = await this.company(tx, source, payload);
		if (companyResult.status === "review" || !companyResult.canonicalId)
			return { status: "review", entityType: "opportunity" };
		const title =
			text(input, "title", "name") ?? text(payload, "title", "name");
		if (!title) return { status: "review", entityType: "opportunity" };
		const ownerId = text(input, "ownerId") ?? text(payload, "ownerId");
		if (
			!ownerId ||
			!(await tx.user.findUnique({
				where: { id: ownerId },
				select: { id: true },
			}))
		)
			return { status: "review", entityType: "opportunity" };
		const visibleCompanyId = companyResult.visibleId;
		if (!visibleCompanyId)
			return {
				status: "review",
				entityType: "opportunity",
				reason: "insufficient_data",
			};
		const canonical = await tx.canonicalOpportunity.create({
			data: {
				canonicalCompanyId: companyResult.canonicalId,
				businessUnitId: source.businessUnitId,
				title,
				normalizedTitle: normalizedName(title),
				ownerId,
				currency: text(input, "currency") ?? "USD",
			},
			select: { id: true },
		});
		const deal = await tx.deal.create({
			data: { name: title, companyId: visibleCompanyId, ownerId },
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
			reviewId: review.id,
		};
	}
}
