import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type { GauzyAdapter } from "./gauzy.adapter";
import type { OpportunityWonPayloadV1 } from "./opportunity-won";

function assertOpportunityWonPayload(value: unknown): asserts value is OpportunityWonPayloadV1 {
	if (!value || typeof value !== "object") throw new PermanentPromotionError("Invalid opportunity.won payload.");
	const payload = value as Partial<OpportunityWonPayloadV1>;
	if (payload.version !== 1 || typeof payload.opportunityId !== "string" || typeof payload.businessUnitId !== "string" || !Array.isArray(payload.contactIds) || !Array.isArray(payload.provenanceIds)) {
		throw new PermanentPromotionError("Invalid opportunity.won v1 payload.");
	}
}

const PROVIDER = "gauzy";

@Injectable()
export class GauzyPromotionService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async promote(eventId: string, gauzy: GauzyAdapter) {
		const event = await this.db.lumensOsEvent.findUnique({ where: { id: eventId } });
		if (!event || event.eventType !== "opportunity.won") {
			throw new Error(`No opportunity.won event with id ${eventId}.`);
		}
		assertOpportunityWonPayload(event.payload);
		const payload = event.payload;
		const promotion = await this.db.gauzyPromotion.findUnique({
			where: { opportunityId: payload.opportunityId },
		});
		if (!promotion) throw new Error(`No Gauzy promotion for event ${eventId}.`);
		if (promotion.status === "completed") return promotion;

		try {
			await this.markAttempt(eventId, promotion.id);
			const opportunity = await this.db.canonicalOpportunity.findUnique({
				where: { id: payload.opportunityId },
				include: {
					businessUnit: true,
					company: { include: { people: { include: { person: true } } } },
				},
			});
			if (!opportunity) throw new PermanentPromotionError("Canonical opportunity no longer exists.");
			if (!opportunity.company) throw new PermanentPromotionError("Won opportunity has no canonical company.");

			const organization = await this.resolveIdentity(
				"business_unit",
				opportunity.businessUnitId,
				"organization",
				() => gauzy.findOrCreateOrganization({
					canonicalBusinessUnitId: opportunity.businessUnitId,
					name: opportunity.businessUnit.name,
				}),
			);
			const customer = await this.resolveIdentity(
				"company",
				opportunity.company.id,
				"customer",
				() => gauzy.findOrCreateCustomer({
					canonicalCompanyId: opportunity.company!.id,
					organizationId: organization,
					name: opportunity.company!.name,
					phone: opportunity.company!.phone,
				}),
			);

			let primaryContactId: string | null = null;
			for (const link of opportunity.company.people) {
				const person = link.person;
				const contactId = await this.resolveIdentity(
					"person",
					person.id,
					"contact",
					() => gauzy.findOrCreateContact({
						canonicalPersonId: person.id,
						customerId: customer,
						organizationId: organization,
						firstName: person.firstName,
						lastName: person.lastName,
						email: person.email,
						phone: person.phone,
					}),
				);
				if (link.isPrimary || !primaryContactId) primaryContactId = contactId;
			}

			const project = await this.resolveIdentity(
				"opportunity",
				opportunity.id,
				"project",
				() => gauzy.findOrCreateProject({
					canonicalOpportunityId: opportunity.id,
					customerId: customer,
					organizationId: organization,
					name: opportunity.name,
				}),
			);

			const now = new Date();
			return await this.db.$transaction(async (tx) => {
				const completed = await tx.gauzyPromotion.update({
					where: { id: promotion.id },
					data: {
						status: "completed",
						gauzyOrganizationId: organization,
						gauzyContactId: primaryContactId,
						gauzyProjectId: project,
						lastError: null,
						promotedAt: now,
						updatedAt: now,
					},
				});
				await tx.lumensOsEvent.update({
					where: { id: eventId },
					data: { status: "processed", processedAt: now, lastError: null, updatedAt: now },
				});
				await tx.agentTask.updateMany({
					where: { kind: "gauzy_promotion", subject: eventId, finishedAt: null },
					data: { finishedAt: now, outcome: "completed" },
				});
				return completed;
			});
		} catch (error) {
			await this.recordFailure(eventId, promotion.id, error);
			throw error;
		}
	}

	private async resolveIdentity(
		canonicalType: string,
		canonicalId: string,
		externalType: string,
		create: () => Promise<{ id: string }>,
	) {
		const existing = await this.db.externalIdentity.findUnique({
			where: {
				canonicalType_canonicalId_provider_externalType: {
					canonicalType,
					canonicalId,
					provider: PROVIDER,
					externalType,
				},
			},
			select: { externalId: true },
		});
		if (existing) return existing.externalId;

		const external = await create();
		await this.db.externalIdentity.upsert({
			where: {
				canonicalType_canonicalId_provider_externalType: {
					canonicalType,
					canonicalId,
					provider: PROVIDER,
					externalType,
				},
			},
			create: {
				id: randomUUID(),
				canonicalType,
				canonicalId,
				provider: PROVIDER,
				externalType,
				externalId: external.id,
			},
			update: { externalId: external.id, updatedAt: new Date() },
		});
		return external.id;
	}

	private async markAttempt(eventId: string, promotionId: string) {
		const now = new Date();
		await this.db.$transaction([
			this.db.lumensOsEvent.update({
				where: { id: eventId },
				data: { status: "processing", attempts: { increment: 1 }, leasedUntil: new Date(now.getTime() + 5 * 60_000), updatedAt: now },
			}),
			this.db.gauzyPromotion.update({
				where: { id: promotionId },
				data: { status: "processing", lastError: null, updatedAt: now },
			}),
			this.db.agentTask.updateMany({
				where: { kind: "gauzy_promotion", subject: eventId, finishedAt: null },
				data: { attempts: { increment: 1 }, startedAt: now },
			}),
		]);
	}

	private async recordFailure(eventId: string, promotionId: string, error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		const permanent = error instanceof PermanentPromotionError;
		const now = new Date();
		await this.db.$transaction([
			this.db.lumensOsEvent.update({
				where: { id: eventId },
				data: {
					status: permanent ? "failed" : "pending",
					lastError: message,
					leasedUntil: null,
					availableAt: permanent ? now : new Date(now.getTime() + 60_000),
					updatedAt: now,
				},
			}),
			this.db.gauzyPromotion.update({
				where: { id: promotionId },
				data: { status: permanent ? "failed" : "pending", lastError: message, updatedAt: now },
			}),
			this.db.agentTask.updateMany({
				where: { kind: "gauzy_promotion", subject: eventId, finishedAt: null },
				data: permanent
					? { finishedAt: now, outcome: `failed: ${message}` }
					: { dueAt: new Date(now.getTime() + 60_000), outcome: `retry: ${message}` },
			}),
		]);
	}
}

export class PermanentPromotionError extends Error {}
