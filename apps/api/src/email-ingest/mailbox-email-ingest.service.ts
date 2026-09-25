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

	constructor(
		config: ConfigService<EnvironmentVariables, true>,
		private readonly ingest: EmailIngestService,
	) {
		this.address = normalizeEmail(
			config.get("CRM_EMAIL_INGEST_ADDRESS", { infer: true }) ?? "",
		);
		this.allowedSenders = new Set(
			(config.get("CRM_EMAIL_INGEST_ALLOWED_SENDERS", { infer: true }) ?? "")
				.split(",")
				.map((value) => normalizeEmail(value))
				.filter((value): value is string => Boolean(value)),
		);
	}

	async handle(message: IncomingMessage): Promise<boolean> {
		if (!this.address) return false;

		const addressedToGateway = message.recipients.some(
			(recipient) => normalizeEmail(recipient.email) === this.address,
		);
		if (!addressedToGateway) return false;

		const sender = normalizeEmail(message.from.email);
		if (!sender || !this.allowedSenders.has(sender)) {
			this.logger.warn({
				message: "Rejected CRM ingest mailbox message from unauthorized sender",
				sender: sender ?? "unknown",
				rfcMessageId: message.rfcMessageId,
			});
			return true;
		}

		try {
			const batch = parseCrmEmailBatch(message.body);
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
		} catch (error) {
			this.logger.warn({
				message: "Rejected malformed CRM ingest mailbox message",
				rfcMessageId: message.rfcMessageId,
				error: error instanceof Error ? error.message : String(error),
			});
		}

		return true;
	}
}

function normalizeEmail(value: string): string | null {
	const trimmed = value.trim().toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}
