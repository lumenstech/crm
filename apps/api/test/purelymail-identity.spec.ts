import { describe, expect, it } from "bun:test";
import { historicalEmailImportInput } from "../src/mailbox/history-import.contracts";
import {
	isPurelymailProviderMessageId,
	isPurelymailProviderThreadId,
	parsePurelymailProviderMessageId,
	purelymailImapMessageId,
	purelymailProviderThreadId,
	purelymailRfcMessageId,
} from "../src/mailbox/purelymail-identity";

const mailbox = "sales@data-gear.com";
const rootMessageId = "<root@example.test>";
const rfcMessageId = "<message@example.test>";

describe("Purelymail historical identity", () => {
	it("preserves immutable IMAP folder, UIDVALIDITY, and UID evidence", () => {
		const providerMessageId = purelymailImapMessageId({
			mailbox,
			folder: "Sent Items",
			uidValidity: "987654321",
			uid: 42,
		});

		expect(providerMessageId).toBe(
			"purelymail-imap:sales%40data-gear.com:Sent%20Items:987654321:42",
		);
		expect(parsePurelymailProviderMessageId(providerMessageId)).toEqual({
			kind: "imap",
			mailbox,
			folder: "Sent Items",
			uidValidity: "987654321",
			uid: 42,
		});
		expect(
			isPurelymailProviderMessageId(providerMessageId, {
				mailbox,
				rfcMessageId,
			}),
		).toBe(true);
		expect(
			isPurelymailProviderMessageId(providerMessageId, {
				mailbox: "other@data-gear.com",
				rfcMessageId,
			}),
		).toBe(false);
	});

	it("accepts verified RFC evidence only when thread identity matches the root", () => {
		const providerMessageId = purelymailRfcMessageId(rfcMessageId);
		const providerThreadId = purelymailProviderThreadId(rootMessageId);
		const input = historicalEmailImportInput.parse({
			source: "purelymail",
			mailbox,
			providerMessageId,
			providerThreadId,
			rfcMessageId,
			rootMessageId,
			subject: "Synthetic Purelymail fixture",
			body: "Synthetic body",
			from: { email: mailbox, name: "Data Gear Sales" },
			recipients: [{ email: "buyer@example.test", name: "Buyer", kind: "to" }],
			sentAt: "2026-09-27T16:14:26.000Z",
		});

		expect(input.source).toBe("purelymail");
		expect(isPurelymailProviderThreadId(providerThreadId, rootMessageId)).toBe(
			true,
		);
		expect(() =>
			historicalEmailImportInput.parse({
				...input,
				providerThreadId: purelymailProviderThreadId(
					"<different-root@example.test>",
				),
			}),
		).toThrow("derived from the verified root Message-ID");
	});

	it("rejects arbitrary provider IDs without verified evidence", () => {
		expect(() =>
			historicalEmailImportInput.parse({
				source: "purelymail",
				mailbox,
				providerMessageId: "uid-42",
				providerThreadId: purelymailProviderThreadId(rootMessageId),
				rfcMessageId,
				rootMessageId,
				subject: null,
				body: "Synthetic body",
				from: { email: mailbox, name: null },
				recipients: [{ email: "buyer@example.test", name: null, kind: "to" }],
				sentAt: "2026-09-27T16:14:26.000Z",
			}),
		).toThrow("immutable IMAP UIDVALIDITY+UID/folder identity");
	});
});
