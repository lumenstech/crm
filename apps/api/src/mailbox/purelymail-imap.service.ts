import { type Db, GoogleSyncStatus } from "@crm/db";
import {
	Injectable,
	Logger,
	type OnApplicationShutdown,
	type OnModuleInit,
} from "@nestjs/common";
import { type FetchMessageObject, ImapFlow } from "imapflow";
import {
	type AddressObject,
	type EmailAddress,
	simpleParser,
} from "mailparser";
import { BusinessUnitsService } from "../business-units/business-units.service";
import { InjectDatabase } from "../database/database.constants";
import { normaliseMessageId, rootMessageIdFrom } from "./message-text";
import { type Participant, parseAddress } from "./participants";
import { sanitizePurelymailError } from "./purelymail-credential.crypto";
import {
	type ActivePurelymailCredential,
	PurelymailCredentialService,
} from "./purelymail-credential.service";
import { parseCursor, selectPurelymailUids } from "./purelymail-cursor";
import {
	purelymailImapMessageId,
	purelymailProviderThreadId,
} from "./purelymail-identity";
import { PURELYMAIL_IMAP } from "./purelymail-imap.config";
import { SyncStateService } from "./sync-state.service";
import {
	type IncomingMessage,
	type ThreadWriteResult,
	ThreadWriterService,
} from "./thread-writer.service";

export type PurelymailMessageEvidence = {
	mailbox: string;
	folder: string;
	uidValidity: string;
	uid: number;
	messageId: string;
	messageDate: string;
	status: ThreadWriteResult["status"];
	activityId?: string | null;
	dispositionId?: string;
};

export type PurelymailPollSummary = {
	status: "disabled" | "ok" | "failed";
	mailbox: string;
	businessUnit: { id: string; key: string; name: string } | null;
	folder: string | null;
	uidValidity: string | null;
	attempted: number;
	processed: number;
	unresolved: number;
	duplicates: number;
	skipped: number;
	failed: number;
	evidence: PurelymailMessageEvidence[];
};

@Injectable()
export class PurelymailImapService
	implements OnModuleInit, OnApplicationShutdown
{
	private readonly logger = new Logger(PurelymailImapService.name);
	private active: Promise<PurelymailPollSummary> | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly state: SyncStateService,
		private readonly writer: ThreadWriterService,
		private readonly businessUnits: BusinessUnitsService,
		private readonly credentials: PurelymailCredentialService,
	) {}

	onModuleInit(): void {
		void this.pollAndLog();
		this.timer = setInterval(
			() => void this.pollAndLog(),
			PURELYMAIL_IMAP.pollIntervalMs,
		);
	}

	async onApplicationShutdown(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		if (this.active) await this.active;
	}

	poll(claimedRowId?: string): Promise<PurelymailPollSummary> {
		if (this.active) return this.active;
		this.active = this.run(claimedRowId)
			.catch((error) => {
				this.logger.error({
					message: "Purelymail IMAP synchronization failed before connection",
					errorCode: sanitizePurelymailError(
						error instanceof Error
							? error
							: "Purelymail synchronization failed.",
					),
				});
				const summary = emptySummary("failed");
				summary.failed = 1;
				return summary;
			})
			.finally(() => {
				this.active = null;
			});
		return this.active;
	}

	private async pollAndLog(): Promise<void> {
		const summary = await this.poll();
		this.logger.log({
			message: "Purelymail IMAP synchronization",
			status: summary.status,
			mailbox: summary.mailbox,
			folder: summary.folder,
			uidValidity: summary.uidValidity,
			attempted: summary.attempted,
			processed: summary.processed,
			unresolved: summary.unresolved,
			duplicates: summary.duplicates,
			skipped: summary.skipped,
			failed: summary.failed,
		});
	}

	private async run(claimedRowId?: string): Promise<PurelymailPollSummary> {
		const credential = await this.credentials.active();
		if (!credential) return emptySummary("disabled");

		const summary = emptySummary("ok");
		const unit = (await this.businessUnits.list()).find(
			(candidate) => candidate.key === "data-gear",
		);
		if (!unit) {
			summary.status = "failed";
			summary.failed += 1;
			return summary;
		}
		summary.businessUnit = {
			id: unit.id,
			key: unit.key,
			name: unit.name,
		};

		let row = claimedRowId
			? await this.state.get(credential.userId, PURELYMAIL_IMAP.source)
			: ((await this.state.get(credential.userId, PURELYMAIL_IMAP.source)) ??
				(await this.state.ensureUnchanged(
					credential.userId,
					PURELYMAIL_IMAP.source,
				)));
		if (!row || (claimedRowId && row.id !== claimedRowId)) {
			return emptySummary("disabled");
		}
		if (!claimedRowId && !(await this.state.claim(row, new Date()))) {
			return emptySummary("disabled");
		}
		if (!claimedRowId) {
			const claimedRow = await this.state.get(
				credential.userId,
				PURELYMAIL_IMAP.source,
			);
			if (!claimedRow) return emptySummary("disabled");
			row = claimedRow;
		}
		if (await this.stopIfCredentialChanged(credential, row, summary)) {
			return summary;
		}
		const client = this.createClient({
			host: PURELYMAIL_IMAP.host,
			port: PURELYMAIL_IMAP.port,
			secure: PURELYMAIL_IMAP.secure,
			servername: PURELYMAIL_IMAP.host,
			auth: { user: PURELYMAIL_IMAP.mailbox, pass: credential.password },
			disableAutoIdle: true,
			logger: false,
			connectionTimeout: PURELYMAIL_IMAP.connectionTimeoutMs,
			greetingTimeout: PURELYMAIL_IMAP.greetingTimeoutMs,
			socketTimeout: PURELYMAIL_IMAP.socketTimeoutMs,
			maxLiteralSize: PURELYMAIL_IMAP.maxMessageBytes + 1,
			maxResponseSize: PURELYMAIL_IMAP.maxMessageBytes + 16_384,
		});

		try {
			await client.connect();
			if (await this.stopIfCredentialChanged(credential, row, summary)) {
				return summary;
			}
			const folder = credential.folder;
			summary.folder = folder;
			const lock = await client.getMailboxLock(folder, { readOnly: true });
			try {
				const mailbox = client.mailbox;
				if (mailbox === false || !mailbox?.readOnly) {
					throw new Error("Purelymail mailbox was not opened read-only.");
				}
				if (await this.stopIfCredentialChanged(credential, row, summary)) {
					return summary;
				}
				const uidValidity = mailbox.uidValidity.toString();
				summary.uidValidity = uidValidity;
				const cursor = parseCursor(row.cursor);
				const found = await client.search({ all: true }, { uid: true });
				const page = selectPurelymailUids(
					Array.isArray(found) ? found : [],
					cursor,
					folder,
					uidValidity,
					PURELYMAIL_IMAP.maxMessagesPerTick,
				);
				const uids = page.uids;
				if (uids.length > 0) {
					if (await this.stopIfCredentialChanged(credential, row, summary)) {
						return summary;
					}
					const messages = await client.fetchAll(
						uids,
						{
							uid: true,
							internalDate: true,
							size: true,
							source: {
								maxLength: PURELYMAIL_IMAP.maxMessageBytes + 1,
							},
						},
						{ uid: true },
					);
					const context = await this.writer.context();
					const mailboxContext = {
						...context,
						ourAddresses: new Set([
							...context.ourAddresses,
							PURELYMAIL_IMAP.mailbox,
						]),
					};
					for (const message of messages) {
						if (await this.stopIfCredentialChanged(credential, row, summary)) {
							return summary;
						}
						await this.processMessage(
							message,
							folder,
							uidValidity,
							row,
							mailboxContext,
							summary,
						);
					}
				}
				if (await this.stopIfCredentialChanged(credential, row, summary)) {
					return summary;
				}
				if (summary.failed > 0) {
					summary.status = "failed";
					await this.state.markFailed(
						row.id,
						"Purelymail message processing failed.",
						row.updatedAt,
					);
				} else {
					await this.state.settle(
						row.id,
						{
							cursor: JSON.stringify(page.nextCursor),
							status: GoogleSyncStatus.IDLE,
						},
						row.updatedAt,
					);
				}
			} finally {
				lock.release();
			}
		} catch (error) {
			summary.status = "failed";
			summary.failed += 1;
			const errorCode = sanitizePurelymailError(
				error instanceof Error ? error : "Purelymail synchronization failed.",
			);
			await this.state.markFailed(row.id, errorCode, row.updatedAt);
			this.logger.error({
				message: "Purelymail IMAP synchronization failed",
				errorCode,
			});
		} finally {
			if (client.usable) {
				await client.logout().catch(() => client.close());
			} else {
				client.close();
			}
		}

		return summary;
	}

	private async stopIfCredentialChanged(
		credential: ActivePurelymailCredential,
		row: Awaited<ReturnType<SyncStateService["get"]>>,
		summary: PurelymailPollSummary,
	): Promise<boolean> {
		if (!row || (await this.credentials.isCurrent(credential))) return false;
		summary.status = "disabled";
		await this.state.cancel(row);
		return true;
	}

	protected createClient(
		options: ConstructorParameters<typeof ImapFlow>[0],
	): ImapFlow {
		return new ImapFlow(options);
	}

	private async processMessage(
		message: FetchMessageObject,
		folder: string,
		uidValidity: string,
		row: Awaited<ReturnType<SyncStateService["ensure"]>>,
		context: Awaited<ReturnType<ThreadWriterService["context"]>>,
		summary: PurelymailPollSummary,
	): Promise<void> {
		summary.attempted += 1;
		if (!message.source) {
			summary.failed += 1;
			return;
		}
		if (
			(message.size ?? message.source.length) > PURELYMAIL_IMAP.maxMessageBytes
		) {
			const providerMessageId = purelymailImapMessageId({
				mailbox: PURELYMAIL_IMAP.mailbox,
				folder,
				uidValidity,
				uid: message.uid,
			});
			const reason = message.source
				? `Message exceeds the ${PURELYMAIL_IMAP.maxMessageBytes}-byte import limit.`
				: "Message source was not available for import.";
			await this.db.mailboxSyncDisposition.upsert({
				where: {
					source_rfcMessageId: {
						source: PURELYMAIL_IMAP.source,
						rfcMessageId: providerMessageId,
					},
				},
				create: {
					source: PURELYMAIL_IMAP.source,
					mailbox: PURELYMAIL_IMAP.mailbox,
					userId: row.userId,
					rfcMessageId: providerMessageId,
					folder,
					uidValidity,
					uid: message.uid,
					status: "SKIPPED",
					reason,
				},
				update: {
					status: "SKIPPED",
					reason,
					folder,
					uidValidity,
					uid: message.uid,
				},
				select: { id: true },
			});
			summary.skipped += 1;
			return;
		}
		const incoming = await parseIncomingMessage(
			message.source,
			message.uid,
			uidValidity,
			message.internalDate,
		);
		const providerMessageId = purelymailImapMessageId({
			mailbox: PURELYMAIL_IMAP.mailbox,
			folder,
			uidValidity,
			uid: message.uid,
		});
		const result = await this.writer.storeDetailed(
			row,
			{
				mailbox: PURELYMAIL_IMAP.mailbox,
				origin: PURELYMAIL_IMAP.source,
				providerThreadId: purelymailProviderThreadId(incoming.rootId),
			},
			{ ...incoming, purelymailMessageId: providerMessageId },
			context,
		);
		const evidence: PurelymailMessageEvidence = {
			mailbox: PURELYMAIL_IMAP.mailbox,
			folder,
			uidValidity,
			uid: message.uid,
			messageId: incoming.rfcMessageId,
			messageDate: incoming.sentAt.toISOString(),
			status: result.status,
			activityId: "activityId" in result ? result.activityId : undefined,
		};
		if (result.status === "stored") summary.processed += 1;
		if (result.status === "duplicate") summary.duplicates += 1;
		if (result.status === "unresolved") {
			summary.unresolved += 1;
			const disposition = await this.db.mailboxSyncDisposition.upsert({
				where: {
					source_rfcMessageId: {
						source: PURELYMAIL_IMAP.source,
						rfcMessageId: incoming.rfcMessageId,
					},
				},
				create: {
					source: PURELYMAIL_IMAP.source,
					mailbox: PURELYMAIL_IMAP.mailbox,
					userId: row.userId,
					rfcMessageId: incoming.rfcMessageId,
					folder,
					uidValidity,
					uid: message.uid,
					status: "UNRESOLVED",
					reason: "No canonical company or contact match",
					candidateIds: incoming.recipients.map((recipient) => recipient.email),
				},
				update: { status: "UNRESOLVED", uidValidity, uid: message.uid },
				select: { id: true },
			});
			evidence.dispositionId = disposition.id;
		}
		summary.evidence.push(evidence);
	}
}

export async function parseIncomingMessage(
	source: Buffer,
	uid: number,
	uidValidity: string,
	internalDate?: Date | string,
): Promise<IncomingMessage> {
	const parsed = await simpleParser(source, {
		skipHtmlToText: true,
		skipTextToHtml: true,
		skipImageLinks: true,
		maxHtmlLengthToParse: 0,
	});
	const from = participantsOf(parsed.from)[0];
	if (!from) throw new Error("Purelymail message has no valid sender.");
	const to = participantsOf(parsed.to).map((participant) => ({
		...participant,
		kind: "to" as const,
	}));
	const cc = participantsOf(parsed.cc).map((participant) => ({
		...participant,
		kind: "cc" as const,
	}));
	const recipients = uniqueRecipients([...to, ...cc]);
	const fallbackId = `purelymail-${uidValidity}-${uid}@data-gear.com`;
	const rfcMessageId = normaliseMessageId(parsed.messageId ?? fallbackId);
	const references = Array.isArray(parsed.references)
		? parsed.references.join(" ")
		: (parsed.references ?? null);
	const rootId =
		rootMessageIdFrom({
			references,
			inReplyTo: parsed.inReplyTo ?? null,
			messageId: rfcMessageId,
		}) ?? rfcMessageId;
	return {
		rfcMessageId,
		rootId,
		subject: parsed.subject?.trim() || null,
		from,
		recipients,
		body: parsed.text?.trim() ?? "",
		sentAt: parsed.date ?? dateOf(internalDate),
	};
}

function participantsOf(
	value: AddressObject | AddressObject[] | undefined,
): Participant[] {
	const objects = value ? (Array.isArray(value) ? value : [value]) : [];
	return objects.flatMap((object) => object.value.flatMap(participantOf));
}

function participantOf(value: EmailAddress): Participant[] {
	if (value.group) return value.group.flatMap(participantOf);
	if (!value.address) return [];
	const participant = parseAddress(value.address);
	if (!participant) return [];
	return [{ ...participant, name: value.name.trim() || null }];
}

function uniqueRecipients<T extends Participant & { kind: "to" | "cc" }>(
	values: T[],
): T[] {
	const seen = new Set<string>();
	return values.filter((value) => {
		if (seen.has(value.email)) return false;
		seen.add(value.email);
		return true;
	});
}

function dateOf(value?: Date | string): Date {
	if (value instanceof Date) return value;
	if (value) {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return new Date();
}

function emptySummary(
	status: PurelymailPollSummary["status"],
): PurelymailPollSummary {
	return {
		status,
		mailbox: PURELYMAIL_IMAP.mailbox,
		businessUnit: null,
		folder: null,
		uidValidity: null,
		attempted: 0,
		processed: 0,
		unresolved: 0,
		duplicates: 0,
		skipped: 0,
		failed: 0,
		evidence: [],
	};
}
