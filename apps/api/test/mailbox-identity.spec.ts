import { describe, expect, it } from "bun:test";
import {
	isHistoricalMailboxAuthorized,
	parseHistoricalMailboxBindings,
	parseVerifiedSenderBusinessUnits,
} from "../src/config/mailbox-identity";

const userId = "CQILDYRIiaRmf7CD28VLn8jYPu6gSeTE";
const binding = JSON.stringify([
	{ userId, source: "gmail", mailbox: "danny@lumensny.com" },
]);

describe("historical mailbox identity configuration", () => {
	it("authorizes only the exact user, source, and mailbox tuple", () => {
		const bindings = parseHistoricalMailboxBindings(binding);

		expect(
			isHistoricalMailboxAuthorized(bindings, {
				userId,
				userEmail: "danny@lumenstechnology.com",
				source: "gmail",
				mailbox: "danny@lumensny.com",
			}),
		).toBe(true);
	});

	it("fails closed for another user, provider, or mailbox", () => {
		const bindings = parseHistoricalMailboxBindings(binding);
		const input = {
			userId,
			userEmail: "danny@lumenstechnology.com",
			source: "gmail" as const,
			mailbox: "danny@lumensny.com",
		};

		expect(
			isHistoricalMailboxAuthorized(bindings, {
				...input,
				userId: "another-user",
			}),
		).toBe(false);
		expect(
			isHistoricalMailboxAuthorized(bindings, {
				...input,
				source: "outlook",
			}),
		).toBe(false);
		expect(
			isHistoricalMailboxAuthorized(bindings, {
				...input,
				mailbox: "other@example.com",
			}),
		).toBe(false);
	});

	it("rejects malformed, wildcard, domain, and ambiguous bindings", () => {
		expect(() => parseHistoricalMailboxBindings("not-json")).toThrow(
			"must be valid JSON",
		);
		expect(() =>
			parseHistoricalMailboxBindings(
				JSON.stringify([{ userId, source: "gmail", mailbox: "@lumensny.com" }]),
			),
		).toThrow("is invalid");
		expect(() =>
			parseHistoricalMailboxBindings(
				JSON.stringify([
					{ userId, source: "gmail", mailbox: "*.lumensny.com" },
				]),
			),
		).toThrow("is invalid");
		expect(() =>
			parseHistoricalMailboxBindings(
				JSON.stringify([
					{ userId, source: "gmail", mailbox: "danny@lumensny.com" },
					{
						userId: "another-user",
						source: "gmail",
						mailbox: "danny@lumensny.com",
					},
				]),
			),
		).toThrow("ambiguous ownership");
	});

	it("preserves Data-Gear and adds the exact Lumens sender mapping", () => {
		const rows = parseVerifiedSenderBusinessUnits(
			JSON.stringify([
				{ email: "danny@lumensny.com", businessUnit: "lumens-technology" },
			]),
		);

		expect(rows).toContainEqual({
			email: "sales@data-gear.com",
			businessUnit: "data-gear",
		});
		expect(rows).toContainEqual({
			email: "danny@lumensny.com",
			businessUnit: "lumens-technology",
		});
	});

	it("rejects malformed or conflicting sender mappings", () => {
		expect(() => parseVerifiedSenderBusinessUnits("not-json")).toThrow(
			"must be valid JSON",
		);
		expect(() =>
			parseVerifiedSenderBusinessUnits(
				JSON.stringify([
					{ email: "@lumensny.com", businessUnit: "lumens-technology" },
				]),
			),
		).toThrow("is invalid");
		expect(() =>
			parseVerifiedSenderBusinessUnits(
				JSON.stringify([
					{ email: "sales@data-gear.com", businessUnit: "lumens-technology" },
				]),
			),
		).toThrow("ambiguous ownership");
	});
});
