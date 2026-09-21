import type { StatusTone } from "@crm/ui/components/status-indicator";
import type {
	AlertSeverity,
	AlertState,
	SignalState,
	SiteOperationalStatus,
	SourceHealthStatus,
} from "@crm/validation/site-operations";

export type Presentation = {
	label: string;
	tone: StatusTone;
};

/**
 * Every state an operator can see, named by its condition rather than by a feeling.
 * Nothing that means "we have no usable data" is allowed a success tone.
 */
export const SIGNAL_STATE = {
	fresh: { label: "Fresh", tone: "success" },
	stale: { label: "Stale", tone: "warning" },
	missing: { label: "Missing", tone: "error" },
	source_failed: { label: "Source failed", tone: "error" },
	invalid: { label: "Invalid", tone: "warning" },
	not_configured: { label: "Not monitored", tone: "neutral" },
} satisfies Record<SignalState, Presentation>;

export const SITE_STATUS = {
	normal: { label: "Normal", tone: "success" },
	attention: { label: "Needs attention", tone: "warning" },
	critical: { label: "Critical", tone: "error" },
	unknown: { label: "Unknown", tone: "neutral" },
} satisfies Record<SiteOperationalStatus, Presentation>;

export const SOURCE_STATUS = {
	ok: { label: "Healthy", tone: "success" },
	degraded: { label: "Degraded", tone: "warning" },
	failed: { label: "Failed", tone: "error" },
	unknown: { label: "Unknown", tone: "neutral" },
} satisfies Record<SourceHealthStatus, Presentation>;

export const ALERT_SEVERITY = {
	info: { label: "Info", tone: "info" },
	warning: { label: "Warning", tone: "warning" },
	critical: { label: "Critical", tone: "error" },
} satisfies Record<AlertSeverity, Presentation>;

export const ALERT_STATE = {
	open: { label: "Open", tone: "error" },
	acknowledged: { label: "Acknowledged", tone: "info" },
	closed: { label: "Closed", tone: "neutral" },
} satisfies Record<AlertState, Presentation>;

const HEALTHY_TONES: ReadonlySet<StatusTone> = new Set<StatusTone>(["success"]);

/** The guard behind the rule that absent telemetry is never rendered as healthy. */
export function readsAsHealthy(tone: StatusTone): boolean {
	return HEALTHY_TONES.has(tone);
}

export function formatAge(seconds: number | null): string {
	if (seconds === null) return "never";
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export function formatInterval(seconds: number | null): string {
	if (seconds === null) return "—";
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.round(minutes / 60)}h`;
}

/**
 * A value is never shown without its age. When there is no value there is no
 * number to show, and the state label carries the meaning instead.
 */
export function formatReading(
	value: number | null,
	unit: string | null,
): string {
	if (value === null) return "—";
	return unit ? `${value} ${unit}` : `${value}`;
}
