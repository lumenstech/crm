import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
	Controller,
	Get,
	Headers,
	HttpCode,
	Logger,
	Post,
	Query,
	Req,
	ServiceUnavailableException,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { z } from "zod";
import type { EnvironmentVariables } from "../config/env.validation";
import { parseChannelRoutes, routeWhatsapp } from "./channel-routes";
import { InboundMessageService } from "./inbound-message.service";

const MAX_BODY_BYTES = 1_048_576;

const media = z.object({
	id: z.string(),
	mime_type: z.string().optional(),
	filename: z.string().optional(),
	caption: z.string().optional(),
});

const whatsappMessage = z.object({
	id: z.string(),
	from: z.string(),
	timestamp: z.string().optional(),
	type: z.string(),
	text: z.object({ body: z.string() }).optional(),
	image: media.optional(),
	document: media.optional(),
	audio: media.optional(),
	video: media.optional(),
	voice: media.optional(),
});

const whatsappPayload = z.object({
	entry: z
		.array(
			z.object({
				changes: z.array(
					z.object({
						value: z.object({
							metadata: z
								.object({
									phone_number_id: z.string().optional(),
								})
								.optional(),
							messages: z.array(whatsappMessage).optional(),
						}),
					}),
				),
			}),
		)
		.default([]),
});

@Controller("webhooks/whatsapp")
export class WhatsappIngressController {
	private readonly logger = new Logger(WhatsappIngressController.name);

	constructor(
		private readonly config: ConfigService<EnvironmentVariables, true>,
		private readonly inbound: InboundMessageService,
	) {}

	@Get()
	@AllowAnonymous()
	verify(
		@Query("hub.mode") mode?: string,
		@Query("hub.verify_token") token?: string,
		@Query("hub.challenge") challenge?: string,
	) {
		const expected =
			this.config.get("META_VERIFY_TOKEN", { infer: true }) ??
			this.config.get("WHATSAPP_VERIFY_TOKEN", { infer: true });
		if (!expected) {
			throw new ServiceUnavailableException(
				"WhatsApp ingest is not configured.",
			);
		}
		if (mode !== "subscribe" || token !== expected || !challenge) {
			throw new UnauthorizedException("Verification failed.");
		}
		return challenge;
	}

	@Post()
	@AllowAnonymous()
	@HttpCode(200)
	async receive(
		@Req() request: IncomingMessage,
		@Headers("x-hub-signature-256") signature?: string,
	) {
		const appSecret =
			this.config.get("META_APP_SECRET", { infer: true }) ??
			this.config.get("WHATSAPP_APP_SECRET", { infer: true });
		if (!appSecret) {
			throw new ServiceUnavailableException(
				"WhatsApp ingest is not configured.",
			);
		}

		const raw = await readRawBody(request, MAX_BODY_BYTES);
		if (!raw || !verifyMetaSignature(raw, signature, appSecret)) {
			throw new UnauthorizedException("Invalid webhook signature.");
		}

		const routes = parseChannelRoutes(
			this.config.get("CRM_CHANNEL_ROUTES_JSON", { infer: true }),
		);
		const payload = whatsappPayload.parse(JSON.parse(raw.toString("utf8")));

		let recorded = 0;
		let queued = 0;
		let ignored = 0;

		for (const entry of payload.entry) {
			for (const change of entry.changes) {
				const phoneNumberId = change.value.metadata?.phone_number_id;
				const businessUnit = phoneNumberId
					? routeWhatsapp(routes, phoneNumberId)
					: null;
				if (!businessUnit) {
					ignored += change.value.messages?.length ?? 0;
					continue;
				}

				for (const message of change.value.messages ?? []) {
					const result = await this.inbound.process({
						channel: "whatsapp",
						externalMessageId: message.id,
						businessUnit,
						sender: message.from,
						recipient: phoneNumberId ?? null,
						subject: "WhatsApp inbound",
						body: messageText(message) ?? null,
						occurredAt: occurredAt(message.timestamp) ?? null,
						conversationId: message.from,
						attachments: messageAttachments(message),
						identityVerified: true,
					});
					if ("recorded" in result && result.recorded) recorded += 1;
					else if ("queuedForReview" in result && result.queuedForReview)
						queued += 1;
					else ignored += 1;
				}
			}
		}

		this.logger.log({
			message: "Processed WhatsApp ingress webhook",
			recorded,
			queued,
			ignored,
		});

		return { accepted: true, recorded, queued, ignored };
	}
}

function verifyMetaSignature(
	rawBody: Buffer,
	signature: string | undefined,
	appSecret: string,
): boolean {
	if (!signature?.startsWith("sha256=")) return false;
	const supplied = signature.slice("sha256=".length);
	if (!/^[0-9a-f]{64}$/i.test(supplied)) return false;
	const expected = createHmac("sha256", appSecret)
		.update(rawBody)
		.digest("hex");
	return timingSafeEqual(
		Buffer.from(supplied.toLowerCase(), "hex"),
		Buffer.from(expected, "hex"),
	);
}

async function readRawBody(
	request: IncomingMessage,
	limit: number,
): Promise<Buffer | null> {
	const maybeBody = request as IncomingMessage & { body?: Buffer | string };
	if (maybeBody.body !== undefined) {
		const body = Buffer.isBuffer(maybeBody.body)
			? maybeBody.body
			: Buffer.from(maybeBody.body);
		return body.length <= limit ? body : null;
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

function occurredAt(timestamp?: string): string | undefined {
	if (!timestamp) return undefined;
	const seconds = Number(timestamp);
	if (!Number.isFinite(seconds)) return undefined;
	return new Date(seconds * 1000).toISOString();
}

function messageText(message: z.infer<typeof whatsappMessage>) {
	return (
		message.text?.body ??
		message.image?.caption ??
		message.document?.caption ??
		message.video?.caption
	);
}

function messageAttachments(message: z.infer<typeof whatsappMessage>) {
	const value =
		message.image ??
		message.document ??
		message.audio ??
		message.video ??
		message.voice;
	if (!value) return [];
	return [
		{
			id: value.id,
			name: value.filename,
			mediaType: value.mime_type,
		},
	];
}
