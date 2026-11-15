import {
	chatEventPurpose,
	createChatEventSecretBox,
} from "@crm/auth/chat-event-crypto";
import type { Prisma } from "@crm/db";

type StoredChatEvent = {
	id: string;
	conversationId: string | null;
	data: Prisma.JsonValue;
	encryptedData: string | null;
};

export function readStoredChatEvent(record: StoredChatEvent): Prisma.JsonValue {
	if (!record.encryptedData) return record.data;
	if (!record.conversationId) return {};
	const box = createChatEventSecretBox();
	if (!box) return {};
	try {
		return JSON.parse(
			box.decrypt(
				record.encryptedData,
				chatEventPurpose({
					conversationId: record.conversationId,
					eventId: record.id,
				}),
			),
		) as Prisma.JsonValue;
	} catch {
		return {};
	}
}
