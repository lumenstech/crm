import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

type BusinessUnitRef = {
	id: string;
	key: string;
	name: string;
};

export type SearchHit = {
	kind: "company" | "contact" | "deal";
	id: string;
	label: string;
	detail: string | null;
	iconUrl: string | null;
	iconDarkUrl: string | null;
	iconTone: string | null;
	imageUrl: string | null;
	sourceBusinessUnit: BusinessUnitRef | null;
	associatedBusinessUnits: BusinessUnitRef[];
};

const PER_KIND = 5;

@Injectable()
export class SearchService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async quick(q: string): Promise<{ hits: SearchHit[] }> {
		const term = q.trim();
		if (term.length < 2) return { hits: [] };

		const [companies, contacts, deals] = await Promise.all([
			this.db.company.findMany({
				where: {
					OR: [
						{ name: { contains: term, mode: "insensitive" } },
						{ domain: { contains: term, mode: "insensitive" } },
					],
				},
				take: PER_KIND,
				orderBy: { name: "asc" },
				select: {
					id: true,
					name: true,
					domain: true,
					iconUrl: true,
					iconDarkUrl: true,
					iconTone: true,
					businessUnit: { select: { id: true, key: true, name: true } },
				},
			}),
			this.db.contact.findMany({
				where: {
					OR: [
						{ firstName: { contains: term, mode: "insensitive" } },
						{ lastName: { contains: term, mode: "insensitive" } },
						{ email: { contains: term, mode: "insensitive" } },
						{ title: { contains: term, mode: "insensitive" } },
						{ company: { name: { contains: term, mode: "insensitive" } } },
					],
				},
				take: PER_KIND,
				orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					imageUrl: true,
					company: {
						select: {
							name: true,
							businessUnit: { select: { id: true, key: true, name: true } },
						},
					},
				},
			}),
			this.db.deal.findMany({
				where: { name: { contains: term, mode: "insensitive" } },
				take: PER_KIND,
				orderBy: [{ stage: "asc" }, { name: "asc" }],
				select: {
					id: true,
					name: true,
					businessUnit: { select: { id: true, key: true, name: true } },
					company: {
						select: {
							name: true,
							iconUrl: true,
							iconDarkUrl: true,
							iconTone: true,
						},
					},
				},
			}),
		]);

		const companyIds = companies.map((row) => row.id);
		const contactIds = contacts.map((row) => row.id);
		const associations =
			companyIds.length > 0 || contactIds.length > 0
				? await this.db.businessUnitRecordAssociation.findMany({
						where: {
							OR: [
								...(companyIds.length > 0
									? [{ recordType: "company", recordId: { in: companyIds } }]
									: []),
								...(contactIds.length > 0
									? [{ recordType: "contact", recordId: { in: contactIds } }]
									: []),
							],
						},
						select: {
							recordType: true,
							recordId: true,
							targetBusinessUnit: {
								select: { id: true, key: true, name: true },
							},
						},
					})
				: [];

		const byRecord = new Map<string, BusinessUnitRef[]>();
		for (const row of associations) {
			const key = `${row.recordType}:${row.recordId}`;
			const list = byRecord.get(key) ?? [];
			list.push(row.targetBusinessUnit);
			byRecord.set(key, list);
		}

		return {
			hits: [
				...companies.map(
					(company): SearchHit => ({
						kind: "company",
						id: company.id,
						label: company.name,
						detail: company.domain,
						iconUrl: company.iconUrl,
						iconDarkUrl: company.iconDarkUrl,
						iconTone: company.iconTone,
						imageUrl: null,
						sourceBusinessUnit: company.businessUnit,
						associatedBusinessUnits: byRecord.get(`company:${company.id}`) ?? [],
					}),
				),
				...contacts.map(
					(contact): SearchHit => ({
						kind: "contact",
						id: contact.id,
						label:
							[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
							(contact.email ?? "Unnamed"),
						detail: contact.company?.name ?? contact.email,
						iconUrl: null,
						iconDarkUrl: null,
						iconTone: null,
						imageUrl: contact.imageUrl,
						sourceBusinessUnit: contact.company?.businessUnit ?? null,
						associatedBusinessUnits: byRecord.get(`contact:${contact.id}`) ?? [],
					}),
				),
				...deals.map(
					(deal): SearchHit => ({
						kind: "deal",
						id: deal.id,
						label: deal.name,
						detail: deal.company.name,
						iconUrl: deal.company.iconUrl,
						iconDarkUrl: deal.company.iconDarkUrl,
						iconTone: deal.company.iconTone,
						imageUrl: null,
						sourceBusinessUnit: deal.businessUnit,
						associatedBusinessUnits: [],
					}),
				),
			],
		};
	}
}
