import { describe, expect, it } from "bun:test";
import { redactSecrets, safeError } from "../src/redact";

describe("secret redaction", () => {
  it("redacts explicit secrets", () => {
    expect(redactSecrets("bad crm_secret token", ["crm_secret"])).toBe("bad [REDACTED] token");
  });

  it("redacts errors", () => {
    expect(safeError(new Error("token=abc"), ["abc"])).toBe("token=[REDACTED]");
  });
});
