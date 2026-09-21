import {
	ALERT_SEVERITIES,
	ALERT_STATES,
	ALERT_TYPES,
	OBSERVATION_VALIDATIONS,
	SIGNAL_STATES,
	SITE_ASSET_TYPES,
	SITE_OPERATIONAL_STATUSES,
	SOURCE_HEALTH_STATUSES,
	siteOpsCommandId,
	THRESHOLD_KINDS,
} from "@crm/validation/site-operations";
import { z } from "zod";
import { SITE_OPS } from "./site-ops-config";

const isoDate = z.string();
const nullableIsoDate = isoDate.nullable();

export const siteOverviewInput = z.object({
	siteId: z.string().trim().min(1).max(64),
});

export const assetDetailInput = z.object({
	assetId: z.string().trim().min(1).max(64),
	historyLimit: z
		.number()
		.int()
		.min(1)
		.max(SITE_OPS.observation.historyMaxLimit)
		.default(SITE_OPS.observation.historyLimit),
});

export const siteListInput = z.object({
	status: z.enum(SITE_OPERATIONAL_STATUSES).nullable().default(null),
});

export const acknowledgeAlertInput = z.object({
	alertId: z.string().trim().min(1).max(64),
	commandId: siteOpsCommandId,
	note: z.string().trim().max(500).nullable().default(null),
});

export const createTaskFromAlertInput = z.object({
	alertId: z.string().trim().min(1).max(64),
	commandId: siteOpsCommandId,
	title: z.string().trim().min(1).max(SITE_OPS.alert.maxTitleLength),
	description: z
		.string()
		.trim()
		.max(SITE_OPS.alert.maxDescriptionLength)
		.default(""),
});

const metricState = z.object({
	metric: z.string(),
	state: z.enum(SIGNAL_STATES),
	reason: z.string(),
	value: z.number().nullable(),
	unit: z.string().nullable(),
	observedAt: nullableIsoDate,
	receivedAt: nullableIsoDate,
	ageSeconds: z.number().nullable(),
	provider: z.string().nullable(),
	sourceEventId: z.string().nullable(),
	observationId: z.string().nullable(),
	validation: z.string().nullable(),
	staleAfterSeconds: z.number().nullable(),
});

const assetSummary = z.object({
	id: z.string(),
	siteId: z.string(),
	code: z.string(),
	name: z.string(),
	assetType: z.enum(SITE_ASSET_TYPES),
	manufacturer: z.string().nullable(),
	model: z.string().nullable(),
	serialNumber: z.string().nullable(),
	externalReference: z.string().nullable(),
	operationalStatus: z.enum(SITE_OPERATIONAL_STATUSES),
	metricStates: z.array(metricState),
	openAlertCount: z.number().int(),
});

const alertSummary = z.object({
	id: z.string(),
	siteId: z.string(),
	siteName: z.string(),
	assetId: z.string(),
	assetName: z.string(),
	observationId: z.string().nullable(),
	alertType: z.enum(ALERT_TYPES),
	severity: z.enum(ALERT_SEVERITIES),
	state: z.enum(ALERT_STATES),
	reason: z.string(),
	provider: z.string().nullable(),
	metric: z.string().nullable(),
	observedValue: z.number().nullable(),
	thresholdKind: z.enum(THRESHOLD_KINDS).nullable(),
	thresholdValue: z.number().nullable(),
	openedAt: isoDate,
	ageSeconds: z.number().int(),
	acknowledgedAt: nullableIsoDate,
	acknowledgedBy: z.string().nullable(),
	acknowledgedByName: z.string().nullable(),
	closedAt: nullableIsoDate,
	lumensOsEventId: z.string().nullable(),
	serviceTaskStatus: z.string().nullable(),
});

const sourceHealthSummary = z.object({
	provider: z.string(),
	siteId: z.string(),
	assetId: z.string().nullable(),
	assetName: z.string().nullable(),
	status: z.enum(SOURCE_HEALTH_STATUSES),
	lastAttemptAt: nullableIsoDate,
	lastSuccessAt: nullableIsoDate,
	lastError: z.string().nullable(),
	expectedIntervalSeconds: z.number().int(),
	secondsSinceSuccess: z.number().int().nullable(),
});

const siteSummary = z.object({
	id: z.string(),
	code: z.string(),
	name: z.string(),
	timezone: z.string(),
	status: z.enum(SITE_OPERATIONAL_STATUSES),
	addressLine: z.string().nullable(),
	locality: z.string().nullable(),
	region: z.string().nullable(),
	countryCode: z.string().nullable(),
	companyId: z.string().nullable(),
	companyName: z.string().nullable(),
	assetCount: z.number().int(),
	openAlertCount: z.number().int(),
	unhealthySourceCount: z.number().int(),
	lastObservationAt: nullableIsoDate,
});

export const siteOverviewOutput = z.object({
	site: siteSummary,
	assets: z.array(assetSummary),
	activeAlerts: z.array(alertSummary),
	sourceHealth: z.array(sourceHealthSummary),
});

export const siteListOutput = z.object({
	sites: z.array(siteSummary),
});

export const operationsOverviewOutput = z.object({
	siteCount: z.number().int(),
	sitesNeedingAttention: z.number().int(),
	activeAlertCount: z.number().int(),
	criticalAlertCount: z.number().int(),
	failedSourceCount: z.number().int(),
	staleSourceCount: z.number().int(),
	openServiceTaskCount: z.number().int(),
	sites: z.array(siteSummary),
});

export const assetDetailOutput = z.object({
	asset: assetSummary,
	site: siteSummary,
	policies: z.array(
		z.object({
			id: z.string(),
			metric: z.string(),
			unit: z.string().nullable(),
			enabled: z.boolean(),
			expectedIntervalSeconds: z.number().int(),
			staleAfterSeconds: z.number().int(),
			minValue: z.number().nullable(),
			maxValue: z.number().nullable(),
			alertSeverity: z.enum(ALERT_SEVERITIES),
		}),
	),
	observations: z.array(
		z.object({
			id: z.string(),
			provider: z.string(),
			sourceEventId: z.string(),
			metric: z.string(),
			numericValue: z.number().nullable(),
			textValue: z.string().nullable(),
			unit: z.string().nullable(),
			observedAt: isoDate,
			receivedAt: isoDate,
			validation: z.enum(OBSERVATION_VALIDATIONS),
			rejectionCode: z.string().nullable(),
			evidenceRef: z.string().nullable(),
		}),
	),
	openAlerts: z.array(alertSummary),
	sourceHealth: z.array(sourceHealthSummary),
	serviceTasks: z.array(
		z.object({
			eventId: z.string(),
			alertId: z.string().nullable(),
			status: z.string(),
			attempts: z.number().int(),
			lastError: z.string().nullable(),
			createdAt: isoDate,
			processedAt: nullableIsoDate,
		}),
	),
});

export const acknowledgeAlertOutput = z.object({
	alert: alertSummary,
	changed: z.boolean(),
});

export const createTaskFromAlertOutput = z.object({
	accepted: z.literal(true),
	created: z.boolean(),
	eventId: z.string(),
	alertId: z.string(),
	status: z.string(),
});

export type SiteOverviewInput = z.infer<typeof siteOverviewInput>;
export type AssetDetailInput = z.infer<typeof assetDetailInput>;
export type SiteListInput = z.infer<typeof siteListInput>;
export type AcknowledgeAlertInput = z.infer<typeof acknowledgeAlertInput>;
export type CreateTaskFromAlertInput = z.infer<typeof createTaskFromAlertInput>;
export type SiteSummary = z.infer<typeof siteSummary>;
export type AssetSummary = z.infer<typeof assetSummary>;
export type AlertSummary = z.infer<typeof alertSummary>;
export type SourceHealthSummary = z.infer<typeof sourceHealthSummary>;
export type MetricStateDto = z.infer<typeof metricState>;
export type SiteOverviewOutput = z.infer<typeof siteOverviewOutput>;
export type OperationsOverviewOutput = z.infer<typeof operationsOverviewOutput>;
export type AssetDetailOutput = z.infer<typeof assetDetailOutput>;
export type AcknowledgeAlertOutput = z.infer<typeof acknowledgeAlertOutput>;
export type CreateTaskFromAlertOutput = z.infer<
	typeof createTaskFromAlertOutput
>;
