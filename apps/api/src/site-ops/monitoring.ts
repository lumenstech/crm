import type {
	AlertSeverity,
	SignalState,
	SiteOperationalStatus,
	SourceHealthStatus,
	ThresholdKind,
} from "@crm/validation/site-operations";
import { SITE_OPS } from "./site-ops-config";

export type ObservationFacts = {
	id: string;
	observedAt: Date;
	receivedAt: Date;
	numericValue: number | null;
	textValue: string | null;
	unit: string | null;
	provider: string;
	sourceEventId: string;
	validation: string;
	rejectionCode: string | null;
};

export type PolicyFacts = {
	metric: string;
	unit: string | null;
	enabled: boolean;
	expectedIntervalSeconds: number;
	staleAfterSeconds: number;
	minValue: number | null;
	maxValue: number | null;
	alertSeverity: string;
};

export type SourceHealthFacts = {
	provider: string;
	status: SourceHealthStatus;
	lastAttemptAt: Date | null;
	lastSuccessAt: Date | null;
	lastError: string | null;
	expectedIntervalSeconds: number;
};

export type MetricStateInput = {
	policy: PolicyFacts | null;
	latest: ObservationFacts | null;
	latestAccepted: ObservationFacts | null;
	sourceHealth: SourceHealthFacts | null;
	now: Date;
};

export type MetricState = {
	metric: string;
	state: SignalState;
	reason: string;
	value: number | null;
	unit: string | null;
	observedAt: Date | null;
	receivedAt: Date | null;
	ageSeconds: number | null;
	provider: string | null;
	sourceEventId: string | null;
	observationId: string | null;
	validation: string | null;
	staleAfterSeconds: number | null;
};

function ageSeconds(from: Date, now: Date): number {
	return Math.max(
		0,
		Math.round((now.getTime() - from.getTime()) / SITE_OPS.time.secondMs),
	);
}

function emptyState(
	metric: string,
	state: SignalState,
	reason: string,
	policy: PolicyFacts | null,
): MetricState {
	return {
		metric,
		state,
		reason,
		value: null,
		unit: policy?.unit ?? null,
		observedAt: null,
		receivedAt: null,
		ageSeconds: null,
		provider: null,
		sourceEventId: null,
		observationId: null,
		validation: null,
		staleAfterSeconds: policy?.staleAfterSeconds ?? null,
	};
}

function fromObservation(
	metric: string,
	state: SignalState,
	reason: string,
	observation: ObservationFacts,
	policy: PolicyFacts | null,
	now: Date,
): MetricState {
	return {
		metric,
		state,
		reason,
		value: observation.numericValue,
		unit: observation.unit ?? policy?.unit ?? null,
		observedAt: observation.observedAt,
		receivedAt: observation.receivedAt,
		ageSeconds: ageSeconds(observation.observedAt, now),
		provider: observation.provider,
		sourceEventId: observation.sourceEventId,
		observationId: observation.id,
		validation: observation.validation,
		staleAfterSeconds: policy?.staleAfterSeconds ?? null,
	};
}

/**
 * The single place a signal state is decided. The ladder is ordered, and the order
 * is the contract: a broken source outranks an old reading, and nothing usable is
 * never reported as healthy.
 */
export function deriveSignalState(input: MetricStateInput): MetricState {
	const { policy, latest, latestAccepted, sourceHealth, now } = input;
	const metric = policy?.metric ?? latest?.provider ?? "unknown";

	if (!policy || !policy.enabled) {
		return emptyState(
			metric,
			"not_configured",
			"No enabled monitoring policy expects this metric.",
			policy,
		);
	}

	if (sourceHealth?.status === "failed") {
		return emptyState(
			policy.metric,
			"source_failed",
			sourceHealth.lastError
				? `Source ${sourceHealth.provider} reports failure: ${sourceHealth.lastError}`
				: `Source ${sourceHealth.provider} reports failure.`,
			policy,
		);
	}

	if (
		latest &&
		latest.validation !== "accepted" &&
		ageSeconds(latest.observedAt, now) <= policy.staleAfterSeconds
	) {
		return fromObservation(
			policy.metric,
			"invalid",
			latest.rejectionCode
				? `Latest reading was rejected: ${latest.rejectionCode}.`
				: "Latest reading failed validation.",
			latest,
			policy,
			now,
		);
	}

	if (!latestAccepted) {
		return emptyState(
			policy.metric,
			"missing",
			`No accepted reading has been received. One is expected every ${policy.expectedIntervalSeconds}s.`,
			policy,
		);
	}

	const age = ageSeconds(latestAccepted.observedAt, now);
	if (age > policy.staleAfterSeconds) {
		return fromObservation(
			policy.metric,
			"stale",
			`Latest accepted reading is ${age}s old, past the ${policy.staleAfterSeconds}s threshold.`,
			latestAccepted,
			policy,
			now,
		);
	}

	return fromObservation(
		policy.metric,
		"fresh",
		`Reading is ${age}s old, inside the ${policy.staleAfterSeconds}s threshold.`,
		latestAccepted,
		policy,
		now,
	);
}

const UNHEALTHY_STATES = new Set<SignalState>([
	"stale",
	"missing",
	"source_failed",
	"invalid",
]);

export function isUnhealthy(state: SignalState): boolean {
	return UNHEALTHY_STATES.has(state);
}

/**
 * A site is only normal when something is being monitored and nothing is wrong.
 * Absent telemetry can never produce `normal`.
 */
export function siteStatusFrom(input: {
	metricStates: readonly SignalState[];
	openAlertSeverities: readonly AlertSeverity[];
}): SiteOperationalStatus {
	if (input.openAlertSeverities.includes("critical")) return "critical";
	if (input.openAlertSeverities.length > 0) return "attention";
	if (input.metricStates.some(isUnhealthy)) return "attention";
	const monitored = input.metricStates.filter(
		(state) => state !== "not_configured",
	);
	if (monitored.length === 0) return "unknown";
	return "normal";
}

export function assetStatusFrom(input: {
	metricStates: readonly SignalState[];
	openAlertSeverities: readonly AlertSeverity[];
}): SiteOperationalStatus {
	return siteStatusFrom(input);
}

export type ThresholdEvaluation = {
	kind: ThresholdKind;
	thresholdValue: number;
	observedValue: number;
	violated: boolean;
	severity: AlertSeverity;
	reason: string;
};

function severityOf(policy: PolicyFacts): AlertSeverity {
	const allowed: readonly AlertSeverity[] = ["info", "warning", "critical"];
	return allowed.includes(policy.alertSeverity as AlertSeverity)
		? (policy.alertSeverity as AlertSeverity)
		: "warning";
}

/**
 * Returns one evaluation per configured threshold direction, or `null` when the
 * reading cannot prove anything either way.
 *
 * `null` and "not violated" are different answers, and conflating them is how a
 * dead sensor closes a live alert. Only a fresh, accepted, numeric reading proves
 * a condition; stale, missing, source_failed, invalid and not_configured prove
 * nothing, so they return `null` and every open alert is left exactly as it is.
 */
export function evaluateThresholds(input: {
	state: MetricState;
	policy: PolicyFacts;
}): ThresholdEvaluation[] | null {
	const { state, policy } = input;
	if (state.state !== "fresh") return null;
	if (state.value === null) return null;
	if (state.validation !== "accepted") return null;

	const severity = severityOf(policy);
	const unit = state.unit ? ` ${state.unit}` : "";
	const value = state.value;
	const evaluations: ThresholdEvaluation[] = [];

	if (policy.minValue !== null) {
		const violated = value < policy.minValue;
		evaluations.push({
			kind: "min",
			thresholdValue: policy.minValue,
			observedValue: value,
			violated,
			severity,
			reason: violated
				? `${policy.metric} is ${value}${unit}, below the configured minimum of ${policy.minValue}${unit}.`
				: `${policy.metric} is ${value}${unit}, at or above the configured minimum of ${policy.minValue}${unit}.`,
		});
	}

	if (policy.maxValue !== null) {
		const violated = value > policy.maxValue;
		evaluations.push({
			kind: "max",
			thresholdValue: policy.maxValue,
			observedValue: value,
			violated,
			severity,
			reason: violated
				? `${policy.metric} is ${value}${unit}, above the configured maximum of ${policy.maxValue}${unit}.`
				: `${policy.metric} is ${value}${unit}, at or below the configured maximum of ${policy.maxValue}${unit}.`,
		});
	}

	return evaluations;
}

export function deriveSourceHealthStatus(input: {
	stored: SourceHealthStatus;
	lastSuccessAt: Date | null;
	expectedIntervalSeconds: number;
	now: Date;
}): SourceHealthStatus {
	if (input.stored === "failed") return "failed";
	if (!input.lastSuccessAt)
		return input.stored === "ok" ? "unknown" : input.stored;

	const age = ageSeconds(input.lastSuccessAt, input.now);
	if (
		age >
		input.expectedIntervalSeconds *
			SITE_OPS.sourceHealth.failedAfterMissedIntervals
	) {
		return "failed";
	}
	if (
		age >
		input.expectedIntervalSeconds *
			SITE_OPS.sourceHealth.degradedAfterMissedIntervals
	) {
		return "degraded";
	}
	return input.stored;
}
