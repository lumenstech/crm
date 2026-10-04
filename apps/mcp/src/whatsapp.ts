import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { CrmClient } from "./crmClient";

const businessUnitRef = z.object({
	key: z.string(),
});

const searchHit = z.object({
	kind: z.enum(["company", "contact", "deal"]),
	id: z.string(),
	sourceBusinessUnit: businessUnitRef.nullable(),
	associatedBusinessUnits: z.array(businessUnitRef),
});

const searchResponse = z.object({
	hits: z.array(searchHit),
});

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

const whatsappContact = z.object({
	wa_id: z.string().optional(),
	profile: z.object({ name: z.string().optional() }).optional(),
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
							contacts: z.array(whatsappContact).optional(),
							messages: z.array(whatsappMessage).optional(),
						}),
					}),
				),
			}),
		)
		.default([]),
});

export type WhatsappConfig = {
	verifyToken: string;
	appSecret: string;
	businessUnit: string;
};

export function verifyWhatsappChallenge(
	url: URL,
	verifyToken: string,
): string | null {
	if (
		url.searchParams.get("hub.mode") !== "subscribe" ||
		url.searchParams.get("hub.verify_token") !== verifyToken
	) {
		return null;
	}
	return url.searchParams.get("hub.challenge");
}

export function verifyWhatsappSignature(
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

export async function processWhatsappWebhook(
	rawBody: Buffer,
	client: CrmClient,
	config: WhatsappConfig,
) {
	const parsedJson = z.json().parse(JSON.parse(rawBody.toString("utf8")));
	const payload = whatsappPayload.parse(parsedJson);
	let recorded = 0;
	let queued = 0;
	let ignored = 0;

	for (const entry of payload.entry) {
		for (const change of entry.changes) {
			const contacts = change.value.contacts ?? [];
			for (const message of change.value.messages ?? []) {
				const profileName =
					contacts.find((contact) => contact.wa_id === message.from)?.profile
						?.name ?? null;
				const search = searchResponse.parse(await client.search(message.from));
				const contactHits = search.hits.filter((hit) => hit.kind === "contact");

				if (contactHits.length !== 1) {
					await client.ingestSignal({
						businessUnit: config.businessUnit,
						signal: {
							source: "whatsapp",
							sourceType: "whatsapp.message",
							sourceId: message.id,
							observedAt: occurredAt(message.timestamp) ?? null,
							entity: null,
							tags: ["whatsapp", "inbound"],
							payload: {
								phone: message.from,
								profileName,
								messageType: message.type,
								text: messageText(message) ?? null,
								phoneNumberId: change.value.metadata?.phone_number_id ?? null,
								media: messageMedia(message),
								matchCount: contactHits.length,
							},
						},
					});
					queued += 1;
					continue;
				}

				const contact = contactHits[0];
				if (!contact) {
					ignored += 1;
					continue;
				}

				const alreadyAssociated =
					contact.sourceBusinessUnit?.key === config.businessUnit ||
					contact.associatedBusinessUnits.some(
						(unit) => unit.key === config.businessUnit,
					);

				if (!alreadyAssociated) {
					await client.associateRecord({
						recordType: "contact",
						recordId: contact.id,
						targetBusinessUnit: config.businessUnit,
						useCase: "WhatsApp inbound",
						notes: "Matched by normalized phone number.",
					});
				}

				await client.recordInteraction({
					channel: "whatsapp",
					direction: "inbound",
					externalMessageId: message.id,
					conversationId: message.from,
					subject: "WhatsApp inbound",
					body: messageText(message) ?? null,
					occurredAt: occurredAt(message.timestamp) ?? null,
					contactId: contact.id,
					businessUnit: config.businessUnit,
					attachments: messageAttachments(message),
				});
				recorded += 1;
			}
		}
	}

	return { recorded, queued, ignored };
}

function occurredAt(timestamp: string | undefined): string | undefined {
	if (!timestamp) return undefined;
	const seconds = Number(timestamp);
	if (!Number.isFinite(seconds)) return undefined;
	return new Date(seconds * 1000).toISOString();
}

function messageText(
	message: z.infer<typeof whatsappMessage>,
): string | undefined {
	return (
		message.text?.body ??
		message.image?.caption ??
		message.document?.caption ??
		message.video?.caption
	);
}

function messageMedia(message: z.infer<typeof whatsappMessage>) {
	const value =
		message.image ??
		message.document ??
		message.audio ??
		message.video ??
		message.voice;
	if (!value) return null;
	return {
		id: value.id,
		mimeType: value.mime_type ?? null,
		filename: value.filename ?? null,
	};
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
			name: value.filename ?? undefined,
			mediaType: value.mime_type ?? undefined,
		},
	];
}
