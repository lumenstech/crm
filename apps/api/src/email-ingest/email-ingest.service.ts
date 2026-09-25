import { createHash } from "node:crypto";
import type { Db } from "@crm/db";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ContactsService } from "../contacts/contacts.service";
import { CompaniesService } from "../companies/companies.service";
import { normalizeDomain } from "../companies/domain";
import { InjectDatabase } from "../database/database.constants";
import { IngestService } from "../ingest/ingest.service";
import { BusinessUnitsService } from "../business-units/business-units.service";
import type { CrmEmailBatch, CrmEmailLead } from "./email-ingest.contracts";

type CompanyMatch = { id: string; name: string; domain: string | null };
type ContactMatch = { id: string; email: string | null; companyId: string | null };

export type EmailIngestItemResult = {
	sourceId: string;
	company: string;
	status: "existing" | "created" | "checked" | "failed";
	companyId: string | null;
	contactId: string | null;
	companyAssociationAdded: boolean;
	contactAssociationAdded: boolean;
	sourceRecordId: string | null;
	duplicateSubmission: boolean;
	error: string | null;
};

@Injectable()
export class EmailIngestService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly companies: CompaniesService,
		private readonly contacts: ContactsService,
		private readonly businessUnits: BusinessUnitsService,
		private readonly signals: IngestService,
	) {}

	async process(batch: CrmEmailBatch) {
		const unit = await this.db.businessUnit.findUnique({
			where: { key: batch.businessUnit },
			select: { id: true, key: true, enabled: true },
		});
		if (!unit?.enabled) {
			throw new BadRequestException(
				`Unknown or disabled business unit: ${batch.businessUnit}.`,
			);
		}

		const items: EmailIngestItemResult[] = [];
		for (let index = 0; index < batch.leads.length; index += 1) {
			const lead = batch.leads[index]!;
			const sourceId =
				lead.sourceId ??
				createHash("sha256")
					.update(
						[
							batch.batchId,
							String(index),
							lead.company.trim().toLowerCase(),
							lead.domain ?? "",
							lead.contact?.email ?? "",
						].join("|"),
					)
					.digest("hex");

			try {
				items.push(
					await this.processLead(
						batch,
						lead,
						sourceId,
						unit.id,
					),
				);
			} catch (error) {
				items.push({
					sourceId,
					company: lead.company,
					status: "failed",
					companyId: null,
					contactId: null,
					companyAssociationAdded: false,
					contactAssociationAdded: false,
					sourceRecordId: null,
					duplicateSubmission: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return {
			batchId: batch.batchId,
			businessUnit: batch.businessUnit,
			mode: batch.mode,
			submitted: items.length,
			existing: items.filter((item) => item.status === "existing").length,
			created: items.filter((item) => item.status === "created").length,
			checked: items.filter((item) => item.status === "checked").length,
			failed: items.filter((item) => item.status === "failed").length,
			items,
		};
	}

	private async processLead(
		batch: CrmEmailBatch,
		lead: CrmEmailLead,
		sourceId: string,
		businessUnitId: string,
	): Promise<EmailIngestItemResult> {
		const existingCompany = await this.findCompany(lead);
		const existingContact = await this.findContact(lead);

		if (batch.mode === "CHECK") {
			return {
				sourceId,
				company: lead.company,
				status: "checked",
				companyId: existingCompany?.id ?? null,
				contactId: existingContact?.id ?? null,
				companyAssociationAdded: false,
				contactAssociationAdded: false,
				sourceRecordId: null,
				duplicateSubmission: false,
				error: null,
			};
		}

		const signal = await this.signals.signal({
			project: batch.businessUnit,
			source: "email-gateway",
			sourceType: "prospect",
			sourceId,
			sourceUrl: lead.sourceUrl,
			entity: lead.company,
			signalScore: lead.signalScore,
			tags: lead.tags,
			payload: {
				batch_id: batch.batchId,
				company: lead.company,
				domain: lead.domain ?? null,
				contact_email: lead.contact?.email ?? null,
				qualification: lead.qualification ?? null,
				notes: lead.notes ?? null,
			},
		});

		let company = existingCompany;
		let created = false;
		if (!company) {
			const made = await this.companies.create({
				name: lead.company,
				domain: normalizeDomain(lead.domain ?? undefined) ?? undefined,
			});
			company = { id: made.id, name: made.name, domain: made.domain };
			await this.db.company.update({
				where: { id: made.id },
				data: { businessUnitId },
			});
			created = true;
		}

		const companyAssociationAdded = await this.ensureAssociation(
			"company",
			company.id,
			batch.businessUnit,
			lead.qualification,
			lead.notes,
		);

		let contact = existingContact;
		if (!contact && lead.contact?.email) {
			const names = splitName(lead.contact);
			const made = await this.contacts.create({
				firstName: names.firstName,
				lastName: names.lastName || undefined,
				email: lead.contact.email,
				phone: lead.contact.phone ?? undefined,
				title: lead.contact.title ?? undefined,
				companyId: company.id,
			});
			contact = {
				id: made.id,
				email: lead.contact.email,
				companyId: company.id,
			};
		}

		if (contact?.companyId && contact.companyId !== company.id) {
			throw new BadRequestException(
				"Existing contact email belongs to a different company; review required.",
			);
		}
		if (contact && !contact.companyId) {
			await this.contacts.update(contact.id, { companyId: company.id });
			contact = { ...contact, companyId: company.id };
		}

		let contactAssociationAdded = false;
		if (contact) {
			contactAssociationAdded = await this.ensureAssociation(
				"contact",
				contact.id,
				batch.businessUnit,
				lead.qualification,
				lead.notes,
			);
		}

		return {
			sourceId,
			company: lead.company,
			status: created ? "created" : "existing",
			companyId: company.id,
			contactId: contact?.id ?? null,
			companyAssociationAdded,
			contactAssociationAdded,
			sourceRecordId: signal.sourceRecordId,
			duplicateSubmission: signal.deduplicated,
			error: null,
		};
	}

	private async findCompany(lead: CrmEmailLead): Promise<CompanyMatch | null> {
		const domain = normalizeDomain(lead.domain ?? undefined);
		if (domain) {
			const byDomain = await this.db.company.findFirst({
				where: { domain, archivedAt: null },
				select: { id: true, name: true, domain: true },
			});
			if (byDomain) return byDomain;
		}

		return this.db.company.findFirst({
			where: {
				name: { equals: lead.company.trim(), mode: "insensitive" },
				archivedAt: null,
			},
			select: { id: true, name: true, domain: true },
		});
	}

	private async findContact(lead: CrmEmailLead): Promise<ContactMatch | null> {
		const email = lead.contact?.email?.trim().toLowerCase();
		if (!email) return null;
		return this.db.contact.findFirst({
			where: {
				email: { equals: email, mode: "insensitive" },
				archivedAt: null,
			},
			select: { id: true, email: true, companyId: true },
		});
	}

	private async ensureAssociation(
		recordType: "company" | "contact",
		recordId: string,
		targetBusinessUnit: string,
		useCase?: string | null,
		notes?: string | null,
	): Promise<boolean> {
		const existing = await this.db.businessUnitRecordAssociation.findFirst({
			where: {
				recordType,
				recordId,
				targetBusinessUnit: { key: targetBusinessUnit },
			},
			select: { id: true },
		});
		await this.businessUnits.associateRecord({
			recordType,
			recordId,
			targetBusinessUnit,
			useCase,
			notes,
		});
		return !existing;
	}
}

function splitName(contact: NonNullable<CrmEmailLead["contact"]>) {
	if (contact.firstName) {
		return {
			firstName: contact.firstName,
			lastName: contact.lastName ?? "",
		};
	}
	const parts = (contact.name ?? "Unknown").trim().split(/\s+/);
	return {
		firstName: parts[0] || "Unknown",
		lastName: parts.slice(1).join(" "),
	};
}
