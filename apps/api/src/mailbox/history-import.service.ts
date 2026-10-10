import { type Db, EmailDirection, Prisma as PrismaNamespace } from "@crm/db";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	type HistoricalEmailImportInput,
	type HistoricalEmailImportOutput,
} from "./history-import.contracts";
import { MailboxMatchService } from "./mailbox-match.service";
import {
	type IncomingMessage,
	ThreadWriterService,
} from "./thread-writer.service";

@Injectable()
export class HistoricalEmailImportService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly match: MailboxMatchService,
		private readonly threads: ThreadWriterService,
	) {}

	async import(
		input: HistoricalEmailImportInput,
		userId: string,
		userEmail: string,
	): Promise<HistoricalEmailImportOutput> {
		const mailbox = userEmail.toLowerCase();
		if (input.mailbox !== mailbox) {
			throw new ForbiddenException(
				"The historical mailbox must match the authenticated CRM user.",
			);
		}

		const outbound = input.from.email === mailbox;
		if (
			!outbound &&
			!input.recipients.some((recipient) => recipient.email === mailbox)
		) {
			throw new BadRequestException(
				"The authenticated mailbox must be the sender or a recipient.",
			);
		}

		const originalSentAt = new Date(input.sentAt);
		const direction = outbound
			? EmailDirection.OUTBOUND
			: EmailDirection.INBOUND;
		const existing = await this.existingIdentity(input);
		if (existing.status === "duplicate") {
			return this.result(input, direction, originalSentAt, {
				status: "duplicate",
				companyId: existing.thread.companyId,
				contactId: existing.thread.contactId,
				activityId: existing.thread.activity?.id ?? null,
				emailThreadId: existing.thread.id,
				candidates: [],
				reason: null,
			});
		}
		if (existing.status === "conflict") {
			return this.result(input, direction, originalSentAt, {
				status: "conflict",
				companyId: existing.thread?.companyId ?? null,
				contactId: existing.thread?.contactId ?? null,
				activityId: existing.thread?.activity?.id ?? null,
				emailThreadId: existing.thread?.id ?? null,
				candidates: [],
				reason: existing.reason,
			});
		}

		const context = await this.threads.context();
		const match = await this.match.resolveHistorical(
			[input.from, ...input.recipients],
			context,
		);
		if (match.status !== "resolved") {
			return this.result(input, direction, originalSentAt, {
				status: match.status,
				companyId: null,
				contactId: null,
				activityId: null,
				emailThreadId: null,
				candidates: match.candidates,
				reason: match.reason,
			});
		}

		const root = await this.db.emailThread.findUnique({
			where: { rootMessageId: input.rootMessageId },
			select: {
				id: true,
				companyId: true,
				contactId: true,
				activity: { select: { id: true } },
			},
		});
		if (
			root &&
			(root.companyId !== match.match.companyId ||
				root.contactId !== match.match.contactId)
		) {
			return this.result(input, direction, originalSentAt, {
				status: "conflict",
				companyId: root.companyId,
				contactId: root.contactId,
				activityId: root.activity?.id ?? null,
				emailThreadId: root.id,
				candidates: [],
				reason:
					"The existing canonical thread has a different company or contact association.",
			});
		}

		const parsed: IncomingMessage = {
			rfcMessageId: input.rfcMessageId,
			rootId: input.rootMessageId,
			subject: input.subject,
			from: input.from,
			recipients: input.recipients,
			body: input.body,
			sentAt: originalSentAt,
			gmailMessageId: input.source === "gmail" ? input.providerMessageId : null,
			outlookMessageId:
				input.source === "outlook" ? input.providerMessageId : null,
			outlookWebLink: input.outlookWebLink ?? null,
		};

		try {
			const stored = await this.threads.storeDetailed(
				{ userId, autoCreate: false },
				{
					mailbox,
					origin: input.source,
					providerThreadId: input.providerThreadId,
					skipCommandIngest: true,
					match: match.match,
				},
				parsed,
				context,
			);
			if (stored.status === "unresolved") {
				return this.result(input, direction, originalSentAt, {
					status: "unresolved",
					companyId: null,
					contactId: null,
					activityId: null,
					emailThreadId: null,
					candidates: [],
					reason:
						"The canonical thread writer could not resolve this historical message.",
				});
			}
			if (stored.status === "ignored") {
				return this.result(input, direction, originalSentAt, {
					status: "conflict",
					companyId: null,
					contactId: null,
					activityId: null,
					emailThreadId: null,
					candidates: [],
					reason: "The canonical thread writer ignored this message.",
				});
			}
			const canonical = await this.db.emailMessage.findUnique({
				where: { rfcMessageId: input.rfcMessageId },
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
			return this.result(input, direction, originalSentAt, {
				status: stored.status === "duplicate" ? "duplicate" : "imported",
				companyId: canonical?.thread.companyId ?? stored.companyId,
				contactId: canonical?.thread.contactId ?? stored.contactId,
				activityId: canonical?.thread.activity?.id ?? stored.activityId,
				emailThreadId: canonical?.threadId ?? null,
				candidates: [],
				reason: null,
			});
		} catch (error) {
			if (
				error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
				error.code === "P2002"
			) {
				const winner = await this.existingIdentity(input);
				if (winner.status === "duplicate") {
					return this.result(input, direction, originalSentAt, {
						status: "duplicate",
						companyId: winner.thread.companyId,
						contactId: winner.thread.contactId,
						activityId: winner.thread.activity?.id ?? null,
						emailThreadId: winner.thread.id,
						candidates: [],
						reason: null,
					});
				}
				if (winner.status === "conflict") {
					return this.result(input, direction, originalSentAt, {
						status: "conflict",
						companyId: winner.thread?.companyId ?? null,
						contactId: winner.thread?.contactId ?? null,
						activityId: winner.thread?.activity?.id ?? null,
						emailThreadId: winner.thread?.id ?? null,
						candidates: [],
						reason: winner.reason,
					});
				}
			}
			throw error;
		}
	}

	private async existingIdentity(input: HistoricalEmailImportInput) {
		const [byRfc, byProviderMessage, byProviderThread] = await Promise.all([
			this.db.emailMessage.findUnique({
				where: { rfcMessageId: input.rfcMessageId },
				select: {
					threadId: true,
					gmailMessageId: true,
					outlookMessageId: true,
					thread: {
						select: {
							id: true,
							rootMessageId: true,
							companyId: true,
							contactId: true,
							activity: { select: { id: true } },
						},
					},
				},
			}),
			this.db.emailMessage.findFirst({
				where:
					input.source === "gmail"
						? { gmailMessageId: input.providerMessageId }
						: { outlookMessageId: input.providerMessageId },
				select: {
					rfcMessageId: true,
					thread: {
						select: {
							id: true,
							rootMessageId: true,
							companyId: true,
							contactId: true,
							activity: { select: { id: true } },
						},
					},
				},
			}),
			this.db.emailThread.findUnique({
				where: {
					provider_mailbox_providerThreadId: {
						provider: input.source,
						mailbox: input.mailbox,
						providerThreadId: input.providerThreadId,
					},
				},
				select: {
					id: true,
					rootMessageId: true,
					companyId: true,
					contactId: true,
					activity: { select: { id: true } },
				},
			}),
		]);

		if (byRfc) {
			const sameProvider =
				(input.source === "gmail" &&
					byRfc.gmailMessageId === input.providerMessageId) ||
				(input.source === "outlook" &&
					byRfc.outlookMessageId === input.providerMessageId);
			if (
				sameProvider &&
				byRfc.thread.rootMessageId === input.rootMessageId &&
				byRfc.thread.activity
			) {
				return { status: "duplicate" as const, thread: byRfc.thread };
			}
			return {
				status: "conflict" as const,
				thread: byRfc.thread,
				reason:
					"The RFC Message-ID is already linked to different provider or thread identity.",
			};
		}
		if (byProviderMessage) {
			return {
				status: "conflict" as const,
				thread: byProviderMessage.thread,
				reason:
					"The provider message ID is already linked to a different RFC Message-ID.",
			};
		}
		if (byProviderThread) {
			if (byProviderThread.rootMessageId === input.rootMessageId) {
				return { status: "new" as const };
			}
			return {
				status: "conflict" as const,
				thread: byProviderThread,
				reason:
					"The provider thread ID is already linked to a different canonical thread.",
			};
		}
		return { status: "new" as const };
	}

	private result(
		input: HistoricalEmailImportInput,
		direction: EmailDirection,
		originalSentAt: Date,
		values: {
			status: HistoricalEmailImportOutput["status"];
			companyId: string | null;
			contactId: string | null;
			activityId: string | null;
			emailThreadId: string | null;
			candidates: HistoricalEmailImportOutput["candidates"];
			reason: string | null;
		},
	): HistoricalEmailImportOutput {
		return {
			status: values.status,
			source: input.source,
			providerMessageId: input.providerMessageId,
			providerThreadId: input.providerThreadId,
			rfcMessageId: input.rfcMessageId,
			direction: direction === EmailDirection.OUTBOUND ? "outbound" : "inbound",
			companyId: values.companyId,
			contactId: values.contactId,
			activityId: values.activityId,
			emailThreadId: values.emailThreadId,
			originalSentAt: originalSentAt.toISOString(),
			candidates: values.candidates,
			reason: values.reason,
		};
	}
}
