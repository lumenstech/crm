import type { Db } from "@crm/db";
import type { SourceHealthStatus } from "@crm/validation/site-operations";
import { SITE_METRICS } from "@crm/validation/site-operations";
import type { SiteOpsIngestService } from "./site-ops-ingest.service";

export const PILOT = {
	businessUnitKey: "lumens-site-ops-pilot",
	businessUnitName: "Lumens Site Operations Pilot",
	siteCode: "GEO-01",
	siteName: "Georgetown Pilot Site",
	timezone: "America/Guyana",
	assetCode: "GEN-01",
	assetName: "Generator 1",
	provider: "energybms",
	metric: SITE_METRICS.BATTERY_VOLTAGE,
	unit: "V",
	expectedIntervalSeconds: 300,
	staleAfterSeconds: 900,
	minVoltage: 11.8,
	maxVoltage: 15.2,
	healthyVoltage: 12.6,
	lowVoltage: 11.2,
} as const;

export type PilotFixture = {
	businessUnitId: string;
	siteId: string;
	assetId: string;
};

function scoped(suffix: string, value: string): string {
	return `${value}-${suffix}`;
}

/**
 * The one-site, one-asset vertical slice. Deterministic: the same suffix always
 * produces the same identities, so a test can re-run without drift.
 */
export async function buildPilotFixture(
	db: Db,
	options: { suffix: string },
): Promise<PilotFixture> {
	const businessUnit = await db.businessUnit.upsert({
		where: { key: scoped(options.suffix, PILOT.businessUnitKey) },
		create: {
			key: scoped(options.suffix, PILOT.businessUnitKey),
			name: PILOT.businessUnitName,
		},
		update: {},
		select: { id: true },
	});

	const existingSite = await db.siteOpsSite.findUnique({
		where: {
			businessUnitId_code: {
				businessUnitId: businessUnit.id,
				code: PILOT.siteCode,
			},
		},
		select: { id: true },
	});
	const site =
		existingSite ??
		(await db.siteOpsSite.create({
			data: {
				businessUnitId: businessUnit.id,
				name: PILOT.siteName,
				code: PILOT.siteCode,
				addressLine: "1 Water Street",
				locality: "Georgetown",
				region: "Demerara-Mahaica",
				countryCode: "GY",
				timezone: PILOT.timezone,
				status: "unknown",
			},
			select: { id: true },
		}));

	const asset = await createAsset(db, {
		siteId: site.id,
		code: PILOT.assetCode,
		name: PILOT.assetName,
		assetType: "generator",
	});

	return { businessUnitId: businessUnit.id, siteId: site.id, assetId: asset };
}

export async function createAsset(
	db: Db,
	input: {
		siteId: string;
		code: string;
		name: string;
		assetType: string;
	},
): Promise<string> {
	const existing = await db.siteOpsAsset.findUnique({
		where: { siteId_code: { siteId: input.siteId, code: input.code } },
		select: { id: true },
	});
	if (existing) return existing.id;

	const created = await db.siteOpsAsset.create({
		data: {
			siteId: input.siteId,
			code: input.code,
			name: input.name,
			assetType: input.assetType,
			manufacturer: "Acme Power",
			model: "AP-500",
			operationalStatus: "unknown",
		},
		select: { id: true },
	});
	return created.id;
}

export async function createBatteryPolicy(
	db: Db,
	input: { assetId: string; enabled?: boolean },
): Promise<string> {
	const policy = await db.siteOpsMonitoringPolicy.upsert({
		where: {
			assetId_metric: { assetId: input.assetId, metric: PILOT.metric },
		},
		create: {
			assetId: input.assetId,
			metric: PILOT.metric,
			unit: PILOT.unit,
			expectedIntervalSeconds: PILOT.expectedIntervalSeconds,
			staleAfterSeconds: PILOT.staleAfterSeconds,
			enabled: input.enabled ?? true,
			minValue: PILOT.minVoltage,
			maxValue: PILOT.maxVoltage,
			alertSeverity: "warning",
		},
		update: { enabled: input.enabled ?? true },
		select: { id: true },
	});
	return policy.id;
}

export type SourceHealthFixture = {
	siteId: string;
	assetId: string | null;
	status: SourceHealthStatus;
	lastSuccessAt: Date | null;
	lastAttemptAt?: Date | null;
	lastError?: string | null;
};

export async function setSourceHealth(
	ingest: SiteOpsIngestService,
	input: SourceHealthFixture,
): Promise<string> {
	return ingest.recordSourceHealth({
		provider: PILOT.provider,
		siteId: input.siteId,
		assetId: input.assetId,
		status: input.status,
		lastSuccessAt: input.lastSuccessAt,
		lastAttemptAt: input.lastAttemptAt ?? input.lastSuccessAt,
		lastError: input.lastError ?? null,
		expectedIntervalSeconds: PILOT.expectedIntervalSeconds,
	});
}
