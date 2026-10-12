import { describe, expect, it } from "bun:test";
import {
	excludedMailboxesForUser,
	hasExcludedMailboxForSource,
	historyCoverageForUser,
	isMailboxExcluded,
	parseExcludedMailboxes,
	visibleActivityWhere,
	visibleEmailThreadWhere,
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
			false,
		);
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
		});
		expect(visibleActivityWhere(excluded)).toEqual({
			OR: [
				{ emailThread: { is: null } },
				{
					emailThread: {
						is: {
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
					},
				},
			],
		});
	});
});
