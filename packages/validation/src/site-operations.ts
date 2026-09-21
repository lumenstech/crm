import { z } from "zod";

export const SITE_ASSET_TYPES = [
	"generator",
	"battery",
	"ups",
	"electrical_panel",
	"pump",
	"hvac",
	"boiler",
	"water_heater",
	"elevator",
	"sensor",
	"network",
	"compute",
] as const;

export type SiteAssetType = (typeof SITE_ASSET_TYPES)[number];

export const PILOT_ASSET_TYPES = ["generator", "battery"] as const;

export const SITE_OPERATIONAL_STATUSES = [
	"normal",
	"attention",
	"critical",
	"unknown",
] as const;

export type SiteOperationalStatus = (typeof SITE_OPERATIONAL_STATUSES)[number];

export const SIGNAL_STATES = [
	"fresh",
	"stale",
	"missing",
	"source_failed",
	"invalid",
	"not_configured",
] as const;

export type SignalState = (typeof SIGNAL_STATES)[number];

export const OBSERVATION_VALIDATIONS = [
	"accepted",
	"invalid",
	"rejected",
] as const;

export type ObservationValidation = (typeof OBSERVATION_VALIDATIONS)[number];

export const SOURCE_HEALTH_STATUSES = [
	"ok",
	"degraded",
	"failed",
	"unknown",
] as const;

export type SourceHealthStatus = (typeof SOURCE_HEALTH_STATUSES)[number];

export const ALERT_STATES = ["open", "acknowledged", "closed"] as const;

export type AlertState = (typeof ALERT_STATES)[number];

export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;

export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_TYPES = ["threshold_breach"] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

export const THRESHOLD_KINDS = ["min", "max"] as const;

export type ThresholdKind = (typeof THRESHOLD_KINDS)[number];

export const SITE_METRICS = {
	BATTERY_VOLTAGE: "battery_voltage",
} as const;

export const siteOpsCommandId = z
	.string()
	.trim()
	.regex(
		/^siteops:[A-Za-z0-9_-]{1,64}:[a-z-]{1,32}:v\d{1,3}$/,
		"commandId must look like siteops:<alertId>:<action>:v1.",
	);

export function createTaskCommandId(alertId: string): string {
	return `siteops:${alertId}:create-task:v1`;
}

export function acknowledgeCommandId(alertId: string): string {
	return `siteops:${alertId}:acknowledge:v1`;
}

/**
 * Identifies the live breach for one asset, metric and direction. It is stored on
 * the alert while the alert is open or acknowledged, and set to NULL when it
 * closes, so a unique index allows one active alert and any number of closed ones.
 */
export function thresholdActiveKey(
	assetId: string,
	metric: string,
	kind: ThresholdKind,
): string {
	return `threshold:${assetId}:${metric}:${kind}`;
}

/**
 * Identifies one breach episode. It carries the observation that opened the alert,
 * so a later breach of the same condition is a new row and never overwrites the
 * provenance of the earlier one.
 */
export function thresholdOccurrenceKey(
	assetId: string,
	metric: string,
	kind: ThresholdKind,
	observationId: string,
): string {
	return `threshold:${assetId}:${metric}:${kind}:${observationId}`;
}

export function sourceHealthId(
	provider: string,
	siteId: string,
	assetId: string | null,
): string {
	return `${provider}:${siteId}:${assetId ?? "site"}`;
}

export type SiteObservationPayloadValue =
	| string
	| number
	| boolean
	| null
	| SiteObservationPayloadValue[]
	| { [key: string]: SiteObservationPayloadValue };

const siteObservationPayloadValue: z.ZodType<SiteObservationPayloadValue> =
	z.lazy(() =>
		z.union([
			z.string(),
			z.number().finite(),
			z.boolean(),
			z.null(),
			z.array(siteObservationPayloadValue),
			z.record(z.string(), siteObservationPayloadValue),
		]),
	);

export const siteObservationPayload = z.record(
	z.string(),
	siteObservationPayloadValue,
);

export type SiteObservationPayload = z.infer<typeof siteObservationPayload>;

export function parseSiteObservationPayload(
	value: unknown,
): SiteObservationPayload {
	return siteObservationPayload.parse(value ?? {});
}

export const siteAlertMetadata = z.object({
	acknowledgeNote: z.string().trim().max(500).optional(),
});

export type SiteAlertMetadata = z.infer<typeof siteAlertMetadata>;

export function parseSiteAlertMetadata(value: unknown): SiteAlertMetadata {
	return siteAlertMetadata.parse(value ?? {});
}

export const siteObservationEvidence = z.object({
	provider: z.string().trim().min(1).max(64),
	sourceEventId: z.string().trim().min(1).max(200),
	receivedAt: z.iso.datetime(),
	note: z.string().trim().max(500).optional(),
});

export type SiteObservationEvidence = z.infer<typeof siteObservationEvidence>;

export const siteTaskCommandData = z.object({
	siteId: z.string().min(1),
	assetId: z.string().min(1),
	alertId: z.string().min(1),
	title: z.string().trim().min(1).max(200),
	description: z.string().trim().max(2000),
	severity: z.enum(ALERT_SEVERITIES),
	reason: z.string().trim().min(1).max(500),
	observationId: z.string().nullable(),
	provider: z.string().nullable(),
	metric: z.string().nullable(),
	requestedBy: z.string().min(1),
	origin: z.object({
		provider: z.literal("lumens"),
		surface: z.literal("lumens-site-operations"),
	}),
});

export type SiteTaskCommandData = z.infer<typeof siteTaskCommandData>;

/**
 * The shape stored in `lumens_os_event.payload` for a site service-task command.
 * It crosses a boundary - Site Operations writes it, Lumens OS execution reads it -
 * so it is parsed rather than indexed into.
 */
export const siteTaskCommandEvent = z.object({
	version: z.literal(1),
	eventType: z.literal("task.create"),
	canonicalType: z.literal("alert"),
	canonicalId: z.string().min(1),
	businessUnitId: z.string().min(1),
	commandId: siteOpsCommandId,
	data: siteTaskCommandData,
});

export type SiteTaskCommandEvent = z.infer<typeof siteTaskCommandEvent>;

export function parseSiteTaskCommandEvent(
	value: unknown,
): SiteTaskCommandEvent {
	return siteTaskCommandEvent.parse(value);
}
