import type { Db } from "@crm/db";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

type AssociationRecordType = "company" | "contact";

@Injectable()
export class BusinessUnitsService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async list() {
		return this.db.businessUnit.findMany({
			where: { enabled: true },
			select: {
				id: true,
				key: true,
				name: true,
				description: true,
				enabled: true,
			},
			orderBy: { name: "asc" },
		});
	}

	async associateRecord(input: {
		recordType: AssociationRecordType;
		recordId: string;
		targetBusinessUnit: string;
		useCase?: string | null;
		notes?: string | null;
	}) {
		const target = await this.db.businessUnit.findUnique({
			where: { key: input.targetBusinessUnit },
			select: { id: true, key: true, name: true, enabled: true },
		});
		if (!target || !target.enabled) {
			throw new BadRequestException(
				`Unknown or disabled business unit: ${input.targetBusinessUnit}.`,
			);
		}

		const sourceBusinessUnitId = await this.sourceBusinessUnitId(
			input.recordType,
			input.recordId,
		);

		const association = await this.db.businessUnitRecordAssociation.upsert({
			where: {
				recordType_recordId_targetBusinessUnitId: {
					recordType: input.recordType,
					recordId: input.recordId,
					targetBusinessUnitId: target.id,
				},
			},
			create: {
				recordType: input.recordType,
				recordId: input.recordId,
				sourceBusinessUnitId,
				targetBusinessUnitId: target.id,
				useCase: input.useCase?.trim() || null,
				notes: input.notes?.trim() || null,
			},
			update: {
				sourceBusinessUnitId,
				useCase: input.useCase?.trim() || null,
				notes: input.notes?.trim() || null,
			},
			include: {
				sourceBusinessUnit: { select: { id: true, key: true, name: true } },
				targetBusinessUnit: { select: { id: true, key: true, name: true } },
			},
		});

		return {
			...association,
			createdAt: association.createdAt.toISOString(),
			updatedAt: association.updatedAt.toISOString(),
		};
	}

	async recordAssociations(recordType: AssociationRecordType, recordId: string) {
		await this.sourceBusinessUnitId(recordType, recordId);
		const rows = await this.db.businessUnitRecordAssociation.findMany({
			where: { recordType, recordId },
			include: {
				sourceBusinessUnit: { select: { id: true, key: true, name: true } },
				targetBusinessUnit: { select: { id: true, key: true, name: true } },
			},
			orderBy: { createdAt: "asc" },
		});
		return rows.map((row) => ({
			...row,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		}));
	}

	async createBusinessUnitOpportunity(input: {
		companyId: string;
		contactId?: string | null;
		targetBusinessUnit: string;
		ownerId?: string | null;
		name: string;
		useCase?: string | null;
		notes?: string | null;
	}) {
		const company = await this.db.company.findUnique({
			where: { id: input.companyId },
			select: { id: true, businessUnitId: true, ownerId: true },
		});
		if (!company) throw new NotFoundException(`No company with id ${input.companyId}.`);

		let contactOwnerId: string | null = null;
		if (input.contactId) {
			const contact = await this.db.contact.findUnique({
				where: { id: input.contactId },
				select: { id: true, companyId: true, ownerId: true },
			});
			if (!contact) throw new NotFoundException(`No contact with id ${input.contactId}.`);
			if (contact.companyId !== company.id) {
				throw new BadRequestException(
					"The selected contact does not belong to the selected company.",
				);
			}
			contactOwnerId = contact.ownerId;
		}

		const resolvedOwnerId = input.ownerId ?? company.ownerId ?? contactOwnerId;
		if (!resolvedOwnerId) {
			throw new BadRequestException(
				"No owner could be inferred. Provide ownerId or assign an owner to the company/contact first.",
			);
		}
		const owner = await this.db.user.findUnique({
			where: { id: resolvedOwnerId },
			select: { id: true },
		});
		if (!owner) {
			throw new NotFoundException(`No user with id ${resolvedOwnerId}.`);
		}

		const association = await this.associateRecord({
			recordType: "company",
			recordId: company.id,
			targetBusinessUnit: input.targetBusinessUnit,
			useCase: input.useCase,
			notes: input.notes,
		});
		if (input.contactId) {
			await this.associateRecord({
				recordType: "contact",
				recordId: input.contactId,
				targetBusinessUnit: input.targetBusinessUnit,
				useCase: input.useCase,
				notes: input.notes,
			});
		}

		const deal = await this.db.deal.create({
			data: {
				name: input.name.trim(),
				company: { connect: { id: company.id } },
				owner: { connect: { id: owner.id } },
				businessUnit: {
					connect: { id: association.targetBusinessUnit.id },
				},
				description: input.notes?.trim() || input.useCase?.trim() || null,
				...(input.contactId
					? {
							contacts: {
								create: {
									contact: { connect: { id: input.contactId } },
								},
							},
						}
					: {}),
			},
			select: { id: true },
		});

		return {
			dealId: deal.id,
			companyId: company.id,
			contactId: input.contactId ?? null,
			businessUnit: association.targetBusinessUnit,
			associationId: association.id,
			created: true as const,
		};
	}

	private async sourceBusinessUnitId(
		recordType: AssociationRecordType,
		recordId: string,
	): Promise<string | null> {
		if (recordType === "company") {
			const company = await this.db.company.findUnique({
				where: { id: recordId },
				select: { businessUnitId: true },
			});
			if (!company) throw new NotFoundException(`No company with id ${recordId}.`);
			return company.businessUnitId;
		}

		const contact = await this.db.contact.findUnique({
			where: { id: recordId },
			select: { company: { select: { businessUnitId: true } } },
		});
		if (!contact) throw new NotFoundException(`No contact with id ${recordId}.`);
		return contact.company?.businessUnitId ?? null;
	}

}
