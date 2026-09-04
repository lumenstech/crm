import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type {
	IngestSignalRequest,
	IngestSignalResult,
} from "./ingest.contracts";

@Injectable()
export class IngestService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async ingestSignal(input: IngestSignalRequest): Promise<IngestSignalResult> {
		const duplicate = await this.db.$queryRawUnsafe<Array<{ id: string }>>(
			'SELECT id FROM "crmIngestEvent" WHERE "eventId" = $1 LIMIT 1',
			input.eventId,
		);
		if (duplicate.length > 0) {
			return { status: "duplicate", eventId: input.eventId };
		}

		let companyId: string | undefined;
		if (input.entity) {
			const match = input.entity.domain
				? await this.db.company.findFirst({
					where: { domain: input.entity.domain, archivedAt: null },
					select: { id: true },
				})
				: await this.db.company.findFirst({
					where: { name: input.entity.name, archivedAt: null },
					select: { id: true },
				});

			if (match) {
				companyId = match.id;
			} else {
				const created = await this.db.company.create({
					data: {
						name: input.entity.name,
						domain: input.entity.domain,
						website: input.entity.website,
						email: input.entity.email,
						phone: input.entity.phone,
						city: input.entity.city,
						stateCode: input.entity.stateCode,
						countryCode: input.entity.countryCode,
						source: "IMPORT",
					},
					select: { id: true },
				});
				companyId = created.id;
			}
		}

		let contactId: string | undefined;
		if (input.contact) {
			const existing = input.contact.email
				? await this.db.contact.findFirst({
					where: { email: input.contact.email, archivedAt: null },
					select: { id: true },
				})
				: null;
			if (existing) {
				contactId = existing.id;
			} else {
				const created = await this.db.contact.create({
					data: {
						firstName: input.contact.firstName,
						lastName: input.contact.lastName,
						email: input.contact.email,
						phone: input.contact.phone,
						title: input.contact.title,
						linkedinUrl: input.contact.linkedinUrl,
						companyId,
						source: "IMPORT",
					},
					select: { id: true },
				});
				contactId = created.id;
			}
		}

		const signalId = randomUUID();
		const taskId = randomUUID();
		const now = new Date();
		const observedAt = input.observedAt ? new Date(input.observedAt) : now;
		const score = Math.max(0, Math.min(100, input.score ?? 50));
		const payload = JSON.stringify(input.payload ?? {});
		const tags = JSON.stringify(input.tags ?? []);

		await this.db.$transaction([
			this.db.$executeRawUnsafe(
				'INSERT INTO "crmIngestEvent" (id, "eventId", project, source, "sourceType", payload, "receivedAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',
				randomUUID(),
				input.eventId,
				input.project,
				input.source,
				input.sourceType,
				payload,
				now,
			),
			this.db.$executeRawUnsafe(
				'INSERT INTO "crmSignal" (id, project, source, "sourceType", title, description, url, score, tags, "companyId", "contactId", "observedAt", "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)',
				signalId,
				input.project,
				input.source,
				input.sourceType,
				input.title,
				input.description ?? null,
				input.url ?? null,
				score,
				tags,
				companyId ?? null,
				contactId ?? null,
				observedAt,
				now,
			),
			this.db.$executeRawUnsafe(
				'INSERT INTO "agentTask" (id, "contactId", "companyId", kind, reason, payload, priority, budget, attempts, "dueAt", subject, "createdAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,0,$9,$10,$11)',
				taskId,
				contactId ?? null,
				companyId ?? null,
				"qualify_signal",
				`New ${input.sourceType} signal from ${input.source} for ${input.project}`,
				JSON.stringify({ signalId, eventId: input.eventId, project: input.project }),
				Math.round(score),
				4,
				now,
				input.title,
				now,
			),
		]);

		return {
			status: "accepted",
			eventId: input.eventId,
			signalId,
			companyId,
			contactId,
			agentTaskId: taskId,
		};
	}
}
