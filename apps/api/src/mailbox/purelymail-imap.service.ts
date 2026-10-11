import { type Db, GoogleSyncStatus } from "@crm/db";
import {
	Injectable,
	Logger,
	type OnApplicationShutdown,
	type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type FetchMessageObject, ImapFlow } from "imapflow";
import {
	type AddressObject,
	type EmailAddress,
	simpleParser,
} from "mailparser";
import { z } from "zod";
import { BusinessUnitsService } from "../business-units/business-units.service";
import type { EnvironmentVariables } from "../config/env.validation";
import { InjectDatabase } from "../database/database.constants";
import { normaliseMessageId, rootMessageIdFrom } from "./message-text";
import { type Participant, parseAddress } from "./participants";
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
	failed: number;
	evidence: PurelymailMessageEvidence[];
};

@Injectable()
export class PurelymailImapService
	implements OnModuleInit, OnApplicationShutdown
{
	private readonly logger = new Logger(PurelymailImapService.name);
	private readonly password: string | undefined;
	private readonly userEmail: string | undefined;
	private active: Promise<PurelymailPollSummary> | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		config: ConfigService<EnvironmentVariables, true>,
		@InjectDatabase() private readonly db: Db,
		private readonly state: SyncStateService,
		private readonly writer: ThreadWriterService,
		private readonly businessUnits: BusinessUnitsService,
	) {
		this.password = config
			.get("PURELYMAIL_IMAP_PASSWORD", { infer: true })
			?.trim();
		this.userEmail = config
			.get("PURELYMAIL_SYNC_USER_EMAIL", { infer: true })
			?.trim()
			.toLowerCase();
	}

	onModuleInit(): void {
		if (!this.password) {
			this.logger.log({
				message: "Purelymail IMAP synchronization disabled",
				mailbox: PURELYMAIL_IMAP.mailbox,
			});
			return;
		}

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

	poll(): Promise<PurelymailPollSummary> {
		if (!this.password) return Promise.resolve(emptySummary("disabled"));
		if (this.active) return this.active;
		this.active = this.run(this.password).finally(() => {
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
			failed: summary.failed,
		});
	}

	private async run(password: string): Promise<PurelymailPollSummary> {
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

		if (!this.userEmail) {
			summary.status = "failed";
			summary.failed += 1;
			return summary;
		}
		const user = await this.db.user.findUnique({
			where: { email: this.userEmail },
			select: { id: true },
		});
		if (!user) {
			summary.status = "failed";
			summary.failed += 1;
			return summary;
		}
		const row = await this.state.ensure(user.id, PURELYMAIL_IMAP.source, {
			autoCreate: false,
		});
		const client = new ImapFlow({
			host: PURELYMAIL_IMAP.host,
			port: PURELYMAIL_IMAP.port,
			secure: PURELYMAIL_IMAP.secure,
			servername: PURELYMAIL_IMAP.host,
			auth: { user: PURELYMAIL_IMAP.mailbox, pass: password },
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
			const folder = await discoverSentFolder(client);
			summary.folder = folder;
			const lock = await client.getMailboxLock(folder);
			try {
				if (!client.mailbox) throw new Error("Purelymail did not select Sent.");
				const uidValidity = client.mailbox.uidValidity.toString();
				summary.uidValidity = uidValidity;
				const cursor = parseCursor(row.cursor);
				const found = await client.search({ all: true }, { uid: true });
				const uids = (Array.isArray(found) ? found : [])
					.filter((uid) => cursor === null || uid > cursor.uid)
					.slice(0, PURELYMAIL_IMAP.maxMessagesPerTick);
				if (uids.length > 0) {
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
				const latestUid = uids.at(-1) ?? cursor?.uid ?? null;
				await this.state.settle(row.id, {
					cursor:
						latestUid === null
							? row.cursor
							: JSON.stringify({ folder, uidValidity, uid: latestUid }),
					status: GoogleSyncStatus.IDLE,
				});
			} finally {
				lock.release();
			}
		} catch (error) {
			summary.status = "failed";
			summary.failed += 1;
			await this.state.markFailed(
				row.id,
				error instanceof Error ? error.message : String(error),
			);
			this.logger.error(
				{ message: "Purelymail IMAP synchronization failed" },
				error instanceof Error ? error.stack : String(error),
			);
		} finally {
			if (client.usable) {
				await client.logout().catch(() => client.close());
			} else {
				client.close();
			}
		}

		return summary;
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
		if (
			!message.source ||
			(message.size ?? message.source.length) > PURELYMAIL_IMAP.maxMessageBytes
		) {
			summary.failed += 1;
			return;
		}
		const incoming = await parseIncomingMessage(
			message.source,
			message.uid,
			uidValidity,
			message.internalDate,
		);
		const result = await this.writer.storeDetailed(
			row,
			{ mailbox: PURELYMAIL_IMAP.mailbox, origin: PURELYMAIL_IMAP.source },
			incoming,
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

async function discoverSentFolder(client: ImapFlow): Promise<string> {
	const folders = await client.list();
	const special = folders.find(
		(folder) => folder.specialUse?.toLowerCase() === "\\sent",
	);
	if (special) return special.path;
	const fallback = folders.find((folder) =>
		/(^|[./ ])sent($|[./ ])?/i.test(folder.path),
	);
	if (fallback) return fallback.path;
	throw new Error("Purelymail did not advertise a Sent folder.");
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

function parseCursor(value: string | null): { uid: number } | null {
	if (!value) return null;
	try {
		const parsed = z
			.object({ uid: z.number().int() })
			.strict()
			.safeParse(JSON.parse(value));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
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
		failed: 0,
		evidence: [],
	};
}
