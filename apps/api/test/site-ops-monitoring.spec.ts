import { describe, expect, test } from "bun:test";
import {
	deriveSignalState,
	deriveSourceHealthStatus,
	evaluateThresholds,
	type ObservationFacts,
	type PolicyFacts,
	type SourceHealthFacts,
	siteStatusFrom,
} from "../src/site-ops/monitoring";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
	return new Date(NOW.getTime() - minutes * 60_000);
}

const policy: PolicyFacts = {
	metric: "battery_voltage",
	unit: "V",
	enabled: true,
	expectedIntervalSeconds: 300,
	staleAfterSeconds: 900,
	minValue: 11.8,
	maxValue: 15.2,
	alertSeverity: "warning",
};

function observation(
	overrides: Partial<ObservationFacts> & { observedAt: Date },
): ObservationFacts {
	return {
		id: "obs-1",
		receivedAt: overrides.observedAt,
		numericValue: 12.6,
		textValue: null,
		unit: "V",
		provider: "energybms",
		sourceEventId: "evt-1",
		validation: "accepted",
		rejectionCode: null,
		...overrides,
	};
}

const okHealth: SourceHealthFacts = {
	provider: "energybms",
	status: "ok",
	lastAttemptAt: minutesAgo(1),
	lastSuccessAt: minutesAgo(1),
	lastError: null,
	expectedIntervalSeconds: 300,
};

describe("deriveSignalState", () => {
	test("fresh: a recent accepted reading inside the threshold", () => {
		const latest = observation({ observedAt: minutesAgo(2) });
		const state = deriveSignalState({
			policy,
			latest,
			latestAccepted: latest,
			sourceHealth: okHealth,
			now: NOW,
		});
		expect(state.state).toBe("fresh");
		expect(state.value).toBe(12.6);
		expect(state.ageSeconds).toBe(120);
	});

	test("stale: an accepted reading older than the threshold", () => {
		const latest = observation({ observedAt: minutesAgo(30) });
		const state = deriveSignalState({
			policy,
			latest,
			latestAccepted: latest,
			sourceHealth: okHealth,
			now: NOW,
		});
		expect(state.state).toBe("stale");
		expect(state.ageSeconds).toBe(1800);
		expect(state.value).toBe(12.6);
	});

	test("missing: a policy expects readings and none were accepted", () => {
		const state = deriveSignalState({
			policy,
			latest: null,
			latestAccepted: null,
			sourceHealth: okHealth,
			now: NOW,
		});
		expect(state.state).toBe("missing");
		expect(state.value).toBeNull();
		expect(state.observedAt).toBeNull();
	});

	test("source_failed: a failed source outranks a perfectly good reading", () => {
		const latest = observation({ observedAt: minutesAgo(1) });
		const state = deriveSignalState({
			policy,
			latest,
			latestAccepted: latest,
			sourceHealth: {
				...okHealth,
				status: "failed",
				lastError: "connection refused",
			},
			now: NOW,
		});
		expect(state.state).toBe("source_failed");
		expect(state.reason).toContain("connection refused");
	});

	test("invalid: a recent reading that failed validation", () => {
		const latest = observation({
			observedAt: minutesAgo(2),
			validation: "rejected",
			rejectionCode: "out_of_range",
			numericValue: null,
		});
		const state = deriveSignalState({
			policy,
			latest,
			latestAccepted: null,
			sourceHealth: okHealth,
			now: NOW,
		});
		expect(state.state).toBe("invalid");
		expect(state.reason).toContain("out_of_range");
	});

	test("not_configured: no policy is different from missing data", () => {
		const state = deriveSignalState({
			policy: null,
			latest: null,
			latestAccepted: null,
			sourceHealth: okHealth,
			now: NOW,
		});
		expect(state.state).toBe("not_configured");
	});

	test("a disabled policy reports not_configured, not missing", () => {
		const state = deriveSignalState({
			policy: { ...policy, enabled: false },
			latest: null,
			latestAccepted: null,
			sourceHealth: okHealth,
			now: NOW,
		});
		expect(state.state).toBe("not_configured");
	});

	test("an old invalid reading reads as missing, because nothing usable arrived", () => {
		const latest = observation({
			observedAt: minutesAgo(180),
			validation: "invalid",
			numericValue: null,
		});
		const state = deriveSignalState({
			policy,
			latest,
			latestAccepted: null,
			sourceHealth: okHealth,
			now: NOW,
		});
		expect(state.state).toBe("missing");
	});

	test("no state derived from absent telemetry is ever fresh", () => {
		for (const health of ["ok", "degraded", "failed", "unknown"] as const) {
			const state = deriveSignalState({
				policy,
				latest: null,
				latestAccepted: null,
				sourceHealth: { ...okHealth, status: health },
				now: NOW,
			});
			expect(state.state).not.toBe("fresh");
		}
	});
});

describe("siteStatusFrom", () => {
	test("all fresh with no alerts is normal", () => {
		expect(
			siteStatusFrom({
				metricStates: ["fresh", "fresh"],
				openAlertSeverities: [],
			}),
		).toBe("normal");
	});

	test("missing telemetry never reads as normal", () => {
		expect(
			siteStatusFrom({
				metricStates: ["fresh", "missing"],
				openAlertSeverities: [],
			}),
		).toBe("attention");
	});

	test("a failed source never reads as normal", () => {
		expect(
			siteStatusFrom({
				metricStates: ["source_failed"],
				openAlertSeverities: [],
			}),
		).toBe("attention");
	});

	test("a stale reading never reads as normal", () => {
		expect(
			siteStatusFrom({ metricStates: ["stale"], openAlertSeverities: [] }),
		).toBe("attention");
	});

	test("an invalid reading never reads as normal", () => {
		expect(
			siteStatusFrom({ metricStates: ["invalid"], openAlertSeverities: [] }),
		).toBe("attention");
	});

	test("a critical alert outranks everything", () => {
		expect(
			siteStatusFrom({
				metricStates: ["fresh"],
				openAlertSeverities: ["warning", "critical"],
			}),
		).toBe("critical");
	});

	test("nothing monitored is unknown, not normal", () => {
		expect(
			siteStatusFrom({
				metricStates: ["not_configured"],
				openAlertSeverities: [],
			}),
		).toBe("unknown");
		expect(siteStatusFrom({ metricStates: [], openAlertSeverities: [] })).toBe(
			"unknown",
		);
	});
});

describe("evaluateThresholds", () => {
	function stateFor(
		value: number,
		kind: "fresh" | "stale" | "invalid" = "fresh",
	) {
		const latest = observation({
			observedAt: minutesAgo(kind === "stale" ? 30 : 2),
			numericValue: kind === "invalid" ? null : value,
			validation: kind === "invalid" ? "rejected" : "accepted",
		});
		return deriveSignalState({
			policy,
			latest,
			latestAccepted: kind === "invalid" ? null : latest,
			sourceHealth: okHealth,
			now: NOW,
		});
	}

	function kindOf(value: number, kind: "min" | "max") {
		const result = evaluateThresholds({ state: stateFor(value), policy });
		return result?.find((entry) => entry.kind === kind);
	}

	test("a fresh reading below the minimum violates min and clears max", () => {
		expect(kindOf(11.2, "min")?.violated).toBe(true);
		expect(kindOf(11.2, "min")?.thresholdValue).toBe(11.8);
		expect(kindOf(11.2, "max")?.violated).toBe(false);
	});

	test("a fresh reading above the maximum violates max and clears min", () => {
		expect(kindOf(15.9, "max")?.violated).toBe(true);
		expect(kindOf(15.9, "min")?.violated).toBe(false);
	});

	test("a reading inside the band violates nothing", () => {
		const result = evaluateThresholds({ state: stateFor(12.6), policy });
		expect(result?.every((entry) => entry.violated === false)).toBe(true);
	});

	test("a stale reading proves nothing, so it returns null", () => {
		expect(
			evaluateThresholds({ state: stateFor(12.6, "stale"), policy }),
		).toBeNull();
	});

	test("an invalid reading proves nothing, so it returns null", () => {
		expect(
			evaluateThresholds({ state: stateFor(12.6, "invalid"), policy }),
		).toBeNull();
	});

	test("a missing reading proves nothing, so it returns null", () => {
		const state = deriveSignalState({
			policy,
			latest: null,
			latestAccepted: null,
			sourceHealth: okHealth,
			now: NOW,
		});
		expect(evaluateThresholds({ state, policy })).toBeNull();
	});

	test("a failed source proves nothing, so it returns null", () => {
		const latest = observation({
			observedAt: minutesAgo(1),
			numericValue: 12.6,
		});
		const state = deriveSignalState({
			policy,
			latest,
			latestAccepted: latest,
			sourceHealth: { ...okHealth, status: "failed" },
			now: NOW,
		});
		expect(evaluateThresholds({ state, policy })).toBeNull();
	});

	test("an unconfigured metric proves nothing, so it returns null", () => {
		const state = deriveSignalState({
			policy: { ...policy, enabled: false },
			latest: null,
			latestAccepted: null,
			sourceHealth: okHealth,
			now: NOW,
		});
		expect(
			evaluateThresholds({ state, policy: { ...policy, enabled: false } }),
		).toBeNull();
		expect(state.state).toBe("not_configured");
	});

	test("null and not-violated are different answers", () => {
		const cleared = evaluateThresholds({ state: stateFor(12.6), policy });
		const unproven = evaluateThresholds({
			state: stateFor(12.6, "stale"),
			policy,
		});
		expect(cleared).not.toBeNull();
		expect(unproven).toBeNull();
	});
});

describe("deriveSourceHealthStatus", () => {
	test("silence past the failure multiple becomes failed", () => {
		expect(
			deriveSourceHealthStatus({
				stored: "ok",
				lastSuccessAt: minutesAgo(60),
				expectedIntervalSeconds: 300,
				now: NOW,
			}),
		).toBe("failed");
	});

	test("silence past the degraded multiple becomes degraded", () => {
		expect(
			deriveSourceHealthStatus({
				stored: "ok",
				lastSuccessAt: minutesAgo(13),
				expectedIntervalSeconds: 300,
				now: NOW,
			}),
		).toBe("degraded");
	});

	test("a recent success stays ok", () => {
		expect(
			deriveSourceHealthStatus({
				stored: "ok",
				lastSuccessAt: minutesAgo(2),
				expectedIntervalSeconds: 300,
				now: NOW,
			}),
		).toBe("ok");
	});

	test("a source that never succeeded is unknown, not ok", () => {
		expect(
			deriveSourceHealthStatus({
				stored: "ok",
				lastSuccessAt: null,
				expectedIntervalSeconds: 300,
				now: NOW,
			}),
		).toBe("unknown");
	});
});
