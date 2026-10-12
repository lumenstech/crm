import { describe, expect, it } from "bun:test";
import {
	visibleActivityWhere,
	visibleEmailThreadWhere,
} from "@crm/db/mailbox-privacy";
import {
	excludedMailboxesForReader,
	excludedMailboxesForUser,
	hasExcludedMailboxForSource,
	hasOwnedExcludedMailboxForSource,
	historyCoverageForUser,
	isMailboxExcluded,
	isOwnedMailboxExcluded,
	parseExcludedMailboxes,
} from "../src/config/mailbox-exclusion";

const excludedUserId = "CQILDYRIiaRmf7CD28VLn8jYPu6gSeTE";

describe("per-user mailbox exclusions", () => {
	it("always excludes the approved Gmail mailbox for the exact user", () => {
		const rows = excludedMailboxesForUser(excludedUserId, "[]");

		expect(rows).toEqual([
			{
				userId: excludedUserId,
				source: "gmail",
				mailbox: "danny@lumensny.com",
			},
		]);
		expect(historyCoverageForUser(excludedUserId, "[]")).toBe("limited");
		expect(excludedMailboxesForUser("another-user", "[]")).toEqual([]);
		expect(
			isMailboxExcluded(excludedUserId, "gmail", "DANNY@LUMENSNY.COM", "[]"),
		).toBe(true);
		expect(hasExcludedMailboxForSource(excludedUserId, "gmail", "[]")).toBe(
			true,
		);
		expect(hasExcludedMailboxForSource("another-user", "gmail", "[]")).toBe(
			true,
		);
		expect(
			hasOwnedExcludedMailboxForSource("another-user", "gmail", "[]"),
		).toBe(false);
		expect(
			isOwnedMailboxExcluded(
				"another-user",
				"gmail",
				"danny@lumensny.com",
				"[]",
			),
		).toBe(false);
	});

	it("normalizes additional mailbox entries and preserves DataGear access", () => {
		const rows = parseExcludedMailboxes(
			JSON.stringify([
				{
					userId: excludedUserId,
					source: "gmail",
					mailbox: "DANNY@LUMENSNY.COM",
				},
				{
					userId: excludedUserId,
					source: "purelymail",
					mailbox: "Sales@Data-Gear.com",
				},
			]),
		);

		expect(rows).toContainEqual({
			userId: excludedUserId,
			source: "purelymail",
			mailbox: "sales@data-gear.com",
		});
		expect(rows.filter((row) => row.source === "gmail")).toHaveLength(1);
	});

	it("builds query-level filters for threads and email activities", () => {
		const excluded = excludedMailboxesForUser(excludedUserId, "[]");

		expect(visibleEmailThreadWhere(excluded)).toEqual({
			OR: [
				{ provider: null },
				{ mailbox: null },
				{
					NOT: {
						OR: [
							{
								provider: "gmail",
								mailbox: {
									equals: "danny@lumensny.com",
									mode: "insensitive",
								},
							},
						],
					},
				},
			],
		});
		expect(visibleActivityWhere(excluded)).toEqual({
			OR: [
				{ emailThread: { is: null } },
				{
					emailThread: {
						is: {
							OR: [
								{ provider: null },
								{ mailbox: null },
								{
									NOT: {
										OR: [
											{
												provider: "gmail",
												mailbox: {
													equals: "danny@lumensny.com",
													mode: "insensitive",
												},
											},
										],
									},
								},
							],
						},
					},
				},
			],
		});
	});

	it("applies the protected mailbox filter to every reader identity", () => {
		const rows = excludedMailboxesForReader("another-user", "[]");

		expect(rows).toContainEqual({
			userId: excludedUserId,
			source: "gmail",
			mailbox: "danny@lumensny.com",
		});
		expect(visibleEmailThreadWhere(rows)).toMatchObject({
			OR: [
				{ provider: null },
				{ mailbox: null },
				{ NOT: { OR: [{ provider: "gmail" }] } },
			],
		});
		expect(excludedMailboxesForUser("another-user", "[]")).toEqual([]);
	});
});
