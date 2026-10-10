import {
	ActivityType,
	type Db,
	EmailDirection,
	type MailboxSyncModel as MailboxSync,
	type Prisma,
	Prisma as PrismaNamespace,
	RecordSource,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import { MailboxEmailIngestService } from "../email-ingest/mailbox-email-ingest.service";
import type { SyncSource } from "./mailbox.constants";
import {
	MailboxMatchService,
	type MatchContext,
	type MatchResult,
} from "./mailbox-match.service";
import { snippetOf } from "./message-text";
import type { Participant } from "./participants";

export type IncomingMessage = {
	rfcMessageId: string;
	rootId: string;
	providerThreadId?: string | null;
	subject: string | null;
	from: Participant;
	recipients: { email: string; name: string | null; kind: "to" | "cc" }[];
	body: string;
	sentAt: Date;
	gmailMessageId?: string | null;
	outlookMessageId?: string | null;
	outlookWebLink?: string | null;
};

export type ThreadWriteRow = Pick<MailboxSync, "userId" | "autoCreate">;

export type ThreadWriteOptions = {
	mailbox: string;
	origin: SyncSource;
	providerThreadId?: string;
	skipCommandIngest?: boolean;
	match?: MatchResult;
};

export type ThreadWriteResult =
	| {
			status: "stored";
			activityId: string;
			companyId: string | null;
			contactId: string | null;
	  }
	| {
			status: "duplicate";
			activityId: string | null;
			companyId: string | null;
			contactId: string | null;
	  }
	| {
			status: "conflict";
			activityId: string | null;
			companyId: string | null;
			contactId: string | null;
			reason: string;
	  }
	| {
			status: "unresolved";
			rfcMessageId: string;
			companyId: null;
			contactId: null;
	  }
	| { status: "ignored"; rfcMessageId: string };

@Injectable()
export class ThreadWriterService {
	private readonly logger = new Logger(ThreadWriterService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly match: MailboxMatchService,
		private readonly stamp: ActivityStampService,
		private readonly emailIngest: MailboxEmailIngestService,
	) {}

	async context(): Promise<MatchContext> {
		const [internal, suppressedDomains, suppressedEmails] = await Promise.all([
			this.match.internalIdentity(),
			this.match.suppressedDomains(),
			this.match.suppressedEmails(),
		]);

		return {
			ourAddresses: internal.addresses,
			ourDomains: internal.domains,
			suppressedDomains,
			suppressedEmails,
		};
	}

	async store(
		row: ThreadWriteRow,
		options: ThreadWriteOptions,
		parsed: IncomingMessage,
		context: MatchContext,
	): Promise<boolean> {
		const result = await this.storeDetailed(row, options, parsed, context);
		return result.status === "stored";
	}

	async storeDetailed(
		row: ThreadWriteRow,
		options: ThreadWriteOptions,
		parsed: IncomingMessage,
		context: MatchContext,
	): Promise<ThreadWriteResult> {
		if (
			!options.skipCommandIngest &&
			(await this.emailIngest.handle(parsed, options.mailbox))
		) {
			return { status: "ignored", rfcMessageId: parsed.rfcMessageId };
		}

		const existing = await this.db.emailMessage.findUnique({
			where: { rfcMessageId: parsed.rfcMessageId },
			select: {
				threadId: true,
				thread: {
					select: {
						companyId: true,
						contactId: true,
						activity: { select: { id: true } },
					},
				},
			},
		});
		if (existing?.thread.activity) {
			return {
				status: "duplicate",
				activityId: existing.thread.activity.id,
				companyId: existing.thread.companyId,
				contactId: existing.thread.contactId,
			};
		}

		const repair = existing !== null;
		const participants = [parsed.from, ...parsed.recipients];
		const outbound = parsed.from.email === options.mailbox;

		const thread = existing
			? {
					id: existing.threadId,
					companyId: existing.thread.companyId,
					contactId: existing.thread.contactId,
				}
			: await this.db.emailThread.findUnique({
					where: { rootMessageId: parsed.rootId },
					select: { id: true, companyId: true, contactId: true },
				});

		let companyId = thread?.companyId ?? null;
		let contactId = thread?.contactId ?? null;

		if (!thread) {
			const repliedTo =
				outbound ||
				(await this.hasOutboundInThread(parsed.rootId, options.mailbox));

			const match =
				options.match ??
				(await this.match.resolve(
					{
						participants,
						allowCreate: row.autoCreate && repliedTo,
						source: RecordSource.EMAIL,
						ownerId: row.userId,
					},
					context,
				));

			companyId = match.companyId;
			contactId = match.contactId;

			if (!companyId && !contactId) {
				return {
					status: "unresolved",
					rfcMessageId: parsed.rfcMessageId,
					companyId: null,
					contactId: null,
				};
			}
		}

		let occurredAt: Date;
		let activityId: string;
		let writeKind: "stored" | "repair" = "stored";

		try {
			const projection = await this.db.$transaction(async (tx) => {
				await this.lockProviderMessage(tx, options, parsed);
				const existingRoot = existing
					? null
					: await tx.emailThread.findUnique({
							where: { rootMessageId: parsed.rootId },
							select: {
								id: true,
								provider: true,
								mailbox: true,
								providerThreadId: true,
								companyId: true,
								contactId: true,
								activity: { select: { id: true } },
							},
						});
				if (
					existingRoot &&
					options.providerThreadId &&
					providerScopeChanged(existingRoot, options)
				) {
					return {
						kind: "conflict" as const,
						activityId: existingRoot.activity?.id ?? null,
						companyId: existingRoot.companyId,
						contactId: existingRoot.contactId,
						reason:
							"The provider thread identity is already linked to a different mailbox or provider thread.",
					};
				}
				if (!repair) {
					const providerMessage = providerMessageWhere(options, parsed);
					if (providerMessage) {
						const existingProviderMessage = await tx.emailMessage.findFirst({
							where: {
								...providerMessage,
								thread: providerMessageThreadWhere(options),
							},
							select: {
								rfcMessageId: true,
								thread: {
									select: {
										companyId: true,
										contactId: true,
										activity: { select: { id: true } },
									},
								},
							},
						});
						if (existingProviderMessage) {
							const sameRfc =
								existingProviderMessage.rfcMessageId === parsed.rfcMessageId;
							if (sameRfc) {
								return {
									kind: "duplicate" as const,
									activityId:
										existingProviderMessage.thread.activity?.id ?? null,
									companyId: existingProviderMessage.thread.companyId,
									contactId: existingProviderMessage.thread.contactId,
								};
							}
							return {
								kind: "conflict" as const,
								activityId: existingProviderMessage.thread.activity?.id ?? null,
								companyId: existingProviderMessage.thread.companyId,
								contactId: existingProviderMessage.thread.contactId,
								reason:
									"The provider message ID is already linked to a different RFC Message-ID.",
							};
						}
					}
				}
				const record = existing
					? { id: existing.threadId }
					: existingRoot
						? { id: existingRoot.id }
						: await tx.emailThread.upsert({
								where: { rootMessageId: parsed.rootId },
								create: {
									rootMessageId: parsed.rootId,
									provider: options.providerThreadId ? options.origin : null,
									mailbox: options.providerThreadId ? options.mailbox : null,
									providerThreadId: options.providerThreadId ?? null,
									subject: parsed.subject,
									companyId,
									contactId,
									firstMessageAt: parsed.sentAt,
									lastMessageAt: parsed.sentAt,
									messageCount: 0,
								},
								update: {},
								select: { id: true },
							});
				if (
					existingRoot &&
					options.providerThreadId &&
					(!existingRoot.provider ||
						!existingRoot.mailbox ||
						!existingRoot.providerThreadId)
				) {
					await tx.emailThread.update({
						where: { id: existingRoot.id },
						data: {
							provider: options.origin,
							mailbox: options.mailbox,
							providerThreadId: options.providerThreadId,
						},
					});
				}

				if (!repair) {
					await tx.emailMessage.create({
						data: {
							threadId: record.id,
							rfcMessageId: parsed.rfcMessageId,
							syncedByUserId: row.userId,
							gmailMessageId: parsed.gmailMessageId ?? null,
							outlookMessageId: parsed.outlookMessageId ?? null,
							outlookWebLink: parsed.outlookWebLink ?? null,
							direction: outbound
								? EmailDirection.OUTBOUND
								: EmailDirection.INBOUND,
							fromEmail: parsed.from.email,
							fromName: parsed.from.name,
							recipients: parsed.recipients,
							subject: parsed.subject,
							snippet: snippetOf(parsed.body),
							body: parsed.body || null,
							sentAt: parsed.sentAt,
						},
					});
				}

				const stats = await tx.emailMessage.aggregate({
					where: { threadId: record.id },
					_count: { _all: true },
					_min: { sentAt: true },
					_max: { sentAt: true },
				});

				const firstMessageAt = stats._min.sentAt ?? parsed.sentAt;
				const lastMessageAt = stats._max.sentAt ?? parsed.sentAt;

				const data: Prisma.EmailThreadUpdateInput = {
					messageCount: stats._count._all,
					firstMessageAt,
					lastMessageAt,
				};

				if (parsed.sentAt <= firstMessageAt) data.subject = parsed.subject;

				await tx.emailThread.update({ where: { id: record.id }, data });

				const activity = await this.project(tx, record.id, row.userId, {
					subject: parsed.subject ?? "(no subject)",
					snippet: snippetOf(parsed.body),
					lastMessageAt,
					companyId,
					contactId,
					origin: options.origin,
				});
				return {
					kind: repair ? ("repair" as const) : ("stored" as const),
					id: activity.id,
					occurredAt: activity.occurredAt,
				};
			});
			if (projection.kind === "duplicate") {
				return {
					status: "duplicate",
					activityId: projection.activityId,
					companyId: projection.companyId,
					contactId: projection.contactId,
				};
			}
			if (projection.kind === "conflict") {
				return {
					status: "conflict",
					activityId: projection.activityId,
					companyId: projection.companyId,
					contactId: projection.contactId,
					reason: projection.reason,
				};
			}
			writeKind = projection.kind;
			occurredAt = projection.occurredAt;
			activityId = projection.id;
		} catch (error) {
			if (await this.storedElsewhere(error, parsed.rfcMessageId)) {
				return {
					status: "duplicate",
					activityId: null,
					companyId,
					contactId,
				};
			}
			throw error;
		}

		await this.touch({ companyId, contactId }, occurredAt, parsed.rfcMessageId);

		return {
			status: writeKind === "repair" ? "duplicate" : "stored",
			activityId,
			companyId,
			contactId,
		};
	}

	private async lockProviderMessage(
		tx: Prisma.TransactionClient,
		options: ThreadWriteOptions,
		parsed: IncomingMessage,
	): Promise<void> {
		const providerMessage = providerMessageWhere(options, parsed);
		if (!providerMessage) return;
		const providerMessageId =
			options.origin === "gmail"
				? parsed.gmailMessageId
				: parsed.outlookMessageId;
		if (!providerMessageId) return;
		const lockKey = JSON.stringify([
			options.origin,
			options.mailbox,
			providerMessageId,
		]);
		await tx.$executeRaw(
			PrismaNamespace.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
		);
	}

	private async storedElsewhere(
		cause: unknown,
		rfcMessageId: string,
	): Promise<boolean> {
		const duplicate =
			cause instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			cause.code === "P2002";
		if (!duplicate) return false;

		const winner = await this.db.emailMessage.findFirst({
			where: { rfcMessageId, thread: { activity: { isNot: null } } },
			select: { id: true },
		});

		return winner !== null;
	}

	private async touch(
		target: { companyId: string | null; contactId: string | null },
		at: Date,
		rfcMessageId: string,
	): Promise<void> {
		try {
			await this.stamp.touch(target, at);
		} catch (error) {
			this.logger.error(
				{
					message: "An email was stored but its activity stamps were not moved",
					rfcMessageId,
					...target,
				},
				error instanceof Error ? error.stack : String(error),
			);
		}
	}

	private async hasOutboundInThread(
		rootMessageId: string,
		mailbox: string,
	): Promise<boolean> {
		const found = await this.db.emailMessage.findFirst({
			where: {
				thread: { rootMessageId },
				fromEmail: mailbox,
			},
			select: { id: true },
		});

		return found !== null;
	}

	private async project(
		tx: Prisma.TransactionClient,
		emailThreadId: string,
		userId: string,
		summary: {
			subject: string;
			snippet: string | null;
			lastMessageAt: Date;
			companyId: string | null;
			contactId: string | null;
			origin: SyncSource;
		},
	): Promise<{ id: string; occurredAt: Date }> {
		const activity = await tx.activity.upsert({
			where: { emailThreadId },
			create: {
				type: ActivityType.EMAIL,
				subject: summary.subject,
				body: summary.snippet,
				occurredAt: summary.lastMessageAt,
				companyId: summary.companyId,
				contactId: summary.contactId,
				createdById: userId,
				emailThreadId,
				meta: { synced: true, source: summary.origin },
			},
			update: {
				body: summary.snippet,
				occurredAt: summary.lastMessageAt,
			},
			select: { id: true, occurredAt: true },
		});

		return {
			id: activity.id,
			occurredAt: activity.occurredAt ?? summary.lastMessageAt,
		};
	}
}

function providerMessageWhere(
	options: ThreadWriteOptions,
	parsed: IncomingMessage,
): Prisma.EmailMessageWhereInput | null {
	if (options.origin === "gmail" && parsed.gmailMessageId) {
		return { gmailMessageId: parsed.gmailMessageId };
	}
	if (options.origin === "outlook" && parsed.outlookMessageId) {
		return { outlookMessageId: parsed.outlookMessageId };
	}
	return null;
}

function providerMessageThreadWhere(
	options: ThreadWriteOptions,
): Prisma.EmailThreadWhereInput {
	return {
		OR: [
			{ provider: options.origin, mailbox: options.mailbox },
			{ provider: null, mailbox: null, providerThreadId: null },
		],
	};
}

function providerScopeChanged(
	existing: {
		provider: string | null;
		mailbox: string | null;
		providerThreadId: string | null;
	},
	options: ThreadWriteOptions,
): boolean {
	const hasIdentity =
		existing.provider !== null ||
		existing.mailbox !== null ||
		existing.providerThreadId !== null;
	if (!hasIdentity) return false;

	return (
		existing.provider !== options.origin ||
		existing.mailbox !== options.mailbox ||
		(existing.providerThreadId !== null &&
			existing.providerThreadId !== options.providerThreadId)
	);
}