import { describe, expect, test } from "bun:test";

function shouldEmitWon(previousStage: string, nextStage: string) {
	return previousStage.trim().toLowerCase() !== "won" && nextStage.trim().toLowerCase() === "won";
}

describe("canonical opportunity WON transition", () => {
	test("emits only when entering WON", () => {
		expect(shouldEmitWon("qualified", "won")).toBe(true);
		expect(shouldEmitWon("proposal", "WON")).toBe(true);
		expect(shouldEmitWon("won", "won")).toBe(false);
		expect(shouldEmitWon("WON", "qualified")).toBe(false);
		expect(shouldEmitWon("qualified", "proposal")).toBe(false);
	});

	test("normalizes whitespace and case", () => {
		expect(shouldEmitWon(" qualified ", " Won ")).toBe(true);
		expect(shouldEmitWon(" won ", "WON")).toBe(false);
	});
});
