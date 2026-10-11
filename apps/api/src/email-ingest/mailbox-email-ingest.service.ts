import { timingSafeEqual } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import type { IncomingMessage } from "../mailbox/thread-writer.service";
import { parseCrmEmailBatch } from "./email-ingest.contracts";
import { EmailIngestService } from "./email-ingest.service";

@Injectable()
export class MailboxEmailIngestService {
	private readonly logger = new Logger(MailboxEmailIngestService.name);
	private readonly address: string | null;
	private readonly allowedSenders: Set<string>;
	private readonly commandToken: string | null;

	constructor(
		config: ConfigService<EnvironmentVariables, true>,
		private readonly ingest: EmailIngestService,
	) {
		this.address = normalizeEmail(
			config.get("CRM_EMAIL_INGEST_ADDRESS", { infer: true }) ??
				"leads@516labs.com",
		);
		this.allowedSenders = new Set(
			(config.get("CRM_EMAIL_INGEST_ALLOWED_SENDERS", { infer: true }) ?? "")
				.split(",")
				.map((value) => normalizeEmail(value))
				.filter((value): value is string => Boolean(value)),
		);
		this.commandToken =
			config.get("CRM_EMAIL_INGEST_COMMAND_TOKEN", { infer: true }) ?? null;
	}

	async handle(message: IncomingMessage, mailbox?: string): Promise<boolean> {
		if (!this.address) return false;

		const addressedToGateway = message.recipients.some(
			(recipient) => normalizeEmail(recipient.email) === this.address,
		);
		if (!addressedToGateway) return false;

		const sender = normalizeEmail(message.from.email);
		const authenticatedMailbox = normalizeEmail(mailbox ?? "");
		const trusted =
			Boolean(sender && authenticatedMailbox && sender === authenticatedMailbox) ||
			Boolean(sender && this.allowedSenders.has(sender));
		if (!trusted) {
			this.logger.warn({
				message: "Rejected CRM ingest mailbox message from unauthorized sender",
				sender: sender ?? "unknown",
				rfcMessageId: message.rfcMessageId,
			});
			return true;
		}

		let batch: ReturnType<typeof parseCrmEmailBatch>;
		try {
			batch = parseCrmEmailBatch(message.body);
		} catch (error) {
			this.logger.warn({
				message: "Rejected malformed CRM ingest mailbox message",
				rfcMessageId: message.rfcMessageId,
				error: error instanceof Error ? error.message : String(error),
			});
			return true;
		}
		if (!this.commandToken || !safeSecretEqual(this.commandToken, batch.commandToken)) {
			this.logger.warn({
				message: "Rejected structured CRM ingest without command authorization",
				rfcMessageId: message.rfcMessageId,
			});
			return true;
		}
		const result = await this.ingest.process(batch);
		this.logger.log({
			message: "Processed CRM ingest mailbox message",
			rfcMessageId: message.rfcMessageId,
			batchId: result.batchId,
			businessUnit: result.businessUnit,
			submitted: result.submitted,
			existing: result.existing,
			created: result.created,
			checked: result.checked,
			failed: result.failed,
		});

		return true;
	}
}

function safeSecretEqual(expected: string, actual?: string): boolean {
	if (!actual) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(actual);
	return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeEmail(value: string): string | null {
	const trimmed = value.trim().toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}
