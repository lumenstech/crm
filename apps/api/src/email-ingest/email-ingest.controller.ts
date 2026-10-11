import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
	Controller,
	Headers,
	HttpCode,
	Logger,
	Post,
	Req,
	ServiceUnavailableException,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { parseCrmEmailBatch } from "./email-ingest.contracts";
import { EmailIngestService } from "./email-ingest.service";
import { parseChannelRoutes, routeEmail } from "./channel-routes";
import { InboundMessageService } from "./inbound-message.service";

const MAX_BODY_BYTES = 512_000;
const MAX_WEBHOOK_AGE_SECONDS = 300;

type ResendReceivedEvent = {
	type: string;
	data: {
		email_id?: string;
		from?: string;
		to?: string[];
		subject?: string;
		attachments?: Array<{
			id: string;
			filename?: string;
			content_type?: string;
		}>;
	};
};

type ReceivedEmail = {
	from?: string;
	to?: string[];
	subject?: string;
	text?: string | null;
	html?: string | null;
};

@Controller("webhooks/resend")
export class EmailIngestController {
	private readonly logger = new Logger(EmailIngestController.name);

	constructor(
		private readonly ingest: EmailIngestService,
		private readonly inbound: InboundMessageService,
		private readonly config: ConfigService<EnvironmentVariables, true>,
	) {}

	@Post("crm-ingest")
	@AllowAnonymous()
	@HttpCode(200)
	async receive(
		@Req() request: IncomingMessage,
		@Headers("svix-id") svixId?: string,
		@Headers("svix-timestamp") svixTimestamp?: string,
		@Headers("svix-signature") svixSignature?: string,
	) {
		const webhookSecret = this.config.get("RESEND_WEBHOOK_SECRET", {
			infer: true,
		});
		const apiKey = this.config.get("RESEND_API_KEY", { infer: true });
		if (!webhookSecret || !apiKey) {
			throw new ServiceUnavailableException(
				"CRM email ingest is not configured.",
			);
		}

		const payload = await readRawBody(request, MAX_BODY_BYTES);
		if (
			!payload ||
			!verifySvix(payload, {
				id: svixId,
				timestamp: svixTimestamp,
				signature: svixSignature,
				secret: webhookSecret,
			})
		) {
			throw new UnauthorizedException("Invalid webhook signature.");
		}

		const event = JSON.parse(payload.toString("utf8")) as ResendReceivedEvent;
		if (event.type !== "email.received" || !event.data.email_id) {
			return { accepted: true, ignored: true };
		}

		const received = await fetchReceivedEmail(apiKey, event.data.email_id);
		const sender = extractEmail(received.from ?? event.data.from ?? "");
		const allowed = allowedSenders(
			this.config.get("CRM_EMAIL_INGEST_ALLOWED_SENDERS", { infer: true }),
		);

		// Preserve the existing structured automation path, but only for explicitly
		// allowlisted senders. Ordinary inbound email never gains write authority.
		const commandToken = this.config.get("CRM_EMAIL_INGEST_COMMAND_TOKEN", {
			infer: true,
		});
		if (sender && allowed.has(sender) && commandToken && received.text?.trim()) {
			let batch: ReturnType<typeof parseCrmEmailBatch> | null = null;
			try {
				batch = parseCrmEmailBatch(received.text);
			} catch {
				batch = null;
			}
			if (batch && safeSecretEqual(commandToken, batch.commandToken)) {
				const result = await this.ingest.process(batch);

				await sendReceiptIfConfigured(apiKey, this.config, sender, result).catch(
					(error: unknown) => {
						this.logger.error(
							{ message: "CRM email ingest receipt failed", batchId: batch.batchId },
							error instanceof Error ? error.stack : String(error),
						);
					},
				);

				return {
					accepted: true,
					channel: "email",
					structured: true,
					batchId: batch.batchId,
					submitted: result.submitted,
					existing: result.existing,
					created: result.created,
					checked: result.checked,
					failed: result.failed,
				};
			}
		}

		const routes = parseChannelRoutes(
			this.config.get("CRM_CHANNEL_ROUTES_JSON", { infer: true }),
		);
		const recipients = received.to ?? event.data.to ?? [];
		const routedRecipient = recipients
			.map((value) => extractEmail(value))
			.find((value): value is string => Boolean(value && routeEmail(routes, value)));
		if (!routedRecipient) {
			return { accepted: true, ignored: true, reason: "recipient_not_routed" };
		}
		const businessUnit = routeEmail(routes, routedRecipient);
		if (!businessUnit) {
			return { accepted: true, ignored: true, reason: "recipient_not_routed" };
		}

		const result = await this.inbound.process({
			channel: "email",
			externalMessageId: event.data.email_id,
			businessUnit,
			sender: sender ?? received.from ?? event.data.from ?? "unknown",
			recipient: routedRecipient,
			subject: received.subject ?? event.data.subject ?? null,
			body: received.text ?? null,
			conversationId: event.data.email_id,
			attachments: (event.data.attachments ?? []).map((attachment) => ({
				id: attachment.id,
				name: attachment.filename,
				mediaType: attachment.content_type,
			})),
		});

		return {
			accepted: true,
			channel: "email",
			recorded: result.recorded ?? false,
			deduplicated: result.deduplicated ?? false,
			queuedForReview:
				"queuedForReview" in result ? result.queuedForReview : false,
			reason: "reason" in result ? result.reason : null,
		};
	}
}

async function readRawBody(
	request: IncomingMessage,
	limit: number,
): Promise<Buffer | null> {
	const maybeBody = request as IncomingMessage & {
		body?: unknown;
		rawBody?: Buffer;
	};
	if (Buffer.isBuffer(maybeBody.rawBody)) {
		return maybeBody.rawBody.length <= limit ? maybeBody.rawBody : null;
	}

	if (typeof maybeBody.body === "string") {
		const body = Buffer.from(maybeBody.body);
		return body.length <= limit ? body : null;
	}
	if (Buffer.isBuffer(maybeBody.body)) {
		return maybeBody.body.length <= limit ? maybeBody.body : null;
	}

	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let settled = false;
		const finish = (value: Buffer | null) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		request.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > limit) {
				request.destroy();
				finish(null);
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => finish(Buffer.concat(chunks)));
		request.on("error", () => finish(null));
	});
}

function verifySvix(
	payload: Buffer,
	input: {
		id?: string;
		timestamp?: string;
		signature?: string;
		secret: string;
	},
): boolean {
	if (!input.id || !input.timestamp || !input.signature) return false;
	const unix = Number(input.timestamp);
	if (!Number.isFinite(unix)) return false;
	if (Math.abs(Date.now() / 1000 - unix) > MAX_WEBHOOK_AGE_SECONDS) return false;

	const rawSecret = input.secret.startsWith("whsec_")
		? input.secret.slice("whsec_".length)
		: input.secret;
	let key: Buffer;
	try {
		key = Buffer.from(rawSecret, "base64");
	} catch {
		return false;
	}
	if (!key.length) return false;

	const signed = Buffer.concat([
		Buffer.from(`${input.id}.${input.timestamp}.`),
		payload,
	]);
	const expected = createHmac("sha256", key).update(signed).digest("base64");

	for (const token of input.signature.split(" ")) {
		const [version, value] = token.split(",", 2);
		if (version !== "v1" || !value) continue;
		const a = Buffer.from(expected);
		const b = Buffer.from(value);
		if (a.length === b.length && timingSafeEqual(a, b)) return true;
	}
	return false;
}

function safeSecretEqual(expected: string, actual?: string): boolean {
	if (!actual) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(actual);
	return a.length === b.length && timingSafeEqual(a, b);
}

async function fetchReceivedEmail(
	apiKey: string,
	emailId: string,
): Promise<ReceivedEmail> {
	const response = await fetch(
		`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
		{ headers: { authorization: `Bearer ${apiKey}` } },
	);
	if (!response.ok) {
		throw new Error(`Resend receiving lookup failed: HTTP ${response.status}`);
	}
	const body = (await response.json()) as
		| ReceivedEmail
		| { data?: ReceivedEmail };
	if ("data" in body) return body.data ?? {};
	return body as ReceivedEmail;
}

function extractEmail(value: string): string | null {
	const bracket = value.match(/<([^>]+)>/);
	const candidate = (bracket?.[1] ?? value).trim().toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function allowedSenders(value?: string): Set<string> {
	return new Set(
		(value ?? "")
			.split(",")
			.map((item) => extractEmail(item))
			.filter((item): item is string => Boolean(item)),
	);
}

async function sendReceiptIfConfigured(
	apiKey: string,
	config: ConfigService<EnvironmentVariables, true>,
	defaultRecipient: string,
	result: Awaited<ReturnType<EmailIngestService["process"]>>,
) {
	const from = config.get("CRM_EMAIL_INGEST_RECEIPT_FROM", { infer: true });
	const to =
		config.get("CRM_EMAIL_INGEST_RECEIPT_TO", { infer: true }) ??
		defaultRecipient;
	if (!from || !to) return;

	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			from,
			to: [to],
			subject: `COMP CRM ingest receipt — ${result.batchId}`,
			text: formatReceipt(result),
		}),
	});
	if (!response.ok) {
		throw new Error(`Resend receipt send failed: HTTP ${response.status}`);
	}
}

function formatReceipt(
	result: Awaited<ReturnType<EmailIngestService["process"]>>,
): string {
	const lines = [
		`Batch: ${result.batchId}`,
		`Business unit: ${result.businessUnit}`,
		`Mode: ${result.mode}`,
		"",
		`${result.submitted} submitted`,
		`${result.existing} existing/reused`,
		`${result.created} new records created`,
		`${result.checked} checked only`,
		`${result.failed} failed`,
		"",
	];
	for (const item of result.items) {
		lines.push(`${item.status} — source=${item.sourceId}`);
		if (item.error) lines.push("  error: processing failed; review the private CRM log.");
	}
	return lines.join("\n");
}
