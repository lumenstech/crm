import { describe, expect, it } from "bun:test";
import { bearerToken, isAuthorized, parseCallerTokens } from "../src/auth";

describe("MCP caller auth", () => {
	it("accepts a bare token", () => {
		expect(parseCallerTokens("secret-one")).toEqual(["secret-one"]);
	});

	it("accepts JSON token maps", () => {
		expect(
			parseCallerTokens('{"secret-a":["write"],"secret-b":["read"]}').sort(),
		).toEqual(["secret-a", "secret-b"]);
	});

	it("parses bearer auth", () => {
		expect(bearerToken("Bearer abc123")).toBe("abc123");
	});

	it("rejects invalid tokens", () => {
		expect(isAuthorized("Bearer wrong", ["right"])).toBe(false);
	});

	it("accepts valid tokens", () => {
		expect(isAuthorized("Bearer right", ["right"])).toBe(true);
	});
});
