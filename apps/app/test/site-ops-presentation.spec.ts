import { describe, expect, test } from "bun:test";
import {
	SIGNAL_STATES,
	SOURCE_HEALTH_STATUSES,
} from "@crm/validation/site-operations";
import {
	ALERT_SEVERITY,
	ALERT_STATE,
	formatAge,
	formatInterval,
	formatReading,
	readsAsHealthy,
	SIGNAL_STATE,
	SITE_STATUS,
	SOURCE_STATUS,
} from "../lib/site-ops/presentation";

describe("signal state presentation", () => {
	test("every state the API can return has a presentation", () => {
		for (const state of SIGNAL_STATES) {
			expect(SIGNAL_STATE[state]).toBeTruthy();
		}
	});

	test("the five operator states are visually distinguishable", () => {
		const labels = (
			["fresh", "stale", "missing", "source_failed", "invalid"] as const
		).map((state) => SIGNAL_STATE[state].label);
		expect(new Set(labels).size).toBe(5);
	});

	test("fresh is the only state that reads as healthy", () => {
		expect(readsAsHealthy(SIGNAL_STATE.fresh.tone)).toBe(true);
		for (const state of [
			"stale",
			"missing",
			"source_failed",
			"invalid",
			"not_configured",
		] as const) {
			expect(readsAsHealthy(SIGNAL_STATE[state].tone)).toBe(false);
		}
	});

	test("missing and source_failed are the strongest non-healthy tones", () => {
		expect(SIGNAL_STATE.missing.tone).toBe("error");
		expect(SIGNAL_STATE.source_failed.tone).toBe("error");
	});

	test("not monitored is not the same label as missing", () => {
		expect(SIGNAL_STATE.not_configured.label).not.toBe(
			SIGNAL_STATE.missing.label,
		);
	});
});

describe("site status presentation", () => {
	test("only normal reads as healthy", () => {
		expect(readsAsHealthy(SITE_STATUS.normal.tone)).toBe(true);
		for (const status of ["attention", "critical", "unknown"] as const) {
			expect(readsAsHealthy(SITE_STATUS[status].tone)).toBe(false);
		}
	});

	test("unknown is never rendered as normal", () => {
		expect(SITE_STATUS.unknown.label).not.toBe(SITE_STATUS.normal.label);
		expect(SITE_STATUS.unknown.tone).toBe("neutral");
	});
});

describe("source status presentation", () => {
	test("every source status has a presentation and only ok is healthy", () => {
		for (const status of SOURCE_HEALTH_STATUSES) {
			expect(SOURCE_STATUS[status]).toBeTruthy();
		}
		expect(readsAsHealthy(SOURCE_STATUS.ok.tone)).toBe(true);
		for (const status of ["degraded", "failed", "unknown"] as const) {
			expect(readsAsHealthy(SOURCE_STATUS[status].tone)).toBe(false);
		}
	});
});

describe("alert presentation", () => {
	test("an open alert and an acknowledged alert look different", () => {
		expect(ALERT_STATE.open.label).not.toBe(ALERT_STATE.acknowledged.label);
		expect(ALERT_STATE.open.tone).not.toBe(ALERT_STATE.acknowledged.tone);
	});

	test("no alert state reads as healthy", () => {
		for (const state of ["open", "acknowledged", "closed"] as const) {
			expect(readsAsHealthy(ALERT_STATE[state].tone)).toBe(false);
		}
	});

	test("severities are ordered by visual weight and all distinct", () => {
		expect(ALERT_SEVERITY.info.tone).toBe("info");
		expect(ALERT_SEVERITY.warning.tone).toBe("warning");
		expect(ALERT_SEVERITY.critical.tone).toBe("error");
	});
});

describe("formatting", () => {
	test("an absent reading shows a dash, never a zero", () => {
		expect(formatReading(null, "V")).toBe("—");
		expect(formatReading(0, "V")).toBe("0 V");
	});

	test("a reading carries its unit", () => {
		expect(formatReading(12.6, "V")).toBe("12.6 V");
		expect(formatReading(12.6, null)).toBe("12.6");
	});

	test("an absent age says never, not just now", () => {
		expect(formatAge(null)).toBe("never");
		expect(formatAge(5)).toBe("5s ago");
		expect(formatAge(120)).toBe("2m ago");
		expect(formatAge(7200)).toBe("2h ago");
		expect(formatAge(60 * 60 * 72)).toBe("3d ago");
	});

	test("intervals render compactly", () => {
		expect(formatInterval(null)).toBe("—");
		expect(formatInterval(30)).toBe("30s");
		expect(formatInterval(300)).toBe("5m");
		expect(formatInterval(7200)).toBe("2h");
	});
});
