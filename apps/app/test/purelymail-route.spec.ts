import { describe, expect, it } from "bun:test";
import { PURELYMAIL_OWNER_USER_ID } from "@crm/db/purelymail";
import { isPurelymailOwner } from "../lib/purelymail-route";

const ownerWithoutMailboxGrants = {
	user: {
		id: PURELYMAIL_OWNER_USER_ID,
		name: "Danny",
		email: "danny@example.test",
		image: null,
	},
};

describe("Purelymail setup route access", () => {
	it("allows the owner without Google or Microsoft mailbox grants", () => {
		expect(isPurelymailOwner(ownerWithoutMailboxGrants)).toBe(true);
		expect(
			isPurelymailOwner({
				user: { ...ownerWithoutMailboxGrants.user, id: "other-user" },
			}),
		).toBe(false);
	});

	it("uses a session-only route shell instead of the mailbox grant gate", async () => {
		const layout = await Bun.file(
			new URL("../app/(purelymail)/[slug]/layout.tsx", import.meta.url),
		).text();

		expect(layout).toContain("mailboxRequired={false}");
		expect(layout).not.toContain("requireMailboxAccess");
	});

	it("shows a visible incomplete-history warning for skipped messages", async () => {
		const source = await Bun.file(
			new URL(
				"../app/(app)/[slug]/settings/connections/purelymail-connection.tsx",
				import.meta.url,
			),
		).text();

		expect(source).toContain("historyIncomplete");
		expect(source).toContain("skippedCount");
		expect(source).toContain("History import is incomplete");
	});
});
