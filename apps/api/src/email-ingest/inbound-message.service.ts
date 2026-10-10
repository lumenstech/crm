import { createHash } from "node:crypto";
import { ActivityType, type Db, Prisma } from "@crm/db";
import {
	HttpException,
	HttpStatus,
	Injectable,
	ServiceUnavailableException,
} from "@nestjs/common";
import { BusinessUnitsService } from "../business-units/business-units.service";
import { InjectDatabase } from "../database/database.constants";
import { IngestService } from "../ingest/ingest.service";

export type InboundChannel = "email" | "whatsapp";

export type InboundMessage = {
	channel: InboundChannel;
	externalMessageId: string;
	businessUnit: string;
	sender: string;
	recipient?: string | null;
	subject?: string | null;
	body?: string | null;
	occurredAt?: string | null;
	conversationId?: string | null;
	attachments?: Array<{
		id?: string;
		name?: string;
		mediaType?: string;
	}>;
	identityVerified?: boolean;
};

type ContactCandidate = {
	id: string;
	companyId: string | null;
	ownerId: string | null;
	companyOwnerId: string | null;
};

const MAX_BODY_CHARS = 10_000;
const MAX_MESSAGES_PER_SENDER_PER_HOUR = 60;

@Injectable()
export class InboundMessageService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly businessUnits: BusinessUnitsService,
		private readonly ingest: IngestService,
	) {}

	async process(input: InboundMessage) {
		const unit = await this.db.businessUnit.findUnique({
			where: { key: input.businessUnit },
			select: { id: true, enabled: true },
		});
		if (!unit?.enabled) {
			throw new ServiceUnavailableException(
				"The configured CRM business unit is unavailable.",
			);
		}

		const externalId = `${input.channel}:${input.externalMessageId}`;
		const prior = await this.db.activity.findUnique({
			where: { externalId },
			select: { id: true },
		});
		if (prior) {
			return {
				accepted: true,
				recorded: true,
				deduplicated: true,
				activityId: prior.id,
			};
		}

		const allowed = await this.checkRateLimit(input);
		if (!allowed) {
			throw new HttpException(
				"Inbound channel rate limit exceeded; retry later.",
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}

		const matches = await this.contactMatches(input.channel, input.sender);
		if (!input.identityVerified) {
			return this.queueUnresolved(
				input,
				matches.length,
				"sender_identity_unverified",
			);
		}
		if (matches.length !== 1) {
			return this.queueUnresolved(input, matches.length);
		}

		const [contact] = matches;
		if (!contact) {
			return this.queueUnresolved(input, matches.length);
		}

		await this.ensureAssociation("contact", contact.id, input);

		if (contact.companyId) {
			await this.ensureAssociation("company", contact.companyId, input);
		}

		const occurredAt = input.occurredAt
			? new Date(input.occurredAt)
			: new Date();
		const body = sanitizeBody(input.body);

		const activity = await this.db.activity.upsert({
			where: { externalId },
			create: {
				type:
					input.channel === "email" ? ActivityType.EMAIL : ActivityType.NOTE,
				subject:
					input.subject?.trim() ||
					(input.channel === "email" ? "Inbound email" : "WhatsApp inbound"),
				body,
				occurredAt: Number.isNaN(occurredAt.getTime())
					? new Date()
					: occurredAt,
				externalId,
				companyId: contact.companyId,
				contactId: contact.id,
				createdById: null,
				meta: {
					automated: true,
					channel: input.channel,
					direction: "inbound",
					businessUnit: input.businessUnit,
					sender: input.sender,
					recipient: input.recipient ?? null,
					conversationId: input.conversationId ?? null,
					attachments: input.attachments ?? [],
					trust: "untrusted-external",
				},
			},
			update: {},
			select: { id: true },
		});

		return {
			accepted: true,
			recorded: true,
			deduplicated: false,
			activityId: activity.id,
			contactId: contact.id,
			companyId: contact.companyId,
		};
	}

	private async ensureAssociation(
		recordType: "company" | "contact",
		recordId: string,
		input: InboundMessage,
	) {
		const target = await this.db.businessUnit.findUniqueOrThrow({
			where: { key: input.businessUnit },
			select: { id: true },
		});
		const existing = await this.db.businessUnitRecordAssociation.findUnique({
			where: {
				recordType_recordId_targetBusinessUnitId: {
					recordType,
					recordId,
					targetBusinessUnitId: target.id,
				},
			},
			select: { id: true },
		});
		if (existing) return false;
		await this.businessUnits.associateRecord({
			recordType,
			recordId,
			targetBusinessUnit: input.businessUnit,
			useCase: `${input.channel} inbound`,
			notes:
				recordType === "contact"
					? "Matched by normalized sender identity through hardened channel ingress."
					: "Associated from matched inbound contact.",
		});
		return true;
	}

	private async queueUnresolved(
		input: InboundMessage,
		matchCount: number,
		reason = matchCount === 0 ? "no_contact_match" : "ambiguous_contact_match",
	) {
		const signal = await this.ingest.signal({
			project: input.businessUnit,
			source: input.channel,
			sourceType: `${input.channel}.message`,
			sourceId: input.externalMessageId,
			observedAt: input.occurredAt ?? undefined,
			entity: null,
			tags: [input.channel, "inbound", "untrusted", "review-required"],
			payload: {
				sender: input.sender,
				recipient: input.recipient ?? null,
				subject: input.subject ?? null,
				body: sanitizeBody(input.body),
				conversationId: input.conversationId ?? null,
				attachments: input.attachments ?? [],
				matchCount,
				reason,
				trust: "untrusted-external",
			},
		});

		return {
			accepted: true,
			recorded: false,
			queuedForReview: true,
			deduplicated: signal.deduplicated,
			sourceRecordId: signal.sourceRecordId,
			reason,
		};
	}

	private async checkRateLimit(input: InboundMessage): Promise<boolean> {
		const hourBucket = Math.floor(Date.now() / 3_600_000);
		const key = `channel-ingress:${input.channel}:${input.sender.trim().toLowerCase()}:${hourBucket}`;
		const id = createHash("sha256").update(key).digest("hex");
		const row = await this.db.rateLimit.upsert({
			where: { key },
			create: {
				id,
				key,
				count: 1,
				lastRequest: BigInt(Date.now()),
			},
			update: {
				count: { increment: 1 },
				lastRequest: BigInt(Date.now()),
			},
			select: { count: true },
		});
		return row.count <= MAX_MESSAGES_PER_SENDER_PER_HOUR;
	}

	private async contactMatches(
		channel: InboundChannel,
		sender: string,
	): Promise<ContactCandidate[]> {
		if (channel === "email") {
			const email = normalizeEmail(sender);
			if (!email) return [];
			return this.db.contact
				.findMany({
					where: {
						email: { equals: email, mode: "insensitive" },
						archivedAt: null,
					},
					take: 2,
					select: {
						id: true,
						companyId: true,
						ownerId: true,
						company: { select: { ownerId: true } },
					},
				})
				.then((rows) =>
					rows.map((row) => ({
						id: row.id,
						companyId: row.companyId,
						ownerId: row.ownerId,
						companyOwnerId: row.company?.ownerId ?? null,
					})),
				);
		}

		const digits = sender.replace(/[^0-9]/g, "");
		if (digits.length < 7) return [];
		const candidates = [digits];
		if (digits.length === 11 && digits.startsWith("1")) {
			candidates.push(digits.slice(1));
		}

		return this.db.$queryRaw<ContactCandidate[]>(Prisma.sql`
			SELECT c.id,
				c."companyId" AS "companyId",
				c."ownerId" AS "ownerId",
				co."ownerId" AS "companyOwnerId"
			FROM contact c
			LEFT JOIN company co ON co.id = c."companyId"
			WHERE c."archivedAt" IS NULL
				AND regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g') IN (${Prisma.join(candidates)})
			LIMIT 2
		`);
	}
}

function normalizeEmail(value: string): string | null {
	const bracket = value.match(/<([^>]+)>/);
	const candidate = (bracket?.[1] ?? value).trim().toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function sanitizeBody(value?: string | null): string | null {
	if (!value) return null;
	const stripped = value
		.split("\n")
		.filter((line) => !line.trim().startsWith(">"))
		.join("\n")
		.replace(/On .+wrote:[\s\S]*$/gm, "")
		.replace(/^From:.+\nSent:.+\nTo:.+\nSubject:.+$/gm, "")
		.trim();
	if (!stripped) return null;
	return stripped.length > MAX_BODY_CHARS
		? `${stripped.slice(0, MAX_BODY_CHARS)}\n[Content truncated for security]`
		: stripped;
}
