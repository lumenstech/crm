import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
	readBuilderEvent,
	storeBuilderEvent,
} from "../agent/lib/builder-event-storage";

const identity = {
	conversationId: "conversation-1",
	eventId: "event-1",
};

describe("builder chat event storage", () => {
	test("keeps plaintext when encryption is unset", () => {
		const previous = process.env.CHAT_EVENT_ENCRYPTION_KEY;
		delete process.env.CHAT_EVENT_ENCRYPTION_KEY;
		try {
			const stored = storeBuilderEvent({ message: "Hello" }, identity);
			expect(stored).toEqual({
				data: { message: "Hello" },
				encryptedData: null,
			});
			expect(readBuilderEvent(stored, identity)).toEqual({ message: "Hello" });
		} finally {
			if (previous === undefined) delete process.env.CHAT_EVENT_ENCRYPTION_KEY;
			else process.env.CHAT_EVENT_ENCRYPTION_KEY = previous;
		}
	});

	test("stores ciphertext and reads the original event", () => {
		const previous = process.env.CHAT_EVENT_ENCRYPTION_KEY;
		process.env.CHAT_EVENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
		try {
			const stored = storeBuilderEvent({ message: "Private" }, identity);
			expect(stored.encryptedData).not.toContain("Private");
			expect(stored.data).toEqual({});
			expect(readBuilderEvent(stored, identity)).toEqual({
				message: "Private",
			});
			expect(
				readBuilderEvent(stored, { ...identity, eventId: "event-2" }),
			).toBeNull();
		} finally {
			if (previous === undefined) delete process.env.CHAT_EVENT_ENCRYPTION_KEY;
			else process.env.CHAT_EVENT_ENCRYPTION_KEY = previous;
		}
	});
});
