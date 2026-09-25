import { describe, expect, it } from "bun:test";
import { ingestLeadsInput } from "../src/schemas";

describe("ingest_leads schema", () => {
  it("requires a business unit", () => {
    expect(() =>
      ingestLeadsInput.parse({
        signals: [{ source: "test", sourceType: "lead", sourceId: "1" }],
      }),
    ).toThrow();
  });

  it("rejects unknown business units", () => {
    expect(() =>
      ingestLeadsInput.parse({
        businessUnit: "unknown",
        signals: [{ source: "test", sourceType: "lead", sourceId: "1" }],
      }),
    ).toThrow();
  });

  it("accepts data-gear", () => {
    const parsed = ingestLeadsInput.parse({
      businessUnit: "data-gear",
      signals: [{ source: "test", sourceType: "lead", sourceId: "1" }],
    });
    expect(parsed.businessUnit).toBe("data-gear");
  });
});
